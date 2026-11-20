import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Env } from "../env";
import { describeBoards, FAMILIES, LIMITS } from "../boards";
import { selectDevice, isReachable } from "../devices/select";
import { ManifestInputSchema, validateManifest } from "../jobs/manifest";
import { isTerminal, type AgentRecord, type DeviceRecord, type Job } from "../jobs/types";
import { rateLimit } from "../lib/ratelimit";
import { hubOf } from "../lib/hub";
import { iso, publicAgent, publicDevice } from "../devices/public";

export interface McpContext {
  env: Env;
  userId: string;
  tokenId: string;
  origin: string;
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown>; isError?: boolean };

const ok = (data: Record<string, unknown>): ToolResult => {
  const body = { ok: true, ...data };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent: body };
};

const err = (code: string, message: string, extra: { hint?: string; details?: unknown } = {}): ToolResult => {
  const body = { ok: false, error: { code, message, ...extra } };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
};

function nextStep(job: Job): string {
  switch (job.status) {
    case "awaiting_upload":
      return "Upload every file with the provided curl commands (sequentially in index order, or in parallel), then poll get_flash_job.";
    case "transferring":
      return "Firmware is streaming to the desktop. Poll get_flash_job with wait_seconds.";
    case "flashing":
    case "verifying":
      return "The desktop is writing/verifying the MCU. Poll get_flash_job with wait_seconds. Do not unplug or reset the device.";
    case "completed":
      return job.kind === "flash" ? "Flashing and verification were confirmed by the desktop agent. Use capture_boot_log or read_serial to check runtime behaviour." : "Device flash contents match the supplied firmware package.";
    case "verification_failed":
      return "Data was written but readback did not match. Re-flash; if it persists suspect power/wiring or wrong flash configuration.";
    case "cancelled":
      return "Job was cancelled. The device may hold a partially written image; flash again before relying on it.";
    default:
      return "Job did not succeed. Inspect error.code/message and result, fix the cause, and submit a new job with a new job_id.";
  }
}

function publicJob(j: Job) {
  return {
    job_id: j.id,
    kind: j.kind,
    status: j.status,
    is_terminal: isTerminal(j.status),
    flash_confirmed: j.kind === "flash" && j.status === "completed",
    device_id: j.device_id,
    board: j.manifest.target.board,
    family: j.manifest.target.family,
    progress: { phase: j.progress.phase, percent: j.progress.percent, file: j.progress.file ?? null, message: j.progress.message ?? null },
    files: j.files.map((f) => ({ filename: f.filename, size: f.size, transferred_bytes: f.transferred, sha256_verified_on_desktop: f.verified_sha256 })),
    created_at: iso(j.created_at),
    updated_at: iso(j.updated_at),
    expires_at: iso(j.expires_at),
    finished_at: iso(j.finished_at),
    error: j.error ?? null,
    result: j.result ?? null,
    recent_log: j.log.slice(-15),
    next_step: nextStep(j),
  };
}

function curlFor(u: { url: string; filename: string }, token: string) {
  return `curl -sS --fail-with-body --max-time 900 -X PUT -H "Authorization: Bearer ${token}" -H "Content-Type: application/octet-stream" -T "<path-to>/${u.filename}" "${u.url}"`;
}

const DeviceIdParam = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/).optional().describe("Device id from list_devices. Optional only when exactly one device is connected.");
const Baud = z.number().int().min(1200).max(3_000_000).optional().describe("Serial baud rate. Defaults to the desktop app's detected/standard rate (115200).");

// --------------------------------------------------------------------- server

