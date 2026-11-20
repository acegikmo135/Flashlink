/**
 * A dependency-free helper that AI agents can download and run in their own
 * build environment to produce a correct manifest (sizes + SHA-256) for
 * flash_firmware. It never talks to the network.
 */
export const MANIFEST_HELPER_PY = String.raw`#!/usr/bin/env python3
"""MCU Bridge manifest helper (stdlib only, runs in your build environment).

Examples
  ESP32:  python3 manifest.py --family esp32 --board esp32-wroom-32 --flash-size 4MB \
            --mode dio --freq 40m 0x1000=bootloader.bin 0x8000=partitions.bin 0x10000=app.bin
  AVR:    python3 manifest.py --family avr --board arduino-uno 0x0=firmware.hex

Prints the manifest JSON to stdout; pass it as the 'manifest' argument of the
flash_firmware MCP tool. Addresses must come from your build system - they are
never guessed.
"""
import argparse, hashlib, json, os, secrets, sys


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--family", required=True)
    p.add_argument("--board", required=True)
    p.add_argument("--flash-size")
    p.add_argument("--mode")
    p.add_argument("--freq")
    p.add_argument("--baud", type=int)
    p.add_argument("--job-id")
    p.add_argument("files", nargs="+", help="ADDRESS=path/to/file")
    a = p.parse_args()

    files = []
    for spec in a.files:
        addr, _, path = spec.partition("=")
        if not path or not addr.lower().startswith("0x"):
            sys.exit("file spec must look like 0x1000=path/to/file.bin: " + spec)
        data = open(path, "rb").read()
        entry = {
            "address": addr,
            "filename": os.path.basename(path),
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        if path.lower().endswith(".hex"):
            entry["format"] = "ihex"
        files.append(entry)

    target = {"family": a.family, "board": a.board}
    if a.flash_size:
        target["flash_size"] = a.flash_size
    cfg = {}
    if a.mode:
        cfg["mode"] = a.mode
    if a.freq:
        cfg["frequency"] = a.freq
    if a.baud:
        cfg["baud_rate"] = a.baud
    manifest = {"schema_version": 1, "job_id": a.job_id or "job_" + secrets.token_hex(6), "target": target, "files": files}
    if cfg:
        manifest["flash_config"] = cfg
    print(json.dumps(manifest, indent=2))


main()
`;
