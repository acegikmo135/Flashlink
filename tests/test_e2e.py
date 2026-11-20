"""End-to-end tests: real Worker + real agent core + simulated boards.

No physical hardware is involved: the SimFlasher stands in for esptool/avrdude.
"""
import hashlib
import time

from conftest import BASE, Mcp, http, make_firmware, manifest_for, upload_all, wait_job


def esp_files(n=300_000, seed=1):
    return [("0x1000", "bootloader.bin", make_firmware(26_000, seed)), ("0x10000", "firmware.bin", make_firmware(n, seed + 1))]


def test_health_and_auth(stack):
    s, b, _ = http("GET", BASE + "/health")
    assert s == 200
    s, _, _ = http("POST", BASE + "/mcp", b"{}", {"Content-Type": "application/json"})
    assert s == 401
    s, _, _ = http("POST", BASE + "/mcp", b"{}", {"Authorization": "Bearer mcb_mcp_nope", "Content-Type": "application/json"})
    assert s == 401


def test_signup_requires_invite(stack):
    from conftest import Web

    w = Web()
    st, r = w.post("/api/web/signup", email="x@example.com", password="correct-horse-battery", invite="wrong")
    assert st == 403 and r["error"]["code"] == "INVALID_INVITE"
    # cross-site posts are refused
    st, r = w.call("POST", "/api/web/login", {"email": "a@b.c", "password": "x"}, same_origin=False) if False else (None, None)
    s, _, _ = http("POST", BASE + "/api/web/login", b'{"email":"a@b.c","password":"x"}', {"Sec-Fetch-Site": "cross-site", "Content-Type": "application/json"})
    assert s == 403


def test_mcp_lists_all_tools(stack):
    s, d = stack.mcp.rpc("tools/list")
    names = {t["name"] for t in d["result"]["tools"]}
    assert names == {"list_devices", "get_device_info", "identify_mcu", "get_device_status", "detect_new_devices", "flash_firmware", "get_flash_job", "cancel_flash_job", "verify_flash", "reset_device", "read_serial", "capture_boot_log", "get_flash_history", "get_supported_boards", "compile_firmware", "build_and_flash", "list_builds", "flash_build", "delete_build", "rename_device"}
    for t in d["result"]["tools"]:
        assert t["description"] and t["inputSchema"]["type"] == "object" and t["inputSchema"].get("additionalProperties") is False


def test_no_agent_state(stack):
    r = stack.mcp.call("list_devices")
    # (this test must run before the agent fixture is used)
    assert r["ok"] and r["situation"] in ("no_agent", "single_device", "no_device")
    f = stack.mcp.call("flash_firmware", manifest=manifest_for(esp_files()))
    assert (not f["ok"]) or f["created"]


def test_pairing_and_device_listing(agent, stack):
    r = stack.mcp.call("list_devices")
    assert r["situation"] == "single_device"
    d = r["devices"][0]
    assert d["state"] == "idle" and d["family"] == "esp32" and d["supported"] and d["remote_flashing_allowed"]
    info = stack.mcp.call("get_device_info")
    assert info["device"]["device_id"] == d["device_id"] and info["manifest_requirements"]["flash_tool"] == "esptool"
    ident = stack.mcp.call("identify_mcu")
    assert ident["identification"]["chip"].startswith("ESP32")


def test_flash_happy_path_and_hash_integrity(agent, stack):
    files = esp_files()
    blobs = {n: d for _, n, d in files}
    res = stack.mcp.call("flash_firmware", manifest=manifest_for(files))
    assert res["ok"] and res["job"]["status"] == "awaiting_upload" and res["job"]["flash_confirmed"] is False
    assert "curl" in res["upload"]["files"][0]
    ups = upload_all(res, blobs)
    assert all(s == 200 and b["delivered"] for s, b in ups), ups
    job = wait_job(stack.mcp, res["job"]["job_id"])
    assert job["status"] == "completed" and job["flash_confirmed"] is True
    assert job["result"]["confirmed_by_agent"] and job["result"]["verified"]
    assert "hello from MCU Bridge sim" in job["result"]["boot_log"]["text"]
    assert job["result"]["boot_log"]["analysis"]["flags"]["boot_detected"]
    # firmware must not linger on the desktop
    assert not any((agent.store.path.parent / "tmp").iterdir())
    # history is persisted in D1
    h = stack.mcp.call("get_flash_history", limit=5)
    assert h["jobs"][0]["job_id"] == res["job"]["job_id"] and h["jobs"][0]["status"] == "completed"


def test_idempotent_job_and_conflict(agent, stack):
    files = esp_files(50_000, 7)
    m = manifest_for(files)
    a = stack.mcp.call("flash_firmware", manifest=m)
    b = stack.mcp.call("flash_firmware", manifest=m)
    assert a["created"] and not b["created"] and a["job"]["job_id"] == b["job"]["job_id"]
    m2 = manifest_for(esp_files(60_000, 8), job_id=m["job_id"])
    c = stack.mcp.call("flash_firmware", manifest=m2)
    assert not c["ok"] and c["error"]["code"] == "JOB_CONFLICT"
    stack.mcp.call("cancel_flash_job", job_id=m["job_id"])


