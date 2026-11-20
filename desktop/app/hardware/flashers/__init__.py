"""Flasher registry."""
from __future__ import annotations

from .avr import AvrFlasher
from .base import DeviceRef, FlashError, FlashOutcome, FlashRequest, Flasher
from .esp import EspFlasher
from .stm32 import Stm32Flasher
from .wch import WchFlasher

__all__ = ["DeviceRef", "FlashError", "FlashOutcome", "FlashRequest", "Flasher", "flasher_for"]

_ESP, _AVR, _STM, _WCH = EspFlasher(), AvrFlasher(), Stm32Flasher(), WchFlasher()


def flasher_for(family: str | None, device: DeviceRef | None = None) -> Flasher:
    if device is not None and device.sim:
        from app.hardware.simulated import SimFlasher

        return SimFlasher()
    if family and family.startswith("esp"):
        return _ESP
    if family == "avr":
        return _AVR
    if family == "stm32":
        return _STM
    if family == "ch32v003":
        return _WCH
    raise FlashError("UNSUPPORTED_MCU", f"No flashing backend for family {family!r}")


def toolchain_missing(family: str | None) -> list[str]:
    try:
        return flasher_for(family).missing()
    except FlashError:
        return []
