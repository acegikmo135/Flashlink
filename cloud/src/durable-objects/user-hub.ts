import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { randomId, sha256Hex, signToken } from "../lib/crypto";
import { selectDevice, isReachable, type Failure } from "../devices/select";
import type { NormalizedManifest } from "../jobs/manifest";
import { isTerminal, type AgentRecord, type DeviceRecord, type Job, type JobStatus, type ToolchainInfo } from "../jobs/types";
import { FAMILIES } from "../boards";

/**
 * UserHub — one Durable Object per account.
 *
 * Owns: the desktop agents' WebSocket connections (hibernation API), the device
 * registry, the job state machine and command routing. Firmware bytes never
 * pass through here (see TransferRelay).
 */

const JOB_TTL_MS = 15 * 60_000;
const FLASH_PHASE_TTL_MS = 10 * 60_000;
const STALE_AGENT_MS = 90_000;
const MAX_STORED_TERMINAL_JOBS = 30;
const MAX_LOG_LINES = 60;
const DEVICE_RETENTION_MS = 24 * 3600_000;

interface HubState {
  user_id: string | null;
  version: number;
  agents: Record<string, AgentRecord>;
  devices: Record<string, DeviceRecord>;
}

interface Attachment {
  agentId: string;
  connectedAt: number;
}

interface Pending {
  resolve: (r: CommandOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  agentId: string;
}

export type CommandOutcome = { ok: true; data: Record<string, unknown> } | Failure;

class Signal {
  private waiters = new Set<() => void>();
  notify() {
    const w = [...this.waiters];
    this.waiters.clear();
    w.forEach((f) => f());
  }
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }
}

export interface CreateJobInput {
  user_id: string;
  manifest: NormalizedManifest;
  kind: "flash" | "verify";
  device_id?: string;
  verify: boolean;
  boot_log_seconds: number;
  base_url: string;
}

export type CreateJobResult =
  | { ok: true; created: boolean; job: Job; upload_token: string; uploads: { index: number; filename: string; size: number; sha256: string; url: string }[] }
  | Failure;

function fail(code: Failure["error"]["code"], message: string, extra: { hint?: string; details?: unknown } = {}): Failure {
  return { ok: false, error: { code, message, ...extra } };
}