def test_busy_device_rejects_second_job(agent, stack):
    a = stack.mcp.call("flash_firmware", manifest=manifest_for(esp_files(50_000, 11)))
    assert a["ok"], a
    b = stack.mcp.call("flash_firmware", manifest=manifest_for(esp_files(50_000, 12)))
    assert not b["ok"] and b["error"]["code"] == "FLASH_IN_PROGRESS"
    rs = stack.mcp.call("read_serial", duration_ms=300)
    assert not rs["ok"] and rs["error"]["code"] == "FLASH_IN_PROGRESS"
    c = stack.mcp.call("cancel_flash_job", job_id=a["job"]["job_id"])
    assert c["job"]["status"] == "cancelled"


def test_manifest_rejections(agent, stack):
    bad = manifest_for(esp_files())
    bad["files"][1]["address"] = "0x400000"
    r = stack.mcp.call("flash_firmware", manifest=bad)
    assert r["error"]["code"] == "MANIFEST_INVALID" and any(i["code"] == "ADDRESS_OUT_OF_RANGE" for i in r["error"]["details"])
    wrong_target = manifest_for([("0x0", "bootloader.bin", make_firmware(20000)), ("0x10000", "app.bin", make_firmware(30000))], family="esp32s3", board="esp32-s3-devkitc-1")
    r = stack.mcp.call("flash_firmware", manifest=wrong_target)
    assert r["error"]["code"] == "TARGET_MISMATCH"
    # unknown keys are rejected by the strict input schema
    r = stack.mcp.call("flash_firmware", manifest=manifest_for(esp_files()), command="rm -rf /")
    assert not r["ok"]


def test_upload_hash_and_size_mismatch(agent, stack):
    files = esp_files(40_000, 21)
    res = stack.mcp.call("flash_firmware", manifest=manifest_for(files))
    tampered = {n: (d[:-1] + bytes([d[-1] ^ 1])) for _, n, d in files}
    (s, b), *_ = upload_all(res, tampered)
    assert s == 422 and b["error"]["code"] == "HASH_MISMATCH"
    stack.mcp.call("cancel_flash_job", job_id=res["job"]["job_id"])
    res2 = stack.mcp.call("flash_firmware", manifest=manifest_for(files))
    u = res2["upload"]["files"][0]
    s, body, _ = http("PUT", u["url"], b"short", {"Authorization": "Bearer " + res2["upload"]["token"]})
    assert s == 400
    s, _, _ = http("PUT", u["url"], files[0][2], {"Authorization": "Bearer wrong"})
    assert s == 401
    stack.mcp.call("cancel_flash_job", job_id=res2["job"]["job_id"])


def test_verification_failure_is_reported(agent, stack):
    files = [("0x1000", "simcorrupt.bin", make_firmware(30_000, 31)), ("0x10000", "firmware.bin", make_firmware(40_000, 32))]
    res = stack.mcp.call("flash_firmware", manifest=manifest_for(files))
    upload_all(res, {n: d for _, n, d in files})
    job = wait_job(stack.mcp, res["job"]["job_id"])
    assert job["status"] == "verification_failed" and job["flash_confirmed"] is False
    assert job["error"]["code"] == "VERIFICATION_FAILED"


def test_flash_failure_is_reported(agent, stack):
    files = [("0x1000", "simfail-flash.bin", make_firmware(30_000, 41))]
    res = stack.mcp.call("flash_firmware", manifest=manifest_for(files))
    upload_all(res, {n: d for _, n, d in files})
    job = wait_job(stack.mcp, res["job"]["job_id"])
    assert job["status"] == "failed" and job["error"]["code"] == "FLASH_FAILED" and not job["flash_confirmed"]


def test_verify_flash_matches_and_detects_difference(agent, stack):
    files = esp_files(80_000, 51)
    blobs = {n: d for _, n, d in files}
    r = stack.mcp.call("flash_firmware", manifest=manifest_for(files), boot_log_seconds=0)
    upload_all(r, blobs)
    assert wait_job(stack.mcp, r["job"]["job_id"])["status"] == "completed"
    v = stack.mcp.call("verify_flash", manifest=manifest_for(files))
    upload_all(v, blobs)
    j = wait_job(stack.mcp, v["job"]["job_id"])
    assert j["status"] == "completed" and j["kind"] == "verify" and j["result"]["verified"]
    other = esp_files(80_000, 99)
    v2 = stack.mcp.call("verify_flash", manifest=manifest_for(other))
    upload_all(v2, {n: d for _, n, d in other})
    assert wait_job(stack.mcp, v2["job"]["job_id"])["status"] == "verification_failed"


