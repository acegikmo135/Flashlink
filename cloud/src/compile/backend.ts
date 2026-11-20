/**
 * Cloud compilation for chats that have no code sandbox.
 *
 * Source is compiled by a remote Arduino build service (default: Wokwi's public "hexi" server, which runs the real
 * arduino-cli/avr-gcc/xtensa toolchains). The backend is pluggable via the COMPILER_URL variable, so it can be swapped
 * for a self-hosted build server. Firmware never touches storage: compiled bytes live in Worker memory only long enough
 * to be streamed into the transfer relay (see mcp/server.ts).
 */
import type { Env } from "../env";
import { b64decode } from "./bytes";

export const DEFAULT_COMPILER_URL = "https://hexi.wokwi.com/build";

export interface CompileBoard {
  /** value of the `board` field understood by the build service */
  backend: "uno" | "nano" | "mega" | "esp32";
  kind: "avr" | "esp32";
}

/** MCU Bridge board id → how to build it. Only boards that were verified against the service are listed. */
export const COMPILE_BOARDS: Record<string, CompileBoard> = {
  "arduino-uno": { backend: "uno", kind: "avr" },
  "arduino-nano": { backend: "nano", kind: "avr" },
  "arduino-nano-old-bootloader": { backend: "nano", kind: "avr" },
  "arduino-mega2560": { backend: "mega", kind: "avr" },
  "esp32-wroom-32": { backend: "esp32", kind: "esp32" },
  "esp32-wrover": { backend: "esp32", kind: "esp32" },
  "esp32-generic": { backend: "esp32", kind: "esp32" },
};

export interface SourceFile {
  name: string;
  content: string;
}

export interface BuildStats {
  program_bytes: number | null;
  program_percent: number | null;
  program_max: number | null;
  ram_bytes: number | null;
}

export type CompileResult =
  | { ok: true; kind: "ihex" | "bin"; bytes: Uint8Array; text: string | null; stats: BuildStats; stdout: string; esp?: { mode: string; frequency: string; flash_size: string } }
  | { ok: false; code: "COMPILE_FAILED" | "COMPILER_UNAVAILABLE"; message: string; stderr?: string; stdout?: string };

export function parseStats(stdout: string): BuildStats {
  const p = /Sketch uses (\d+) bytes \((\d+)%\) of program storage space\. Maximum is (\d+)/.exec(stdout);
  const r = /Global variables use (\d+) bytes/.exec(stdout);
  return { program_bytes: p ? +p[1] : null, program_percent: p ? +p[2] : null, program_max: p ? +p[3] : null, ram_bytes: r ? +r[1] : null };
}

const ESP_MODE = ["qio", "qout", "dio", "dout"];
const ESP_SIZE: Record<number, string> = { 0: "1MB", 1: "2MB", 2: "4MB", 3: "8MB", 4: "16MB" };
const ESP_FREQ: Record<number, string> = { 0: "40m", 1: "26m", 2: "20m", 15: "80m" };

/** Read flash mode/size/frequency from an ESP image header (nothing is guessed: it comes from the build itself). */
export function espHeader(bytes: Uint8Array): { mode: string; frequency: string; flash_size: string } | null {
  if (bytes.length < 16 || bytes[0] !== 0xe9) return null;
  const mode = ESP_MODE[bytes[2]];
  const size = ESP_SIZE[bytes[3] >> 4];
  const freq = ESP_FREQ[bytes[3] & 0x0f];
  return mode && size && freq ? { mode, frequency: freq, flash_size: size } : null;
}

export function normalizeIhex(raw: string): string | null {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() + "\n";
  const lines = text.trim().split("\n");
  if (!lines.length || !lines.every((l) => /^:[0-9A-Fa-f]{10,}$/.test(l))) return null;
  if (lines[lines.length - 1].toUpperCase() !== ":00000001FF") return null;
  return text;
}

/** Arduino Library Manager names, optionally pinned with @version. Strict charset: the value becomes a line of libraries.txt. */
export const LIBRARY_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.+\-]{0,58}(@[0-9][0-9A-Za-z.\-+]{0,20})?$/;

export async function compileSketch(env: Env, p: { board: string; sketch: string; files: SourceFile[]; libraries?: string[] }): Promise<CompileResult> {
  const b = COMPILE_BOARDS[p.board];
  if (!b) return { ok: false, code: "COMPILE_FAILED", message: `Board '${p.board}' cannot be built in the cloud.` };
  const files = [...p.files];
  if (p.libraries?.length) files.push({ name: "libraries.txt", content: p.libraries.join("\n") + "\n" });
  let res: Response;
  try {
    res = await fetch(env.COMPILER_URL || DEFAULT_COMPILER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "mcu-bridge" },
      body: JSON.stringify({ sketch: p.sketch, files, board: b.backend }),
      signal: AbortSignal.timeout(85_000), // first use of a library downloads it; builds normally take 3-10 s
    });
  } catch (e) {
    return { ok: false, code: "COMPILER_UNAVAILABLE", message: `The build service did not answer (${e instanceof Error ? e.message : "network error"}). Try again in a minute.` };
  }
  if (!res.ok) return { ok: false, code: "COMPILER_UNAVAILABLE", message: `The build service returned HTTP ${res.status}.` };
  let d: { stdout?: string; stderr?: string; hex?: string };
  try {
    d = (await res.json()) as typeof d;
  } catch {
    return { ok: false, code: "COMPILER_UNAVAILABLE", message: "The build service returned an unreadable response." };
  }
  const stdout = (d.stdout ?? "").slice(0, 4000);
  const stderr = (d.stderr ?? "").slice(0, 6000);
  if (!d.hex) return { ok: false, code: "COMPILE_FAILED", message: "The sketch did not compile. Fix the errors in `stderr` and try again.", stderr: stderr || "(no compiler output)", stdout };

  if (b.kind === "avr") {
    const text = normalizeIhex(d.hex);
    if (!text) return { ok: false, code: "COMPILER_UNAVAILABLE", message: "The build service returned malformed Intel HEX." };
    return { ok: true, kind: "ihex", bytes: new TextEncoder().encode(text), text, stats: parseStats(stdout), stdout };
  }
  let bytes: Uint8Array;
  try {
    bytes = b64decode(d.hex);
  } catch {
    return { ok: false, code: "COMPILER_UNAVAILABLE", message: "The build service returned an unreadable ESP32 image." };
  }
  const esp = espHeader(bytes);
  if (!esp) return { ok: false, code: "COMPILER_UNAVAILABLE", message: "The ESP32 image has an unexpected header; refusing to flash it." };
  return { ok: true, kind: "bin", bytes, text: null, stats: parseStats(stdout), stdout, esp };
}
