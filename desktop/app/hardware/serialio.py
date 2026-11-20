"""Serial capture, reset pulses and boot-log analysis (pyserial)."""
from __future__ import annotations

import re
import threading
import time
from typing import Callable

import serial

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class SerialError(Exception):
    pass


def clean(text: str) -> str:
    return _CTRL.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))


def _open(port: str, baud: int) -> serial.Serial:
    s = serial.Serial()
    s.port, s.baudrate, s.timeout = port, baud, 0.1
    s.dtr = False  # avoid accidental bootloader entry / reset on open where possible
    s.rts = False
    try:
        s.open()
    except (serial.SerialException, OSError) as e:
        raise SerialError(f"cannot open {port}: {e}") from e
    return s


def pulse_reset(s: serial.Serial, style: str) -> None:
    """style: 'esp' (RTS->EN, DTR->GPIO0) or 'avr' (DTR->RESET via capacitor)."""
    if style == "avr":
        s.dtr = True
        time.sleep(0.1)
        s.dtr = False
    elif style == "auto":  # chip not identified yet: pulse DTR (AVR reset) then RTS (ESP EN)
        pulse_reset(s, "avr")
        time.sleep(0.05)
        pulse_reset(s, "esp")
    else:
        s.dtr = False  # GPIO0 high => run mode
        s.rts = True   # EN low
        time.sleep(0.12)
        s.rts = False


def read(port: str, baud: int, duration: float, max_bytes: int, reset_style: str | None = None,
         cancel: threading.Event | None = None, on_data: Callable[[str], None] | None = None) -> dict:
    s = _open(port, baud)
    try:
        if reset_style:
            s.reset_input_buffer()
            pulse_reset(s, reset_style)
        buf = bytearray()
        truncated = False
        end = time.monotonic() + duration
        while time.monotonic() < end and not (cancel and cancel.is_set()):
            try:
                data = s.read(4096)
            except (serial.SerialException, OSError) as e:
                raise SerialError(f"device disconnected during capture: {e}") from e
            if data:
                if on_data:
                    on_data(clean(data.decode("utf-8", "replace")))
                room = max_bytes - len(buf)
                if room <= 0:
                    truncated = True
                    continue
                buf += data[:room]
                truncated = truncated or len(data) > room
        return {"text": clean(buf.decode("utf-8", "replace")), "bytes": len(buf), "truncated": truncated, "baud_rate": baud, "port": port}
    finally:
        s.close()


def reset_only(port: str, style: str) -> None:
    s = _open(port, 115200)
    try:
        pulse_reset(s, style)
    finally:
        s.close()


_RST = re.compile(r"rst:0x([0-9a-fA-F]+)\s*\(([A-Z0-9_]+)\)")


def analyze_boot_log(text: str) -> dict:
    """Heuristic classification of a boot log. Pure function (unit-tested)."""
    resets = _RST.findall(text)
    reasons = [r[1] for r in resets]
    flags = {
        "boot_detected": bool(resets) or "ets Jan  8 2013" in text or "ESP-ROM:" in text or "ets_main.c" in text or "I (" in text,
        "panic": bool(re.search(r"Guru Meditation Error|abort\(\) was called|Backtrace:|Fatal exception|Exception \(\d+\):|\*\*\* Panic|assert failed", text)),
        "brownout": "Brownout detector was triggered" in text or "BROWNOUT_RST" in reasons,
        "watchdog_reset": any("WDT" in r for r in reasons) or "Soft WDT reset" in text or "Task watchdog got triggered" in text,
        "waiting_for_download": "waiting for download" in text,
        "boot_loop": len(resets) >= 3,
    }
    return {"reset_reasons": reasons, "flags": flags, "healthy": flags["boot_detected"] and not (flags["panic"] or flags["brownout"] or flags["watchdog_reset"] or flags["boot_loop"] or flags["waiting_for_download"]) or (not flags["boot_detected"] and bool(text.strip()) and not flags["panic"])}