export function buildServer(ctx: McpContext): McpServer {
  const { env, userId } = ctx;
  const hub = () => hubOf(env, userId);

  const server = new McpServer(
    { name: "mcu-bridge", version: "0.1.0" },
    {
      instructions:
        "MCU Bridge flashes physical microcontrollers attached to the user's Windows PC. You compile firmware in your own environment; the PC never compiles. " +
        "Workflow: list_devices → (identify_mcu) → build firmware → flash_firmware (with a manifest) → upload files with the returned curl commands → get_flash_job(wait_seconds) until is_terminal → capture_boot_log/read_serial. " +
        "Only treat firmware as flashed when get_flash_job reports status 'completed' with flash_confirmed=true. Every failure carries a specific error.code.",
    },
  );

  // Rate limiting per token: 120 tool calls / minute.
  const guard = async <T extends ToolResult>(fn: () => Promise<T>): Promise<ToolResult> => {
    if (!(await rateLimit(env, `mcp:${ctx.tokenId}`, 120, 60))) return err("RATE_LIMITED", "Too many MCP calls; slow down.");
    try {
      return await fn();
    } catch (e) {
      return err("INTERNAL", e instanceof Error ? e.message : String(e));
    }
  };
  const fromFailure = (f: { error: { code: string; message: string; hint?: string; details?: unknown } }) => err(f.error.code, f.error.message, { hint: f.error.hint, details: f.error.details });

  const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  // ---------------------------------------------------------- device management

  server.registerTool(
    "list_devices",
    {
      title: "List connected MCUs",
      description:
        "List desktop apps and microcontrollers currently known to this account. The 'situation' field tells you immediately whether the desktop app is offline (no_agent), nothing is plugged in (no_device), exactly one board is available (single_device) or you must choose a device_id (multiple_devices). Disconnected devices seen in the last 24h are included with state 'disconnected'.",
      inputSchema: strict({ include_disconnected: z.boolean().optional().describe("Also list recently unplugged devices and unsupported serial ports such as Bluetooth COM ports (default false).") }),
      outputSchema: { ok: z.boolean(), situation: z.enum(["no_agent", "no_device", "single_device", "multiple_devices"]), registry_version: z.number(), agents: z.array(z.record(z.any())), devices: z.array(z.record(z.any())), hint: z.string() },
      annotations: { title: "List connected MCUs", ...readOnly },
    },
    ({ include_disconnected }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const jobs = await hub().listJobs();
        const agents = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
        const live = snap.devices.filter((d) => isReachable(d, agents) && d.supported);
        const online = snap.agents.some((a) => a.connected);
        const situation = !online ? "no_agent" : live.length === 0 ? "no_device" : live.length === 1 ? "single_device" : "multiple_devices";
        const hint = {
          no_agent: "The MCU Bridge desktop app is not connected. Ask the user to start it on their PC.",
          no_device: "Desktop app is online but no MCU is plugged in. Ask the user to connect a board, then call detect_new_devices with wait_seconds.",
          single_device: "One device available; device_id may be omitted in other tools.",
          multiple_devices: "Several devices are connected. Pass device_id explicitly.",
        }[situation];
        const shown = snap.devices.filter((d) => (include_disconnected || isReachable(d, agents)) && (d.supported || include_disconnected));
        return ok({ situation, registry_version: snap.version, agents: snap.agents.map(publicAgent), devices: shown.map((d) => publicDevice(d, agents, jobs)), hint });
      }),
  );

  server.registerTool(
    "get_device_info",
    {
      title: "Get device details",
      description: "Detailed information about one MCU: USB identity, COM port, detected family/chip/board, flashing capabilities, missing tooling, notes, and the manifest requirements for its family.",
      inputSchema: strict({ device_id: DeviceIdParam }),
      outputSchema: { ok: z.boolean(), device: z.record(z.any()), agent: z.record(z.any()), manifest_requirements: z.record(z.any()).nullable() },
      annotations: { title: "Get device details", ...readOnly },
    },
    ({ device_id }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const agents = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
        const sel = selectDevice(snap.devices, agents, device_id);
        if (!sel.ok) return fromFailure(sel);
        const d = sel.device;
        const fam = d.family ? FAMILIES[d.family] : undefined;
        return ok({
          device: publicDevice(d, agents, await hub().listJobs()),
          agent: publicAgent(agents[d.agent_id]),
          manifest_requirements: fam ? { family: d.family, flash_tool: fam.tool, formats: fam.formats, baud_rates: fam.baud_rates, flash_modes: fam.flash_modes ?? null, flash_frequencies: fam.flash_freqs ?? null, flash_sizes: fam.flash_sizes ?? null, limits: LIMITS } : null,
        });
      }),
  );

  server.registerTool(
    "identify_mcu",
    {
      title: "Identify the MCU",
      description:
        "Actively probe the board through the desktop app (e.g. read the ESP chip type, flash size and MAC, or the AVR signature). This briefly resets the board and may enter its bootloader. Use it when family/chip is not yet identified or before choosing a build target. Not allowed while a flash job is active.",
      inputSchema: strict({ device_id: DeviceIdParam }),
      outputSchema: { ok: z.boolean(), device_id: z.string(), identification: z.record(z.any()) },
      annotations: { title: "Identify the MCU", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ device_id }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), device_id);
        if (!sel.ok) return fromFailure(sel);
        const r = await hub().command(sel.device.id, "identify", {}, 60_000);
        if (!r.ok) return fromFailure(r);
        return ok({ device_id: sel.device.id, identification: r.data });
      }),
  );

  server.registerTool(
    "get_device_status",
    {
      title: "Get device status",
      description: "Live state of one device: idle, flashing, verifying, disconnected or agent_offline, plus its active job (if any) and the most recent job outcome.",
      inputSchema: strict({ device_id: DeviceIdParam }),
      outputSchema: { ok: z.boolean(), state: z.enum(["idle", "flashing", "verifying", "disconnected", "agent_offline"]), device: z.record(z.any()), active_job: z.record(z.any()).nullable(), last_job: z.record(z.any()).nullable() },
      annotations: { title: "Get device status", ...readOnly },
    },
    ({ device_id }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const agents = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
        // status must work for disconnected devices too, so don't use selectDevice's strictness
        let dev = device_id ? snap.devices.find((d) => d.id === device_id) : undefined;
        if (!device_id) {
          const sel = selectDevice(snap.devices, agents);
          if (!sel.ok) return fromFailure(sel);
          dev = sel.device;
        }
        if (!dev) return err("DEVICE_NOT_FOUND", `No device with id '${device_id}'.`, { hint: "Call list_devices." });
        const jobs = await hub().listJobs();
        const pd = publicDevice(dev, agents, jobs);
        const mine = jobs.filter((j) => j.device_id === dev!.id);
        return ok({ state: pd.state, device: pd, active_job: mine.find((j) => !isTerminal(j.status)) ? publicJob(mine.find((j) => !isTerminal(j.status))!) : null, last_job: mine.find((j) => isTerminal(j.status)) ? publicJob(mine.find((j) => isTerminal(j.status))!) : null });
      }),
  );

  server.registerTool(
    "detect_new_devices",
    {
      title: "Wait for device changes",
      description:
        "Report devices plugged in or removed since a registry_version (from list_devices or a previous call). With wait_seconds (max 25) it long-polls, which is the right way to wait for the user to plug a board in. Pass since_version=0 to receive every currently connected device as 'added'.",
      inputSchema: strict({ since_version: z.number().int().min(0).optional().describe("registry_version to compare against. Defaults to the current version (i.e. only future changes)."), wait_seconds: z.number().int().min(0).max(25).optional().describe("How long to wait for a change (default 0).") }),
      outputSchema: { ok: z.boolean(), registry_version: z.number(), changed: z.boolean(), added: z.array(z.record(z.any())), removed: z.array(z.record(z.any())) },
      annotations: { title: "Wait for device changes", ...readOnly },
    },
    ({ since_version, wait_seconds }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const since = since_version ?? snap.version;
        const ch = await hub().changesSince(since, (wait_seconds ?? 0) * 1000);
        const agents = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
        const jobs = await hub().listJobs();
        return ok({ registry_version: ch.version, changed: ch.added.length + ch.removed.length > 0, added: ch.added.map((d) => publicDevice(d, agents, jobs)), removed: ch.removed.map((d) => publicDevice(d, agents, jobs)) });
      }),
  );

  // ------------------------------------------------------------------ flashing

  const flashInput = strict({
    manifest: ManifestInputSchema.describe("Firmware manifest: target family/board, flash configuration and every file with address, size and SHA-256. Nothing is guessed on the desktop."),
    device_id: DeviceIdParam,
    verify: z.boolean().optional().describe("Read back and verify after writing (default true; strongly recommended)."),
    boot_log_seconds: z.number().min(0).max(30).optional().describe("Seconds of serial output to capture after the reset that follows flashing (default 4, 0 disables)."),
  });

  const jobCreate = async (kind: "flash" | "verify", a: { manifest: unknown; device_id?: string; verify?: boolean; boot_log_seconds?: number }) => {
    const v = validateManifest(a.manifest);
    if (!v.ok) return err("MANIFEST_INVALID", "The firmware manifest was rejected.", { details: v.issues, hint: "Fix every listed issue; see get_supported_boards for allowed values." });
    const r = await hub().createJob({
      user_id: userId,
      manifest: v.manifest,
      kind,
      device_id: a.device_id,
      verify: kind === "verify" ? true : a.verify ?? true,
      boot_log_seconds: kind === "verify" ? 0 : a.boot_log_seconds ?? 4,
      base_url: ctx.origin,
    });
    if (!r.ok) return fromFailure(r);
    return ok({
      created: r.created,
      job: publicJob(r.job),
      upload: {
        token: r.upload_token,
        expires_at: iso(r.job.expires_at),
        order: "Upload files in the listed order, or all in parallel. Each PUT returns only after the desktop app has received (and acknowledged) the whole file.",
        files: r.uploads.map((u) => ({ ...u, method: "PUT", headers: { Authorization: `Bearer ${r.upload_token}`, "Content-Type": "application/octet-stream" }, curl: curlFor(u, r.upload_token) })),
      },
      note: "No firmware is stored in the cloud: it is streamed directly from your upload to the desktop app. The job is NOT flashed until get_flash_job reports status 'completed'.",
    });
  };

  server.registerTool(
    "flash_firmware",
    {
      title: "Flash firmware to an MCU",
      description:
        "Create a flashing job from a manifest and return upload instructions. The manifest is validated (family/board, flash addresses, sizes, SHA-256, flash config) and the target device is checked for presence, support, user allowance, busy state and chip/family match. This call does NOT flash by itself: PUT each firmware file to its URL using the returned curl commands (bounded-memory streaming, SHA-256 checked end to end), then poll get_flash_job. Re-sending the identical manifest with the same job_id is idempotent. Never report success until get_flash_job says 'completed'.",
      inputSchema: flashInput,
      outputSchema: { ok: z.boolean(), created: z.boolean(), job: z.record(z.any()), upload: z.record(z.any()), note: z.string() },
      annotations: { title: "Flash firmware to an MCU", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (a) => guard(() => jobCreate("flash", a)),
  );

  server.registerTool(
    "verify_flash",
    {
      title: "Verify device flash contents",
      description:
        "Check that the MCU's flash currently matches a firmware package WITHOUT writing anything. Takes the same manifest and upload flow as flash_firmware (firmware is not retained anywhere, so it must be streamed again); the desktop reads the flash back and compares SHA-256 / bytes. Result 'completed' means identical; 'verification_failed' means different.",
      inputSchema: strict({ manifest: ManifestInputSchema, device_id: DeviceIdParam }),
      outputSchema: { ok: z.boolean(), created: z.boolean(), job: z.record(z.any()), upload: z.record(z.any()), note: z.string() },
      annotations: { title: "Verify device flash contents", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) => guard(() => jobCreate("verify", a)),
  );

  server.registerTool(
    "get_flash_job",
    {
      title: "Get flash job status",
      description:
        "Current state of a flash or verify job: awaiting_upload → transferring → flashing → verifying → completed | failed | verification_failed | cancelled | expired. wait_seconds (max 25) long-polls until the job changes. 'completed' with flash_confirmed=true is the only success signal; it is set solely by the desktop agent after the programmer exited cleanly AND verification passed.",
      inputSchema: strict({ job_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), wait_seconds: z.number().int().min(0).max(25).optional() }),
      outputSchema: { ok: z.boolean(), job: z.record(z.any()) },
      annotations: { title: "Get flash job status", ...readOnly },
    },
    ({ job_id, wait_seconds }) =>
      guard(async () => {
        const job = await hub().getJob(job_id, (wait_seconds ?? 0) * 1000, -1);
        if (job) return ok({ job: publicJob(job) });
        const row = await env.DB.prepare("SELECT * FROM jobs WHERE user_id = ?1 AND id = ?2").bind(userId, job_id).first<Record<string, unknown>>();
        if (!row) return err("JOB_NOT_FOUND", `No job '${job_id}' for this account.`);
        return ok({ job: { job_id, status: row.status, kind: row.kind, board: row.board, family: row.family, device_id: row.device_id, is_terminal: true, flash_confirmed: row.kind === "flash" && row.status === "completed", created_at: iso(row.created_at as number), finished_at: iso(row.finished_at as number | null), error_code: row.error_code, summary: safeJson(row.summary as string), note: "Archived job (live state no longer held)." } });
      }),
  );

  server.registerTool(
    "cancel_flash_job",
    {
      title: "Cancel a flash job",
      description: "Cancel a job that is not finished yet. Before flashing starts this is clean. During writing the desktop stops the programmer, which can leave the MCU with a partial image — flash again afterwards.",
      inputSchema: strict({ job_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }),
      outputSchema: { ok: z.boolean(), job: z.record(z.any()), note: z.string() },
      annotations: { title: "Cancel a flash job", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ job_id }) =>
      guard(async () => {
        const r = await hub().cancelJob(job_id);
        if (!r.ok) return fromFailure(r);
        return ok({ job: publicJob(r.job), note: r.note });
      }),
  );

  server.registerTool(
    "reset_device",
    {
      title: "Reset the MCU",
      description: "Pulse the board's reset line (ESP: RTS/EN, AVR: DTR, ST-Link/WCH-Link: probe reset) so the firmware restarts. Optionally capture serial output right after reset. Blocked during a flash job. 'reset_signal_sent' means the reset was issued, not that the firmware is healthy — inspect the log.",
      inputSchema: strict({ device_id: DeviceIdParam, capture_seconds: z.number().min(0).max(30).optional().describe("Seconds of serial output to capture after reset (default 0)."), baud_rate: Baud }),
      outputSchema: { ok: z.boolean(), device_id: z.string(), reset_signal_sent: z.boolean(), method: z.string().optional(), serial: z.record(z.any()).optional() },
      annotations: { title: "Reset the MCU", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ device_id, capture_seconds, baud_rate }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), device_id);
        if (!sel.ok) return fromFailure(sel);
        const r = await hub().command(sel.device.id, "reset", { capture_seconds: capture_seconds ?? 0, baud_rate }, ((capture_seconds ?? 0) + 20) * 1000);
        if (!r.ok) return fromFailure(r);
        return ok({ device_id: sel.device.id, reset_signal_sent: true, ...r.data });
      }),
  );

  // --------------------------------------------------------------- diagnostics

  server.registerTool(
    "read_serial",
    {
      title: "Read serial output",
      description: "Open the device's serial port on the desktop for duration_ms and return what the firmware printed (UTF-8, control characters stripped, capped at max_bytes). Does not reset the board; use capture_boot_log for boot output. Blocked during a flash job.",
      inputSchema: strict({ device_id: DeviceIdParam, duration_ms: z.number().int().min(200).max(30_000).optional().describe("Capture duration (default 2000)."), baud_rate: Baud, max_bytes: z.number().int().min(64).max(65_536).optional().describe("Output cap (default 16384).") }),
      outputSchema: { ok: z.boolean(), device_id: z.string(), text: z.string(), bytes: z.number(), truncated: z.boolean(), baud_rate: z.number(), port: z.string().nullable() },
      annotations: { title: "Read serial output", ...readOnly },
    },
    ({ device_id, duration_ms, baud_rate, max_bytes }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), device_id);
        if (!sel.ok) return fromFailure(sel);
        const dur = duration_ms ?? 2000;
        const r = await hub().command(sel.device.id, "read_serial", { duration_ms: dur, baud_rate, max_bytes: max_bytes ?? 16384 }, dur + 15_000);
        if (!r.ok) return fromFailure(r);
        return ok({ device_id: sel.device.id, ...r.data });
      }),
  );

  server.registerTool(
    "capture_boot_log",
    {
      title: "Reset and capture boot log",
      description: "Reset the MCU and capture its serial output from the first byte, then analyse it: boot detected, panic/guru-meditation, brown-out, watchdog reset, boot loop, ROM bootloader waiting for download. Use after flash_firmware completes to see whether the new firmware actually runs.",
      inputSchema: strict({ device_id: DeviceIdParam, duration_ms: z.number().int().min(500).max(30_000).optional().describe("Capture duration (default 5000)."), baud_rate: Baud }),
      outputSchema: { ok: z.boolean(), device_id: z.string(), log: z.string(), analysis: z.record(z.any()) },
      annotations: { title: "Reset and capture boot log", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ device_id, duration_ms, baud_rate }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), device_id);
        if (!sel.ok) return fromFailure(sel);
        const dur = duration_ms ?? 5000;
        const r = await hub().command(sel.device.id, "capture_boot_log", { duration_ms: dur, baud_rate }, dur + 20_000);
        if (!r.ok) return fromFailure(r);
        return ok({ device_id: sel.device.id, ...r.data });
      }),
  );

  server.registerTool(
    "get_flash_history",
    {
      title: "Flash history",
      description: "Past flash/verify jobs for this account, newest first, with outcome and error codes. Metadata only; firmware binaries are never retained.",
      inputSchema: strict({ device_id: DeviceIdParam, limit: z.number().int().min(1).max(50).optional().describe("Max rows (default 10)."), status: z.enum(["completed", "failed", "verification_failed", "cancelled", "expired"]).optional() }),
      outputSchema: { ok: z.boolean(), count: z.number(), jobs: z.array(z.record(z.any())) },
      annotations: { title: "Flash history", ...readOnly },
    },
    ({ device_id, limit, status }) =>
      guard(async () => {
        let q = "SELECT id, device_id, kind, board, family, status, error_code, summary, created_at, finished_at FROM jobs WHERE user_id = ?1";
        const binds: unknown[] = [userId];
        if (device_id) {
          binds.push(device_id);
          q += ` AND device_id = ?${binds.length}`;
        }
        if (status) {
          binds.push(status);
          q += ` AND status = ?${binds.length}`;
        }
        binds.push(limit ?? 10);
        q += ` ORDER BY created_at DESC LIMIT ?${binds.length}`;
        const rows = await env.DB.prepare(q).bind(...binds).all<Record<string, any>>();
        return ok({ count: rows.results.length, jobs: rows.results.map((r) => ({ job_id: r.id, device_id: r.device_id, kind: r.kind, board: r.board, family: r.family, status: r.status, error_code: r.error_code, created_at: iso(r.created_at), finished_at: iso(r.finished_at), summary: safeJson(r.summary) })) });
      }),
  );

  server.registerTool(
    "get_supported_boards",
    {
      title: "Supported boards and manifest rules",
      description: "Static registry of supported MCU families and boards: flashing tool, accepted file formats, allowed baud rates / flash modes / frequencies / sizes, address alignment, and package limits. Use it to build a valid manifest.",
      inputSchema: strict({ family: z.enum(["esp32", "esp32s2", "esp32s3", "esp32c3", "esp8266", "avr", "stm32", "ch32v003"]).optional() }),
      outputSchema: { ok: z.boolean(), limits: z.record(z.any()), boards: z.array(z.record(z.any())), notes: z.array(z.string()) },
      annotations: { title: "Supported boards", ...readOnly },
    },
    ({ family }) =>
      guard(async () =>
        ok({
          limits: LIMITS,
          boards: describeBoards(family),
          notes: [
            "ESP: address must be 4096-aligned; typical ESP32 layout is bootloader 0x1000, partitions 0x8000, app 0x10000 (ESP32-S3/C3: bootloader 0x0). Never guess — take addresses from your build output (flasher_args.json).",
            "AVR: one Intel HEX (or raw bin) file at address 0x0. No bootloader/fuse changes are performed.",
            "STM32 and CH32V003 require an ST-Link / WCH-LinkE programmer; a plain USB-UART adapter cannot program them.",
            "Firmware is never stored: it is streamed from your upload to the desktop app and deleted after flashing.",
          ],
        }),
      ),
  );

  return server;
}

function safeJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Handle one stateless Streamable HTTP MCP request. */
export async function handleMcp(request: Request, ctx: McpContext): Promise<Response> {
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // transport/server are per-request and garbage collected
  }
}
