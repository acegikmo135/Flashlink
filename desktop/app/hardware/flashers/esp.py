"""ESP32 family / ESP8266 via esptool (bundled Python package, run as a child process)."""
from __future__ import annotations

import re
import threading

from app.core.boards import FAMILIES, parse_size
from app.hardware import serialio, tools
from app.hardware.process import run_tool

from .base import DeviceRef, FlashError, FlashOutcome, FlashRequest, Flasher

_CHIP = re.compile(r"(?:Chip type:|Chip is|Connected to|Detecting chip type\.\.\.)\s*(ESP[0-9A-Za-z-]+)")
_SIZE = re.compile(r"Detected flash size:\s*(\d+)\s*([KM])B", re.I)
_MAC = re.compile(r"MAC:\s*((?:[0-9a-f]{2}:){5}[0-9a-f]{2})", re.I)
_PCT = re.compile(r"(\d+(?:\.\d+)?)\s*%")


def family_from_chip(chip: str) -> str | None:
    c = chip.upper()
    for key, fam in (("ESP32-S3", "esp32s3"), ("ESP32-S2", "esp32s2"), ("ESP32-C3", "esp32c3"), ("ESP8266", "esp8266"), ("ESP8285", "esp8266")):
        if c.startswith(key):
            return fam
    if re.match(r"ESP32(-|$)", c):  # ESP32, ESP32-D0WD, ESP32-PICO-D4 ...
        return None if re.match(r"ESP32-(C[0-9]|H[0-9]|P[0-9]|S[0-9]|E)", c) else "esp32"
    return None


def parse_probe(lines: list[str]) -> dict:
    text = "\n".join(lines)
    info: dict = {}
    m = _CHIP.search(text)
    if m:
        info["chip"] = m.group(1)
        info["family"] = family_from_chip(m.group(1))
    s = _SIZE.search(text)
    if s:
        info["flash_size"] = f"{s.group(1)}{s.group(2).upper()}B"
    mac = _MAC.search(text)
    if mac:
        info["mac"] = mac.group(1).lower()
    return info


def classify_failure(lines: list[str], default: str = "FLASH_FAILED") -> tuple[str, str]:
    t = "\n".join(lines[-40:]).lower()
    if re.search(r"could not open port|permissionerror|access is denied|resource busy|device or resource busy", t):
        return "SERIAL_ERROR", "The serial port could not be opened — another program (serial monitor, IDE) probably holds it."
    if re.search(r"verif\w* failed|digest mismatch|verification failed", t):
        return "VERIFICATION_FAILED", "Flash contents differ from the firmware after writing."
    if re.search(r"failed to connect|no serial data received|timed out waiting for packet header|wrong boot mode", t):
        return "FLASH_FAILED", "Could not enter the ROM bootloader. Hold the BOOT button while plugging in / during connect, check the USB cable and port."
    if "a fatal error occurred" in t:
        m = re.search(r"a fatal error occurred: (.+)", t)
        return default, (m.group(1)[:200] if m else "esptool reported a fatal error")
    return default, "esptool exited with an error"


