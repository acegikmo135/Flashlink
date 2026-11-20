"""STM32 over SWD using an ST-Link: STM32CubeProgrammer CLI (preferred) or OpenOCD.

NOTE: argument construction is unit-tested; it has not been exercised against
real hardware by the project authors.
"""
from __future__ import annotations

import re
import threading

from app.core.boards import BOARDS, FAMILIES
from app.hardware import tools
from app.hardware.process import run_tool

from .base import DeviceRef, FlashError, FlashOutcome, FlashRequest, Flasher

_PCT = re.compile(r"(\d+)\s*%")


def tcl_path(p: str) -> str:
    return "{" + p.replace("\\", "/") + "}"


def cube_args(cli: str, files: list[tuple[str, int | None]], verify: bool) -> list[str]:
    argv = [cli, "-c", "port=SWD"]
    for path, addr in files:
        argv += ["-w", path] + ([f"0x{addr:08X}"] if addr is not None else [])
    if verify:
        argv.append("-v")
    argv.append("-rst")
    return argv


def openocd_args(exe: str, target_cfg: str, files: list[tuple[str, int | None]], verify: bool, verify_only: bool) -> list[str]:
    argv = [exe, "-f", "interface/stlink.cfg", "-f", f"target/{target_cfg}"]
    if verify_only:
        argv += ["-c", "init", "-c", "reset halt"]
        for path, addr in files:
            argv += ["-c", f"verify_image {tcl_path(path)} 0x{addr:08X}" if addr is not None else f"verify_image {tcl_path(path)}"]
        argv += ["-c", "reset run", "-c", "shutdown"]
        return argv
    for path, addr in files:
        off = f" 0x{addr:08X}" if addr is not None else ""
        argv += ["-c", f"program {tcl_path(path)}{off}{' verify' if verify else ''}"]
    argv += ["-c", "reset run", "-c", "shutdown"]
    return argv


class Stm32Flasher(Flasher):
    name = "stm32"

    def missing(self) -> list[str]:
        if tools.find("stm32cube").available or tools.find("openocd").available:
            return []
        return ["STM32_Programmer_CLI or openocd"]

    def identify(self, dev: DeviceRef, cancel: threading.Event | None = None) -> dict:
        cube = tools.find("stm32cube")
        if cube.available and cube.path:
            r = run_tool([cube.path, "-c", "port=SWD"], cancel=cancel, timeout=30)
            m = re.search(r"Device name\s*:\s*(.+)", "\n".join(r.lines))
            if r.ok and m:
                return {"family": "stm32", "chip": m.group(1).strip()}
            raise FlashError("PROBE_FAILED", "ST-Link found, but no STM32 answered over SWD (check wiring/power/BOOT0).", r.tail(8))
        return {"family": "stm32", "chip": None}

    def run(self, req: FlashRequest) -> FlashOutcome:
        m = req.manifest
        board = BOARDS[m.board]
        files = [(str(req.paths[f.filename]), None if f.format == "ihex" else f.address) for f in sorted(m.files, key=lambda x: x.address)]
        cube, ocd = tools.find("stm32cube"), tools.find("openocd")
        verify_only = req.kind == "verify"
        if cube.available and cube.path and not verify_only:
            argv = cube_args(cube.path, files, req.verify)
            tool = "STM32_Programmer_CLI"
        elif ocd.available and ocd.path:
            argv = openocd_args(ocd.path, board["openocd_target"], files, req.verify, verify_only)
            tool = "openocd"
        else:
            raise FlashError("PROGRAMMER_MISSING", "No STM32 programming tool found. " + tools.HINTS["stm32cube"], {"verify_only_needs": "openocd"} if verify_only else None)

        phase = "verifying" if verify_only else "flashing"
        req.progress(phase, 0, f"Running {tool}", None)

        def on_line(line: str) -> None:
            req.log(line)
            p = _PCT.search(line)
            if p:
                req.progress(phase, float(p.group(1)), line[:120], None)

        r = run_tool(argv, on_line, req.cancel, timeout=300)
        text = "\n".join(r.lines).lower()
        if r.cancelled:
            raise FlashError("CANCELLED", "Cancelled while programming; the MCU may hold a partial image.")
        if not r.ok:
            if re.search(r"verif\w* failed|mismatch", text):
                raise FlashError("VERIFICATION_FAILED", "Flash contents differ from the firmware.", r.tail())
            if re.search(r"no st-link|no stlink|unable to open|no device found|target not|init mode failed|cannot connect", text):
                raise FlashError("PROGRAMMER_MISSING", "ST-Link or target not found (driver, cable, SWD wiring, power).", r.tail())
            raise FlashError("FLASH_FAILED", f"{tool} exited with an error", r.tail())
        verified = (req.verify or verify_only) and bool(re.search(r"verified ok|verified successfully|download verified", text))
        if (req.verify or verify_only) and not verified:
            raise FlashError("VERIFICATION_FAILED", f"{tool} finished but did not confirm verification.", r.tail())
        req.progress(phase, 100, "Done", None)
        return FlashOutcome(verified, {"tool": tool, "chip": board["id"]})

    def reset(self, dev: DeviceRef) -> str:
        ocd = tools.find("openocd")
        if not (ocd.available and ocd.path):
            raise FlashError("PROGRAMMER_MISSING", "Resetting an STM32 via ST-Link requires OpenOCD.")
        cfg = BOARDS.get(dev.board or "", {}).get("openocd_target", "stm32f1x.cfg")
        r = run_tool([ocd.path, "-f", "interface/stlink.cfg", "-f", f"target/{cfg}", "-c", "init", "-c", "reset run", "-c", "shutdown"], timeout=30)
        if not r.ok:
            raise FlashError("PROGRAMMER_MISSING", "ST-Link reset failed", r.tail(8))
        return "openocd reset run"
