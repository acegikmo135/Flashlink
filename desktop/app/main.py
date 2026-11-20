"""MCU Bridge entry point.

  mcubridge.exe                  start the tray application (GUI)
  mcubridge.exe --headless       run the agent without UI (logs to stdout)
  mcubridge.exe --simulate       virtual boards (development / CI only)
  mcubridge.exe --tool esptool … internal: run the bundled esptool (frozen builds)
"""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import sys
import time


def _run_bundled_tool(argv: list[str]) -> int:
    if argv and argv[0] == "esptool":
        import esptool

        esptool.main(argv[1:])
        return 0
    print("unknown tool", file=sys.stderr)
    return 2


def _setup_logging(verbose: bool, console: bool) -> None:
    from app.core.config import log_dir

    root = logging.getLogger()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    fh = logging.handlers.RotatingFileHandler(log_dir() / "mcubridge.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(fh)
    if console:
        sh = logging.StreamHandler()
        sh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S"))
        root.addHandler(sh)


def build_core():
    from app.core.agent import Agent
    from app.core.config import SettingsStore
    from app.hardware.devices import HardwareManager
    from app.security.credstore import CredentialStore

    store = SettingsStore()
    hw = HardwareManager(store)
    agent = Agent(store, CredentialStore(), hw)
    return store, hw, agent


def run_headless(agent) -> int:
    import asyncio

    last = [""]

    def on_change() -> None:
        s = agent.state
        line = f"state={s.connection} devices={len(s.devices)} " + (f"pairing={s.pairing['url']} code={s.pairing['code']}" if s.pairing else "")
        if line != last[0]:
            last[0] = line
            print(line, flush=True)

    agent.on_change = on_change
    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        pass
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "--tool":
        return _run_bundled_tool(argv[1:])
    ap = argparse.ArgumentParser(prog="mcubridge")
    ap.add_argument("--headless", action="store_true", help="run without UI")
    ap.add_argument("--simulate", action="store_true", help="virtual boards (development/CI only)")
    ap.add_argument("--server", help="override server URL")
    ap.add_argument("--minimized", action="store_true", help="start hidden in the tray")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    import os

    if args.simulate:
        os.environ["MCUBRIDGE_SIMULATE"] = "1"
    if args.server:
        os.environ["MCUBRIDGE_SERVER"] = args.server
    _setup_logging(args.verbose, args.headless)
    store, hw, agent = build_core()
    if args.headless:
        return run_headless(agent)
    from app.ui.app import run_gui

    return run_gui(store, hw, agent, start_hidden=args.minimized or store.settings.start_minimized)


if __name__ == "__main__":
    raise SystemExit(main())
