"""Chunked, acknowledged, resumable firmware download with bounded memory.

Wire format (see cloud/src/transfers/framing.ts), per frame:
    seq:u32be | len:u32be | crc32:u32be | flags:u32be | payload[len]

Every chunk is written to a temporary file; the whole file is SHA-256 verified
at the end. Cumulative acknowledgements let the relay free its window.
"""
from __future__ import annotations

import hashlib
import json
import logging
import struct
import threading
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from typing import Callable

from .http import UA, HttpError, post_json

log = logging.getLogger(__name__)
HEADER = struct.Struct(">IIII")
ACK_EVERY = 4
MAX_CHUNK = 1 << 20


class TransferError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()


def _read_exact(resp, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        part = resp.read(n - len(buf))
        if not part:
            raise ConnectionError("stream ended early")
        buf += part
    return bytes(buf)


def download_file(
    url: str, token: str, dest: Path, size: int, sha256: str,
    progress: Callable[[int], None], cancel: threading.Event, deadline: float,
    max_attempts: int = 8,
) -> None:
    """Download one file. Raises TransferError(code, msg). Retries resume from the last acked chunk."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    chunk_bytes = 65536
    next_seq = 0
    acked = -1
    failures = 0
    ack_url = url + "/ack"
    dest.write_bytes(b"")

    def ack(seq: int) -> None:
        nonlocal acked
        for attempt in range(4):
            try:
                post_json(ack_url, {"seq": seq}, token, timeout=15)
                acked = seq
                return
            except HttpError as e:
                raise TransferError("TRANSFER_FAILED", f"relay rejected ack: {e}") from e
            except ConnectionError:
                time.sleep(0.5 * (attempt + 1))
        raise TransferError("TRANSFER_FAILED", "could not acknowledge chunk")

    with open(dest, "r+b") as out:
        while True:
            if cancel.is_set():
                raise TransferError("CANCELLED", "transfer cancelled")
            if time.time() > deadline:
                raise TransferError("TRANSFER_TIMEOUT", "no firmware was uploaded before the job expired")
            req = urllib.request.Request(f"{url}?from={next_seq}", headers={"authorization": f"Bearer {token}", "user-agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    if resp.status == 204:  # relay long-poll: uploader not here yet
                        failures = 0
                        continue
                    chunk_bytes = int(resp.headers.get("x-chunk-bytes", chunk_bytes))
                    total = int(resp.headers.get("x-total-chunks", "0"))
                    if int(resp.headers.get("x-file-size", size)) != size:
                        raise TransferError("TRANSFER_FAILED", "relay file size differs from manifest")
                    while next_seq < total:
                        if cancel.is_set():
                            raise TransferError("CANCELLED", "transfer cancelled")
                        seq, length, crc, flags = HEADER.unpack(_read_exact(resp, HEADER.size))
                        if seq != next_seq or length > MAX_CHUNK:
                            raise TransferError("TRANSFER_FAILED", f"unexpected frame seq={seq} (wanted {next_seq})")
                        payload = _read_exact(resp, length)
                        if zlib.crc32(payload) & 0xFFFFFFFF != crc:
                            raise ConnectionError("chunk CRC mismatch")  # retried
                        out.seek(seq * chunk_bytes)
                        out.write(payload)
                        out.flush()
                        next_seq += 1
                        failures = 0
                        progress(min(size, next_seq * chunk_bytes))
                        if next_seq - 1 - acked >= ACK_EVERY or next_seq == total:
                            ack(next_seq - 1)
            except HttpError as e:
                if cancel.is_set():
                    raise TransferError("CANCELLED", "transfer cancelled") from e
                raise TransferError("TRANSFER_FAILED", f"relay error: {e}") from e
            except urllib.error.HTTPError as e:
                if cancel.is_set():
                    raise TransferError("CANCELLED", "transfer cancelled") from e
                body = e.read().decode("utf-8", "replace")[:200]
                code = "TRANSFER_FAILED"
                if e.code in (401, 403):
                    code = "TRANSFER_FAILED"
                raise TransferError(code, f"relay refused download ({e.code}): {body}") from e
            except (ConnectionError, TimeoutError, OSError, urllib.error.URLError, struct.error) as e:
                if cancel.is_set():
                    raise TransferError("CANCELLED", "transfer cancelled") from e
                failures += 1
                if failures >= max_attempts:
                    raise TransferError("TRANSFER_FAILED", f"download kept failing: {e}") from e
                log.warning("download interrupted (%s); resuming from chunk %d", e, next_seq)
                time.sleep(min(5, 0.5 * failures))
                continue
            break

    actual = out_size = dest.stat().st_size
    if out_size != size:
        raise TransferError("HASH_MISMATCH", f"received {out_size} bytes, expected {size}")
    digest = sha256_file(dest)
    if digest != sha256:
        raise TransferError("HASH_MISMATCH", f"SHA-256 mismatch: got {digest[:16]}…, manifest says {sha256[:16]}…")
    del actual
