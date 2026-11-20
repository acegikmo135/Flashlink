"""Device registry: merges COM ports and programmers, classifies, applies allow policy."""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field

from app.core.boards import BOARDS
from app.core.config import SettingsStore, data_dir
from app.hardware import usb
from app.hardware.flashers import DeviceRef, toolchain_missing
from app.hardware.simulated import SIM_DEVICES, sim_device_kinds


@dataclass
class Device:
    id: str
    port: str | None
    usb: usb.UsbPort
    cls: usb.Classification
    family: str | None
    chip: str | None
    board: str | None
    identified: bool = False
    flash_size: str | None = None
    mac: str | None = None
    sim: bool = False
    allowed: bool = False
    missing: list[str] = field(default_factory=list)
    seen_at: float = field(default_factory=time.time)

    @property
    def label(self) -> str:
        if self.board and self.board in BOARDS:
            return BOARDS[self.board]["label"]
        return self.chip or self.cls.label

    def capabilities(self) -> list[str]:
        caps: list[str] = []
        if not self.cls.supported and not self.sim:
            return caps
        caps += ["identify"]
        if self.family or self.cls.uart_bridge or self.cls.candidates:
            caps += ["flash", "verify", "reset"]
        if self.port:
            caps.append("serial")
        return caps

    def ref(self) -> DeviceRef:
        return DeviceRef(self.id, self.port, self.family, self.chip, self.board, self.usb.vid, self.usb.pid, self.usb.serial_number, self.cls.programmer, self.sim)

    def to_wire(self) -> dict:
        u = self.usb
        hx = lambda v: f"{v:04x}" if v is not None else None  # noqa: E731
        return {
            "id": self.id, "port": self.port,
            "usb": {"vid": hx(u.vid), "pid": hx(u.pid), "serial_number": u.serial_number, "manufacturer": u.manufacturer, "product": u.product, "description": u.description or self.cls.label},
            "family": self.family, "chip": self.chip, "board": self.board,
            "identified": self.identified, "identification": "simulated" if self.sim else ("probe" if self.identified else "usb_heuristic"),
            "supported": bool(self.cls.supported or self.sim), "allowed": self.allowed,
            "capabilities": self.capabilities(), "programmer": self.cls.programmer, "missing": self.missing,
            "notes": self.cls.notes + (["Simulated device (development mode)."] if self.sim else []),
            "flash_size": self.flash_size, "mac": self.mac,
        }


class HardwareManager:
    PROGRAMMER_SCAN_INTERVAL = 20.0

    def __init__(self, store: SettingsStore) -> None:
        self.store = store
        self._lock = threading.RLock()
        self._ident_path = data_dir() / "identified.json"
        try:
            self._ident: dict[str, dict] = json.loads(self._ident_path.read_text())
        except (OSError, ValueError):
            self._ident = {}
        self._prog_cache: list[usb.UsbPort] = []
        self._prog_at = 0.0
        self._born = time.monotonic()
        self.devices: dict[str, Device] = {}
        self.busy: dict[str, str] = {}  # device id -> reason/job id

    def set_identified(self, dev_id: str, info: dict) -> None:
        with self._lock:
            keep = {k: info.get(k) for k in ("family", "chip", "flash_size", "mac", "board")}
            self._ident[dev_id] = keep
            try:
                self._ident_path.write_text(json.dumps(self._ident))
            except OSError:
                pass

    def is_allowed(self, dev_id: str, supported: bool) -> bool:
        s = self.store.settings
        if dev_id in s.device_allow:
            return bool(s.device_allow[dev_id])
        return supported and s.trust_policy == "auto"

    def set_allowed(self, dev_id: str, allowed: bool) -> None:
        self.store.settings.device_allow[dev_id] = allowed
        self.store.save()

    def scan(self, force_programmers: bool = False) -> list[Device]:
        s = self.store.settings
        found: list[Device] = []
        if s.simulate:
            for kind in sim_device_kinds():
                d = SIM_DEVICES[kind]
                u = usb.UsbPort(d["port"], 0x1209, 0x0001, d["id"], "MCU Bridge", "Simulated " + d["chip"], "Simulated " + d["chip"])
                dev = Device(d["id"], d["port"], u, usb.Classification(d["family"], d["board"], d["chip"], True, None, False, [], [], "Simulated " + d["chip"]), d["family"], d["chip"], d["board"], True, d["flash_size"], d["mac"], sim=True)
                found.append(dev)
        else:
            ports = usb.scan_serial_ports()
            now = time.monotonic()
            # the (comparatively expensive) PnP query is held back for a few seconds so start-up stays snappy
            if force_programmers or (now - self._prog_at > self.PROGRAMMER_SCAN_INTERVAL and now - self._born > 4.0):
                self._prog_cache = usb.scan_programmers()
                self._prog_at = now
            have = {(p.vid, p.pid, p.serial_number) for p in ports}
            for p in [*ports, *[q for q in self._prog_cache if (q.vid, q.pid, q.serial_number) not in have]]:
                cls = usb.classify(p)
                dev_id = usb.device_id(s.install_id, p)
                ident = self._ident.get(dev_id, {})
                family = ident.get("family") or cls.family
                dev = Device(dev_id, p.port, p, cls, family, ident.get("chip") or cls.chip, ident.get("board") or cls.board, bool(ident), ident.get("flash_size"), ident.get("mac"))
                if dev.identified and not dev.board and family:
                    dev.board = f"{family}-generic" if f"{family}-generic" in BOARDS else None
                found.append(dev)
        for dev in found:
            supported = bool(dev.cls.supported or dev.sim)
            dev.allowed = self.is_allowed(dev.id, supported)
            dev.missing = [] if (dev.sim or not dev.family) else toolchain_missing(dev.family)
            if dev.cls.programmer and not dev.family:
                dev.missing = []
        with self._lock:
            self.devices = {d.id: d for d in found}
        return found

    def get(self, dev_id: str) -> Device | None:
        return self.devices.get(dev_id)
