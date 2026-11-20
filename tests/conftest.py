"""End-to-end harness: local Worker (wrangler dev) + real desktop agent core (simulated boards)."""
from __future__ import annotations

import asyncio
import hashlib
import http.cookiejar as cookiejar
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))
PORT = int(os.environ.get("E2E_PORT", "8799"))
BASE = f"http://127.0.0.1:{PORT}"
SIGNUP = "e2e-invite-code"


def http(method, url, body=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


class Web:
    """Minimal browser stand-in: cookie jar + same-origin JSON calls to /api/web/*."""

    def __init__(self):
        self.jar = cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, same_origin=True):
        headers = {"Content-Type": "application/json"}
        if same_origin:
            headers["Sec-Fetch-Site"] = "same-origin"
        req = urllib.request.Request(BASE + path, json.dumps(body).encode() if body is not None else None, headers, method=method)
        try:
            r = self.op.open(req)
            raw = r.read()
            return r.status, (json.loads(raw) if raw[:1] in (b"{", b"[") else raw.decode())
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw.decode()

    def post(self, path, **body):
        return self.call("POST", path, body)

    def get(self, path):
        return self.call("GET", path)


class Mcp:
    def __init__(self, token):
        self.h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        self.n = 0

    def rpc(self, method, params=None):
        self.n += 1
        s, b, _ = http("POST", BASE + "/mcp", json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}}).encode(), self.h, timeout=90)
        return s, json.loads(b)

    def call(self, name, **args):
        s, d = self.rpc("tools/call", {"name": name, "arguments": args})
        assert s == 200, (s, d)
        if "error" in d:
            return {"ok": False, "protocol_error": d["error"]}
        r = d["result"]
        if "structuredContent" not in r:  # SDK-level rejection (e.g. strict schema violation)
            return {"ok": False, "error": {"code": "PROTOCOL", "message": json.dumps(r.get("content"))}}
        return r["structuredContent"]


