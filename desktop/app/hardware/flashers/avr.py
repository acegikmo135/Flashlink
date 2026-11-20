"""Arduino AVR (Uno/Nano/Mega) via avrdude and the board's serial bootloader."""
from __future__ import annotations

import re
import threading

from app.core.boards import BOARDS
from app.hardware import serialio, tools
from app.hardware.process import run_tool

from .base import DeviceRef, FlashError, FlashOutcome, FlashRequest, Flasher, win_port

_SIGNATURES = {"1e950f": ("ATmega328P", "m328p"), "1e9514": ("ATmega328PB", "m328pb"), "1e9801": ("ATmega2560", "m2560"), "1e9406": ("ATmega168P", "m168p")}
_PCT = re.compile(r"(\d+)%")


def classify_failure(lines: list[str]) -> tuple[str, str]:
    t = "\n".join(lines[-30:]).lower()
    if re.search(r"can't open device|cannot open|access is denied|permission denied|resource busy", t):
        return "SERIAL_ERROR", "The serial port could not be opened — another program probably holds it."
    if re.search(r"verification error|content mismatch|verify.*failed", t):
        return "VERIFICATION_FAILED", "Flash contents differ from the firmware after writing."
    if re.search(r"not in sync|not responding|no response|stk500\w*_(getsync|recv)|timeout", t):
        return "FLASH_FAILED", "The bootloader did not respond. Wrong board/baud (try the old-bootloader Nano variant), or the bootloader is missing."
    return "FLASH_FAILED", "avrdude exited with an error"


class AvrFlasher(Flasher):
    name = "avrdude"

    def missing(self) -> list[str]:
        return [] if tools.find("avrdude").available else ["avrdude"]

    def _base(self, dev: DeviceRef, board_id: str) -> list[str]:
        t = tools.find("avrdude")
        if not t.available or not t.path:
            raise FlashError("TOOLCHAIN_MISSING", "avrdude is not installed. " + t.hint)
        if not dev.port:
            raise FlashError("DEVICE_DISCONNECTED", "device has no serial port")
        b = BOARDS[board_id]
        return [t.path, "-p", b["avr_part"], "-c", b["avr_programmer"], "-P", win_port(dev.port), "-b", str(b["default_baud"])]

    def identify(self, dev: DeviceRef, cancel: threading.Event | None = None) -> dict:
        for board_id in ("arduino-uno", "arduino-nano-old-bootloader", "arduino-mega2560"):
            r = run_tool(self._base(dev, board_id) + ["-F"], cancel=cancel, timeout=20)
            m = re.search(r"signature\s*(?:=|is)?\s*0x([0-9a-fA-F]{6})", "\n".join(r.lines))
            if m and m.group(1).lower() in _SIGNATURES:
                chip, _ = _SIGNATURES[m.group(1).lower()]
                board = "arduino-mega2560" if "2560" in chip else board_id
                return {"family": "avr", "chip": chip, "board": board}
        raise FlashError("PROBE_FAILED", "No AVR bootloader answered (tried Uno, Nano old-bootloader, Mega 2560).")

    def run(self, req: FlashRequest) -> FlashOutcome:
        m = req.manifest
        f = m.files[0]
        path = str(req.paths[f.filename])
        fmt = "i" if f.format == "ihex" else "r"
        base = self._base(req.device, m.board)
        if m.baud_rate:
            base[base.index("-b") + 1] = str(m.baud_rate)

        def on_line(phase: str):
            def cb(line: str) -> None:
                req.log(line)
                p = _PCT.search(line)
                if p:
                    req.progress(phase, float(p.group(1)), line[:120], f.filename)
            return cb

        if req.kind == "flash":
            req.progress("flashing", 0, "Writing flash", f.filename)
            r = run_tool(base + ["-D", "-U", f"flash:w:{path}:{fmt}"], on_line("flashing"), req.cancel, timeout=300)
            if r.cancelled:
                raise FlashError("CANCELLED", "Cancelled while writing; the board may hold a partial image.")
            if not r.ok:
                code, msg = classify_failure(r.lines)
                raise FlashError(code, msg, r.tail())
            req.progress("flashing", 100, "Write complete", f.filename)
        verified = False
        if req.verify or req.kind == "verify":
            req.progress("verifying", 0, "Reading back and comparing", f.filename)
            r = run_tool(base + ["-D", "-U", f"flash:v:{path}:{fmt}"], on_line("verifying"), req.cancel, timeout=300)
            if r.cancelled:
                raise FlashError("CANCELLED", "Cancelled during verification")
            if not r.ok:
                code, msg = classify_failure(r.lines)
                raise FlashError("VERIFICATION_FAILED" if code == "FLASH_FAILED" and req.kind == "verify" else code, msg, r.tail())
            verified = True
            req.progress("verifying", 100, "Verification passed", f.filename)
        return FlashOutcome(verified, {"chip": BOARDS[m.board].get("avr_part"), "tool": "avrdude " + (tools.find("avrdude").version or "")})

    def reset(self, dev: DeviceRef) -> str:
        if not dev.port:
            raise FlashError("DEVICE_DISCONNECTED", "no serial port")
        try:
            serialio.reset_only(dev.port, "avr")
        except serialio.SerialError as e:
            raise FlashError("SERIAL_ERROR", str(e)) from e
        return "DTR pulse"