export class UserHub extends DurableObject<Env> {
  private state: HubState = { user_id: null, version: 0, agents: {}, devices: {} };
  private jobs = new Map<string, Job>();
  private pending = new Map<string, Pending>();
  private registrySignal = new Signal();
  private jobSignal = new Signal();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.ctx.storage.get<HubState>("state");
      if (s) this.state = s;
      const stored = await this.ctx.storage.list<Job>({ prefix: "job:" });
      for (const [, j] of stored) this.jobs.set(j.id, j);
    });
  }

  // ------------------------------------------------------------ persistence

  private async saveState() {
    await this.ctx.storage.put("state", this.state);
  }

  private async saveJob(job: Job) {
    job.updated_at = Date.now();
    this.jobs.set(job.id, job);
    await this.ctx.storage.put(`job:${job.id}`, job);
    this.jobSignal.notify();
  }

  private async pruneJobs() {
    const terminal = [...this.jobs.values()].filter((j) => isTerminal(j.status)).sort((a, b) => b.created_at - a.created_at);
    for (const j of terminal.slice(MAX_STORED_TERMINAL_JOBS)) {
      this.jobs.delete(j.id);
      await this.ctx.storage.delete(`job:${j.id}`);
    }
  }

  private async dbUpsertJob(job: Job) {
    const summary = JSON.stringify({
      files: job.manifest.files.map((f) => ({ filename: f.filename, address: f.address_hex, size: f.size, sha256: f.sha256 })),
      result: job.result ?? null,
      error: job.error ?? null,
    }).slice(0, 12_000);
    await this.env.DB.prepare(
      `INSERT INTO jobs (user_id, id, agent_id, device_id, kind, board, family, status, error_code, summary, created_at, updated_at, finished_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
       ON CONFLICT(user_id, id) DO UPDATE SET status=?8, error_code=?9, summary=?10, updated_at=?12, finished_at=?13`,
    )
      .bind(job.user_id, job.id, job.agent_id, job.device_id, job.kind, job.manifest.target.board, job.manifest.target.family, job.status, job.error?.code ?? null, summary, job.created_at, Date.now(), job.finished_at ?? null)
      .run()
      .catch(() => undefined);
  }

  // ------------------------------------------------------------- websockets

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const agentId = request.headers.get("x-agent-id");
    const userId = request.headers.get("x-user-id");
    const name = request.headers.get("x-agent-name") ?? "Desktop";
    if (!agentId || !userId) return new Response("unauthorized", { status: 401 });

    if (!this.state.user_id) this.state.user_id = userId;
    // Only one live connection per agent: the newest wins.
    for (const old of this.ctx.getWebSockets(`agent:${agentId}`)) {
      try {
        old.close(4000, "replaced by a newer connection");
      } catch {
        /* already closed */
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [`agent:${agentId}`]);
    const att: Attachment = { agentId, connectedAt: Date.now() };
    server.serializeAttachment(att);

    const prev = this.state.agents[agentId];
    this.state.agents[agentId] = {
      id: agentId,
      name,
      connected: true,
      connected_at: att.connectedAt,
      last_seen: att.connectedAt,
      version: prev?.version ?? null,
      os: prev?.os ?? null,
      toolchains: prev?.toolchains ?? {},
    };
    await this.saveState();
    server.send(JSON.stringify({ type: "welcome", protocol: 1, server_time: Date.now() }));
    await this.scheduleAlarm();
    this.registrySignal.notify();
    return new Response(null, { status: 101, webSocket: client });
  }

  private agentOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.agentId ?? null;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const agentId = this.agentOf(ws);
    if (!agentId) return;
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const agent = this.state.agents[agentId];
    if (agent) agent.last_seen = Date.now();
    switch (msg.type) {
      case "hello":
        return this.onHello(agentId, ws, msg);
      case "devices":
        return this.onDevices(agentId, msg.devices);
      case "job.update":
        return this.onJobUpdate(agentId, msg);
      case "job.result":
        return this.onJobResult(agentId, msg);
      case "command.result":
        return this.onCommandResult(agentId, msg);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket) {
    const agentId = this.agentOf(ws);
    if (!agentId) return;
    const stillOpen = this.ctx.getWebSockets(`agent:${agentId}`).filter((w) => w !== ws && w.readyState === WebSocket.READY_STATE_OPEN);
    if (stillOpen.length) return;
    const agent = this.state.agents[agentId];
    if (agent) agent.connected = false;
    // outstanding commands can never be answered now
    for (const [id, p] of this.pending) {
      if (p.agentId === agentId) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve(fail("AGENT_DISCONNECTED", "The desktop app disconnected before answering."));
      }
    }
    await this.saveState();
    this.registrySignal.notify();
    await this.scheduleAlarm();
  }

  private send(agentId: string, msg: unknown): boolean {
    const sockets = this.ctx.getWebSockets(`agent:${agentId}`);
    for (const s of sockets) {
      if (s.readyState === WebSocket.READY_STATE_OPEN) {
        s.send(JSON.stringify(msg));
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------- inbound messages

  private async onHello(agentId: string, _ws: WebSocket, msg: Record<string, any>) {
    const agent = this.state.agents[agentId];
    if (agent) {
      agent.version = typeof msg.agent_version === "string" ? msg.agent_version.slice(0, 32) : null;
      agent.os = typeof msg.os === "string" ? msg.os.slice(0, 64) : null;
      if (typeof msg.hostname === "string") agent.name = msg.hostname.slice(0, 64);
      agent.toolchains = sanitizeToolchains(msg.toolchains);
    }
    await this.saveState();

    const active = new Set<string>(Array.isArray(msg.active_jobs) ? msg.active_jobs.filter((x: unknown) => typeof x === "string") : []);
    for (const job of this.jobs.values()) {
      if (job.agent_id !== agentId || isTerminal(job.status)) continue;
      if (!job.accepted_at) {
        await this.dispatchJob(job); // agent was offline when the job was created
      } else if (!active.has(job.id)) {
        await this.finishJob(job, "failed", { code: "AGENT_DISCONNECTED", message: "The desktop app restarted while this job was running." });
      }
    }
  }

  private async onDevices(agentId: string, list: unknown) {
    if (!Array.isArray(list)) return;
    const now = Date.now();
    const seen = new Set<string>();
    let changed = false;
    for (const raw of list.slice(0, 64)) {
      const d = sanitizeDevice(raw, agentId);
      if (!d) continue;
      seen.add(d.id);
      const ex = this.state.devices[d.id];
      if (!ex) {
        this.state.devices[d.id] = { ...d, first_seen: now, last_seen: now, added_version: ++this.state.version, removed_version: 0, busy: false };
        changed = true;
        continue;
      }
      const wasConnected = ex.connected;
      const before = JSON.stringify({ ...ex, last_seen: 0 });
      Object.assign(ex, d, { last_seen: now, first_seen: ex.first_seen, added_version: ex.added_version, removed_version: ex.removed_version });
      if (!wasConnected) {
        ex.added_version = ++this.state.version;
        changed = true;
      } else if (JSON.stringify({ ...ex, last_seen: 0 }) !== before) changed = true;
    }
    for (const ex of Object.values(this.state.devices)) {
      if (ex.agent_id === agentId && ex.connected && !seen.has(ex.id)) {
        ex.connected = false;
        ex.removed_version = ++this.state.version;
        changed = true;
        for (const job of this.jobs.values()) {
          if (job.device_id === ex.id && !isTerminal(job.status)) {
            await this.finishJob(job, "failed", { code: "DEVICE_DISCONNECTED", message: `Device ${ex.port ?? ex.id} was unplugged during the job.` });
          }
        }
      }
    }
    for (const [id, ex] of Object.entries(this.state.devices)) {
      if (!ex.connected && now - ex.last_seen > DEVICE_RETENTION_MS) delete this.state.devices[id];
    }
    if (changed) {
      await this.saveState();
      this.registrySignal.notify();
    }
  }

  private async onJobUpdate(agentId: string, msg: Record<string, any>) {
    const job = this.jobs.get(String(msg.job_id));
    if (!job || job.agent_id !== agentId || isTerminal(job.status)) return;
    if (!job.accepted_at) job.accepted_at = Date.now();
    const status = msg.status as JobStatus;
    if (["transferring", "flashing", "verifying"].includes(status)) {
      if (status !== job.status && (status === "flashing" || status === "verifying")) job.expires_at = Date.now() + FLASH_PHASE_TTL_MS;
      job.status = status;
    } else if (job.status === "awaiting_upload" && msg.accepted) {
      // accepted, still waiting for bytes
    }
    job.progress = {
      phase: String(msg.phase ?? job.status).slice(0, 40),
      percent: clampPct(msg.percent),
      file: typeof msg.file === "string" ? msg.file.slice(0, 64) : undefined,
      message: typeof msg.message === "string" ? msg.message.slice(0, 300) : undefined,
    };
    if (Array.isArray(msg.files)) {
      job.files = job.manifest.files.map((f) => {
        const u = (msg.files as any[]).find((x) => x?.filename === f.filename);
        return { filename: f.filename, size: f.size, transferred: Math.min(f.size, Math.max(0, Number(u?.transferred ?? 0) || 0)), verified_sha256: !!u?.verified_sha256 };
      });
    }
    if (job.progress.message) {
      job.log.push(job.progress.message);
      if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
    }
    await this.saveJob(job);
    await this.dbUpsertJob(job);
  }

  private async onJobResult(agentId: string, msg: Record<string, any>) {
    const job = this.jobs.get(String(msg.job_id));
    if (!job || job.agent_id !== agentId || isTerminal(job.status)) return;
    const status = String(msg.status);
    const result = msg.result && typeof msg.result === "object" ? (msg.result as Record<string, unknown>) : {};
    if (status === "completed") {
      // Success must be explicitly confirmed by the desktop agent.
      const wantsVerify = job.kind === "verify" || job.options.verify;
      if (result.confirmed_by_agent !== true || (wantsVerify && result.verified !== true)) {
        return this.finishJob(job, "failed", { code: "INTERNAL", message: "Agent reported completion without hardware confirmation; treating as failed." }, result);
      }
      return this.finishJob(job, "completed", undefined, result);
    }
    const allowed = ["failed", "verification_failed", "cancelled"];
    const err = msg.error && typeof msg.error === "object" ? msg.error : { code: "FLASH_FAILED", message: "Agent reported failure." };
    return this.finishJob(job, (allowed.includes(status) ? status : "failed") as JobStatus, { code: String(err.code ?? "FLASH_FAILED"), message: String(err.message ?? "").slice(0, 500), details: err.details }, result);
  }

  private onCommandResult(agentId: string, msg: Record<string, any>) {
    const p = this.pending.get(String(msg.id));
    if (!p || p.agentId !== agentId) return;
    clearTimeout(p.timer);
    this.pending.delete(String(msg.id));
    if (msg.ok) p.resolve({ ok: true, data: (msg.data && typeof msg.data === "object" ? msg.data : {}) as Record<string, unknown> });
    else {
      const e = msg.error ?? {};
      p.resolve(fail((e.code as any) ?? "INTERNAL", String(e.message ?? "Command failed").slice(0, 500), { details: e.details, hint: e.hint }));
    }
  }

  // --------------------------------------------------------------- jobs

  private async finishJob(job: Job, status: JobStatus, error?: Job["error"], result?: Record<string, unknown>) {
    if (isTerminal(job.status)) return;
    job.status = status;
    job.finished_at = Date.now();
    if (error) job.error = error;
    if (result) job.result = result;
    job.progress = { ...job.progress, phase: status, percent: status === "completed" ? 100 : job.progress.percent };
    await this.saveJob(job);
    await this.dbUpsertJob(job);
    await this.pruneJobs();
    // free the relay immediately
    if (status !== "completed") await this.abortRelay(job);
  }

  private async abortRelay(job: Job) {
    try {
      const stub = this.env.TRANSFER_RELAY.get(this.env.TRANSFER_RELAY.idFromName(`${job.user_id}:${job.id}`));
      await stub.fetch("https://relay/abort", {
        method: "POST",
        headers: { "x-relay-spec": JSON.stringify({ files: job.manifest.files.map((f) => ({ size: f.size, sha256: f.sha256 })) }) },
      });
    } catch {
      /* relay may not exist (never used) */
    }
  }

  private async dispatchJob(job: Job, baseUrl?: string) {
    const files = job.manifest.files.map((f) => ({ size: f.size, sha256: f.sha256 }));
    const expMs = job.expires_at;
    const dl = await signToken(this.env.JOB_SIGNING_KEY, { t: "dl", uid: job.user_id, jid: job.id, aid: job.agent_id, exp: expMs, files });
    const base = baseUrl ?? (await this.ctx.storage.get<string>("base_url")) ?? "";
    this.send(job.agent_id, {
      type: "job.new",
      job_id: job.id,
      kind: job.kind,
      device_id: job.device_id,
      manifest: job.manifest,
      options: job.options,
      expires_at: job.expires_at,
      download_token: dl,
      files: job.manifest.files.map((f, i) => ({ index: i, filename: f.filename, size: f.size, sha256: f.sha256, url: `${base}/api/transfers/${job.id}/${i}` })),
    });
  }

  async createJob(input: CreateJobInput): Promise<CreateJobResult> {
    this.state.user_id = input.user_id;
    await this.ctx.storage.put("base_url", input.base_url);
    const m = input.manifest;
    const digest = await sha256Hex(JSON.stringify(m) + "|" + input.kind + "|" + input.verify + "|" + input.boot_log_seconds);

    const existing = this.jobs.get(m.job_id);
    if (existing) {
      if (existing.manifest_digest === digest && (!input.device_id || existing.device_id === input.device_id)) {
        return { ok: true, created: false, job: existing, ...(await this.uploadInfo(existing, input.base_url)) };
      }
      return fail("JOB_CONFLICT", `Job id '${m.job_id}' already exists with a different manifest or options.`, { hint: "Use a new unique job_id for a different firmware package." });
    }

    const devices = Object.values(this.state.devices);
    const sel = selectDevice(devices, this.state.agents, input.device_id);
    if (!sel.ok) return sel;
    const dev = sel.device;
    const agent = this.state.agents[dev.agent_id];

    if (!dev.supported) return fail("UNSUPPORTED_MCU", `Device on ${dev.port ?? "?"} (${dev.usb.description ?? "unknown"}) is not a supported programmable MCU.`, { details: { notes: dev.notes } });
    if (!dev.allowed) return fail("DEVICE_NOT_ALLOWED", "The user has not allowed remote flashing for this device in the MCU Bridge desktop app.", { hint: "Ask the user to open MCU Bridge, select the device and enable 'Allow remote flashing'." });
    if (dev.family && dev.family !== m.target.family) {
      return fail("TARGET_MISMATCH", `Firmware targets '${m.target.family}' but the connected device is '${dev.family}'${dev.chip ? ` (${dev.chip})` : ""}.`, { hint: "Rebuild for the correct target or choose another device_id." });
    }
    const tool = FAMILIES[m.target.family]?.tool;
    if (dev.missing.length) return fail(tool === "stm32" || tool === "wlink" ? "PROGRAMMER_MISSING" : "TOOLCHAIN_MISSING", `Required flashing tooling is missing on the desktop: ${dev.missing.join(", ")}.`, { details: { missing: dev.missing } });
    if (!dev.capabilities.includes("flash")) return fail("UNSUPPORTED_MCU", "This device has no flashing capability in the desktop app.");
    for (const j of this.jobs.values()) {
      if (j.device_id === dev.id && !isTerminal(j.status)) return fail("FLASH_IN_PROGRESS", `Job '${j.id}' is already ${j.status} on this device.`, { details: { job_id: j.id, status: j.status } });
    }
    if (!agent?.connected) return fail("NO_AGENT_CONNECTED", "Desktop app is offline.");

    const now = Date.now();
    const job: Job = {
      id: m.job_id,
      user_id: input.user_id,
      agent_id: dev.agent_id,
      device_id: dev.id,
      kind: input.kind,
      manifest: m,
      manifest_digest: digest,
      options: { verify: input.verify, boot_log_seconds: input.boot_log_seconds },
      status: "awaiting_upload",
      progress: { phase: "awaiting_upload", percent: 0, message: "Waiting for firmware upload" },
      files: m.files.map((f) => ({ filename: f.filename, size: f.size, transferred: 0, verified_sha256: false })),
      created_at: now,
      updated_at: now,
      expires_at: now + JOB_TTL_MS,
      log: [],
    };
    await this.saveJob(job);
    await this.dbUpsertJob(job);
    await this.dispatchJob(job, input.base_url);
    await this.scheduleAlarm();
    return { ok: true, created: true, job, ...(await this.uploadInfo(job, input.base_url)) };
  }

  private async uploadInfo(job: Job, base: string) {
    const files = job.manifest.files.map((f) => ({ size: f.size, sha256: f.sha256 }));
    const upload_token = await signToken(this.env.JOB_SIGNING_KEY, { t: "ul", uid: job.user_id, jid: job.id, exp: job.expires_at, files });
    return {
      upload_token,
      uploads: job.manifest.files.map((f, i) => ({ index: i, filename: f.filename, size: f.size, sha256: f.sha256, url: `${base}/api/uploads/${job.id}/${i}` })),
    };
  }

  async getJob(jobId: string, waitMs = 0, sinceUpdatedAt = 0): Promise<Job | null> {
    let job = this.jobs.get(jobId) ?? null;
    if (job && waitMs > 0 && !isTerminal(job.status)) {
      const deadline = Date.now() + Math.min(waitMs, 25_000);
      const since = sinceUpdatedAt < 0 ? job.updated_at : sinceUpdatedAt;
      while (job && !isTerminal(job.status) && job.updated_at <= since && Date.now() < deadline) {
        await this.jobSignal.wait(Math.max(100, deadline - Date.now()));
        job = this.jobs.get(jobId) ?? null;
      }
    }
    return job;
  }

  async listJobs(): Promise<Job[]> {
    return [...this.jobs.values()].sort((a, b) => b.created_at - a.created_at);
  }

  async cancelJob(jobId: string): Promise<{ ok: true; job: Job; note: string } | Failure> {
    const job = this.jobs.get(jobId);
    if (!job) return fail("JOB_NOT_FOUND", `No active or recent job '${jobId}'.`);
    if (isTerminal(job.status)) return { ok: true, job, note: `Job already ${job.status}; nothing to cancel.` };
    job.cancel_requested = true;
    await this.saveJob(job);
    const delivered = this.send(job.agent_id, { type: "job.cancel", job_id: job.id });
    await this.abortRelay(job);
    if (!delivered || job.status === "awaiting_upload") {
      await this.finishJob(job, "cancelled", { code: "CANCELLED", message: "Cancelled before flashing started." });
      return { ok: true, job: this.jobs.get(jobId)!, note: "Cancelled before any flashing started; device untouched." };
    }
    // Agent confirms with job.result(cancelled); give it a moment.
    const j2 = await this.getJob(jobId, 8000);
    const note = j2 && isTerminal(j2.status) ? "Cancelled." : "Cancel requested; the agent is stopping the current step. Poll get_flash_job. A cancelled flash may leave the device in a partially written state.";
    return { ok: true, job: j2 ?? job, note };
  }

  // ---------------------------------------------------------------- queries

  async snapshot(): Promise<{ version: number; agents: AgentRecord[]; devices: DeviceRecord[] }> {
    const busyDevices = new Set([...this.jobs.values()].filter((j) => !isTerminal(j.status)).map((j) => j.device_id));
    const devices = Object.values(this.state.devices)
      .map((d) => ({ ...d, busy: busyDevices.has(d.id) }))
      .sort((a, b) => a.first_seen - b.first_seen);
    return { version: this.state.version, agents: Object.values(this.state.agents), devices };
  }

  async changesSince(since: number, waitMs: number): Promise<{ version: number; added: DeviceRecord[]; removed: DeviceRecord[] }> {
    const deadline = Date.now() + Math.min(waitMs, 25_000);
    for (;;) {
      if (this.state.version > since || Date.now() >= deadline) break;
      await this.registrySignal.wait(Math.max(100, deadline - Date.now()));
    }
    const all = Object.values(this.state.devices);
    return {
      version: this.state.version,
      added: all.filter((d) => d.connected && d.added_version > since),
      removed: all.filter((d) => !d.connected && d.removed_version > since),
    };
  }

  /** Send a fixed-vocabulary command to the agent owning `deviceId`. */
  async command(deviceId: string, type: "identify" | "read_serial" | "reset" | "capture_boot_log" | "rescan", params: Record<string, unknown>, timeoutMs: number): Promise<CommandOutcome> {
    const sel = selectDevice(Object.values(this.state.devices), this.state.agents, deviceId);
    if (!sel.ok) return sel;
    const dev = sel.device;
    for (const j of this.jobs.values()) {
      if (j.device_id === dev.id && !isTerminal(j.status)) return fail("FLASH_IN_PROGRESS", `Job '${j.id}' is ${j.status} on this device; serial/reset/probe are blocked until it finishes.`, { details: { job_id: j.id } });
    }
    const id = randomId("cmd", 9);
    return new Promise<CommandOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(fail("TIMEOUT", `The desktop app did not answer '${type}' within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, timer, agentId: dev.agent_id });
      const sent = this.send(dev.agent_id, { type: "command", id, command: type, device_id: dev.id, params });
      if (!sent) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(fail("NO_AGENT_CONNECTED", "Desktop app is offline."));
      }
    });
  }

  async revokeAgent(agentId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(`agent:${agentId}`)) {
      try {
        ws.send(JSON.stringify({ type: "revoked" }));
        ws.close(4001, "revoked");
      } catch {
        /* ignore */
      }
    }
    for (const job of this.jobs.values()) {
      if (job.agent_id === agentId && !isTerminal(job.status)) await this.finishJob(job, "failed", { code: "AGENT_DISCONNECTED", message: "Desktop app was revoked." });
    }
    delete this.state.agents[agentId];
    for (const [id, d] of Object.entries(this.state.devices)) if (d.agent_id === agentId) delete this.state.devices[id];
    this.state.version++;
    await this.saveState();
    this.registrySignal.notify();
  }

  // -------------------------------------------------------------- housekeeping

  private async scheduleAlarm() {
    const hasWork = Object.values(this.state.agents).some((a) => a.connected) || [...this.jobs.values()].some((j) => !isTerminal(j.status));
    if (!hasWork) return;
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (!isTerminal(job.status) && now > job.expires_at) {
        await this.finishJob(job, job.status === "awaiting_upload" || job.status === "transferring" ? "expired" : "failed", {
          code: job.status === "awaiting_upload" || job.status === "transferring" ? "JOB_EXPIRED" : "TIMEOUT",
          message: `Job timed out while ${job.status}.`,
        });
        this.send(job.agent_id, { type: "job.cancel", job_id: job.id });
      }
    }
    for (const agent of Object.values(this.state.agents)) {
      if (!agent.connected) continue;
      const sockets = this.ctx.getWebSockets(`agent:${agent.id}`);
      const last = Math.max(agent.last_seen, ...sockets.map((s) => this.ctx.getWebSocketAutoResponseTimestamp(s)?.getTime() ?? 0));
      if (now - last > STALE_AGENT_MS) {
        agent.connected = false;
        sockets.forEach((s) => {
          try {
            s.close(4002, "stale");
          } catch {
            /* ignore */
          }
        });
        this.registrySignal.notify();
      }
    }
    // jobs whose agent has been offline for a while cannot finish
    for (const job of this.jobs.values()) {
      if (!isTerminal(job.status) && job.accepted_at && !this.state.agents[job.agent_id]?.connected && now - (this.state.agents[job.agent_id]?.last_seen ?? 0) > 60_000) {
        await this.finishJob(job, "failed", { code: "AGENT_DISCONNECTED", message: "Desktop app went offline during the job." });
      }
    }
    await this.saveState();
    await this.scheduleAlarm();
  }
}

// ---------------------------------------------------------------- sanitizers

function clampPct(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : 0;
}

function str(v: unknown, max = 128): string | null {
  return typeof v === "string" && v.length ? v.slice(0, max) : null;
}

function sanitizeToolchains(raw: unknown): Record<string, ToolchainInfo> {
  const out: Record<string, ToolchainInfo> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, any>).slice(0, 16)) {
      out[k.slice(0, 32)] = { available: !!v?.available, version: str(v?.version, 64) };
    }
  }
  return out;
}

function sanitizeDevice(raw: any, agentId: string): Omit<DeviceRecord, "first_seen" | "last_seen" | "added_version" | "removed_version" | "busy"> | null {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(raw.id)) return null;
  const usb = raw.usb ?? {};
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 16).map((x: string) => x.slice(0, 200)) : []);
  return {
    id: raw.id,
    agent_id: agentId,
    port: str(raw.port, 64),
    connected: true,
    usb: { vid: str(usb.vid, 8), pid: str(usb.pid, 8), serial_number: str(usb.serial_number, 64), manufacturer: str(usb.manufacturer), product: str(usb.product), description: str(usb.description) },
    family: str(raw.family, 24),
    chip: str(raw.chip, 48),
    board: str(raw.board, 64),
    identified: !!raw.identified,
    identification: str(raw.identification, 32) ?? "unknown",
    supported: !!raw.supported,
    allowed: !!raw.allowed,
    capabilities: strArr(raw.capabilities),
    programmer: str(raw.programmer, 48),
    missing: strArr(raw.missing),
    notes: strArr(raw.notes),
    flash_size: str(raw.flash_size, 16),
    mac: str(raw.mac, 32),
  };
}

export { isReachable };
