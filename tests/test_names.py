"""Custom board names: stored per account, shown to the AI, accepted wherever device_id is."""
import time

from conftest import AgentRunner


def _device_id(stack):
    deadline = time.time() + 20
    while time.time() < deadline:
        r = stack.mcp.call("list_devices")
        if r["situation"] == "single_device":
            return r["devices"][0]["device_id"]
        time.sleep(0.3)
    raise AssertionError("no device appeared")


def test_names_roundtrip_resolve_and_validation(stack, tmp_path):
    r = AgentRunner(stack, tmp_path / "nm", "esp32").start()
    try:
        did = _device_id(stack)
        assert stack.mcp.call("list_devices")["devices"][0]["name"] is None
        ok = stack.mcp.call("rename_device", device_id=did, name="Kitchen ESP32")
        assert ok["ok"] and ok["name"] == "Kitchen ESP32"
        # visible in list/info and accepted instead of the id (case-insensitive)
        assert stack.mcp.call("list_devices")["devices"][0]["name"] == "Kitchen ESP32"
        info = stack.mcp.call("get_device_info", device_id="kitchen esp32")
        assert info["ok"] and info["device"]["device_id"] == did and info["device"]["name"] == "Kitchen ESP32"
        # web overview carries it, and the web endpoint can rename too
        _, ov = stack.web.get("/api/web/overview")
        assert any(d["name"] == "Kitchen ESP32" for d in ov["devices"])
        s, b = stack.web.call("PUT", f"/api/web/devices/{did}/name", {"name": "Bench ESP32"})
        assert s == 200 and b["name"] == "Bench ESP32"
        assert stack.mcp.call("get_device_info", device_id="Bench ESP32")["ok"]
        assert stack.mcp.call("get_device_info", device_id="Kitchen ESP32")["ok"] is False  # old name no longer resolves
        # validation
        for bad in ("", "../x", "a;b", "x" * 33, " lead"):
            assert stack.mcp.call("rename_device", device_id=did, name=bad)["ok"] is False, bad
        assert stack.web.call("PUT", f"/api/web/devices/{did}/name", {"name": "bad;name"})[0] == 400
        assert stack.web.call("PUT", "/api/web/devices/dev_nonexistent/name", {"name": "x1"})[0] == 404
        # clear
        assert stack.mcp.call("rename_device", device_id=did, name=None)["name"] is None
        assert stack.mcp.call("list_devices")["devices"][0]["name"] is None
    finally:
        r.stop()


def test_unknown_device_and_name_uniqueness(stack):
    assert stack.mcp.call("rename_device", device_id="dev_missing", name="X1")["error"]["code"] == "DEVICE_NOT_FOUND"
    assert stack.mcp.call("get_device_info", device_id="No Such Name")["error"]["code"] == "DEVICE_NOT_FOUND"
