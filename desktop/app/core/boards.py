"""Board/family registry, shared with the cloud (shared/boards.json)."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _registry_path() -> Path:
    if getattr(sys, "frozen", False):  # PyInstaller bundle
        return Path(getattr(sys, "_MEIPASS", ".")) / "boards.json"
    return Path(__file__).resolve().parents[3] / "shared" / "boards.json"


REGISTRY: dict[str, Any] = json.loads(_registry_path().read_text(encoding="utf-8"))
LIMITS: dict[str, int] = REGISTRY["limits"]
FAMILIES: dict[str, dict[str, Any]] = REGISTRY["families"]
BOARDS: dict[str, dict[str, Any]] = {b["id"]: b for b in REGISTRY["boards"]}


def parse_size(s: str) -> int:
    n, unit = int(s[:-2]), s[-2:]
    return n * (1024 * 1024 if unit == "MB" else 1024)


def is_esp(family: str) -> bool:
    return family.startswith("esp")
