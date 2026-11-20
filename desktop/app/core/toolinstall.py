"""Download and install flashing tools from pinned, hash-verified official releases.

Security model: URL + SHA-256 are pinned in tools_manifest.json (shipped with the app). The archive is streamed
to a temp file with a hard size cap, verified, then extracted with zip-slip protection into
<data>/tools/<name>/. Nothing is executed during installation.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import threading
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

from app.core.config import APP_VERSION, data_dir

MAX_ENTRIES = 6000
MAX_UNPACKED = 400 * 1024 * 1024


def _manifest_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", ".")) / "tools_manifest.json"
    return Path(__file__).resolve().parents[2] / "tools_manifest.json"


def load_manifest() -> dict:
    return json.loads(_manifest_path().read_text(encoding="utf-8"))["tools"]


class InstallError(Exception):
    pass


def tools_root() -> Path:
    p = data_dir() / "tools"
    p.mkdir(parents=True, exist_ok=True)
    return p


def installed_dir(name: str) -> Path:
    return tools_root() / name


def safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """Extract with zip-slip, entry-count and size protection."""
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES or sum(i.file_size for i in infos) > MAX_UNPACKED:
        raise InstallError("archive is unexpectedly large")
    root = dest.resolve()
    for info in infos:
        target = (dest / info.filename).resolve()
        if root != target and root not in target.parents:
            raise InstallError(f"unsafe path in archive: {info.filename}")
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out, 1 << 16)


def install(spec: dict, name: str, progress: Callable[[float, str], None], cancel: threading.Event | None = None, dest_root: Path | None = None) -> Path:
    """Download + verify + extract. `progress(percent, message)`. Returns the install directory."""
    if not spec.get("url") or not spec.get("sha256"):
        raise InstallError("this tool has no pinned direct download")
    root = dest_root or tools_root()
    dest = root / name
    tmp_dir = root / ".download"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    archive = tmp_dir / f"{name}.zip"
    cap = int(spec.get("size", 0)) * 2 + (1 << 20) if spec.get("size") else 200 * 1024 * 1024
    h = hashlib.sha256()
    try:
        req = urllib.request.Request(spec["url"], headers={"user-agent": f"MCUBridge/{APP_VERSION}"})
        progress(0, f"Downloading {spec.get('label', name)} {spec.get('version', '')}".strip())
        with urllib.request.urlopen(req, timeout=30) as resp, open(archive, "wb") as out:
            total = int(resp.headers.get("content-length") or spec.get("size") or 0)
            got = 0
            while True:
                if cancel is not None and cancel.is_set():
                    raise InstallError("cancelled")
                block = resp.read(1 << 16)
                if not block:
                    break
                got += len(block)
                if got > cap:
                    raise InstallError("download is larger than expected; aborted")
                h.update(block)
                out.write(block)
                if total:
                    progress(min(90.0, 90.0 * got / total), f"Downloading… {got // 1024} KB")
        if h.hexdigest() != spec["sha256"].lower():
            raise InstallError("SHA-256 mismatch: the download does not match the pinned release. Nothing was installed.")
        progress(92, "Verified. Extracting…")
        staging = root / f".staging-{name}"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        with zipfile.ZipFile(archive) as zf:
            safe_extract(zf, staging)
        shutil.rmtree(dest, ignore_errors=True)
        staging.rename(dest)
        (dest / ".installed.json").write_text(json.dumps({"name": name, "version": spec.get("version"), "sha256": spec["sha256"]}), encoding="utf-8")
        progress(100, "Installed")
        return dest
    except zipfile.BadZipFile as e:
        raise InstallError("downloaded file is not a valid zip") from e
    except OSError as e:
        raise InstallError(f"network or disk error: {e}") from e
    finally:
        archive.unlink(missing_ok=True)
        shutil.rmtree(root / f".staging-{name}", ignore_errors=True)


def uninstall(name: str) -> None:
    shutil.rmtree(installed_dir(name), ignore_errors=True)
