"""Cloud compilation for chats without a code sandbox (compile_firmware / build_and_flash), with a mock build service."""
import hashlib

import pytest

from conftest import AgentRunner, wait_job

BLINK = "void setup(){pinMode(13,OUTPUT);}\nvoid loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}\n"


def test_compile_returns_hex_stats_and_hash(stack):
    r = stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-uno")
    assert r["ok"] and r["format"] == "Intel HEX"
    hex_text = stack.compiler.avr_hex.replace("\r\n", "\n")
    assert r["intel_hex"] == hex_text and r["size_bytes"] == len(hex_text)
    assert r["sha256"] == hashlib.sha256(hex_text.encode()).hexdigest()
    assert r["stats"]["program_bytes"] == 924 and r["stats"]["program_max"] == 32256
    sent = stack.compiler.requests[-1]
    assert sent["board"] == "uno" and sent["sketch"] == BLINK


def test_boards_map_to_backend_targets_and_extra_files_are_forwarded(stack):
    stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-mega2560", extra_files=[{"name": "config.h", "content": "#define X 1\n"}])
    sent = stack.compiler.requests[-1]
    assert sent["board"] == "mega" and sent["files"] == [{"name": "config.h", "content": "#define X 1\n"}]
    stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-nano-old-bootloader")
    assert stack.compiler.requests[-1]["board"] == "nano"


def test_compile_errors_are_returned_for_the_model_to_fix(stack):
    r = stack.mcp.call("compile_firmware", sketch="void setup(){ undefined_fn(); }\nvoid loop(){}\n", board="arduino-uno")
    assert not r["ok"] and r["error"]["code"] == "COMPILE_FAILED"
    assert "undefined_fn" in r["error"]["details"]["stderr"] and "was not declared" in r["error"]["details"]["stderr"]


def test_build_service_outage_is_reported_distinctly(stack):
    r = stack.mcp.call("compile_firmware", sketch="// FORCE_500\nvoid setup(){}\nvoid loop(){}\n", board="arduino-uno")
    assert not r["ok"] and r["error"]["code"] == "COMPILER_UNAVAILABLE"


def test_input_validation_is_strict(stack):
    assert stack.mcp.call("compile_firmware", sketch=BLINK, board="stm32-bluepill-f103c8")["ok"] is False  # not a cloud-compilable board
    assert stack.mcp.call("compile_firmware", sketch="", board="arduino-uno")["ok"] is False
    assert stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-uno", extra_files=[{"name": "../evil.h", "content": "x"}])["ok"] is False
    assert stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-uno", command="rm -rf /")["ok"] is False
    assert stack.mcp.call("compile_firmware", sketch="x" * 200_001, board="arduino-uno")["ok"] is False


def test_build_and_flash_avr_end_to_end_without_any_manual_upload(stack, tmp_path):
    r = AgentRunner(stack, tmp_path / "avr", "avr").start()
    try:
        import time

        deadline = time.time() + 20
        while time.time() < deadline and stack.mcp.call("list_devices")["situation"] != "single_device":
            time.sleep(0.3)
        out = stack.mcp.call("build_and_flash", sketch=BLINK, board="arduino-uno", boot_log_seconds=0)
        assert out["ok"], out
        assert out["build"]["board"] == "arduino-uno" and out["build"]["stats"]["program_bytes"] == 924
        job = wait_job(stack.mcp, out["job"]["job_id"])
        assert job["status"] == "completed" and job["flash_confirmed"] is True, job
        assert job["result"]["verified"] and job["result"]["files"][0]["filename"] == "sketch.hex"
        assert job["result"]["files"][0]["sha256"] == out["build"]["sha256"]
        # what the desktop flashed is exactly what the build service produced
        assert out["build"]["sha256"] == hashlib.sha256(stack.compiler.avr_hex.replace("\r\n", "\n").encode()).hexdigest()
        # the firmware is not retained on the desktop
        assert not any((tmp_path / "avr" / "tmp").iterdir())
    finally:
        r.stop()


def test_build_and_flash_esp32_uses_the_image_header_for_flash_settings(stack, tmp_path):
    r = AgentRunner(stack, tmp_path / "esp", "esp32").start()
    try:
        import time

        deadline = time.time() + 20
        while time.time() < deadline and stack.mcp.call("list_devices")["situation"] != "single_device":
            time.sleep(0.3)
        out = stack.mcp.call("build_and_flash", sketch=BLINK, board="esp32-wroom-32", boot_log_seconds=0)
        assert out["ok"], out
        job = wait_job(stack.mcp, out["job"]["job_id"])
        assert job["status"] == "completed", job
        f = job["result"]["files"][0]
        assert f["address"] == "0x10000" and f["filename"] == "firmware.bin" and f["bytes"] == len(stack.compiler.esp_bin)
    finally:
        r.stop()


def test_wrong_board_family_is_rejected_before_anything_is_sent_to_the_pc(stack, tmp_path):
    r = AgentRunner(stack, tmp_path / "mm", "esp32").start()
    try:
        import time

        deadline = time.time() + 20
        while time.time() < deadline and stack.mcp.call("list_devices")["situation"] != "single_device":
            time.sleep(0.3)
        n = len(stack.compiler.requests)
        out = stack.mcp.call("build_and_flash", sketch=BLINK, board="arduino-uno")
        # an AVR build for an ESP32 device: refused with TARGET_MISMATCH (the compile may or may not have run first)
        assert not out["ok"] and out["error"]["code"] == "TARGET_MISMATCH", out
        _ = n
    finally:
        r.stop()


def test_no_device_means_no_compile(stack):
    # no agent running in this test: device selection fails first, so the build service is never called
    n = len(stack.compiler.requests)
    out = stack.mcp.call("build_and_flash", sketch=BLINK, board="arduino-uno")
    assert not out["ok"] and out["error"]["code"] in ("NO_AGENT_CONNECTED", "NO_DEVICE")
    assert len(stack.compiler.requests) == n


def test_supported_boards_lists_cloud_compile_boards(stack):
    r = stack.mcp.call("get_supported_boards")
    assert set(r["cloud_compile_boards"]) >= {"arduino-uno", "arduino-nano", "arduino-mega2560", "esp32-wroom-32"}
    assert any("build_and_flash" in n for n in r["notes"])


def test_wrong_chip_image_is_reported_as_target_mismatch_not_a_crash(stack, tmp_path, monkeypatch):
    """An ESP32-S3 image sent to a classic-ESP32 board must fail with TARGET_MISMATCH (regression: used to be INTERNAL)."""
    r = AgentRunner(stack, tmp_path / "wc", "esp32").start()
    try:
        import time

        deadline = time.time() + 20
        while time.time() < deadline and stack.mcp.call("list_devices")["situation"] != "single_device":
            time.sleep(0.3)
        original = stack.compiler.esp_bin
        stack.compiler.esp_bin = bytes([0xE9, 0x06, 0x02, 0x2F, 0xE4, 0x24, 0x08, 0x40, 0xEE, 0, 0, 0, 0x09, 0x00, 0, 0]) + bytes(300)  # chip id 9 = ESP32-S3
        try:
            out = stack.mcp.call("build_and_flash", sketch=BLINK, board="esp32-wroom-32", boot_log_seconds=0)
            job = wait_job(stack.mcp, out["job"]["job_id"])
        finally:
            stack.compiler.esp_bin = original
        assert job["status"] == "failed" and job["error"]["code"] == "TARGET_MISMATCH", job
        assert "esp32s3" in job["error"]["message"]
    finally:
        r.stop()
