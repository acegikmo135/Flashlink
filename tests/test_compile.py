"""Cloud compilation for chats without a code sandbox (compile_firmware / build_and_flash), with a mock build service."""
import hashlib
import json

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


def boot_consts():
    """sha256 of the embedded bootloader / partition table / boot_app0, read from the Worker source."""
    import re
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "cloud" / "src" / "compile" / "esp32-boot.ts").read_text()
    return {k: re.search(rf'{k}: \{{ address: (0x[0-9a-f]+), size: (\d+), sha256: "([0-9a-f]{{64}})"', src).groups() for k in ("bootloader", "partitions", "boot_app0")}


def esp_runner(stack, tmp_path, name):
    import time

    r = AgentRunner(stack, tmp_path / name, "esp32").start()
    deadline = time.time() + 20
    while time.time() < deadline and stack.mcp.call("list_devices")["situation"] != "single_device":
        time.sleep(0.3)
    return r


def test_esp32_build_is_flashed_as_a_complete_image_so_a_blank_chip_boots(stack, tmp_path):
    r = esp_runner(stack, tmp_path, "esp")
    try:
        out = stack.mcp.call("build_and_flash", sketch=BLINK, board="esp32-wroom-32", boot_log_seconds=0)
        assert out["ok"], out
        assert out["build"]["full_image"] is True
        assert [(f["filename"], f["address"]) for f in out["build"]["files"]] == [("bootloader.bin", "0x1000"), ("partitions.bin", "0x8000"), ("boot_app0.bin", "0xe000"), ("firmware.bin", "0x10000")]
        job = wait_job(stack.mcp, out["job"]["job_id"])
        assert job["status"] == "completed" and job["flash_confirmed"] is True, job
        files = {f["filename"]: f for f in job["result"]["files"]}
        c = boot_consts()
        # exactly the embedded, verified components were delivered and verified on the PC
        assert files["bootloader.bin"]["sha256"] == c["bootloader"][2] and files["bootloader.bin"]["bytes"] == int(c["bootloader"][1])
        assert files["partitions.bin"]["sha256"] == c["partitions"][2] and files["boot_app0.bin"]["sha256"] == c["boot_app0"][2]
        assert files["firmware.bin"]["address"] == "0x10000" and files["firmware.bin"]["bytes"] == len(stack.compiler.esp_bin)
        assert job["result"]["verified"]
    finally:
        r.stop()


def test_esp32_app_only_update_when_full_image_is_false(stack, tmp_path):
    r = esp_runner(stack, tmp_path, "esp2")
    try:
        out = stack.mcp.call("build_and_flash", sketch=BLINK, board="esp32-wroom-32", full_image=False, boot_log_seconds=0)
        assert out["ok"] and out["build"]["full_image"] is False
        job = wait_job(stack.mcp, out["job"]["job_id"])
        assert job["status"] == "completed", job
        assert [f["filename"] for f in job["result"]["files"]] == ["firmware.bin"]
    finally:
        r.stop()


def test_app_larger_than_the_app_partition_is_refused_before_any_job(stack, tmp_path):
    r = esp_runner(stack, tmp_path, "esp3")
    try:
        out = stack.mcp.call("build_and_flash", sketch=BLINK + "// BIG_APP\n", board="esp32-wroom-32")
        assert not out["ok"] and out["error"]["code"] == "MANIFEST_INVALID" and "1.25 MB" in out["error"]["message"]
    finally:
        r.stop()


def test_third_party_libraries_are_forwarded_as_libraries_txt(stack):
    stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-uno", libraries=["Adafruit NeoPixel", "DHT sensor library@1.4.6"])
    sent = stack.compiler.requests[-1]
    lib = next(f for f in sent["files"] if f["name"] == "libraries.txt")
    assert lib["content"] == "Adafruit NeoPixel\nDHT sensor library@1.4.6\n"
    stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-uno")
    assert not any(f["name"] == "libraries.txt" for f in stack.compiler.requests[-1]["files"])


def test_library_names_that_could_inject_lines_or_paths_are_rejected(stack):
    n = len(stack.compiler.requests)
    for bad in (["x\nmalicious"], ["../evil"], ["https://evil.example/x.zip"], ["a;b"], [""], ["l" + str(i) for i in range(11)]):
        assert stack.mcp.call("compile_firmware", sketch=BLINK, board="arduino-uno", libraries=bad)["ok"] is False, bad
    assert len(stack.compiler.requests) == n  # nothing reached the build service


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


# ------------------------------------------------------------ build history / cache / re-flash
def _wait_single(stack):
    import time

    deadline = time.time() + 20
    while time.time() < deadline and stack.mcp.call("list_devices")["situation"] != "single_device":
        time.sleep(0.3)


