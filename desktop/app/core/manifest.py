"""Strict firmware-manifest validation (mirror of cloud/src/jobs/manifest.ts).

Both implementations are tested against shared/test-vectors/manifests.json.
Nothing is guessed: ESP flash mode/frequency/size must be spelled out.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .boards import BOARDS, FAMILIES, LIMITS, is_esp, parse_size

JOB_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
FILENAME = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{1,8}$")
SIZE = re.compile(r"^\d+(KB|MB)$")
FREQ = re.compile(r"^\d+m$")
FAMILY_NAMES = set(FAMILIES)


@dataclass(frozen=True)
class FileSpec:
    address: int
    filename: str
    size: int
    sha256: str
    format: str


@dataclass(frozen=True)
class Manifest:
    job_id: str
    family: str
    board: str
    flash_size: str | None
    mode: str | None
    frequency: str | None
    baud_rate: int | None
    files: tuple[FileSpec, ...]


class ManifestError(Exception):
    def __init__(self, issues: list[dict[str, str]]) -> None:
        super().__init__("; ".join(f"{i['path']}: {i['message']}" for i in issues))
        self.issues = issues


def _unknown(d: dict, allowed: set[str], path: str, add) -> None:
    for k in d:
        if k not in allowed:
            add(f"{path}.{k}" if path else k, "SCHEMA", "unknown key")


def check(raw: Any) -> tuple[Manifest | None, list[dict[str, str]]]:
    issues: list[dict[str, str]] = []

    def add(path: str, code: str, message: str) -> None:
        issues.append({"path": path, "code": code, "message": message})

    if not isinstance(raw, dict):
        return None, [{"path": "(root)", "code": "SCHEMA", "message": "manifest must be an object"}]
    _unknown(raw, {"schema_version", "job_id", "target", "flash_config", "files"}, "", add)
    if raw.get("schema_version", 1) != 1:
        add("schema_version", "SCHEMA", "must be 1")
    job_id = raw.get("job_id")
    if not isinstance(job_id, str) or not JOB_ID.match(job_id):
        add("job_id", "SCHEMA", "invalid job_id")

    target = raw.get("target")
    if not isinstance(target, dict):
        add("target", "SCHEMA", "target required")
        target = {}
    _unknown(target, {"family", "board", "flash_size"}, "target", add)
    family, board_id, flash_size = target.get("family"), target.get("board"), target.get("flash_size")
    if family not in FAMILY_NAMES:
        add("target.family", "SCHEMA", "unknown family")
    if not isinstance(board_id, str) or not board_id:
        add("target.board", "SCHEMA", "board required")
    if flash_size is not None and (not isinstance(flash_size, str) or not SIZE.match(flash_size)):
        add("target.flash_size", "SCHEMA", "invalid flash_size")
        flash_size = None

    cfg = raw.get("flash_config") or {}
    if not isinstance(cfg, dict):
        add("flash_config", "SCHEMA", "must be an object")
        cfg = {}
    _unknown(cfg, {"mode", "frequency", "baud_rate"}, "flash_config", add)
    mode, freq, baud = cfg.get("mode"), cfg.get("frequency"), cfg.get("baud_rate")
    if mode is not None and mode not in ("qio", "qout", "dio", "dout"):
        add("flash_config.mode", "SCHEMA", "invalid mode")
    if freq is not None and (not isinstance(freq, str) or not FREQ.match(freq)):
        add("flash_config.frequency", "SCHEMA", "invalid frequency")
    if baud is not None and (isinstance(baud, bool) or not isinstance(baud, int)):
        add("flash_config.baud_rate", "SCHEMA", "invalid baud_rate")
        baud = None

    files_raw = raw.get("files")
    if not isinstance(files_raw, list) or not 1 <= len(files_raw) <= LIMITS["max_files"]:
        add("files", "SCHEMA", f"files must be a list of 1..{LIMITS['max_files']} entries")
        files_raw = []
    parsed: list[FileSpec] = []
    for i, f in enumerate(files_raw):
        p = f"files[{i}]"
        if not isinstance(f, dict):
            add(p, "SCHEMA", "must be an object")
            continue
        _unknown(f, {"address", "filename", "size", "sha256", "format"}, p, add)
        ok = True
        if not isinstance(f.get("address"), str) or not ADDRESS.match(f["address"]):
            add(f"{p}.address", "SCHEMA", "address must look like 0x1000"); ok = False
        if not isinstance(f.get("filename"), str) or not FILENAME.match(f["filename"]):
            add(f"{p}.filename", "SCHEMA", "invalid filename"); ok = False
        sz = f.get("size")
        if isinstance(sz, bool) or not isinstance(sz, int) or sz <= 0:
            add(f"{p}.size", "SCHEMA", "size must be a positive integer"); ok = False
        if not isinstance(f.get("sha256"), str) or not SHA256.match(f["sha256"]):
            add(f"{p}.sha256", "SCHEMA", "sha256 must be 64 hex chars"); ok = False
        fmt = f.get("format")
        if fmt is not None and fmt not in ("bin", "ihex"):
            add(f"{p}.format", "SCHEMA", "format must be bin or ihex"); ok = False
        if ok:
            fmt = fmt or ("ihex" if f["filename"].lower().endswith(".hex") else "bin")
            parsed.append(FileSpec(int(f["address"], 16), f["filename"], sz, f["sha256"].lower(), fmt))
    if any(i["code"] == "SCHEMA" for i in issues):
        return None, issues

    fam = FAMILIES[family]
    board = BOARDS.get(board_id)
    if board is None:
        add("target.board", "UNKNOWN_BOARD", f"unknown board {board_id!r}")
    elif board["family"] != family:
        add("target.family", "FAMILY_BOARD_MISMATCH", f"board {board_id} is family {board['family']}")

    esp = is_esp(family)
    flash_bytes = None
    flash_base = 0
    if esp:
        if not flash_size:
            add("target.flash_size", "REQUIRED", "flash_size is required for ESP targets")
        elif flash_size not in fam["flash_sizes"]:
            add("target.flash_size", "BAD_FLASH_SIZE", "flash_size not allowed for family")
        else:
            flash_bytes = parse_size(flash_size)
            if board and board.get("max_flash") and flash_bytes > parse_size(board["max_flash"]):
                add("target.flash_size", "FLASH_SIZE_EXCEEDS_BOARD", "flash_size exceeds board flash")
        if not mode:
            add("flash_config.mode", "REQUIRED", "mode is required for ESP targets")
        elif mode not in fam["flash_modes"]:
            add("flash_config.mode", "BAD_FLASH_MODE", "mode not allowed")
        if not freq:
            add("flash_config.frequency", "REQUIRED", "frequency is required for ESP targets")
        elif freq not in fam["flash_freqs"]:
            add("flash_config.frequency", "BAD_FLASH_FREQ", "frequency not allowed for family")
    else:
        if flash_size:
            add("target.flash_size", "NOT_ALLOWED", "flash_size only valid for ESP")
        if mode or freq:
            add("flash_config", "NOT_ALLOWED", "mode/frequency only valid for ESP")
        if family == "avr":
            flash_bytes = board.get("flash_bytes") if board else None
        else:
            flash_base = int(fam.get("flash_base", "0x0"), 16)
            flash_bytes = (board or {}).get("flash_bytes") or fam.get("flash_bytes")

    if baud is not None and baud not in fam["baud_rates"]:
        add("flash_config.baud_rate", "BAD_BAUD", "baud_rate not allowed")

    names: set[str] = set()
    total = 0
    for i, f in enumerate(parsed):
        p = f"files[{i}]"
        if f.filename in names:
            add(f"{p}.filename", "DUPLICATE_FILENAME", "duplicate filename")
        names.add(f.filename)
        if f.size > LIMITS["max_file_bytes"]:
            add(f"{p}.size", "FILE_TOO_LARGE", "file too large")
        if f.format not in fam["formats"]:
            add(f"{p}.format", "BAD_FORMAT", f"format {f.format} not accepted for {family}")
        if f.address % fam["address_align"]:
            add(f"{p}.address", "ADDRESS_ALIGNMENT", f"address must be a multiple of {fam['address_align']}")
        total += f.size
    if total > LIMITS["max_total_bytes"]:
        add("files", "PACKAGE_TOO_LARGE", "package too large")

    if flash_bytes is not None and not issues:
        if family == "avr":
            if len(parsed) != 1:
                add("files", "AVR_SINGLE_FILE", "AVR takes exactly one file")
            else:
                f = parsed[0]
                if f.address != 0:
                    add("files[0].address", "ADDRESS_OUT_OF_RANGE", "AVR images must use address 0x0")
                if f.format == "bin" and f.size > flash_bytes:
                    add("files[0].size", "IMAGE_TOO_LARGE", "image exceeds usable flash")
                if f.format == "ihex" and f.size > flash_bytes * 4:
                    add("files[0].size", "IMAGE_TOO_LARGE", "hex file implausibly large")
        else:
            order = sorted(range(len(parsed)), key=lambda k: parsed[k].address)
            for pos, i in enumerate(order):
                f = parsed[i]
                if family == "stm32" and f.format == "ihex":
                    if f.address != flash_base:
                        add(f"files[{i}].address", "ADDRESS_OUT_OF_RANGE", "ihex must declare flash base")
                    continue
                if f.address < flash_base or f.address + f.size > flash_base + flash_bytes:
                    add(f"files[{i}].address", "ADDRESS_OUT_OF_RANGE", "region outside flash")
                if pos + 1 < len(order):
                    nxt = parsed[order[pos + 1]]
                    if f.address + f.size > nxt.address:
                        add(f"files[{i}]", "REGIONS_OVERLAP", f"{f.filename} overlaps {nxt.filename}")
    if issues:
        return None, issues
    if baud is None:
        baud = (board or {}).get("default_baud") or fam["default_baud"] or None
    return Manifest(job_id, family, board_id, flash_size, mode, freq, baud, tuple(parsed)), []


def validate(raw: Any) -> Manifest:
    m, issues = check(raw)
    if m is None:
        raise ManifestError(issues)
    return m
