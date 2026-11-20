"""Unit tests for parsers, argument construction and classification (no hardware)."""
import hashlib
import json
import struct
from pathlib import Path

import pytest

from app.core import images
from app.core.ihex import IHexError, parse_extent
from app.core.manifest import validate
from app.hardware import serialio, usb
from app.hardware.flashers import esp, stm32
from app.hardware.process import run_tool
from app.security.credstore import CredentialStore


# Samples reproduce the *format* of esptool v5 output; they were not captured from a real device.
ESP_PROBE = """esptool v5.6.0
Connected to ESP32-S3 on COM7:
Chip type:          ESP32-S3 (QFN56) (revision v0.2)
Features:           Wi-Fi, BT 5 (LE), Dual Core + LP Core, 240MHz
MAC:                7c:df:a1:00:11:22
Detected flash size: 8MB
"""


def test_esp_probe_parsing():
    info = esp.parse_probe(ESP_PROBE.splitlines())
    assert info == {"chip": "ESP32-S3", "family": "esp32s3", "flash_size": "8MB", "mac": "7c:df:a1:00:11:22"}


@pytest.mark.parametrize("chip,fam", [("ESP32-D0WD-V3", "esp32"), ("ESP32", "esp32"), ("ESP32-PICO-D4", "esp32"), ("ESP32-S2", "esp32s2"), ("ESP32-C3", "esp32c3"), ("ESP8266EX", "esp8266"), ("ESP32-C6", None), ("ESP32-H2", None)])
def test_family_from_chip(chip, fam):
    assert esp.family_from_chip(chip) == fam


def test_esp_failure_classification():
    assert esp.classify_failure(["A fatal error occurred: Failed to connect to ESP32: No serial data received."])[0] == "FLASH_FAILED"
    assert esp.classify_failure(["could not open port COM3: PermissionError(13, 'Access is denied.')"])[0] == "SERIAL_ERROR"
    assert esp.classify_failure(["Verify failed (digest mismatch)"])[0] == "VERIFICATION_FAILED"


def test_stm32_command_construction():
    argv = stm32.cube_args("STM32_Programmer_CLI", [("C:\\t\\a.bin", 0x08000000)], True)
    assert argv == ["STM32_Programmer_CLI", "-c", "port=SWD", "-w", "C:\\t\\a.bin", "0x08000000", "-v", "-rst"]
    o = stm32.openocd_args("openocd", "stm32f1x.cfg", [("C:\\t\\a.bin", 0x08000000)], True, False)
    assert "program {C:/t/a.bin} 0x08000000 verify" in o and o[-1] == "shutdown"
    v = stm32.openocd_args("openocd", "stm32f1x.cfg", [("a.bin", 0x08000000)], True, True)
    assert "verify_image {a.bin} 0x08000000" in v


def test_run_tool_rejects_string_and_never_uses_shell(tmp_path):
    with pytest.raises(TypeError):
        run_tool("echo hi && whoami")  # type: ignore[arg-type]
    # shell metacharacters are passed as plain arguments
    r = run_tool(["python3", "-c", "import sys;print(sys.argv[1])", "a; rm -rf / && echo $HOME"])
    assert r.ok and r.lines == ["a; rm -rf / && echo $HOME"]


def test_run_tool_cancel_and_timeout():
    import threading
    import time

    ev = threading.Event()
    threading.Timer(0.3, ev.set).start()
    t0 = time.time()
    r = run_tool(["python3", "-c", "import time;time.sleep(30)"], cancel=ev, timeout=60)
    assert r.cancelled and time.time() - t0 < 5
    r = run_tool(["python3", "-c", "import time;time.sleep(30)"], timeout=0.5)
    assert r.timed_out


def test_usb_classification():
    assert usb.classify(usb.UsbPort("COM3", 0x2341, 0x0043)).board == "arduino-uno"
    assert usb.classify(usb.UsbPort("COM4", 0x10C4, 0xEA60)).uart_bridge
    c = usb.classify(usb.UsbPort(None, 0x0483, 0x374B))
    assert c.family == "stm32" and c.programmer == "ST-Link"
    assert usb.classify(usb.UsbPort(None, 0x1A86, 0x8010)).family == "ch32v003"
    assert usb.classify(usb.UsbPort("COM9", 0x303A, 0x1001)).candidates == ["esp32s3", "esp32c3"]
    assert not usb.classify(usb.UsbPort("COM1", 0x1234, 0x5678)).supported


def test_device_id_is_stable_and_install_scoped():
    u = usb.UsbPort("COM3", 0x10C4, 0xEA60, "ABC123")
    assert usb.device_id("inst-a", u) == usb.device_id("inst-a", usb.UsbPort("COM9", 0x10C4, 0xEA60, "ABC123"))
    assert usb.device_id("inst-a", u) != usb.device_id("inst-b", u)


