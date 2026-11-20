"""Secure credential storage.

Windows: the device token is encrypted with DPAPI (CryptProtectData), bound to
the current Windows user, and stored in a blob file. Other platforms (used only
for development/CI) fall back to a 0600 file and log a warning.
"""
from __future__ import annotations

import base64
import ctypes
import logging
import os
import sys
from ctypes import wintypes
from pathlib import Path

from app.core.config import data_dir

log = logging.getLogger(__name__)
_ENTROPY = b"MCUBridge.v1"


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> tuple[_Blob, ctypes.Array]:
    buf = ctypes.create_string_buffer(data, len(data))
    return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf


def dpapi_protect(data: bytes) -> bytes:
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32  # type: ignore[attr-defined]
    inp, keep1 = _blob(data)
    ent, keep2 = _blob(_ENTROPY)
    out = _Blob()
    if not crypt32.CryptProtectData(ctypes.byref(inp), "MCU Bridge", ctypes.byref(ent), None, None, 0, ctypes.byref(out)):
        raise OSError("CryptProtectData failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)
        del keep1, keep2


def dpapi_unprotect(data: bytes) -> bytes:
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32  # type: ignore[attr-defined]
    inp, keep1 = _blob(data)
    ent, keep2 = _blob(_ENTROPY)
    out = _Blob()
    if not crypt32.CryptUnprotectData(ctypes.byref(inp), None, ctypes.byref(ent), None, None, 0, ctypes.byref(out)):
        raise OSError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)
        del keep1, keep2


class CredentialStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (data_dir() / "credentials.bin")

    def save(self, token: str) -> None:
        raw = token.encode()
        if sys.platform == "win32":
            blob = b"DPAPI1" + dpapi_protect(raw)
        else:
            log.warning("DPAPI unavailable on this OS; storing token in a 0600 file (development only)")
            blob = b"PLAIN1" + base64.b64encode(raw)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(blob)
        os.replace(tmp, self.path)

    def load(self) -> str | None:
        try:
            blob = self.path.read_bytes()
        except OSError:
            return None
        try:
            if blob.startswith(b"DPAPI1") and sys.platform == "win32":
                return dpapi_unprotect(blob[6:]).decode()
            if blob.startswith(b"PLAIN1"):
                return base64.b64decode(blob[6:]).decode()
        except (OSError, ValueError):
            log.error("stored credential is unreadable; re-pairing required")
        return None

    def clear(self) -> None:
        try:
            self.path.unlink()
        except OSError:
            pass