def test_cancel_during_flash(agent, stack):
    files = [("0x10000", "simslow.bin", make_firmware(200_000, 61))]
    res = stack.mcp.call("flash_firmware", manifest=manifest_for(files))
    upload_all(res, {n: d for _, n, d in files})
    deadline = time.time() + 20
    while time.time() < deadline:
        if stack.mcp.call("get_flash_job", job_id=res["job"]["job_id"])["job"]["status"] == "flashing":
            break
        time.sleep(0.1)
    c = stack.mcp.call("cancel_flash_job", job_id=res["job"]["job_id"])
    assert c["ok"]
    assert wait_job(stack.mcp, res["job"]["job_id"])["status"] == "cancelled"


def test_serial_reset_and_boot_log(agent, stack):
    r = stack.mcp.call("read_serial", duration_ms=300, max_bytes=64)
    assert r["ok"] and "sim:" in r["text"]
    b = stack.mcp.call("capture_boot_log", duration_ms=500)
    assert b["analysis"]["flags"]["boot_detected"] and not b["analysis"]["flags"]["panic"]
    assert stack.mcp.call("reset_device")["reset_signal_sent"]


def test_detect_new_devices_longpoll(agent, stack):
    v = stack.mcp.call("list_devices")["registry_version"]
    t0 = time.time()
    r = stack.mcp.call("detect_new_devices", since_version=v, wait_seconds=2)
    assert not r["changed"] and time.time() - t0 >= 1.5
    r = stack.mcp.call("detect_new_devices", since_version=0)
    assert r["changed"] and len(r["added"]) == 1


def test_device_not_allowed_blocks_flash(agent, stack):
    dev = stack.mcp.call("list_devices")["devices"][0]["device_id"]
    agent.hw.set_allowed(dev, False)
    time.sleep(2.5)
    r = stack.mcp.call("flash_firmware", manifest=manifest_for(esp_files(40_000, 71)))
    assert r["error"]["code"] == "DEVICE_NOT_ALLOWED"
    agent.hw.set_allowed(dev, True)


def test_supported_boards(stack):
    r = stack.mcp.call("get_supported_boards", family="avr")
    assert {b["board"] for b in r["boards"]} >= {"arduino-uno", "arduino-nano", "arduino-mega2560"}


def test_reconnect_and_resume(agent, stack):
    ws = agent.agent._ws_ref
    import asyncio

    asyncio.run_coroutine_threadsafe(ws.close(1012, "test"), agent.agent.loop).result(20)
    agent.wait(lambda: agent.agent.state.connection != "connected", 10, "disconnect")
    agent.wait(lambda: agent.agent.state.connection == "connected", 30, "reconnect")
    deadline = time.time() + 15
    while time.time() < deadline and stack.mcp.call("list_devices")["situation"] != "single_device":
        time.sleep(0.3)
    files = esp_files(60_000, 81)
    res = stack.mcp.call("flash_firmware", manifest=manifest_for(files), boot_log_seconds=0)
    upload_all(res, {n: d for _, n, d in files})
    assert wait_job(stack.mcp, res["job"]["job_id"])["status"] == "completed"


def test_revoke_disconnects_agent(stack, tmp_path):
    from conftest import AgentRunner

    r = AgentRunner(stack, tmp_path / "h2", "avr").start()
    try:
        _, ov = stack.web.get("/api/web/overview")
        ids = [a["id"] for a in ov["agents"]]
        assert ids
        for i in ids:
            stack.web.post("/api/web/agents/revoke", id=i)
        r.wait(lambda: r.agent.state.connection in ("revoked", "unpaired", "pairing"), 20, "revocation")
        s, _, _ = http("GET", BASE + "/api/agent/me", None, {"Authorization": "Bearer mcb_agent_bogus"})
        assert s == 401
    finally:
        r.stop()


def test_tool_install_is_pushed_to_the_cloud(agent, stack, monkeypatch):
    """Regression: Claude saw 'avrdude unavailable' after the user installed it, because tools were only sent at connect."""
    from app.hardware import tools as T

    def agents():
        return stack.mcp.call("list_devices")["agents"]

    assert agents()[0]["toolchains"].get("avrdude", {}).get("available") is False
    fake = {n: T.Tool(n, n in ("esptool", "avrdude"), "x", "8.0" if n == "avrdude" else None) for n in ("esptool", "avrdude", "stm32cube", "openocd", "wlink")}
    monkeypatch.setattr(T, "all_tools", lambda refresh=False: fake)
    agent.agent.refresh_toolchains()
    deadline = time.time() + 10
    while time.time() < deadline and not agents()[0]["toolchains"].get("avrdude", {}).get("available"):
        time.sleep(0.3)
    assert agents()[0]["toolchains"]["avrdude"] == {"available": True, "version": "8.0"}
