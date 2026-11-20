"""Arduino AVR (Uno/Nano/Mega) via avrdude and the board's serial bootloader."""
from __future__ import annotations

import re
import threading
from pathlib import Path

from app.core.boards import BOARDS
from app.hardware import serialio, tools
from app.hardware.process import run_tool

from .base import DeviceRef, FlashError, FlashOutcome, FlashRequest, Flasher, win_port

_SIGNATURES = {"1e950f": ("ATmega328P", "m328p"), "1e9514": ("ATmega328PB", "m328pb"), "1e9801": ("ATmega2560", "m2560"), "1e9406": ("ATmega168P", "m168p")}
_PCT = re.compile(r"(\d+)%")


_SYNC = re.compile(r"not in sync|not responding|no response|stk500\w*_(getsync|recv)|timeout|programmer is not responding", re.I)
_BUSY = re.compile(r"can't open device|cannot open|access is denied|permission denied|resource busy|could not open port", re.I)
_NOCONF = re.compile(r"can't open config file|cannot open config|avrdude\.conf", re.I)


def classify_failure(lines: list[str]) -> tuple[str, str]:
    t = "\n".join(lines[-30:])
    if _BUSY.search(t):
        return "SERIAL_ERROR", "The serial port could not be opened — another program (Arduino IDE serial monitor/uploader, a terminal) probably holds it. Close it and retry."
    if _NOCONF.search(t) and re.search(r"can't open|cannot|not found|no such", t, re.I):
        return "TOOLCHAIN_MISSING", "avrdude could not find its avrdude.conf. Re-install avrdude from Tools → Remove, then Download."
    if re.search(r"verification error|content mismatch|verify.*failed", t, re.I):
        return "VERIFICATION_FAILED", "Flash contents differ from the firmware after writing."
    if _SYNC.search(t):
        return "FLASH_FAILED", "The bootloader did not respond. Check the board selection (Uno = 115200, Nano old bootloader/Duemilanove = 57600), the USB cable, and that no other program uses the port."
    return "FLASH_FAILED", "avrdude exited with an error"


def _conf_args(exe: str) -> list[str]:
    """Pass avrdude.conf explicitly when it sits next to the executable (do not rely on avrdude's search path)."""
    conf = Path(exe).with_name("avrdude.conf")
    return ["-C", str(conf)] if conf.is_file() else []


ARDUINO_VID = 0x2341
USB_UART_BRIDGE_VIDS = {0x0403, 0x1A86, 0x10C4}  # FTDI, CH340/CH341, CP210x — what Nano boards use


def pick_board(answered_as: str, chip: str, vid: int | None) -> str:
    """Map (which probe answered, chip signature, USB vendor) to one board id."""
    if "2560" in chip:
        return "arduino-mega2560"
    if answered_as == "arduino-nano-old-bootloader":
        return "arduino-nano-old-bootloader"
    if vid in USB_UART_BRIDGE_VIDS:
        return "arduino-nano"
    return "arduino-uno"


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
        return [t.path, *_conf_args(t.path), "-p", b["avr_part"], "-c", b["avr_programmer"], "-P", win_port(dev.port), "-b", str(b["default_baud"])]

    def identify(self, dev: DeviceRef, cancel: threading.Event | None = None) -> dict:
        """Find which bootloader answers (115200 → 57600 → Mega/wiring) and name the exact board.

        - answers at 57600            → Nano with the old bootloader
        - ATmega2560 signature         → Mega 2560
        - answers at 115200 (m328p)    → Uno when the USB identity is Arduino's own (VID 2341) or when it is unknown/CH340-less;
                                          Nano (new bootloader) when behind an FTDI/CH340/CP210x bridge, as on Nano boards.
        """
        tried: list[str] = []
        for board_id in ("arduino-uno", "arduino-nano-old-bootloader", "arduino-mega2560"):
            if cancel is not None and cancel.is_set():
                raise FlashError("CANCELLED", "cancelled")
            argv = self._base(dev, board_id) + ["-F"]
            r = run_tool(argv, cancel=cancel, timeout=15)
            text = "\n".join(r.lines)
            m = re.search(r"signature\s*(?:=|is)?\s*0x([0-9a-fA-F]{6})", text)
            if m and m.group(1).lower() in _SIGNATURES:
                chip, _ = _SIGNATURES[m.group(1).lower()]
                board = pick_board(board_id, chip, getattr(dev, "vid", None))
                return {"family": "avr", "chip": chip, "board": board, "baud_rate": BOARDS[board_id]["default_baud"], "board_label": BOARDS[board]["label"]}
            code, msg = classify_failure(r.lines)
            if code in ("SERIAL_ERROR", "TOOLCHAIN_MISSING"):
                raise FlashError(code, msg, r.tail(10))  # not a bootloader problem: say so immediately
            b = BOARDS[board_id]
            tried.append(f"[{b['avr_programmer']} @ {b['default_baud']}] " + (" | ".join(r.lines[-3:]) or "(no output)"))
        raise FlashError("PROBE_FAILED", "No AVR bootloader answered at 115200 (Uno / new Nano), 57600 (old-bootloader Nano/Duemilanove) or as Mega 2560. The port opens fine, so check that this really is an AVR Arduino, the USB cable, and that no other program is using the port.", "\n".join(tried)[-1500:])

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
            primary = int(base[base.index("-b") + 1])
            attempts = [primary] + ([57600 if primary == 115200 else 115200] if BOARDS[m.board].get("avr_programmer") == "arduino" else [])
            last: tuple[str, str, str] | None = None
            for n, baud in enumerate(attempts):
                base[base.index("-b") + 1] = str(baud)
                if n:
                    req.log(f"no answer at {attempts[0]} baud — retrying at {baud} baud (old bootloader?)")
                    req.progress("flashing", 0, f"Retrying at {baud} baud", f.filename)
                r = run_tool(base + ["-D", "-U", f"flash:w:{path}:{fmt}"], on_line("flashing"), req.cancel, timeout=300)
                if r.cancelled:
                    raise FlashError("CANCELLED", "Cancelled while writing; the board may hold a partial image.")
                if r.ok:
                    last = None
                    break
                code, msg = classify_failure(r.lines)
                last = (code, msg, r.tail())
                if code != "FLASH_FAILED" or not _SYNC.search(r.tail(30)):
                    break  # only a no-sync result justifies trying the other speed
            if last:
                raise FlashError(last[0], last[1], last[2])
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
