"""USB / COM-port discovery and MCU classification."""
from __future__ import annotations

import glob
import hashlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from serial.tools import list_ports


@dataclass
class UsbPort:
    port: str | None
    vid: int | None
    pid: int | None
    serial_number: str | None = None
    manufacturer: str | None = None
    product: str | None = None
    description: str | None = None


@dataclass
class Classification:
    family: str | None = None          # known family (None = ambiguous UART bridge)
    board: str | None = None
    chip: str | None = None
    supported: bool = False
    programmer: str | None = None       # external programmer required (ST-Link, WCH-LinkE)
    uart_bridge: bool = False
    candidates: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    label: str = "Unknown USB device"


# (vid, pid) -> classification template
_UART_BRIDGES = {
    (0x10C4, 0xEA60): "Silicon Labs CP210x USB-UART",
    (0x1A86, 0x7523): "WCH CH340 USB-UART",
    (0x1A86, 0x55D4): "WCH CH9102 USB-UART",
    (0x1A86, 0x7522): "WCH CH340K USB-UART",
    (0x0403, 0x6001): "FTDI FT232R USB-UART",
    (0x0403, 0x6010): "FTDI FT2232 USB-UART",
    (0x0403, 0x6014): "FTDI FT232H USB-UART",
    (0x0403, 0x6015): "FTDI FT231X USB-UART",
}
_ARDUINO_UNO = {(0x2341, 0x0043), (0x2341, 0x0001), (0x2341, 0x0243), (0x2A03, 0x0043), (0x2A03, 0x0243)}
_ARDUINO_MEGA = {(0x2341, 0x0042), (0x2341, 0x0010), (0x2A03, 0x0042), (0x2A03, 0x0010)}
_STLINK = {(0x0483, 0x374B), (0x0483, 0x3748), (0x0483, 0x374E), (0x0483, 0x374F), (0x0483, 0x3752), (0x0483, 0x3753)}
_WCHLINK = {(0x1A86, 0x8010), (0x1A86, 0x8012)}


def classify(u: UsbPort) -> Classification:
    key = (u.vid or 0, u.pid or 0)
    if u.vid == 0x303A:
        if u.pid == 0x1001:
            return Classification(None, None, None, True, None, False, ["esp32s3", "esp32c3"], ["Espressif native USB-Serial/JTAG (ESP32-S3/C3); run identify_mcu to tell them apart."], "Espressif USB-Serial/JTAG")
        if u.pid in (0x0002, 0x0001):
            return Classification("esp32s2", None, "ESP32-S2", True, None, False, [], ["ESP32-S2 native USB (ROM bootloader/CDC)."], "ESP32-S2 (native USB)")
        return Classification(None, None, None, True, None, False, [], ["Espressif USB device."], "Espressif USB device")
    if key in _ARDUINO_UNO:
        return Classification("avr", "arduino-uno", "ATmega328P", True, None, False, [], [], "Arduino Uno")
    if key in _ARDUINO_MEGA:
        return Classification("avr", "arduino-mega2560", "ATmega2560", True, None, False, [], [], "Arduino Mega 2560")
    if key in _STLINK:
        return Classification("stm32", None, None, True, "ST-Link", False, [], ["Flashes the STM32 attached to this ST-Link over SWD."], "ST-Link programmer")
    if key in _WCHLINK:
        return Classification("ch32v003", "ch32v003f4p6", "CH32V003", True, "WCH-LinkE", False, [], ["WCH-LinkE must be in RISC-V mode (not ARM/DAP mode) for CH32V003."], "WCH-LinkE programmer")
    if key in _UART_BRIDGES:
        return Classification(None, None, None, True, None, True, ["esp32", "esp8266", "avr"], ["Generic USB-UART bridge: run identify_mcu to detect the attached chip. STM32/CH32V003 cannot be programmed through a plain UART adapter by this app."], _UART_BRIDGES[key])
    if u.vid == 0x0483 and u.pid == 0xDF11:
        return Classification("stm32", None, None, False, "STM32 ROM DFU", False, [], ["STM32 in DFU mode: not supported in this version; use ST-Link."], "STM32 DFU bootloader")
    if u.port:
        return Classification(None, None, None, False, None, False, [], ["Serial port is not a recognised programmable MCU."], u.description or "Serial port")
    return Classification()


def device_id(install_id: str, u: UsbPort) -> str:
    if u.serial_number:
        ident = f"{u.vid}:{u.pid}:{u.serial_number}"
    else:
        ident = f"{u.vid}:{u.pid}:{u.port}"
    return "dev_" + hashlib.sha256(f"{install_id}|{ident}".encode()).hexdigest()[:12]


def scan_serial_ports() -> list[UsbPort]:
    out = []
    for p in list_ports.comports():
        if p.vid is None and sys.platform != "win32":
            continue  # skip legacy/platform UARTs (/dev/ttyS*)
        out.append(UsbPort(p.device, p.vid, p.pid, p.serial_number or None, p.manufacturer or None, p.product or None, p.description or None))
    return out


_PS = (
    "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\\VID_*' } | "
    "Select-Object InstanceId, FriendlyName, Manufacturer | ConvertTo-Json -Compress"
)


def parse_pnp_json(text: str) -> list[UsbPort]:
    """Parse the output of the fixed PnP query above (pure; unit-tested)."""
    import re

    if not text.strip():
        return []
    data = json.loads(text)
    if isinstance(data, dict):
        data = [data]
    seen: set[tuple[int, int, str]] = set()
    out: list[UsbPort] = []
    for d in data:
        inst = str(d.get("InstanceId", ""))
        m = re.match(r"USB\\VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})(?:&MI_\w\w)?\\(.+)$", inst)
        if not m:
            continue
        vid, pid, ser = int(m.group(1), 16), int(m.group(2), 16), m.group(3)
        if (vid, pid, ser) in seen:
            continue
        seen.add((vid, pid, ser))
        out.append(UsbPort(None, vid, pid, None if "&" in ser else ser, d.get("Manufacturer"), d.get("FriendlyName"), d.get("FriendlyName")))
    return out


def scan_programmers() -> list[UsbPort]:
    """Non-serial USB devices we care about (ST-Link, WCH-LinkE, STM32 DFU)."""
    interesting = _STLINK | _WCHLINK | {(0x0483, 0xDF11)}
    found: list[UsbPort] = []
    try:
        if sys.platform == "win32":
            r = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", _PS], capture_output=True, text=True, timeout=15,
                               stdin=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            cands = parse_pnp_json(r.stdout)
        elif sys.platform.startswith("linux"):
            cands = []
            for d in glob.glob("/sys/bus/usb/devices/*"):
                try:
                    vid = int(Path(d, "idVendor").read_text().strip(), 16)
                    pid = int(Path(d, "idProduct").read_text().strip(), 16)
                except (OSError, ValueError):
                    continue
                ser = None
                try:
                    ser = Path(d, "serial").read_text().strip()
                except OSError:
                    pass
                cands.append(UsbPort(None, vid, pid, ser))
        else:
            cands = []
    except (OSError, subprocess.SubprocessError, ValueError):
        return []
    for c in cands:
        if (c.vid or 0, c.pid or 0) in interesting:
            found.append(c)
    return found