class EspFlasher(Flasher):
    name = "esptool"

    def missing(self) -> list[str]:
        return [] if tools.find("esptool").available else ["esptool"]

    def _argv(self, dev: DeviceRef, baud: int, chip: str | None, after: str) -> list[str]:
        if not dev.port:
            raise FlashError("DEVICE_DISCONNECTED", "device has no serial port")
        argv = tools.esptool_argv() + ["--port", dev.port, "--baud", str(baud), "--after", after]
        if chip:
            argv += ["--chip", chip]
        return argv

    def identify(self, dev: DeviceRef, cancel: threading.Event | None = None) -> dict:
        r = run_tool(self._argv(dev, 115200, None, "hard-reset") + ["flash-id"], cancel=cancel, timeout=45)
        info = parse_probe(r.lines)
        if not info.get("chip"):
            code, msg = classify_failure(r.lines, "PROBE_FAILED")
            raise FlashError("PROBE_FAILED" if code == "FLASH_FAILED" else code, msg, r.tail(10))
        if info.get("family") is None:
            raise FlashError("UNSUPPORTED_MCU", f"{info['chip']} is not supported by this version of MCU Bridge", info)
        return info

    def run(self, req: FlashRequest) -> FlashOutcome:
        m, dev = req.manifest, req.device
        baud = m.baud_rate or FAMILIES[m.family]["default_baud"]
        req.progress("preparing", 0, "Probing chip", None)
        info = self.identify(dev, req.cancel)
        if req.cancel.is_set():
            raise FlashError("CANCELLED", "Cancelled before writing")
        if info["family"] != m.family:
            raise FlashError("TARGET_MISMATCH", f"Connected chip is {info['chip']} ({info['family']}) but the firmware targets {m.family}.")
        want = parse_size(m.flash_size or "0KB") if m.flash_size else 0
        got = parse_size(info["flash_size"]) if info.get("flash_size") else 0
        if got and want and got < want:
            raise FlashError("TARGET_MISMATCH", f"Chip reports {info['flash_size']} flash but the manifest requires {m.flash_size}.")
        chip = FAMILIES[m.family]["chip"]
        flags = ["--flash-mode", m.mode or "keep", "--flash-freq", m.frequency or "keep", "--flash-size", m.flash_size or "keep"]
        pairs: list[str] = []
        for f in sorted(m.files, key=lambda x: x.address):
            pairs += [f"0x{f.address:x}", str(req.paths[f.filename])]
        names = {f"0x{f.address:x}": f.filename for f in m.files}
        state = {"file": None}

        def on_line(line: str, phase: str) -> None:
            req.log(line)
            a = re.search(r"(?:Writing at|Reading at|Verifying at) (0x[0-9a-fA-F]+)", line)
            if a:
                state["file"] = names.get(f"0x{int(a.group(1), 16):x}", state["file"])
            p = _PCT.search(line)
            if p:
                req.progress(phase, float(p.group(1)), line[:120], state["file"])

        if req.kind == "flash":
            req.progress("flashing", 0, "Writing flash", None)
            after = "no-reset" if req.verify else "hard-reset"
            r = run_tool(self._argv(dev, baud, chip, after) + ["write-flash"] + flags + pairs, lambda l: on_line(l, "flashing"), req.cancel, timeout=600)
            if r.cancelled:
                raise FlashError("CANCELLED", "Cancelled while writing; the chip may hold a partial image.")
            if not r.ok:
                code, msg = classify_failure(r.lines)
                raise FlashError(code, msg, r.tail())
            req.progress("flashing", 100, "Write complete", None)
        verified = False
        if req.verify or req.kind == "verify":
            req.progress("verifying", 0, "Reading back and comparing", None)
            r = run_tool(self._argv(dev, baud, chip, "hard-reset") + ["verify-flash"] + flags + pairs, lambda l: on_line(l, "verifying"), req.cancel, timeout=600)
            if r.cancelled:
                raise FlashError("CANCELLED", "Cancelled during verification")
            if not r.ok:
                code, msg = classify_failure(r.lines, "VERIFICATION_FAILED")
                raise FlashError("VERIFICATION_FAILED" if code in ("FLASH_FAILED", "VERIFICATION_FAILED") else code, msg, r.tail())
            verified = True
            req.progress("verifying", 100, "Verification passed", None)
        return FlashOutcome(verified, {"chip": info["chip"], "mac": info.get("mac"), "flash_size": info.get("flash_size"), "tool": "esptool " + (tools.find("esptool").version or "")})

    def reset(self, dev: DeviceRef) -> str:
        if not dev.port:
            raise FlashError("DEVICE_DISCONNECTED", "no serial port")
        if dev.vid == 0x303A:  # native USB-Serial/JTAG: reset via esptool's USB-aware sequence
            r = run_tool(self._argv(dev, 115200, None, "hard-reset") + ["chip-id"], timeout=30)
            if not r.ok:
                raise FlashError("SERIAL_ERROR", "reset via esptool failed", r.tail(8))
            return "esptool hard-reset (USB-Serial/JTAG)"
        try:
            serialio.reset_only(dev.port, "esp")
        except serialio.SerialError as e:
            raise FlashError("SERIAL_ERROR", str(e)) from e
        return "RTS pulse on EN"