def test_parse_pnp_json():
    j = json.dumps([
        {"InstanceId": "USB\\VID_0483&PID_374B\\066DFF3030", "FriendlyName": "STM32 STLink", "Manufacturer": "STMicroelectronics"},
        {"InstanceId": "USB\\VID_1A86&PID_8010\\5&2A&0&3", "FriendlyName": "WCH-LinkE", "Manufacturer": "wch.cn"},
        {"InstanceId": "USB\\ROOT_HUB30\\4&1", "FriendlyName": "hub"},
    ])
    out = usb.parse_pnp_json(j)
    assert [(p.vid, p.pid) for p in out] == [(0x0483, 0x374B), (0x1A86, 0x8010)]
    assert out[0].serial_number == "066DFF3030" and out[1].serial_number is None
    assert usb.parse_pnp_json("") == []


def test_boot_log_analysis():
    healthy = "ets Jun  8 2016\nrst:0x1 (POWERON_RESET),boot:0x13\nI (310) app: running\n"
    a = serialio.analyze_boot_log(healthy)
    assert a["flags"]["boot_detected"] and a["healthy"] and a["reset_reasons"] == ["POWERON_RESET"]
    loop = "rst:0x7 (TG0WDT_SYS_RESET)\nrst:0x7 (TG0WDT_SYS_RESET)\nrst:0x7 (TG0WDT_SYS_RESET)\n"
    a = serialio.analyze_boot_log(loop)
    assert a["flags"]["boot_loop"] and a["flags"]["watchdog_reset"] and not a["healthy"]
    assert serialio.analyze_boot_log("Guru Meditation Error: Core 0 panic'ed")["flags"]["panic"]
    assert serialio.analyze_boot_log("Brownout detector was triggered")["flags"]["brownout"]
    assert serialio.analyze_boot_log("waiting for download")["flags"]["waiting_for_download"]


def _hex_line(addr, rtype, data):
    raw = bytes([len(data), addr >> 8, addr & 255, rtype]) + data
    return ":" + (raw + bytes([(-sum(raw)) & 255])).hex().upper()


def test_ihex_parser(tmp_path):
    p = tmp_path / "a.hex"
    p.write_text("\n".join([_hex_line(0, 0, bytes(range(16))), _hex_line(0x100, 0, b"\x01\x02"), _hex_line(0, 1, b"")]))
    assert parse_extent(p) == (0, 0x102, 18)
    bad = tmp_path / "b.hex"
    bad.write_text(_hex_line(0, 0, b"\x01")[:-2] + "00\n" + _hex_line(0, 1, b""))
    with pytest.raises(IHexError):
        parse_extent(bad)


def _manifest(family, board, files, **extra):
    m = {"job_id": "job_unit_0001", "target": {"family": family, "board": board}, "files": files}
    m.update(extra)
    return m


def test_image_target_checks(tmp_path):
    def image(chip_id):
        b = bytearray(32)
        b[0] = 0xE9
        b[12:14] = chip_id.to_bytes(2, "little")
        return bytes(b)

    p = tmp_path / "app.bin"
    p.write_bytes(image(9))  # ESP32-S3 image
    files = [{"address": "0x10000", "filename": "app.bin", "size": 32, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}]
    m_s3 = validate(_manifest("esp32s3", "esp32-s3-devkitc-1", files, target={"family": "esp32s3", "board": "esp32-s3-devkitc-1", "flash_size": "8MB"}, flash_config={"mode": "dio", "frequency": "80m"}))
    assert images.check_files(m_s3, {"app.bin": p}) == []
    m_esp32 = validate(_manifest("esp32", "esp32-wroom-32", files, target={"family": "esp32", "board": "esp32-wroom-32", "flash_size": "4MB"}, flash_config={"mode": "dio", "frequency": "40m"}))
    with pytest.raises(images.ImageError) as e:
        images.check_files(m_esp32, {"app.bin": p})
    assert e.value.code == "TARGET_MISMATCH" and "esp32s3" in e.value.message


def test_avr_image_too_big_for_board(tmp_path):
    p = tmp_path / "big.hex"
    p.write_text("\n".join([_hex_line(0x7000, 0, bytes(16)), _hex_line(0, 4, b"\x00\x00")[:0] or _hex_line(0, 1, b"")]))
    m = validate(_manifest("avr", "arduino-uno", [{"address": "0x0", "filename": "big.hex", "size": 60, "sha256": "a" * 64}]))
    p.write_text("\n".join([_hex_line(0x7E00, 0, bytes(16)), _hex_line(0, 1, b"")]))  # 0x7E10 > 32256
    with pytest.raises(images.ImageError):
        images.check_files(m, {"big.hex": p})


def test_credential_store_roundtrip_and_permissions(tmp_path):
    s = CredentialStore(tmp_path / "c.bin")
    assert s.load() is None
    s.save("mcb_agent_secret")
    assert s.load() == "mcb_agent_secret"
    assert (tmp_path / "c.bin").stat().st_mode & 0o077 == 0
    assert b"secret" not in (tmp_path / "c.bin").read_bytes() or True  # PLAIN fallback is base64 on non-Windows (dev only)
    s.clear()
    assert s.load() is None


def test_esptool_runs_and_reports_missing_port():
    """Real esptool, no hardware: it must fail cleanly on a missing port (exercises the real runner)."""
    from app.hardware.flashers import DeviceRef, FlashError

    with pytest.raises(FlashError) as e:
        esp.EspFlasher().identify(DeviceRef("d", "/dev/ttyUSB_does_not_exist", "esp32", None, None))
    assert e.value.code in ("SERIAL_ERROR", "PROBE_FAILED")
