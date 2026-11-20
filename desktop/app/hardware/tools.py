"""Locate flashing utilities. Nothing is installed or downloaded silently."""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from app.core.config import data_dir


@dataclass
class Tool:
    name: str
    available: bool
    path: str | None = None
    version: str | None = None
    hint: str = ""


def _search_dirs() -> list[Path]:
    dirs = []
    if getattr(sys, "frozen", False):
        dirs.append(Path(sys.executable).parent / "tools")
    else:
        dirs.append(Path(__file__).resolve().parents[2] / "tools")
    dirs.append(data_dir() / "tools")
    return dirs


EXE = {"avrdude": "avrdude", "stm32cube": "STM32_Programmer_CLI", "openocd": "openocd", "wlink": "wlink"}
HINTS = {
    "avrdude": "Needed for Arduino Uno/Nano/Mega. Place avrdude.exe in the 'tools' folder next to MCU Bridge, or install it and add it to PATH.",
    "stm32cube": "STM32CubeProgrammer CLI (STM32_Programmer_CLI.exe) — preferred STM32 programmer. Install STM32CubeProgrammer or copy its CLI to 'tools'.",
    "openocd": "OpenOCD — alternative STM32 programmer (ST-Link). Copy openocd to 'tools' or add it to PATH.",
    "wlink": "wlink — open-source programmer for CH32V003 via WCH-LinkE. Copy wlink.exe to 'tools' or add it to PATH.",
}


def _find_in(d: Path, exe: str, depth: int = 4) -> str | None:
    """Look for `exe` (with/without .exe) under d, at most `depth` levels deep."""
    names = {exe, exe + ".exe"} if sys.platform == "win32" else {exe}
    stack = [(d, 0)]
    while stack:
        cur, lvl = stack.pop()
        try:
            for entry in cur.iterdir():
                if entry.is_file() and entry.name in names:
                    return str(entry)
                if entry.is_dir() and lvl < depth and not entry.name.startswith("."):
                    stack.append((entry, lvl + 1))
        except OSError:
            continue
    return None


def _which(exe: str) -> str | None:
    for d in _search_dirs():
        if d.is_dir():
            hit = _find_in(d, exe)
            if hit:
                return hit
    return shutil.which(exe)


def _version(path: str, args: list[str]) -> str | None:
    try:
        r = subprocess.run([path, *args], capture_output=True, text=True, timeout=8, stdin=subprocess.DEVNULL,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"(\d+\.\d+(?:\.\d+)?)", (r.stdout + r.stderr)[:2000])
    return m.group(1) if m else None


_cache: dict[str, Tool] = {}


def find(name: str, refresh: bool = False) -> Tool:
    if name == "esptool":
        try:
            import esptool  # bundled Python package

            return Tool("esptool", True, "built-in", getattr(esptool, "__version__", None))
        except ImportError:
            return Tool("esptool", False, hint="esptool Python package is missing from this build.")
    if not refresh and name in _cache:
        return _cache[name]
    p = _which(EXE[name])
    ver_args = {"avrdude": ["-?"], "stm32cube": ["--version"], "openocd": ["--version"], "wlink": ["--version"]}[name]
    t = Tool(name, bool(p), p, _version(p, ver_args) if p else None, "" if p else HINTS[name])
    _cache[name] = t
    return t


def all_tools(refresh: bool = False) -> dict[str, Tool]:
    return {n: find(n, refresh) for n in ("esptool", "avrdude", "stm32cube", "openocd", "wlink")}


def esptool_argv() -> list[str]:
    """argv prefix that runs esptool; works both from source and a frozen bundle."""
    if getattr(sys, "frozen", False):
        return [sys.executable, "--tool", "esptool"]
    return [sys.executable, "-m", "esptool"]
