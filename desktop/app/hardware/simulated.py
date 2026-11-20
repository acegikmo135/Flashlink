"""Simulated hardware for development and automated end-to-end tests.

Enabled only with --simulate / MCUBRIDGE_SIMULATE=1. It exercises the *real*
cloud protocol, transfer, validation and job lifecycle against virtual boards;
it never touches a serial port. Real flashing is NOT tested by this module.
"""
from __future__ import annotations

import os
import time

from app.core.boards import FAMILIES
from app.hardware import serialio

from .flashers.base import DeviceRef, FlashError, FlashOutcome, FlashRequest, Flasher

SIM_BOOT_LOG = (
    "ets Jun  8 2016 00:22:57\n\nrst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\n"
    "configsip: 0, SPIWP:0xee\nI (29) boot: ESP-IDF v5.2 2nd stage bootloader\n"
    "I (310) app: MCU Bridge simulated firmware running\nhello from MCU Bridge sim\n"
)

SIM_DEVICES = {
    "esp32": dict(id="dev_sim_esp32", port="SIM1", family="esp32", chip="ESP32-D0WD-V3", board="esp32-wroom-32", flash_size="4MB", mac="24:6f:28:aa:bb:01"),
    "avr": dict(id="dev_sim_uno", port="SIM2", family="avr", chip="ATmega328P", board="arduino-uno", flash_size=None, mac=None),
    "esp32s3": dict(id="dev_sim_s3", port="SIM3", family="esp32s3", chip="ESP32-S3", board="esp32-s3-devkitc-1", flash_size="8MB", mac="24:6f:28:aa:bb:03"),
}


def sim_device_kinds() -> list[str]:
    raw = os.environ.get("MCUBRIDGE_SIM_DEVICES", "esp32")
    return [k for k in (x.strip() for x in raw.split(",")) if k in SIM_DEVICES]


class SimFlasher(Flasher):
    name = "simulator"
    memory: dict[str, dict[int, str]] = {}  # device id -> {address: sha256}

    def identify(self, dev: DeviceRef, cancel=None) -> dict:
        d = next(v for v in SIM_DEVICES.values() if v["id"] == dev.id)
        time.sleep(0.2)
        return {"family": d["family"], "chip": d["chip"], "flash_size": d["flash_size"], "mac": d["mac"], "board": d["board"]}

    def run(self, req: FlashRequest) -> FlashOutcome:
        m, dev = req.manifest, req.device
        if dev.family and m.family != dev.family:
            raise FlashError("TARGET_MISMATCH", f"Connected chip is {dev.chip} ({dev.family}), firmware targets {m.family}.")
        names = " ".join(f.filename for f in m.files)
        slow = "simslow" in names
        steps = 40 if slow else 10
        mem = self.memory.setdefault(dev.id, {})
        if req.kind == "flash":
            for i in range(steps + 1):
                if req.cancel.is_set():
                    raise FlashError("CANCELLED", "Cancelled while writing; simulated chip holds a partial image.")
                req.progress("flashing", 100 * i / steps, f"Writing ({i}/{steps})", m.files[0].filename)
                time.sleep(0.15 if slow else 0.02)
                if "simfail-flash" in names and i == steps // 2:
                    raise FlashError("FLASH_FAILED", "Simulated programmer failure mid-write.")
            for f in m.files:
                mem[f.address] = f.sha256
            if "simcorrupt" in names:
                mem[m.files[0].address] = "0" * 64
        verified = False
        if req.verify or req.kind == "verify":
            for i in range(5):
                req.progress("verifying", 20 * (i + 1), "Reading back", None)
                time.sleep(0.02)
            if any(mem.get(f.address) != f.sha256 for f in m.files):
                raise FlashError("VERIFICATION_FAILED", "Simulated flash contents differ from the firmware package.")
            verified = True
        return FlashOutcome(verified, {"chip": dev.chip, "tool": "simulator", "flash_size": None})

    def reset(self, dev: DeviceRef) -> str:
        return "simulated reset"


def sim_read(duration: float, max_bytes: int, reset: bool) -> dict:
    time.sleep(min(duration, 1.0))
    text = (SIM_BOOT_LOG if reset else "sim: tick 1\nsim: tick 2\n")[:max_bytes]
    return {"text": text, "bytes": len(text), "truncated": False, "baud_rate": 115200, "port": "SIM"}


__all__ = ["SimFlasher", "SIM_DEVICES", "sim_device_kinds", "sim_read", "serialio", "FAMILIES"]
