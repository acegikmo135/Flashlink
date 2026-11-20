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


def _selftest_body() -> int:
    """Start the real UI offscreen, visit every page, and report timings as JSON (used by CI on the installed exe)."""
    import json
    import os
    import time
    import tempfile

    t0 = time.perf_counter()
    stage_log = (os.environ.get("MCUB_SELFTEST_OUT") or "") + ".stages"

    def stage(msg: str) -> None:  # breadcrumbs so CI can show where a hang happened
        if stage_log != ".stages":
            with open(stage_log, "a", encoding="utf-8") as f:
                f.write(f"{round((time.perf_counter() - t0) * 1000):>6} ms  {msg}\n")

    stage("start")
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    home = tempfile.mkdtemp(prefix="mcub-selftest-")
    os.environ["MCUBRIDGE_HOME"] = home
    os.environ["MCUBRIDGE_SIMULATE"] = "1"
    os.environ.setdefault("MCUBRIDGE_SERVER", "http://127.0.0.1:9")
    from PySide6.QtWidgets import QApplication

    stage("pyside imported")
    from app.ui import theme
    from app.ui.app import MainWindow

    stage("app.ui imported")
    store, hw, agent = build_core()
    stage("core built")
    t_import = time.perf_counter()
    app = QApplication([])
    stage("QApplication created")
    theme.apply("dark", app)
    agent.hw.scan()
    stage("devices scanned")
    win = MainWindow(agent, hw)
    stage("window built")
    win.show()
    app.processEvents()
    stage("window shown")
    t_window = time.perf_counter()
    agent.state.connection = "connected"
    agent.state.devices = [{**d.to_wire(), "label": d.label} for d in hw.scan()]
    pages = []
    for i, name in enumerate(win.SECTIONS):
        ts = time.perf_counter()
        win.go(i)
        app.processEvents()
        pages.append((name, round((time.perf_counter() - ts) * 1000)))
        stage(f"page {name} ok")
    shots = os.environ.get("MCUB_SELFTEST_SHOTS")
    if shots:
        os.makedirs(shots, exist_ok=True)
        for i, name in enumerate(win.SECTIONS):
            win.go(i)
            app.processEvents()
            win.grab().save(os.path.join(shots, f"{i}-{name.lower()}.png"))
    from app.hardware import tools
    from app.core import toolinstall

    result = {
        "ok": True,
        "import_ms": round((t_import - t0) * 1000),
        "window_ms": round((t_window - t_import) * 1000),
        "total_to_window_ms": round((t_window - t0) * 1000),
        "pages_ms": dict(pages),
        "tools": {n: t.available for n, t in tools.all_tools().items()},
        "tools_manifest": sorted(toolinstall.load_manifest()),
        "python": sys.version.split()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
    }
    out = os.environ.get("MCUB_SELFTEST_OUT")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f)
    print(json.dumps(result), flush=True)
    return 0


def selftest() -> int:
    """Run the self-test; on any failure write the traceback next to the result file and exit 1 (never block on a dialog)."""
    import os
    import traceback

    try:
        return _selftest_body()
    except BaseException:
        tb = traceback.format_exc()
        out = os.environ.get("MCUB_SELFTEST_OUT")
        if out:
            try:
                with open(out + ".error", "w", encoding="utf-8") as f:
                    f.write(tb)
            except OSError:
                pass
        print(tb, flush=True)
        return 1


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "--tool":
        return _run_bundled_tool(argv[1:])
    if argv and argv[0] == "--selftest":
        return selftest()
    if argv and argv[0] == "--version":
        from app.core.config import APP_VERSION

        print(APP_VERSION)
        return 0
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