def test_builds_are_recorded_deduplicated_and_listed_as_metadata_only(stack):
    src = BLINK + "// history-1\n"
    a = stack.mcp.call("compile_firmware", sketch=src, board="arduino-uno", title="blink 500", libraries=["Servo"])
    assert a["ok"] and a["seen_before"] is False and a["build_id"].startswith("bld_")
    b = stack.mcp.call("compile_firmware", sketch=src, board="arduino-uno", libraries=["Servo"])
    assert b["build_id"] == a["build_id"] and b["seen_before"] is True and b["previous_builds"] == 1
    assert b["output_changed_since_last_build"] is False
    other = stack.mcp.call("compile_firmware", sketch=src, board="arduino-mega2560", libraries=["Servo"])
    assert other["build_id"] != a["build_id"]  # board is part of the cache key
    rows = stack.mcp.call("list_builds", limit=40)["builds"]
    mine = next(r for r in rows if r["build_id"] == a["build_id"])
    assert mine["title"] == "blink 500" and mine["build_count"] == 2 and mine["flash_count"] == 0
    assert mine["libraries"] == ["Servo"] and mine["sha256"] == a["sha256"] and mine["size_bytes"] == a["size_bytes"]
    blob = json.dumps(rows)
    assert "intel_hex" not in blob and ":00000001FF" not in blob  # no firmware in the history
    megas = stack.mcp.call("list_builds", board="arduino-mega2560")["builds"]
    assert other["build_id"] in [r["build_id"] for r in megas] and all(r["board"] == "arduino-mega2560" for r in megas)


def test_failed_compiles_are_not_recorded(stack):
    before = stack.mcp.call("list_builds", limit=40)["count"]
    assert stack.mcp.call("compile_firmware", sketch="undefined_fn();", board="arduino-uno")["ok"] is False
    assert stack.mcp.call("list_builds", limit=40)["count"] == before


def test_flash_build_reflashes_a_previous_build_and_updates_counters(stack, tmp_path):
    r = AgentRunner(stack, tmp_path / "rf", "avr").start()
    try:
        _wait_single(stack)
        first = stack.mcp.call("build_and_flash", sketch=BLINK + "// rf\n", board="arduino-uno", boot_log_seconds=0)
        assert first["ok"] and first["build"]["seen_before"] is False
        assert wait_job(stack.mcp, first["job"]["job_id"])["status"] == "completed"
        bid = first["build"]["build_id"]
        again = stack.mcp.call("flash_build", build_id=bid, boot_log_seconds=0)
        assert again["ok"], again
        assert again["build"]["build_id"] == bid and again["build"]["sha256"] == first["build"]["sha256"]
        assert again["job"]["job_id"] != first["job"]["job_id"]
        job = wait_job(stack.mcp, again["job"]["job_id"])
        assert job["status"] == "completed" and job["flash_confirmed"] is True and job["result"]["verified"]
        row = next(x for x in stack.mcp.call("list_builds", limit=40)["builds"] if x["build_id"] == bid)
        assert row["flash_count"] == 2 and row["build_count"] == 2 and row["last_job_id"] == again["job"]["job_id"]
    finally:
        r.stop()


def test_flash_build_refuses_when_the_rebuild_differs_unless_allowed(stack, tmp_path):
    r = AgentRunner(stack, tmp_path / "ch", "avr").start()
    original = stack.compiler.avr_hex
    try:
        _wait_single(stack)
        first = stack.mcp.call("build_and_flash", sketch=BLINK + "// changed\n", board="arduino-uno", boot_log_seconds=0)
        bid = first["build"]["build_id"]
        wait_job(stack.mcp, first["job"]["job_id"])
        # the toolchain / an unpinned library changed: same source, different output
        stack.compiler.avr_hex = original.replace(":10000000", ":10000000").replace("0001020304050607", "0706050403020100", 1)
        refused = stack.mcp.call("flash_build", build_id=bid)
        assert refused["ok"] is False and refused["error"]["code"] == "BUILD_CHANGED"
        assert not any(j["job_id"] != first["job"]["job_id"] and j["board"] == "arduino-uno" and "build_" in j["job_id"] and j["created_at"] > first["job"]["created_at"] for j in stack.mcp.call("get_flash_history", limit=10)["jobs"])
        allowed = stack.mcp.call("flash_build", build_id=bid, allow_changed=True, boot_log_seconds=0)
        assert allowed["ok"] and allowed["build"]["sha256"] != first["build"]["sha256"]
        assert wait_job(stack.mcp, allowed["job"]["job_id"])["status"] == "completed"
        row = next(x for x in stack.mcp.call("list_builds", limit=40)["builds"] if x["build_id"] == bid)
        assert row["sha256"] == allowed["build"]["sha256"]  # record follows the new output
    finally:
        stack.compiler.avr_hex = original
        r.stop()


def test_flash_build_unknown_malformed_and_delete(stack):
    assert stack.mcp.call("flash_build", build_id="bld_000000000000")["error"]["code"] == "BUILD_NOT_FOUND"
    assert stack.mcp.call("flash_build", build_id="../../x")["ok"] is False
    a = stack.mcp.call("compile_firmware", sketch=BLINK + "// del\n", board="arduino-uno")
    assert stack.mcp.call("delete_build", build_id=a["build_id"])["deleted"] is True
    assert stack.mcp.call("delete_build", build_id=a["build_id"])["deleted"] is False
    assert all(b["build_id"] != a["build_id"] for b in stack.mcp.call("list_builds", limit=40)["builds"])


def test_history_keeps_only_the_latest_40_builds(stack):
    ids = [stack.mcp.call("compile_firmware", sketch=f"{BLINK}// prune {i}\n", board="arduino-uno")["build_id"] for i in range(43)]
    kept = {b["build_id"] for b in stack.mcp.call("list_builds", limit=40)["builds"]}
    assert len(kept) == 40 and ids[-1] in kept and ids[0] not in kept
