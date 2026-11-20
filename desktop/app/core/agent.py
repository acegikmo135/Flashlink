"""The MCU Bridge agent: pairing, persistent WebSocket, device sync, job + command execution.

All business logic lives here and is UI-independent; the Qt window and the
headless runner both drive this class.
"""
from __future__ import annotations

import asyncio
import json
import logging
import platform
import random
import re
import shutil
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus

from app.core import images
from app.core.boards import FAMILIES
from app.core.config import APP_VERSION, SettingsStore, data_dir, tmp_dir
from app.core.manifest import FILENAME, Manifest, ManifestError, validate
from app.hardware import serialio, tools
from app.hardware.devices import HardwareManager
from app.hardware.flashers import DeviceRef, FlashError, FlashRequest, flasher_for
from app.hardware.simulated import sim_read
from app.networking.http import HttpError, post_json
from app.networking.transfer import TransferError, download_file
from app.security.credstore import CredentialStore

log = logging.getLogger("mcubridge.agent")


@dataclass
class JobView:
    job_id: str
    kind: str
    firmware: str
    target: str
    device_id: str
    port: str | None
    status: str = "awaiting_upload"
    phase: str = "queued"
    transfer_pct: float = 0
    flash_pct: float = 0
    verify_pct: float = 0
    message: str = ""
    verified: bool | None = None
    error_code: str | None = None
    error_message: str | None = None
    error_details: Any = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    log: deque = field(default_factory=lambda: deque(maxlen=200))

    @property
    def finished(self) -> bool:
        return self.finished_at is not None

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k != "log"}
        d["log"] = list(self.log)[-40:]
        return d


@dataclass
class AgentState:
    connection: str = "starting"  # starting|unpaired|pairing|connecting|connected|offline|revoked
    detail: str = ""
    account_email: str = ""
    pairing: dict | None = None
    devices: list[dict] = field(default_factory=list)  # wire dicts (+ "label", "sim")
    jobs: list[JobView] = field(default_factory=list)
    toolchains: dict = field(default_factory=dict)
    last_activity: float | None = None
    version: int = 0


