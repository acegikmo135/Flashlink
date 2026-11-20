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
import { COMPILE_BOARDS, compileSketch, LIBRARY_NAME, type SourceFile } from "../compile/backend";
import { ESP32_BOOT } from "../compile/esp32-boot";
import { findBuild, markFlashed, parseJson, recordBuild, type BuildRow } from "../compile/builds";
import { sha256Hex } from "../lib/crypto";
import { iso, publicAgent, publicDevice } from "../devices/public";
import { DEVICE_NAME, loadNames, resolveDeviceRef, setDeviceName } from "../devices/names";

export interface McpContext {
  env: Env;
  userId: string;
  tokenId: string;
  origin: string;
  waitUntil: (p: Promise<unknown>) => void;
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

const DeviceIdParam = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,63}$/).optional().describe("Device id OR the name the user gave the board (both shown by list_devices). Optional only when exactly one device is connected.");
const Baud = z.number().int().min(1200).max(3_000_000).optional().describe("Serial baud rate. Defaults to the desktop app's detected/standard rate (115200).");

// --------------------------------------------------------------------- server

export function buildServer(ctx: McpContext): McpServer {
  const { env, userId } = ctx;
  const hub = () => hubOf(env, userId);
  const rid = (x?: string) => resolveDeviceRef(env, userId, x);

  const server = new McpServer(
    { name: "mcu-bridge", version: "0.1.0" },
    {
      instructions:
        "MCU Bridge flashes physical microcontrollers attached to the user's Windows PC. The PC never compiles; it only flashes. The desktop app picks the right programmer for each board automatically — you never choose or run flashing tools yourself, and must not describe one tool's errors for a different family.\n" +
        "BOARD → FLASH TOOL (used by the desktop app): Arduino Uno/Nano/Mega and other AVR → avrdude (never esptool). ESP32/ESP32-S2/S3/C3/ESP8266 → esptool. STM32 → STM32CubeProgrammer/OpenOCD (ST-Link). CH32V003 → wlink (WCH-LinkE). Read `family`, `chip` and `missing` from list_devices/get_device_info. Users can name their boards (`name` in list_devices; rename_device sets it): always refer to a board by that name, and accept it anywhere device_id is expected; a missing tool is reported per device with its name, and the user can install it from the Tools page of the desktop app.\n" +
        "NO CODE SANDBOX? Use build_and_flash: send the Arduino sketch source and board id; the cloud compiles it (third-party libraries via `libraries`) and streams it to the PC in one call. ESP32 builds are flashed as a complete image (bootloader + partitions + app), so even a blank chip boots. compile_firmware only compiles. Every build is recorded in a metadata-only history: list_builds shows it and flash_build re-flashes an earlier build_id; delete_build removes one.\n" +
        "Workflow with your own toolchain: list_devices → (identify_mcu) → build firmware → flash_firmware (with a manifest) → upload files with the returned curl commands → get_flash_job(wait_seconds) until is_terminal → capture_boot_log/read_serial. " +
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
          multiple_devices: "Several devices are connected. Pass device_id explicitly — either the id or the name the user gave the board (shown as `name`).",
        }[situation];
        const names = await loadNames(env, userId);
        const shown = snap.devices.filter((d) => (include_disconnected || isReachable(d, agents)) && (d.supported || include_disconnected));
        return ok({ situation, registry_version: snap.version, agents: snap.agents.map(publicAgent), devices: shown.map((d) => publicDevice(d, agents, jobs, names)), hint });
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
        const sel = selectDevice(snap.devices, agents, await rid(device_id));
        if (!sel.ok) return fromFailure(sel);
        const d = sel.device;
        const fam = d.family ? FAMILIES[d.family] : undefined;
        return ok({
          device: publicDevice(d, agents, await hub().listJobs(), await loadNames(env, userId)),
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
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), await rid(device_id));
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
        const pd = publicDevice(dev, agents, jobs, await loadNames(env, userId));
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
        const nm = await loadNames(env, userId);
        return ok({ registry_version: ch.version, changed: ch.added.length + ch.removed.length > 0, added: ch.added.map((d) => publicDevice(d, agents, jobs, nm)), removed: ch.removed.map((d) => publicDevice(d, agents, jobs, nm)) });
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
      device_id: await rid(a.device_id),
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
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), await rid(device_id));
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
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), await rid(device_id));
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
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((a) => [a.id, a])), await rid(device_id));
        if (!sel.ok) return fromFailure(sel);
        const dur = duration_ms ?? 5000;
        const r = await hub().command(sel.device.id, "capture_boot_log", { duration_ms: dur, baud_rate }, dur + 20_000);
        if (!r.ok) return fromFailure(r);
        return ok({ device_id: sel.device.id, ...r.data });
      }),
  );


  // ------------------------------------------------------- cloud compilation
  const BoardEnum = z.enum(Object.keys(COMPILE_BOARDS) as [string, ...string[]]);
  const sourceShape = {
    sketch: z.string().min(1).max(200_000).describe("Contents of the main Arduino sketch (.ino) — setup()/loop() style C++."),
    board: BoardEnum.describe("MCU Bridge board id to build for: arduino-uno, arduino-nano, arduino-nano-old-bootloader, arduino-mega2560, esp32-wroom-32, esp32-wrover, esp32-generic."),
    extra_files: z
      .array(z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]{1,48}\.(ino|h|hpp|c|cpp|S)$/), content: z.string().max(100_000) }).strict())
      .max(8)
      .optional()
      .describe("Additional source/header files of the sketch (e.g. config.h)."),
    title: z.string().min(1).max(80).optional().describe("Optional short label for the build history, e.g. \"blink 500ms\"."),
    libraries: z
      .array(z.string().regex(LIBRARY_NAME))
      .max(10)
      .optional()
      .describe("Third-party libraries to install from the Arduino Library Manager before compiling, by their Library Manager name, optionally pinned: e.g. [\"Adafruit NeoPixel\", \"DHT sensor library@1.4.6\"]. Arduino built-in libraries (Servo, Wire, SPI, EEPROM, SoftwareSerial, WiFi…) need no entry."),
  };
  const compileTo = async (a: { sketch: string; board: string; extra_files?: SourceFile[]; libraries?: string[] }) => {
    if (!(await rateLimit(env, `compile:${ctx.tokenId}`, Number(env.COMPILE_LIMIT) || 30, 3600))) return { ok: false as const, code: "RATE_LIMITED" as const, message: "Build limit reached (30 per hour)." };
    return compileSketch(env, { board: a.board, sketch: a.sketch, files: a.extra_files ?? [], libraries: a.libraries });
  };
  type Compiled = Extract<Awaited<ReturnType<typeof compileTo>>, { ok: true }>;
  type Rec = { id: string; previous: BuildRow | null; output_changed: boolean; sha: string };
  /** Record the build's metadata (hashes/sizes/stats + the user's source text — never firmware). Failure here must not fail the build. */
  const recordFor = async (a: { board: string; sketch: string; extra_files?: SourceFile[]; libraries?: string[]; title?: string }, r: Compiled): Promise<Rec> => {
    const sha = await sha256Hex(r.bytes);
    try {
      const b = await recordBuild(env.DB, userId, { board: a.board, sketch: a.sketch, files: a.extra_files ?? [], libraries: a.libraries ?? [] }, { sha256: sha, size_bytes: r.bytes.length, stats: r.stats }, a.title);
      return { ...b, sha };
    } catch (e) {
      console.error("build record failed", e instanceof Error ? e.message : e);
      return { id: "", previous: null, output_changed: false, sha };
    }
  };
  const cacheInfo = (rec: Rec) => ({ build_id: rec.id || null, seen_before: !!rec.previous, previous_builds: rec.previous?.build_count ?? 0, output_changed_since_last_build: rec.output_changed });
  const flashCompiled = async (a: { board: string; full_image?: boolean; verify?: boolean; boot_log_seconds?: number }, r: Compiled, device: DeviceRecord, rec: Rec): Promise<ToolResult> => {
    const sel = { device };
    const sha = rec.sha;
    // 3) manifest (everything comes from the build itself — nothing guessed)
    const jobId = `build_${sha.slice(0, 10)}_${Date.now().toString(36)}`;
    const board = COMPILE_BOARDS[a.board];
    const full = board.kind === "esp32" && (a.full_image ?? true);
    if (board.kind === "esp32" && r.bytes.length > ESP32_BOOT.app_max_bytes) {
      return err("MANIFEST_INVALID", `The compiled app is ${r.bytes.length} bytes but the default partition table has room for ${ESP32_BOOT.app_max_bytes} (1.25 MB).`, { hint: "Reduce the sketch size (fewer/lighter libraries, no verbose logging)." });
    }
    // payloads in flash order; the app is always last
    const payloads: { filename: string; address: string; bytes: Uint8Array; sha256: string }[] = [];
    if (board.kind === "avr") payloads.push({ filename: "sketch.hex", address: "0x0", bytes: r.bytes, sha256: sha });
    else {
      if (full) for (const [name, c] of [["bootloader.bin", ESP32_BOOT.bootloader], ["partitions.bin", ESP32_BOOT.partitions], ["boot_app0.bin", ESP32_BOOT.boot_app0]] as const) payloads.push({ filename: name, address: "0x" + c.address.toString(16), bytes: c.data, sha256: c.sha256 });
      payloads.push({ filename: "firmware.bin", address: "0x10000", bytes: r.bytes, sha256: sha });
    }
    const files = payloads.map((f) => ({ address: f.address, filename: f.filename, size: f.bytes.length, sha256: f.sha256, ...(f.filename.endsWith(".hex") ? { format: "ihex" } : {}) }));
    const manifest =
      board.kind === "avr"
        ? { job_id: jobId, target: { family: "avr", board: a.board }, files }
        : { job_id: jobId, target: { family: "esp32", board: a.board, flash_size: r.esp!.flash_size }, flash_config: { mode: r.esp!.mode, frequency: r.esp!.frequency }, files };
    const v = validateManifest(manifest);
    if (!v.ok) return err("MANIFEST_INVALID", "The compiled firmware does not fit this board.", { details: v.issues });
    const created = await hub().createJob({ user_id: userId, manifest: v.manifest, kind: "flash", device_id: sel.device.id, verify: a.verify ?? true, boot_log_seconds: a.boot_log_seconds ?? 4, base_url: ctx.origin });
    if (!created.ok) return fromFailure(created);
    if (rec.id) ctx.waitUntil(markFlashed(env.DB, userId, rec.id, jobId).catch(() => undefined));
    // 4) we ARE the uploader: stream every file into the relay (memory only) in manifest order while the desktop downloads
    const spec = JSON.stringify({ files: v.manifest.files.map((f) => ({ size: f.size, sha256: f.sha256 })) });
    const stub = env.TRANSFER_RELAY.get(env.TRANSFER_RELAY.idFromName(`${userId}:${jobId}`));
    const byName = new Map(payloads.map((p) => [p.filename, p.bytes]));
    const upload = (async () => {
      for (let i = 0; i < v.manifest.files.length; i++) {
        const f = v.manifest.files[i];
        const res = await stub.fetch(`https://relay/upload/${i}`, { method: "PUT", headers: { "x-relay-spec": spec, "x-declared-length": String(f.size) }, body: byName.get(f.filename)! });
        if (res.status !== 200) return res.status;
      }
      return 200;
    })().catch(() => 0);
    ctx.waitUntil(upload);
    await Promise.race([upload, new Promise((res) => setTimeout(res, 15_000))]);
    const job = (await hub().getJob(jobId)) ?? created.job;
    return ok({
      build: { ...cacheInfo(rec), board: a.board, size_bytes: r.bytes.length, sha256: sha, stats: r.stats, device_id: sel.device.id, port: sel.device.port, files: files.map((f) => ({ filename: f.filename, address: f.address, size: f.size })), full_image: board.kind === "esp32" ? full : null },
      job: publicJob(job),
      note: `${PRIVACY} NOT flashed yet: poll get_flash_job('${jobId}', wait_seconds=20) until is_terminal and check flash_confirmed.`,
    });
  };
  const PRIVACY = "Source is compiled by the cloud build service (default: Wokwi's public Arduino build server); firmware binaries are never stored by MCU Bridge. The build is recorded in your build history (hashes, sizes, and your source text so it can be re-flashed with flash_build).";

  server.registerTool(
    "compile_firmware",
    {
      title: "Compile an Arduino sketch in the cloud",
      description:
        "Compile an Arduino sketch to firmware WITHOUT needing a code sandbox or any local toolchain. Returns build statistics, the SHA-256 and — for AVR boards — the Intel HEX text. Compile errors come back as compiler output in `error.details.stderr` so you can fix the code and retry. This does not touch any board; use build_and_flash to compile AND flash. Supports Arduino Uno/Nano/Mega and ESP32, with third-party libraries from the Arduino Library Manager (`libraries`).",
      inputSchema: strict(sourceShape),
      outputSchema: { ok: z.boolean(), build_id: z.string().nullable(), seen_before: z.boolean(), previous_builds: z.number(), output_changed_since_last_build: z.boolean(), board: z.string(), format: z.string(), size_bytes: z.number(), sha256: z.string(), stats: z.record(z.any()), intel_hex: z.string().nullable(), note: z.string() },
      annotations: { title: "Compile an Arduino sketch in the cloud", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (a) =>
      guard(async () => {
        const r = await compileTo(a);
        if (!r.ok) return err(r.code, r.message, { details: { stderr: "stderr" in r ? r.stderr : undefined, stdout: "stdout" in r ? r.stdout : undefined }, hint: r.code === "COMPILE_FAILED" ? "Fix the compiler errors and call compile_firmware again." : "Retry shortly." });
        const rec = await recordFor(a, r);
        return ok({
          ...cacheInfo(rec),
          board: a.board,
          format: r.kind === "ihex" ? "Intel HEX" : "ESP32 application image (.bin)",
          size_bytes: r.bytes.length,
          sha256: await sha256Hex(r.bytes),
          stats: r.stats,
          intel_hex: r.text && r.text.length <= 40_000 ? r.text : null,
          note: `${PRIVACY} To put this on the board call build_and_flash.`,
        });
      }),
  );

  server.registerTool(
    "build_and_flash",
    {
      title: "Compile in the cloud and flash the board",
      description:
        "One call for chats WITHOUT a code sandbox: compiles the Arduino sketch in the cloud, creates the flashing job for the connected board, and streams the firmware to the desktop app (no manual upload step). Returns immediately with the job; then poll get_flash_job (wait_seconds) until is_terminal and require status 'completed' with flash_confirmed=true before saying it is flashed. Device selection and safety checks are identical to flash_firmware. ESP32 builds are flashed as a COMPLETE image (bootloader + default partition table + boot_app0 + app), so even a blank chip boots; set full_image=false to update only the application (faster, keeps the existing bootloader/partitions).",
      inputSchema: strict({ ...sourceShape, board: BoardEnum.optional().describe("Board id. OPTIONAL: omit it to use the board the desktop app auto-detected for the connected device (run identify_mcu first if it is unknown)."), full_image: z.boolean().optional().describe("ESP32 only: also flash bootloader, partition table and boot_app0 (default true). NVS data (e.g. Wi-Fi credentials) is not touched."), device_id: DeviceIdParam, verify: z.boolean().optional().describe("Read back and verify after writing (default true)."), boot_log_seconds: z.number().min(0).max(30).optional().describe("Seconds of serial output to capture after flashing (default 4).") }),
      outputSchema: { ok: z.boolean(), build: z.record(z.any()), job: z.record(z.any()), note: z.string() },
      annotations: { title: "Compile in the cloud and flash the board", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (a) =>
      guard(async () => {
        // 1) choose/validate the device first so we never compile for nothing
        const snap = await hub().snapshot();
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((x) => [x.id, x])), await rid(a.device_id));
        if (!sel.ok) return fromFailure(sel);
        // 2) pick the board: explicit, else what the desktop auto-detected for this device
        const detected = sel.device.board && sel.device.board in COMPILE_BOARDS ? sel.device.board : sel.device.family?.startsWith("esp32") && !sel.device.family.match(/s2|s3|c3/) ? "esp32-generic" : null;
        const board = a.board ?? detected;
        if (!board) return err("BOARD_UNKNOWN", "The board of the connected device is not known yet.", { hint: "Call identify_mcu (it tries each bootloader speed and names the exact Uno/Nano/Mega/ESP32), then call build_and_flash again — or pass `board`." });
        const ra = { ...a, board };
        // 3) compile
        const r = await compileTo(ra);
        if (!r.ok) return err(r.code, r.message, { details: { stderr: "stderr" in r ? r.stderr : undefined, stdout: "stdout" in r ? r.stdout : undefined }, hint: r.code === "COMPILE_FAILED" ? "Fix the compiler errors and call build_and_flash again." : "Retry shortly." });
        const rec = await recordFor(ra, r);
        return flashCompiled(ra, r, sel.device, rec);
      }),
  );

  server.registerTool(
    "list_builds",
    {
      title: "Build history",
      description: "Your recent cloud builds (newest first): board, size, SHA-256, libraries, how often each was built and flashed, and the last flash job. Metadata only — firmware binaries are never stored. Use a build_id with flash_build to put a previous build on a board again.",
      inputSchema: strict({ board: BoardEnum.optional(), limit: z.number().int().min(1).max(40).optional().describe("Max rows (default 10).") }),
      outputSchema: { ok: z.boolean(), count: z.number(), builds: z.array(z.record(z.any())) },
      annotations: { title: "Build history", ...readOnly },
    },
    ({ board, limit }) =>
      guard(async () => {
        const rows = await env.DB.prepare(`SELECT * FROM builds WHERE user_id = ?1 ${board ? "AND board = ?3" : ""} ORDER BY last_built_at DESC LIMIT ?2`)
          .bind(...(board ? [userId, limit ?? 10, board] : [userId, limit ?? 10]))
          .all<BuildRow>();
        return ok({
          count: rows.results.length,
          builds: rows.results.map((b) => ({
            build_id: b.id,
            title: b.title,
            board: b.board,
            size_bytes: b.size_bytes,
            sha256: b.sha256,
            libraries: parseJson<string[]>(b.libraries, []),
            sketch_preview: b.sketch.slice(0, 120),
            source_bytes: b.sketch.length,
            extra_files: parseJson<SourceFile[]>(b.files, []).map((f) => f.name),
            build_count: b.build_count,
            flash_count: b.flash_count,
            last_job_id: b.last_job_id,
            first_built_at: iso(b.created_at),
            last_built_at: iso(b.last_built_at),
            last_flashed_at: iso(b.last_flashed_at),
          })),
        });
      }),
  );

  server.registerTool(
    "flash_build",
    {
      title: "Re-flash a previous build",
      description:
        "Flash a build from list_builds again — e.g. to restore a known-good firmware or flash a second board. MCU Bridge never stores firmware binaries, so the build is recompiled from its recorded source and the result is checked against the recorded SHA-256: if the output differs (an unpinned library updated, the compiler changed) the flash is REFUSED with BUILD_CHANGED unless allow_changed=true. Pin library versions (\"Name@1.2.3\") to make rebuilds reproducible. Returns immediately like build_and_flash; poll get_flash_job.",
      inputSchema: strict({
        build_id: z.string().regex(/^bld_[0-9a-f]{12}$/),
        allow_changed: z.boolean().optional().describe("Flash even if the rebuilt output differs from the recorded hash (default false)."),
        full_image: z.boolean().optional().describe("ESP32 only: also flash bootloader/partitions/boot_app0 (default true)."),
        device_id: DeviceIdParam,
        verify: z.boolean().optional(),
        boot_log_seconds: z.number().min(0).max(30).optional(),
      }),
      outputSchema: { ok: z.boolean(), build: z.record(z.any()), job: z.record(z.any()), note: z.string() },
      annotations: { title: "Re-flash a previous build", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (a) =>
      guard(async () => {
        const b = await findBuild(env.DB, userId, a.build_id);
        if (!b) return err("BUILD_NOT_FOUND", `No build ${a.build_id} in your history (history keeps the latest 40).`, { hint: "Call list_builds." });
        const snap = await hub().snapshot();
        const sel = selectDevice(snap.devices, Object.fromEntries(snap.agents.map((x) => [x.id, x])), await rid(a.device_id));
        if (!sel.ok) return fromFailure(sel);
        const input = { board: b.board, sketch: b.sketch, extra_files: parseJson<SourceFile[]>(b.files, []), libraries: parseJson<string[]>(b.libraries, []) };
        const r = await compileTo(input);
        if (!r.ok) return err(r.code, r.message, { details: { stderr: "stderr" in r ? r.stderr : undefined }, hint: "The recorded source no longer compiles (a library changed?). Pin library versions and rebuild with build_and_flash." });
        const sha = await sha256Hex(r.bytes);
        if (sha !== b.sha256 && !a.allow_changed) {
          return err("BUILD_CHANGED", `Rebuilding ${a.build_id} produced different firmware (${sha.slice(0, 12)}… instead of ${b.sha256.slice(0, 12)}…), usually because an unpinned library or the toolchain changed. Nothing was flashed.`, { hint: "Retry with allow_changed=true to flash the new output, or pin library versions." });
        }
        if (sha !== b.sha256) await env.DB.prepare("UPDATE builds SET sha256 = ?3, size_bytes = ?4, last_built_at = ?5, build_count = build_count + 1 WHERE user_id = ?1 AND id = ?2").bind(userId, b.id, sha, r.bytes.length, Date.now()).run();
        else await env.DB.prepare("UPDATE builds SET last_built_at = ?3, build_count = build_count + 1 WHERE user_id = ?1 AND id = ?2").bind(userId, b.id, Date.now()).run();
        return flashCompiled({ board: b.board, full_image: a.full_image, verify: a.verify, boot_log_seconds: a.boot_log_seconds }, r, sel.device, { id: b.id, previous: b, output_changed: sha !== b.sha256, sha });
      }),
  );

  server.registerTool(
    "delete_build",
    {
      title: "Delete a build from history",
      description: "Remove a build (including its stored source text) from your build history.",
      inputSchema: strict({ build_id: z.string().regex(/^bld_[0-9a-f]{12}$/) }),
      outputSchema: { ok: z.boolean(), deleted: z.boolean() },
      annotations: { title: "Delete a build from history", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ build_id }) =>
      guard(async () => {
        const r = await env.DB.prepare("DELETE FROM builds WHERE user_id = ?1 AND id = ?2").bind(userId, build_id).run();
        return ok({ deleted: (r.meta.changes ?? 0) > 0 });
      }),
  );

  server.registerTool(
    "rename_device",
    {
      title: "Give a board a custom name",
      description: "Set (or clear, with name=null) a human name for a board, e.g. \"Kitchen ESP32\" or \"Robot Uno\", so you and the user never confuse boards. Afterwards every tool accepts the name wherever device_id is expected. Names: 1–32 chars (letters, digits, space, _ . -), unique per account, case-insensitive. Only rename when the user asks.",
      inputSchema: strict({ device_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,63}$/), name: z.string().regex(DEVICE_NAME).nullable() }),
      outputSchema: { ok: z.boolean(), device_id: z.string(), name: z.string().nullable() },
      annotations: { title: "Give a board a custom name", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ device_id, name }) =>
      guard(async () => {
        const snap = await hub().snapshot();
        const id = (await rid(device_id)) as string;
        if (!snap.devices.some((d) => d.id === id)) return err("DEVICE_NOT_FOUND", `No device '${device_id}' is known for this account.`, { hint: "Call list_devices." });
        const r = await setDeviceName(env, userId, id, name);
        return r.ok ? ok({ device_id: id, name: r.name }) : err(r.code, r.message);
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
      outputSchema: { ok: z.boolean(), limits: z.record(z.any()), boards: z.array(z.record(z.any())), cloud_compile_boards: z.array(z.string()), notes: z.array(z.string()) },
      annotations: { title: "Supported boards", ...readOnly },
    },
    ({ family }) =>
      guard(async () =>
        ok({
          limits: LIMITS,
          boards: describeBoards(family),
          cloud_compile_boards: Object.keys(COMPILE_BOARDS),
          notes: [
            "No code sandbox? build_and_flash compiles Arduino sketches in the cloud (incl. Library Manager libraries) for cloud_compile_boards and flashes them in one call; ESP32 builds include bootloader + partition table so blank chips boot.",
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
