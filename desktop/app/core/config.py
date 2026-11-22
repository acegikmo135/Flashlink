"""Settings and per-user data directories."""
from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

APP_NAME = "MCUBridge"
APP_VERSION = "0.1.0"


def _default_server() -> str:
    """Worker URL baked in at build time (desktop/server_url.txt, written by setup)."""
    candidates = []
    if getattr(sys, "frozen", False):
        candidates.append(Path(getattr(sys, "_MEIPASS", ".")) / "server_url.txt")
    candidates.append(Path(__file__).resolve().parents[2] / "server_url.txt")
    for c in candidates:
        try:
            v = c.read_text(encoding="utf-8").strip()
            if v.startswith("https://") or v.startswith("http://localhost") or v.startswith("http://127."):
                return v.rstrip("/")
        except OSError:
            pass
    return "https://YOUR-WORKER.workers.dev"


DEFAULT_SERVER = _default_server()


def data_dir() -> Path:
    override = os.environ.get("MCUBRIDGE_HOME")
    if override:
        p = Path(override)
    elif sys.platform == "win32":
        p = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / APP_NAME
    else:
        p = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / APP_NAME
    p.mkdir(parents=True, exist_ok=True)
    return p


def tmp_dir() -> Path:
    p = data_dir() / "tmp"
    p.mkdir(parents=True, exist_ok=True)
    return p


def log_dir() -> Path:
    p = data_dir() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass
class Settings:
    server_url: str = DEFAULT_SERVER
    install_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    device_name: str = ""
    agent_id: str = ""
    account_email: str = ""
    start_with_windows: bool = False
    start_minimized: bool = False
    reconnect_min_seconds: int = 2
    reconnect_max_seconds: int = 60
    # "auto": recognised boards may be flashed remotely; "manual": the user must
    # switch on "Allow remote flashing" per device.
    trust_policy: str = "auto"
    device_allow: dict = field(default_factory=dict)  # device_id -> bool override
    theme: str = "auto"  # "light" | "dark" | "auto" (follow Windows)
    simulate: bool = False
    # How many of the most recently flashed firmware versions are kept on this PC (0 = keep nothing).
    keep_firmware: int = 5


class SettingsStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (data_dir() / "settings.json")
        self._lock = threading.Lock()
        self.settings = self._load()

    def _load(self) -> Settings:
        s = Settings()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            for k, v in raw.items():
                if hasattr(s, k):
                    setattr(s, k, v)
        except (OSError, ValueError):
            pass
        if not s.device_name:
            import socket

            s.device_name = socket.gethostname()[:40] or "Windows PC"
        env_server = os.environ.get("MCUBRIDGE_SERVER")
        if env_server:
            s.server_url = env_server
        if os.environ.get("MCUBRIDGE_SIMULATE") == "1":
            s.simulate = True
        s.server_url = s.server_url.rstrip("/")
        return s

    def save(self) -> None:
        with self._lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(asdict(self.settings), indent=2), encoding="utf-8")
            os.replace(tmp, self.path)