class Agent:
    def __init__(self, store: SettingsStore, creds: CredentialStore, hw: HardwareManager, on_change=None) -> None:
        self.store, self.creds, self.hw = store, creds, hw
        self.state = AgentState()
        self.on_change = on_change or (lambda: None)
        self.loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue | None = None
        self._stop = asyncio.Event() if False else None
        self._stopping = False
        self._unsent: dict[str, dict] = {}
        self._cancels: dict[str, threading.Event] = {}
        self._active: set[str] = set()
        self._seen_jobs: set[str] = set()
        self._last_devices_json = ""
        self._last_tools_json = ""
        self._lock = threading.RLock()
        self._ws_ref: Any = None
        self._wake: asyncio.Event | None = None
        self._history_path = data_dir() / "history.json"
        self._load_history()

    # --------------------------------------------------------------- plumbing

    def _notify(self) -> None:
        self.state.version += 1
        try:
            self.on_change()
        except Exception:  # UI errors must never kill the agent
            log.exception("on_change failed")

    def _set(self, connection: str | None = None, detail: str | None = None) -> None:
        if connection is not None:
            self.state.connection = connection
        if detail is not None:
            self.state.detail = detail
        self._notify()

    def _load_history(self) -> None:
        try:
            for d in json.loads(self._history_path.read_text())[-50:]:
                jv = JobView(d["job_id"], d["kind"], d["firmware"], d["target"], d["device_id"], d.get("port"))
                for k, v in d.items():
                    if k != "log" and hasattr(jv, k):
                        setattr(jv, k, v)
                jv.log.extend(d.get("log", []))
                self.state.jobs.append(jv)
        except (OSError, ValueError, KeyError):
            pass

    def _save_history(self) -> None:
        try:
            self._history_path.write_text(json.dumps([j.to_dict() for j in self.state.jobs[-50:]]))
        except OSError:
            pass

    @property
    def ws_url(self) -> str:
        u = urlparse(self.store.settings.server_url)
        return f"{'wss' if u.scheme == 'https' else 'ws'}://{u.netloc}/api/agent/ws"

    def post(self, msg: dict) -> None:
        """Thread-safe: queue a message for the cloud."""
        if msg.get("type") == "job.result":
            self._unsent[msg["job_id"]] = msg
        loop, q = self.loop, self._queue
        if loop and q is not None:
            loop.call_soon_threadsafe(q.put_nowait, msg)

    def stop(self) -> None:
        self._stopping = True
        if self.loop:
            self.loop.call_soon_threadsafe(lambda: self._wake and self._wake.set())
            for t in asyncio.all_tasks(self.loop):
                self.loop.call_soon_threadsafe(t.cancel)

    # ------------------------------------------------------------------- main

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        scan_task = asyncio.create_task(self._scan_loop())
        backoff = self.store.settings.reconnect_min_seconds
        try:
            while not self._stopping:
                token = self.creds.load()
                if not token:
                    await self._pair()
                    continue
                self.state.account_email = self.store.settings.account_email
                try:
                    self._set("connecting", "Connecting…")
                    await self._session(token)
                    backoff = self.store.settings.reconnect_min_seconds
                except _Revoked:
                    log.warning("credential rejected by server — re-pairing required")
                    self.creds.clear()
                    self.store.settings.agent_id = ""
                    self.store.save()
                    self._set("revoked", "This device was revoked or the credential is no longer valid.")
                    await asyncio.sleep(2)
                    continue
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # network errors etc.
                    log.warning("connection lost: %s", e)
                s = self.store.settings
                delay = min(backoff, s.reconnect_max_seconds) * random.uniform(0.8, 1.2)
                self._set("offline", f"Reconnecting in {delay:.0f}s")
                backoff = min(backoff * 2, s.reconnect_max_seconds)
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            pass
        finally:
            scan_task.cancel()

    # ---------------------------------------------------------------- pairing

    async def _pair(self) -> None:
        s = self.store.settings
        self._set("unpaired", "")
        try:
            r = await asyncio.to_thread(post_json, s.server_url + "/api/pair/start", {"install_id": s.install_id, "device_name": s.device_name, "platform": f"{platform.system()} {platform.release()}"})
        except (ConnectionError, HttpError) as e:
            self._set("offline", f"Cannot reach server: {e}")
            await asyncio.sleep(5)
            return
        self.state.pairing = {"code": r["user_code"], "url": r["verification_url"], "expires_at": r["expires_at"] / 1000}
        self._set("pairing", "Waiting for approval in the browser")
        while not self._stopping and time.time() < r["expires_at"] / 1000:
            await asyncio.sleep(r.get("poll_interval_seconds", 2))
            try:
                p = await asyncio.to_thread(post_json, s.server_url + "/api/pair/poll", {"pairing_id": r["pairing_id"], "poll_secret": r["poll_secret"]})
            except (ConnectionError, HttpError) as e:
                log.warning("pair poll: %s", e)
                continue
            if p.get("status") == "approved":
                self.creds.save(p["agent_token"])
                s.agent_id = p["agent_id"]
                s.account_email = p.get("account_email") or ""
                self.store.save()
                self.state.pairing = None
                self.state.account_email = s.account_email
                log.info("paired as %s", s.account_email)
                return
            if p.get("status") in ("denied", "expired"):
                break
        self.state.pairing = None

    # ------------------------------------------------------------ connection

    async def _session(self, token: str) -> None:
        try:
            ws = await websockets.connect(self.ws_url, additional_headers={"Authorization": f"Bearer {token}"}, ping_interval=None, max_size=1 << 20, open_timeout=20, user_agent_header=f"MCUBridge/{APP_VERSION}")
        except InvalidStatus as e:
            if e.response.status_code == 401:
                raise _Revoked() from e
            raise
        self._queue = asyncio.Queue()
        self._ws_ref = ws
        last_pong = time.monotonic()
        try:
            self.state.toolchains = {n: {"available": t.available, "version": t.version, "path": t.path, "hint": t.hint} for n, t in tools.all_tools(True).items()}
            self._last_tools_json = json.dumps(self._tool_snapshot(False), sort_keys=True)
            await ws.send(json.dumps({
                "type": "hello", "agent_version": APP_VERSION, "protocol": 1, "hostname": self.store.settings.device_name,
                "os": f"{platform.system()} {platform.release()}",
                "toolchains": {n: {"available": t["available"], "version": t["version"]} for n, t in self.state.toolchains.items()},
                "active_jobs": sorted(self._active | set(self._unsent)),
            }))
            self._last_devices_json = ""  # force a device sync
            await self._send_devices(ws)
            for msg in list(self._unsent.values()):
                await ws.send(json.dumps(msg))
            self._set("connected", "")
            log.info("connected to %s", self.ws_url)

            async def pinger() -> None:
                while True:
                    await asyncio.sleep(25)
                    await ws.send("ping")
                    if time.monotonic() - last_pong > 80:
                        await ws.close(4003, "pong timeout")
                        return

            async def sender() -> None:
                assert self._queue is not None
                while True:
                    msg = await self._queue.get()
                    await ws.send(json.dumps(msg))
                    if msg.get("type") == "job.result":
                        self._unsent.pop(msg["job_id"], None)

            async def devices_sync() -> None:
                while True:
                    await asyncio.sleep(1.0)
                    await self._send_devices(ws)

            async def toolchain_sync() -> None:
                while True:  # tools can appear/disappear while running (Download button, manual install)
                    await asyncio.sleep(30)
                    snap = await asyncio.to_thread(self._tool_snapshot, True)
                    js = json.dumps(snap, sort_keys=True)
                    if js != self._last_tools_json:
                        self._last_tools_json = js
                        await ws.send(json.dumps({"type": "toolchains", "toolchains": snap}))

            tasks = [asyncio.create_task(c()) for c in (pinger, sender, devices_sync, toolchain_sync)]
            try:
                async for raw in ws:
                    if raw == "pong":
                        last_pong = time.monotonic()
                        continue
                    last_pong = time.monotonic()
                    try:
                        msg = json.loads(raw)
                    except ValueError:
                        continue
                    self._dispatch(msg)
            finally:
                for t in tasks:
                    t.cancel()
            code = ws.close_code
            if code == 4001:
                raise _Revoked()
        except ConnectionClosed as e:
            if e.rcvd and e.rcvd.code == 4001:
                raise _Revoked() from e
            raise
        finally:
            self._queue = None
            self._ws_ref = None
            try:
                await ws.close()
            except Exception:
                pass

    async def _send_devices(self, ws) -> None:
        wire = [dict(d) for d in self.state.devices]
        for d in wire:
            d.pop("label", None)
        js = json.dumps(wire, sort_keys=True)
        if js != self._last_devices_json:
            self._last_devices_json = js
            await ws.send(json.dumps({"type": "devices", "devices": wire}))

    async def _scan_loop(self) -> None:
        while not self._stopping:
            try:
                devs = await asyncio.to_thread(self.hw.scan)
                wire = []
                for d in devs:
                    w = d.to_wire()
                    w["label"] = d.label
                    wire.append(w)
                if wire != self.state.devices:
                    self.state.devices = wire
                    self._notify()
            except Exception:
                log.exception("device scan failed")
            try:
                await asyncio.wait_for(self._wake.wait(), 2.0)  # type: ignore[union-attr]
                self._wake.clear()  # type: ignore[union-attr]
            except asyncio.TimeoutError:
                pass

    @staticmethod
    def _tool_snapshot(refresh: bool) -> dict:
        return {n: {"available": t.available, "version": t.version} for n, t in tools.all_tools(refresh).items()}

    def refresh_toolchains(self) -> None:
        """Thread-safe: re-probe the tools and tell the cloud right away (called after a tool is installed/removed)."""
        snap = self._tool_snapshot(True)
        self.state.toolchains = {n: {**v, "path": None, "hint": ""} for n, v in snap.items()}
        js = json.dumps(snap, sort_keys=True)
        if js != self._last_tools_json:
            self._last_tools_json = js
            self.post({"type": "toolchains", "toolchains": snap})
        self.rescan_now()  # device records carry a per-device "missing tooling" list
        self._notify()

    def rescan_now(self) -> None:
        """Thread-safe: UI / OS device-change notification."""
        if self.loop and self._wake:
            self.hw._prog_at = 0.0
            self.loop.call_soon_threadsafe(self._wake.set)

    # -------------------------------------------------------------- dispatch

    def _dispatch(self, msg: dict) -> None:
        t = msg.get("type")
        if t == "job.new":
            jid = str(msg.get("job_id"))
            if jid in self._seen_jobs or jid in self._active:  # idempotent: replays are ignored
                return
            self._seen_jobs.add(jid)
            self._active.add(jid)
            self._cancels[jid] = threading.Event()
            threading.Thread(target=self._run_job, args=(msg,), name=f"job-{jid}", daemon=True).start()
        elif t == "job.cancel":
            ev = self._cancels.get(str(msg.get("job_id")))
            if ev:
                ev.set()
        elif t == "command":
            threading.Thread(target=self._run_command, args=(msg,), name="command", daemon=True).start()
        elif t == "revoked":
            self.creds.clear()

    # ------------------------------------------------------------------ jobs

    def _run_job(self, msg: dict) -> None:
        jid = msg["job_id"]
        cancel = self._cancels[jid]
        jdir = tmp_dir() / jid
        started = time.time()
        raw = msg.get("manifest") or {}
        tfam = (raw.get("target") or {}).get("family", "?")
        tboard = (raw.get("target") or {}).get("board", "?")
        files_meta = raw.get("files") or []
        view = JobView(jid, msg.get("kind", "flash"), ", ".join(f.get("filename", "?") for f in files_meta)[:80], f"{tboard} ({tfam})", str(msg.get("device_id")), None)
        with self._lock:
            self.state.jobs.append(view)
            self.state.last_activity = time.time()
        self._notify()
        last_post = [0.0]
        file_progress: dict[str, int] = {}

        def update(status: str, phase: str, pct: float, message: str = "", file: str | None = None, force: bool = False) -> None:
            now = time.monotonic()
            view.status, view.phase, view.message = status, phase, message
            if status == "transferring":
                view.transfer_pct = pct
            elif phase == "verifying":
                view.verify_pct = pct
            elif status == "flashing":
                view.flash_pct = pct
            if message:
                view.log.append(message)
            if force or now - last_post[0] > 0.25:
                last_post[0] = now
                self.post({"type": "job.update", "job_id": jid, "status": status, "phase": phase, "percent": pct, "message": message[:300], "file": file, "accepted": True,
                           "files": [{"filename": k, "transferred": v, "verified_sha256": False} for k, v in file_progress.items()]})
                self._notify()

        def finish(status: str, result: dict | None = None, error: FlashError | TransferError | None = None) -> None:
            view.status = status
            view.finished_at = time.time()
            view.verified = (result or {}).get("verified")
            if error is not None:
                view.error_code = getattr(error, "code", "FLASH_FAILED")
                view.error_message = getattr(error, "message", str(error))
                view.error_details = getattr(error, "details", None)
                view.log.append(f"{view.error_code}: {view.error_message}")
            payload: dict = {"type": "job.result", "job_id": jid, "status": status, "result": result or {}}
            if error is not None:
                payload["error"] = {"code": view.error_code, "message": view.error_message, "details": view.error_details if isinstance(view.error_details, (str, dict, list)) else None}
            self.post(payload)
            self._notify()

        dev_ref: DeviceRef | None = None
        try:
            update("awaiting_upload", "accepted", 0, "Job accepted", force=True)
            manifest = self._check_job(msg)
            dev = self.hw.get(str(msg["device_id"]))
            assert dev is not None
            dev_ref = dev.ref()
            view.port = dev.port
            self.hw.busy[dev.id] = jid
            jdir.mkdir(parents=True, exist_ok=True)
            deadline = float(msg.get("expires_at", 0)) / 1000

            # ---- transfer
            total = sum(f.size for f in manifest.files)
            done_before = 0
            paths: dict[str, Path] = {}
            file_urls = {f["filename"]: f["url"] for f in msg["files"]}
            for f in manifest.files:
                p = (jdir / f.filename).resolve()
                if p.parent != jdir.resolve():
                    raise FlashError("MANIFEST_INVALID", "unsafe filename")
                file_progress[f.filename] = 0

                def prog(n: int, f=f, base=done_before) -> None:
                    file_progress[f.filename] = n
                    update("transferring", "transferring", 100 * (base + n) / total, f"Receiving {f.filename}: {n}/{f.size} bytes", f.filename)

                update("transferring", "transferring", 100 * done_before / total, f"Waiting for {f.filename}", f.filename, force=True)
                download_file(file_urls[f.filename], msg["download_token"], p, f.size, f.sha256, prog, cancel, deadline)
                done_before += f.size
                paths[f.filename] = p
                update("transferring", "transferring", 100 * done_before / total, f"{f.filename}: SHA-256 verified", f.filename, force=True)
            view.transfer_pct = 100
            warnings = images.check_files(manifest, paths)
            for w in warnings:
                view.log.append("warning: " + w)

            if cancel.is_set():
                raise FlashError("CANCELLED", "Cancelled before flashing started.")
            # ---- flash / verify
            flasher = flasher_for(manifest.family, dev_ref)

            def fprog(phase: str, pct: float, message: str, file: str | None) -> None:
                status = "verifying" if phase == "verifying" else "flashing"
                update(status, phase, pct, message, file)

            req = FlashRequest(manifest, dev_ref, paths, bool(msg.get("options", {}).get("verify", True)), msg.get("kind", "flash"), fprog, cancel, lambda line: view.log.append(line[:200]))
            update("flashing", "flashing", 0, "Starting programmer", force=True)
            outcome = flasher.run(req)
            result = {
                "confirmed_by_agent": True, "verified": outcome.verified, "duration_ms": int((time.time() - started) * 1000),
                "files": [{"filename": f.filename, "address": f"0x{f.address:x}", "bytes": f.size, "sha256": f.sha256} for f in manifest.files],
                **outcome.details, "warnings": warnings,
            }
            # ---- boot log
            bl = int(msg.get("options", {}).get("boot_log_seconds", 0) or 0)
            if msg.get("kind") == "flash" and bl > 0:
                update("flashing", "boot_log", 100, "Capturing boot log", force=True)
                result["boot_log"] = self._boot_capture(dev_ref, manifest.family, float(bl))
            view.verified = outcome.verified
            update("verifying" if outcome.verified else "flashing", "done", 100, "Completed", force=True)
            finish("completed", result)
        except ManifestError as e:
            finish("failed", None, FlashError("MANIFEST_INVALID", str(e), e.issues))
        except images.ImageError as e:  # wrong chip / oversized / malformed image: a precise code, never a generic crash
            finish("failed", None, FlashError(e.code, e.message))
        except TransferError as e:
            finish("cancelled" if e.code == "CANCELLED" else "failed", None, e)
        except FlashError as e:
            st = "cancelled" if e.code == "CANCELLED" else "verification_failed" if e.code == "VERIFICATION_FAILED" else "failed"
            finish(st, None, e)
        except Exception as e:  # unexpected: never leave the cloud hanging
            log.exception("job %s crashed", jid)
            finish("failed", None, FlashError("INTERNAL", f"{type(e).__name__}: {e}"))
        finally:
            shutil.rmtree(jdir, ignore_errors=True)  # firmware never outlives the job
            if dev_ref:
                self.hw.busy.pop(dev_ref.id, None)
            self._active.discard(jid)
            self._cancels.pop(jid, None)
            self.state.last_activity = time.time()
            with self._lock:
                self._save_history()
            self._notify()

    def _check_job(self, msg: dict) -> Manifest:
        raw = json.loads(json.dumps(msg.get("manifest") or {}))
        for f in raw.get("files", []):  # cloud sends the normalised form
            if "address_hex" in f:
                f["address"] = f.pop("address_hex")
        manifest = validate(raw)
        files = msg.get("files") or []
        base = self.store.settings.server_url + "/api/transfers/"
        if len(files) != len(manifest.files) or not msg.get("download_token"):
            raise FlashError("MANIFEST_INVALID", "transfer list does not match the manifest")
        for spec, mf in zip(files, manifest.files):
            if spec.get("filename") != mf.filename or spec.get("size") != mf.size or spec.get("sha256") != mf.sha256 or not str(spec.get("url", "")).startswith(base):
                raise FlashError("MANIFEST_INVALID", "transfer list does not match the manifest or points to an untrusted host")
            if not FILENAME.match(mf.filename):
                raise FlashError("MANIFEST_INVALID", "bad filename")
        dev = self.hw.get(str(msg.get("device_id")))
        if dev is None:
            raise FlashError("DEVICE_DISCONNECTED", "The device is no longer connected.")
        if not dev.allowed:
            raise FlashError("DEVICE_NOT_ALLOWED", "Remote flashing is not allowed for this device in the desktop app.")
        if self.hw.busy.get(dev.id):
            raise FlashError("FLASH_IN_PROGRESS", "Device is busy.")
        if dev.family and dev.family != manifest.family:
            raise FlashError("TARGET_MISMATCH", f"Firmware targets {manifest.family} but the device is {dev.family}.")
        if dev.missing:
            raise FlashError("TOOLCHAIN_MISSING", "Missing tooling: " + ", ".join(dev.missing))
        miss = flasher_for(manifest.family, dev.ref()).missing()
        if miss:
            raise FlashError("TOOLCHAIN_MISSING", "Missing tooling: " + ", ".join(miss))
        if manifest.family not in FAMILIES:
            raise FlashError("UNSUPPORTED_MCU", "family not supported")
        return manifest

    def _boot_capture(self, dev: DeviceRef, family: str, seconds: float) -> dict:
        try:
            if dev.sim:
                r = sim_read(seconds, 16384, True)
            elif not dev.port or family in ("stm32", "ch32v003"):
                return {"skipped": "no serial console available for this programmer/target"}
            else:
                r = serialio.read(dev.port, 115200, seconds, 16384, "avr" if family == "avr" else "esp")
            return {"text": r["text"], "analysis": serialio.analyze_boot_log(r["text"]), "truncated": r["truncated"]}
        except serialio.SerialError as e:
            return {"error": str(e)}

    # -------------------------------------------------------------- commands

    def _run_command(self, msg: dict) -> None:
        cid = msg.get("id")
        try:
            data = self._command(str(msg.get("command")), str(msg.get("device_id")), msg.get("params") or {})
            self.post({"type": "command.result", "id": cid, "ok": True, "data": data})
        except FlashError as e:
            self.post({"type": "command.result", "id": cid, "ok": False, "error": {"code": e.code, "message": e.message, "details": e.details if isinstance(e.details, (str, dict, list)) else None}})
        except serialio.SerialError as e:
            self.post({"type": "command.result", "id": cid, "ok": False, "error": {"code": "SERIAL_ERROR", "message": str(e)}})
        except Exception as e:
            log.exception("command failed")
            self.post({"type": "command.result", "id": cid, "ok": False, "error": {"code": "INTERNAL", "message": f"{type(e).__name__}: {e}"}})
        self.state.last_activity = time.time()
        self._notify()

    def _command(self, name: str, device_id: str, p: dict) -> dict:
        if name == "rescan":
            self.rescan_now()
            return {"rescanning": True}
        dev = self.hw.get(device_id)
        if dev is None:
            raise FlashError("DEVICE_DISCONNECTED", "Device is not connected.")
        if not dev.allowed:
            raise FlashError("DEVICE_NOT_ALLOWED", "Remote access is not allowed for this device in the desktop app.")
        if self.hw.busy.get(dev.id):
            raise FlashError("FLASH_IN_PROGRESS", "Device is busy.")
        ref = dev.ref()
        self.hw.busy[dev.id] = f"cmd:{name}"
        try:
            if name == "identify":
                return self._identify(dev, ref)
            if name in ("read_serial", "capture_boot_log", "reset"):
                if "serial" not in dev.capabilities() and name != "reset":
                    raise FlashError("SERIAL_ERROR", "This device has no serial console (programmer-only).")
                baud = int(p.get("baud_rate") or 115200)
                if not 1200 <= baud <= 3_000_000:
                    raise FlashError("SERIAL_ERROR", "baud_rate out of range")
                style = "avr" if ref.family == "avr" else "esp" if ref.family else "auto"
                if name == "reset":
                    cap = min(float(p.get("capture_seconds") or 0), 30)
                    if cap > 0:
                        r = sim_read(cap, 16384, True) if ref.sim else serialio.read(ref.port or "", baud, cap, 16384, style)
                        return {"method": "reset + capture", "serial": r}
                    try:
                        method = flasher_for(ref.family or "esp32", ref).reset(ref) if ref.family != "avr" or ref.sim else flasher_for("avr", ref).reset(ref)
                    except FlashError as e:
                        if e.code == "UNSUPPORTED_MCU":
                            raise
                        raise
                    return {"method": method}
                dur = max(0.2, min(float(p.get("duration_ms") or 2000) / 1000, 30))
                mx = max(64, min(int(p.get("max_bytes") or 16384), 65536))
                if name == "read_serial":
                    return sim_read(dur, mx, False) if ref.sim else serialio.read(ref.port or "", baud, dur, mx)
                r = sim_read(dur, mx, True) if ref.sim else serialio.read(ref.port or "", baud, dur, mx, style)
                return {"log": r["text"], "analysis": serialio.analyze_boot_log(r["text"]), "bytes": r["bytes"], "truncated": r["truncated"], "baud_rate": baud}
            raise FlashError("INTERNAL", f"unknown command {name!r}")
        finally:
            self.hw.busy.pop(dev.id, None)

    def _identify(self, dev, ref: DeviceRef) -> dict:
        candidates = [ref.family] if ref.family else (dev.cls.candidates or ["esp32", "avr"])
        order = list(dict.fromkeys("esp32" if c.startswith("esp") else c for c in candidates))
        if ref.vid == 0x0403 and "avr" in order:  # FTDI adapters are mostly Arduino-style boards: ask the AVR bootloader first
            order = ["avr"] + [o for o in order if o != "avr"]
        errors: list[str] = []
        last: FlashError | None = None
        for fam in order:
            try:
                info = flasher_for(fam, ref).identify(ref)
            except FlashError as e:
                last = e
                errors.append(f"{fam}: {e.message}" + (f"\n    {e.details}" if isinstance(e.details, str) and e.details else ""))
                if e.code in ("SERIAL_ERROR", "TOOLCHAIN_MISSING"):
                    raise  # the port is busy / a tool is missing: trying other chips cannot help
                continue
            self.hw.set_identified(dev.id, info)
            self.rescan_now()
            return {**info, "identified": True}
        raise FlashError("PROBE_FAILED", (last.message if last else "No supported MCU answered.") if len(errors) < 2 else "No supported MCU answered (ESP and AVR bootloaders were both tried).", "\n".join(errors)[-1800:])

    # ---------------------------------------------------------------- control

    def revoke_this_device(self) -> None:
        """Called from the UI: revoke server-side, forget credentials, re-pair."""
        tok = self.creds.load()
        if tok:
            try:
                post_json(self.store.settings.server_url + "/api/agent/revoke", {}, tok)
            except (HttpError, ConnectionError) as e:
                log.warning("server-side revoke failed (%s); credential removed locally", e)
        self.creds.clear()
        self.store.settings.agent_id = ""
        self.store.settings.account_email = ""
        self.store.save()
        if self.loop and self._ws_ref is not None:
            asyncio.run_coroutine_threadsafe(self._ws_ref.close(4004, "revoked locally"), self.loop)

    def cancel_job(self, job_id: str) -> None:
        ev = self._cancels.get(job_id)
        if ev:
            ev.set()


class _Revoked(Exception):
    pass


_ = re
