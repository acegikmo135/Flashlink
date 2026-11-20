"""Static checks on firmware images before they touch hardware."""
from __future__ import annotations

from pathlib import Path

from .boards import BOARDS, FAMILIES
from .ihex import IHexError, parse_extent
from .manifest import FileSpec, Manifest

ESP_MAGIC = 0xE9
# extended image header: chip_id u16 at offset 12 (ESP32 family)
ESP_CHIP_IDS = {"esp32": 0, "esp32s2": 2, "esp32c3": 5, "esp32s3": 9}


class ImageError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def check_files(m: Manifest, paths: dict[str, Path]) -> list[str]:
    """Raise ImageError for images that don't match the declared target. Returns warnings."""
    warnings: list[str] = []
    for f in m.files:
        p = paths[f.filename]
        if m.family in ESP_CHIP_IDS:
            with open(p, "rb") as fh:
                head = fh.read(24)
            if head[:1] == bytes([ESP_MAGIC]) and len(head) >= 14:
                chip_id = int.from_bytes(head[12:14], "little")
                if chip_id != ESP_CHIP_IDS[m.family]:
                    other = next((k for k, v in ESP_CHIP_IDS.items() if v == chip_id), f"chip id {chip_id}")
                    raise ImageError("TARGET_MISMATCH", f"{f.filename} was built for {other}, manifest says {m.family}")
        elif m.family == "esp8266":
            with open(p, "rb") as fh:
                head = fh.read(16)
            if head[:1] == bytes([ESP_MAGIC]) and len(head) >= 14 and int.from_bytes(head[12:14], "little") in ESP_CHIP_IDS.values() and head[4:8] != b"\x00\x00\x00\x00":
                warnings.append(f"{f.filename} looks like an ESP32-family image; verify the target")
        elif m.family in ("avr", "stm32") and f.format == "ihex":
            try:
                lo, hi, _ = parse_extent(p)
            except (IHexError, UnicodeDecodeError) as e:
                raise ImageError("MANIFEST_INVALID", f"{f.filename}: invalid Intel HEX ({e})") from e
            board = BOARDS[m.board]
            limit = board.get("flash_bytes") or FAMILIES[m.family].get("flash_bytes")
            if m.family == "avr" and limit and hi > limit:
                raise ImageError("TARGET_MISMATCH", f"{f.filename} needs {hi} bytes of flash, {m.board} has {limit}")
            if m.family == "stm32":
                base = int(FAMILIES["stm32"]["flash_base"], 16)
                if lo < base or (limit and hi > base + limit):
                    raise ImageError("TARGET_MISMATCH", f"{f.filename} addresses 0x{lo:x}-0x{hi:x} fall outside {m.board} flash")
    return warnings
