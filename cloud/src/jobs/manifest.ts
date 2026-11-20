import { z } from "zod";
import { FAMILIES, LIMITS, getBoard, isEspFamily, parseSize } from "../boards";

/** Shape of a firmware manifest as accepted from MCP clients. Unknown keys are rejected. */
export const ManifestInputSchema = z
  .object({
    schema_version: z.literal(1).optional().describe("Manifest schema version. Omit or use 1."),
    job_id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .describe("Unique job id chosen by the caller (8-64 chars: letters, digits, '_' or '-'). Re-sending the same id with the same manifest is idempotent."),
    target: z
      .object({
        family: z.enum(["esp32", "esp32s2", "esp32s3", "esp32c3", "esp8266", "avr", "stm32", "ch32v003"]).describe("MCU family the firmware was built for."),
        board: z.string().min(1).max(64).describe("Board id from get_supported_boards."),
        flash_size: z.string().regex(/^\d+(KB|MB)$/).optional().describe("Flash size the image layout was built for, e.g. '4MB'. Required for ESP families."),
      })
      .strict(),
    flash_config: z
      .object({
        mode: z.enum(["qio", "qout", "dio", "dout"]).optional().describe("SPI flash mode (ESP families)."),
        frequency: z.string().regex(/^\d+m$/).optional().describe("SPI flash frequency, e.g. '40m' (ESP families)."),
        baud_rate: z.number().int().optional().describe("Programming baud rate. Must be allowed for the family."),
      })
      .strict()
      .optional(),
    files: z
      .array(
        z
          .object({
            address: z.string().regex(/^0x[0-9a-fA-F]{1,8}$/).describe("Flash address as hex string, e.g. '0x10000'."),
            filename: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).describe("Plain file name (no path)."),
            size: z.number().int().positive().describe("Exact file size in bytes."),
            sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).describe("SHA-256 of the file, hex."),
            format: z.enum(["bin", "ihex"]).optional().describe("File format. Defaults to 'ihex' for .hex files, else 'bin'."),
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.max_files),
  })
  .strict();

export type ManifestInput = z.infer<typeof ManifestInputSchema>;

export interface ManifestFile {
  address: number;
  address_hex: string;
  filename: string;
  size: number;
  sha256: string;
  format: "bin" | "ihex";
}

export interface NormalizedManifest {
  schema_version: 1;
  job_id: string;
  target: { family: string; board: string; flash_size?: string };
  flash_config: { mode?: string; frequency?: string; baud_rate?: number };
  files: ManifestFile[];
}

export interface ManifestIssue {
  path: string;
  code: string;
  message: string;
}

export type ManifestResult = { ok: true; manifest: NormalizedManifest } | { ok: false; issues: ManifestIssue[] };

