"""Flasher backend interface. Add a new MCU family by subclassing `Flasher`."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from app.core.manifest import Manifest

# progress(phase, percent, message, filename)
ProgressFn = Callable[[str, float, str, "str | None"], None]


class FlashError(Exception):
    def __init__(self, code: str, message: str, details: object = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


@dataclass
class DeviceRef:
    id: str
    port: str | None
    family: str | None
    chip: str | None
    board: str | None
    vid: int | None = None
    pid: int | None = None
    serial_number: str | None = None
    programmer: str | None = None
    sim: bool = False


@dataclass
class FlashRequest:
    manifest: Manifest
    device: DeviceRef
    paths: dict[str, Path]
    verify: bool
    kind: str  # "flash" | "verify"
    progress: ProgressFn
    cancel: threading.Event
    log: Callable[[str], None] = lambda _l: None


@dataclass
class FlashOutcome:
    verified: bool
    details: dict = field(default_factory=dict)


class Flasher:
    name = "base"

    def missing(self) -> list[str]:
        return []

    def identify(self, dev: DeviceRef, cancel: threading.Event | None = None) -> dict:
        raise FlashError("UNSUPPORTED_MCU", f"{self.name} cannot identify devices")

    def run(self, req: FlashRequest) -> FlashOutcome:
        raise NotImplementedError

    def reset(self, dev: DeviceRef) -> str:
        raise FlashError("UNSUPPORTED_MCU", f"{self.name} cannot reset devices")


def win_port(port: str) -> str:
    """COM10+ need the \\\\.\\ prefix for some native tools."""
    import re
    import sys

    if sys.platform == "win32" and re.fullmatch(r"COM\d+", port) and int(port[3:]) >= 10:
        return "\\\\.\\" + port
    return port