def make_firmware(n, seed=1):
    return hashlib.sha256(str(seed).encode()).digest() * (n // 32 + 1)


def manifest_for(files, job_id=None, family="esp32", board="esp32-wroom-32", **extra):
    """files: list of (address, filename, bytes)."""
    m = {
        "job_id": job_id or "job_" + secrets.token_hex(5),
        "target": {"family": family, "board": board, "flash_size": "4MB"},
        "flash_config": {"mode": "dio", "frequency": "40m", "baud_rate": 460800},
        "files": [{"address": a, "filename": n, "size": len(d), "sha256": hashlib.sha256(d).hexdigest()} for a, n, d in files],
    }
    m.update(extra)
    return m


def upload_all(res, blobs: dict, parallel=False):
    """PUT each file as instructed by flash_firmware's result. Returns list of (status, body)."""
    out = [None] * len(res["upload"]["files"])

    def one(i, u):
        s, b, _ = http("PUT", u["url"], blobs[u["filename"]], {"Authorization": "Bearer " + res["upload"]["token"], "Content-Type": "application/octet-stream"}, timeout=120)
        out[i] = (s, json.loads(b or b"{}"))

    ts = [threading.Thread(target=one, args=(i, u)) for i, u in enumerate(res["upload"]["files"])]
    for t in ts:
        t.start()
        if not parallel:
            t.join()
    for t in ts:
        t.join()
    return out


def wait_job(mcp, job_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        r = mcp.call("get_flash_job", job_id=job_id, wait_seconds=5)
        if r["job"]["is_terminal"]:
            return r["job"]
    raise AssertionError("job did not finish")


class MockCompiler:
    """Stand-in for the cloud build service (Wokwi hexi-compatible JSON API). Records every request."""

    def __init__(self):
        import base64
        import http.server
        import socketserver

        outer = self
        self.requests = []

        def rec(addr, t, data):
            raw = bytes([len(data), addr >> 8, addr & 255, t]) + data
            return ":" + (raw + bytes([(-sum(raw)) & 255])).hex().upper()

        self.avr_hex = "\r\n".join([rec(0, 0, bytes(range(16))), rec(16, 0, bytes(range(16, 32))), rec(0, 1, b"")]) + "\r\n"
        # header of a real Arduino-ESP32 build: magic, 6 segments, DIO, 4MB@80m, entry point, ... chip id 0 (ESP32)
        self.esp_bin = bytes([0xE9, 0x06, 0x02, 0x2F, 0xE4, 0x24, 0x08, 0x40, 0xEE, 0, 0, 0, 0, 0, 0, 0]) + bytes(range(256)) * 12

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                outer.requests.append(body)
                src = body.get("sketch", "")
                if "FORCE_500" in src:
                    self.send_response(500)
                    self.end_headers()
                    return
                if "undefined_fn" in src:
                    out = {"stdout": "\n", "stderr": "/sketch/sketch.ino:1:15: error: 'undefined_fn' was not declared in this scope\nError during build: exit status 1\n", "hex": "", "eep": ""}
                elif body["board"] == "esp32":
                    out = {"stdout": "Sketch uses 3072 bytes (0%) of program storage space. Maximum is 1310720 bytes.\n", "stderr": "", "hex": base64.b64encode(outer.esp_bin).decode(), "eep": ""}
                else:
                    out = {"stdout": "Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes.\nGlobal variables use 9 bytes (0%) of dynamic memory.\n", "stderr": "", "hex": outer.avr_hex, "eep": ":00000001FF\r\n"}
                data = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
        self.srv.daemon_threads = True
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()


class Stack:
    pass


@pytest.fixture(scope="session")
def stack():
    work = Path(tempfile.mkdtemp(prefix="mcub-e2e-"))
    persist = work / "state"
    cloud = ROOT / "cloud"
    env = {**os.environ, "NO_COLOR": "1"}
    subprocess.run(["npx", "wrangler", "d1", "migrations", "apply", "mcu-bridge", "--local", "--persist-to", str(persist)], cwd=cloud, check=True, capture_output=True, env=env)
    compiler = MockCompiler()
    dev_vars = work / "e2e.vars"
    dev_vars.write_text(f"JOB_SIGNING_KEY=e2e-signing-key-{secrets.token_hex(8)}\nSIGNUP_CODE={SIGNUP}\nPAIR_START_LIMIT=1000\nCOMPILER_URL=http://127.0.0.1:{compiler.port}/build\n")
    # fake installer (3 parts) served by the Worker's /download route
    dl = ROOT / "web" / "dist" / "dl"
    shutil.rmtree(dl, ignore_errors=True)
    dl.mkdir(parents=True, exist_ok=True)
    blob = b"MZ" + secrets.token_bytes(2500)
    sizes = [1000, 1000, len(blob) - 2000]
    off = 0
    parts = []
    for i, n in enumerate(sizes, 1):
        (dl / f"MCUBridge-Setup.exe.part{i}").write_bytes(blob[off : off + n])
        parts.append({"path": f"/dl/MCUBridge-Setup.exe.part{i}", "size": n})
        off += n
    (dl / "manifest.json").write_text(json.dumps({"name": "MCUBridge-Setup.exe", "total": len(blob), "sha256": hashlib.sha256(blob).hexdigest(), "parts": parts}))
    logf = open(work / "wrangler.log", "w")
    proc = subprocess.Popen(["npx", "wrangler", "dev", "--local", "--port", str(PORT), "--persist-to", str(persist), "--env-file", str(dev_vars), "--log-level", "warn"], cwd=cloud, stdout=logf, stderr=subprocess.STDOUT, env=env, start_new_session=True)
    for _ in range(90):
        try:
            if http("GET", BASE + "/health", timeout=2)[0] == 200:
                break
        except Exception:
            time.sleep(1)
    else:
        proc.kill()
        raise RuntimeError("wrangler dev did not start:\n" + (work / "wrangler.log").read_text())

    s = Stack()
    s.work, s.proc = work, proc
    s.installer = blob
    s.compiler = compiler
    s.web = Web()
    st, _ = s.web.post("/api/web/signup", email="e2e@example.com", password="correct-horse-battery", invite=SIGNUP)
    assert st == 200, st
    st, data = s.web.post("/api/web/tokens", name="e2e")
    s.token = data["token"]
    s.mcp = Mcp(s.token)
    yield s
    import signal

    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            break
        try:
            proc.wait(5)
            break
        except subprocess.TimeoutExpired:
            continue
    logf.close()
    compiler.close()
    shutil.rmtree(dl, ignore_errors=True)  # never leave test files in the deployable dist
    shutil.rmtree(work, ignore_errors=True)


class AgentRunner:
    """Runs the real Agent core in a thread, with simulated boards, pairing through the real web flow."""

    def __init__(self, stack, home, sim_devices="esp32"):
        os.environ["MCUBRIDGE_HOME"] = str(home)
        os.environ["MCUBRIDGE_SERVER"] = BASE
        os.environ["MCUBRIDGE_SIMULATE"] = "1"
        os.environ["MCUBRIDGE_SIM_DEVICES"] = sim_devices
        from app.core.agent import Agent
        from app.core.config import SettingsStore
        from app.hardware.devices import HardwareManager
        from app.security.credstore import CredentialStore

        self.stack = stack
        self.store = SettingsStore(Path(home) / "settings.json")
        self.creds = CredentialStore(Path(home) / "credentials.bin")
        self.hw = HardwareManager(self.store)
        self.agent = Agent(self.store, self.creds, self.hw)
        self.thread = threading.Thread(target=lambda: asyncio.run(self.agent.run()), daemon=True)

    def start(self, pair=True):
        self.thread.start()
        if pair and not self.creds.load():
            self.wait(lambda: self.agent.state.pairing, 20, "pairing code")
            code = self.agent.state.pairing["code"]
            st, info = self.stack.web.get(f"/api/web/pair?code={code}")
            assert st == 200 and info["device_name"]
            st, _ = self.stack.web.post("/api/web/pair/decision", code=code, decision="approve")
            assert st == 200
        self.wait(lambda: self.agent.state.connection == "connected", 30, "connection")
        return self

    def wait(self, cond, timeout, what=""):
        end = time.time() + timeout
        while time.time() < end:
            if cond():
                return
            time.sleep(0.1)
        raise AssertionError(f"timed out waiting for {what} (state={self.agent.state.connection})")

    def stop(self):
        self.agent.stop()
        self.thread.join(5)


@pytest.fixture()
def agent(stack, tmp_path):
    r = AgentRunner(stack, tmp_path / "home").start()
    # wait until the cloud sees the device
    deadline = time.time() + 20
    while time.time() < deadline:
        if stack.mcp.call("list_devices")["situation"] == "single_device":
            break
        time.sleep(0.3)
    yield r
    r.stop()