/** Strict semantic validation. Never guesses addresses or chip configuration. */
export function validateManifest(raw: unknown): ManifestResult {
  const parsed = ManifestInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", code: "SCHEMA", message: i.message })),
    };
  }
  const m = parsed.data;
  const issues: ManifestIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });

  const family = FAMILIES[m.target.family];
  const board = getBoard(m.target.board);
  if (!board) {
    add("target.board", "UNKNOWN_BOARD", `Unknown board '${m.target.board}'. Use get_supported_boards.`);
  } else if (board.family !== m.target.family) {
    add("target.family", "FAMILY_BOARD_MISMATCH", `Board '${board.id}' belongs to family '${board.family}', not '${m.target.family}'.`);
  }

  const cfg = m.flash_config ?? {};
  const esp = isEspFamily(m.target.family);
  let flashBytes = NaN;
  let flashBase = 0;

  if (esp) {
    if (!m.target.flash_size) add("target.flash_size", "REQUIRED", "flash_size is required for ESP targets.");
    else {
      if (!family.flash_sizes?.includes(m.target.flash_size)) add("target.flash_size", "BAD_FLASH_SIZE", `flash_size must be one of ${family.flash_sizes?.join(", ")}.`);
      else {
        flashBytes = parseSize(m.target.flash_size);
        if (board?.max_flash && flashBytes > parseSize(board.max_flash)) add("target.flash_size", "FLASH_SIZE_EXCEEDS_BOARD", `Board '${board.id}' has at most ${board.max_flash} of flash.`);
      }
    }
    if (!cfg.mode) add("flash_config.mode", "REQUIRED", "flash_config.mode is required for ESP targets (never guessed).");
    if (!cfg.frequency) add("flash_config.frequency", "REQUIRED", "flash_config.frequency is required for ESP targets (never guessed).");
    if (cfg.mode && !family.flash_modes?.includes(cfg.mode)) add("flash_config.mode", "BAD_FLASH_MODE", `mode must be one of ${family.flash_modes?.join(", ")}.`);
    if (cfg.frequency && !family.flash_freqs?.includes(cfg.frequency)) add("flash_config.frequency", "BAD_FLASH_FREQ", `frequency must be one of ${family.flash_freqs?.join(", ")} for ${m.target.family}.`);
  } else {
    if (m.target.flash_size) add("target.flash_size", "NOT_ALLOWED", "flash_size is only valid for ESP targets.");
    if (cfg.mode || cfg.frequency) add("flash_config", "NOT_ALLOWED", "mode/frequency are only valid for ESP targets.");
    if (m.target.family === "avr") flashBytes = board?.flash_bytes ?? NaN;
    else {
      flashBase = parseInt(family.flash_base ?? "0", 16);
      flashBytes = board?.flash_bytes ?? family.flash_bytes ?? NaN;
    }
  }

  if (cfg.baud_rate !== undefined && !family.baud_rates.includes(cfg.baud_rate)) {
    add("flash_config.baud_rate", "BAD_BAUD", family.baud_rates.length ? `baud_rate must be one of ${family.baud_rates.join(", ")}.` : "baud_rate is not configurable for this family.");
  }

  const files: ManifestFile[] = [];
  const names = new Set<string>();
  let total = 0;
  m.files.forEach((f, i) => {
    const p = `files[${i}]`;
    const address = parseInt(f.address, 16);
    const format = f.format ?? (f.filename.toLowerCase().endsWith(".hex") ? "ihex" : "bin");
    if (names.has(f.filename)) add(`${p}.filename`, "DUPLICATE_FILENAME", `Duplicate filename '${f.filename}'.`);
    names.add(f.filename);
    if (f.size > LIMITS.max_file_bytes) add(`${p}.size`, "FILE_TOO_LARGE", `File exceeds the ${LIMITS.max_file_bytes}-byte limit.`);
    if (!family.formats.includes(format)) add(`${p}.format`, "BAD_FORMAT", `Format '${format}' not accepted for ${m.target.family} (allowed: ${family.formats.join(", ")}).`);
    if (address % family.address_align !== 0) add(`${p}.address`, "ADDRESS_ALIGNMENT", `Address must be a multiple of ${family.address_align}.`);
    total += f.size;
    files.push({ address, address_hex: "0x" + address.toString(16), filename: f.filename, size: f.size, sha256: f.sha256.toLowerCase(), format });
  });
  if (total > LIMITS.max_total_bytes) add("files", "PACKAGE_TOO_LARGE", `Total package exceeds ${LIMITS.max_total_bytes} bytes.`);

  if (!Number.isNaN(flashBytes) && issues.length === 0) {
    if (m.target.family === "avr") {
      if (files.length !== 1) add("files", "AVR_SINGLE_FILE", "AVR targets take exactly one file.");
      else {
        if (files[0].address !== 0) add("files[0].address", "ADDRESS_OUT_OF_RANGE", "AVR images must use address 0x0.");
        if (files[0].format === "bin" && files[0].size > flashBytes) add("files[0].size", "IMAGE_TOO_LARGE", `Image exceeds ${flashBytes} bytes of usable flash on ${m.target.board}.`);
        if (files[0].format === "ihex" && files[0].size > flashBytes * 4) add("files[0].size", "IMAGE_TOO_LARGE", "Intel HEX file is implausibly large for this board.");
      }
    } else {
      const sorted = [...files].map((f, i) => ({ f, i })).sort((a, b) => a.f.address - b.f.address);
      sorted.forEach(({ f, i }, k) => {
        const p = `files[${i}]`;
        if (m.target.family === "stm32" && f.format === "ihex") {
          if (f.address !== flashBase) add(`${p}.address`, "ADDRESS_OUT_OF_RANGE", `Intel HEX images must declare address 0x${flashBase.toString(16)}.`);
          return;
        }
        if (f.address < flashBase || f.address + f.size > flashBase + flashBytes) {
          add(`${p}.address`, "ADDRESS_OUT_OF_RANGE", `Region 0x${f.address.toString(16)}+${f.size} is outside flash [0x${flashBase.toString(16)}, 0x${(flashBase + flashBytes).toString(16)}).`);
        }
        const next = sorted[k + 1];
        if (next && f.address + f.size > next.f.address) add(p, "REGIONS_OVERLAP", `'${f.filename}' overlaps '${next.f.filename}'.`);
      });
    }
  }

  if (issues.length) return { ok: false, issues };

  const baud = cfg.baud_rate ?? board?.default_baud ?? family.default_baud;
  return {
    ok: true,
    manifest: {
      schema_version: 1,
      job_id: m.job_id,
      target: { family: m.target.family, board: m.target.board, ...(m.target.flash_size ? { flash_size: m.target.flash_size } : {}) },
      flash_config: { ...(cfg.mode ? { mode: cfg.mode } : {}), ...(cfg.frequency ? { frequency: cfg.frequency } : {}), ...(baud ? { baud_rate: baud } : {}) },
      files,
    },
  };
}
