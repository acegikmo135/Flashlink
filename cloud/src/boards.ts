import registry from "../../shared/boards.json";

export interface FamilySpec {
  label: string;
  tool: string;
  chip: string;
  image_chip_id?: number | null;
  baud_rates: number[];
  default_baud: number;
  flash_modes?: string[];
  flash_freqs?: string[];
  flash_sizes?: string[];
  formats: string[];
  address_align: number;
  flash_base?: string;
  flash_bytes?: number;
}

export interface BoardSpec {
  id: string;
  label: string;
  family: string;
  max_flash?: string;
  flash_bytes?: number;
  avr_part?: string;
  avr_programmer?: string;
  default_baud?: number;
  openocd_target?: string;
}

export const LIMITS = registry.limits as {
  max_file_bytes: number;
  max_total_bytes: number;
  max_files: number;
  chunk_bytes: number;
};
export const FAMILIES = registry.families as unknown as Record<string, FamilySpec>;
export const BOARDS = registry.boards as BoardSpec[];

export function getBoard(id: string): BoardSpec | undefined {
  return BOARDS.find((b) => b.id === id);
}

export function getFamily(id: string): FamilySpec | undefined {
  return FAMILIES[id];
}

/** "4MB" → bytes. */
export function parseSize(s: string): number {
  const m = /^(\d+)(KB|MB)$/.exec(s);
  if (!m) return NaN;
  return parseInt(m[1], 10) * (m[2] === "MB" ? 1024 * 1024 : 1024);
}

export function isEspFamily(family: string): boolean {
  return family.startsWith("esp");
}

export function describeBoards(family?: string) {
  return BOARDS.filter((b) => !family || b.family === family).map((b) => {
    const f = FAMILIES[b.family];
    return {
      board: b.id,
      label: b.label,
      family: b.family,
      flash_tool: f.tool,
      accepted_formats: f.formats,
      baud_rates: f.baud_rates,
      default_baud_rate: b.default_baud ?? f.default_baud,
      flash_modes: f.flash_modes ?? [],
      flash_frequencies: f.flash_freqs ?? [],
      flash_sizes: f.flash_sizes ?? [],
      max_flash: b.max_flash ?? null,
      flash_bytes: b.flash_bytes ?? f.flash_bytes ?? null,
      flash_base: f.flash_base ?? null,
      address_alignment: f.address_align,
    };
  });
}
