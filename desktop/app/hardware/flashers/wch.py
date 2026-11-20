"""CH32V003 via WCH-LinkE using the open-source `wlink` CLI.

NOTE: command construction is unit-tested; not exercised on real hardware.
"""
from __future__ import annotations

import re
import threading

from app.hardware import tools
from app.hardware.process import run_tool

from .base import DeviceRef, FlashError, FlashOutcome, FlashRequest, Flasher


class WchFlasher(Flasher):
    name = "wlink"

    def missing(self) -> list[str]:
        return [] if tools.find("wlink").available else ["wlink"]

    def _exe(self) -> str:
        t = tools.find("wlink")
        if not (t.available and t.path):
            raise FlashError("PROGRAMMER_MISSING", "wlink is not installed. " + t.hint)
        return t.path

    def identify(self, dev: DeviceRef, cancel: threading.Event | None = None) -> dict:
        r = run_tool([self._exe(), "status"], cancel=cancel, timeout=20)
        if not r.ok:
            raise FlashError("PROBE_FAILED", "WCH-LinkE found but the target did not answer (is it in RISC-V mode? SWIO wiring?).", r.tail(8))
        m = re.search(r"(CH32V\w+)", "\n".join(r.lines), re.I)
        return {"family": "ch32v003", "chip": m.group(1).upper() if m else "CH32V003"}

    def run(self, req: FlashRequest) -> FlashOutcome:
        exe = self._exe()
        f = req.manifest.files[0]
        path = str(req.paths[f.filename])
        phase = "flashing"
        if req.kind == "flash":
            req.progress(phase, 0, "Programming via WCH-LinkE", f.filename)
            r = run_tool([exe, "flash", "--chip", "CH32V003", "--address", f"0x{f.address:08x}", path], lambda l: req.log(l), req.cancel, timeout=120)
            if r.cancelled:
                raise FlashError("CANCELLED", "Cancelled while programming.")
            if not r.ok:
                raise FlashError("FLASH_FAILED", "wlink flash failed", r.tail())
            req.progress(phase, 100, "Write complete", f.filename)
        verified = False
        if req.verify or req.kind == "verify":
            req.progress("verifying", 0, "Verifying", f.filename)
            r = run_tool([exe, "verify", "--chip", "CH32V003", "--address", f"0x{f.address:08x}", path], lambda l: req.log(l), req.cancel, timeout=120)
            if not r.ok:
                raise FlashError("VERIFICATION_FAILED", "wlink verify failed", r.tail())
            verified = True
            req.progress("verifying", 100, "Verification passed", f.filename)
        return FlashOutcome(verified, {"tool": "wlink " + (tools.find("wlink").version or ""), "chip": "CH32V003"})

    def reset(self, dev: DeviceRef) -> str:
        r = run_tool([self._exe(), "reset"], timeout=20)
        if not r.ok:
            raise FlashError("PROGRAMMER_MISSING", "wlink reset failed", r.tail(8))
        return "wlink reset"
