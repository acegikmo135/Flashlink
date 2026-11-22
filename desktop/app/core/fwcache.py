"""The last few firmware versions that were flashed from this PC, kept on disk (default: 5).

Files are stored by SHA-256 under <data>/firmware/blobs, and index.json lists the newest bundles (one per flashed app
image). A later job whose files are already here skips the download entirely — each file is re-hashed before use, so
a damaged or tampered blob is never flashed. Set keep=0 to turn the store off.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import threading
import time
from pathlib import Path

from app.core.config import data_dir

log = logging.getLogger("mcubridge.fwcache")
DEFAULT_KEEP = 5


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class FirmwareStore:
    def __init__(self, root: Path | None = None, keep: int = DEFAULT_KEEP) -> None:
        self.root = root or (data_dir() / "firmware")
        self.keep = max(0, int(keep))
        self._lock = threading.Lock()

    @property
    def _blobs(self) -> Path:
        return self.root / "blobs"

    @property
    def _index(self) -> Path:
        return self.root / "index.json"

    def _load(self) -> list[dict]:
        try:
            data = json.loads(self._index.read_text(encoding="utf-8"))
            return [b for b in data if isinstance(b, dict) and isinstance(b.get("files"), list)]
        except (OSError, ValueError):
            return []

    def _write(self, bundles: list[dict]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self._index.with_suffix(".tmp")
        tmp.write_text(json.dumps(bundles, indent=2), encoding="utf-8")
        tmp.replace(self._index)

    def list(self) -> list[dict]:
        """Newest first."""
        with self._lock:
            return self._load()

    def find(self, sha256: str, size: int) -> Path | None:
        """A stored copy of this exact file (size + SHA-256 re-verified), or None."""
        if self.keep <= 0 or len(sha256) != 64:
            return None
        p = self._blobs / sha256
        with self._lock:
            try:
                if p.is_file() and p.stat().st_size == size and _sha256(p) == sha256:
                    return p
            except OSError:
                pass
            return None

    def save(self, manifest, paths: dict[str, Path], job_id: str = "") -> None:
        """Remember a successfully flashed bundle and prune to the newest `keep`. Never raises."""
        if self.keep <= 0:
            return
        try:
            with self._lock:
                self._blobs.mkdir(parents=True, exist_ok=True)
                files = []
                for f in manifest.files:
                    dst = self._blobs / f.sha256
                    if not dst.is_file():
                        tmp = dst.with_suffix(".part")
                        shutil.copyfile(paths[f.filename], tmp)
                        if _sha256(tmp) != f.sha256:
                            tmp.unlink(missing_ok=True)
                            return
                        tmp.replace(dst)
                    files.append({"filename": f.filename, "address": f"0x{f.address:x}", "size": f.size, "sha256": f.sha256})
                app = files[-1]["sha256"]  # the application image is always last in the manifest
                bundles = [b for b in self._load() if b.get("app_sha256") != app]
                bundles.insert(0, {"app_sha256": app, "board": manifest.board, "family": manifest.family, "job_id": job_id, "saved_at": int(time.time()), "files": files})
                dropped = bundles[self.keep:]
                bundles = bundles[: self.keep]
                self._write(bundles)
                still = {f["sha256"] for b in bundles for f in b["files"]}
                for b in dropped:
                    for f in b["files"]:
                        if f["sha256"] not in still:
                            (self._blobs / f["sha256"]).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001 - a cache problem must never fail a flash
            log.exception("could not store firmware copy")

    def clear(self) -> None:
        with self._lock:
            shutil.rmtree(self.root, ignore_errors=True)
