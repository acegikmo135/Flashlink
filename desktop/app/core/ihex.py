"""Minimal Intel HEX parser used to size-check AVR/STM32 images before flashing."""
from __future__ import annotations

from pathlib import Path


class IHexError(ValueError):
    pass


def parse_extent(path: Path) -> tuple[int, int, int]:
    """Return (lowest_address, highest_address_exclusive, data_bytes)."""
    base = 0
    lo, hi, total = None, 0, 0
    saw_eof = False
    with open(path, "r", encoding="ascii", errors="strict") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            if not line.startswith(":") or len(line) < 11 or len(line) % 2 == 0:
                raise IHexError(f"line {n}: malformed record")
            try:
                raw = bytes.fromhex(line[1:])
            except ValueError as e:
                raise IHexError(f"line {n}: bad hex") from e
            count, addr, rtype = raw[0], (raw[1] << 8) | raw[2], raw[3]
            if len(raw) != count + 5:
                raise IHexError(f"line {n}: length mismatch")
            if sum(raw) & 0xFF:
                raise IHexError(f"line {n}: checksum error")
            data = raw[4:-1]
            if rtype == 0:
                a = base + addr
                lo = a if lo is None else min(lo, a)
                hi = max(hi, a + count)
                total += count
            elif rtype == 1:
                saw_eof = True
                break
            elif rtype == 2:
                base = ((data[0] << 8) | data[1]) << 4
            elif rtype == 4:
                base = ((data[0] << 8) | data[1]) << 16
    if not saw_eof:
        raise IHexError("missing end-of-file record")
    if lo is None:
        raise IHexError("no data records")
    return lo, hi, total
