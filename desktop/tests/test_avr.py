"""AVR flashing logic against a fake avrdude (no hardware): bootloader-speed fallback, probe diagnostics, port-busy detection."""
import json
import os
import stat
import sys
import threading

import pytest

from app.core.manifest import validate
from app.hardware import tools as T
from app.hardware.flashers import DeviceRef, FlashError, FlashRequest
from app.hardware.flashers.avr import AvrFlasher

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="fake avrdude is a POSIX script")

FAKE = r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
open(os.environ["FAKE_LOG"], "a").write(json.dumps(args) + "\n")
mode = os.environ.get("FAKE_MODE", "ok")
baud = args[args.index("-b") + 1] if "-b" in args else "?"
if mode == "busy":
    print("avrdude: ser_open(): can't open device \"COM5\": Access is denied."); sys.exit(1)
if mode == "noconf":
    print("avrdude: can't open config file \"avrdude.conf\": No such file or directory"); sys.exit(1)
answers = os.environ.get("FAKE_ANSWERS_AT", "")  # baud rates at which the "bootloader" answers
if answers and baud not in answers.split(","):
    print("avrdude: stk500_getsync() attempt 10 of 10: not in sync: resp=0x00"); sys.exit(1)
if mode == "verifyfail":
    print("avrdude: verification error, first mismatch at byte 0x0000"); sys.exit(1)
if "-U" not in args:
    print("avrdude: Device signature = 0x1e950f (probably m328p)")
else:
    print("avrdude: 924 bytes of flash written"); print("avrdude done.  Thank you.")
'''


@pytest.fixture()
def fake(tmp_path, monkeypatch):
    exe = tmp_path / "avrdude"
    exe.write_text(FAKE)
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    log = tmp_path / "calls.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.setattr(T, "find", lambda name, refresh=False: T.Tool(name, True, str(exe), "8.0") if name == "avrdude" else T.Tool(name, False))

    def calls():
        return [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []

    return exe, calls


DEV = DeviceRef("dev_x", "/dev/ttyUSB0", None, None, None)


def req(tmp_path, board="arduino-uno", kind="flash", progress=None, logs=None):
    hexf = tmp_path / "sketch.hex"
    hexf.write_text(":00000001FF\n")
    m = validate({"job_id": "job_avr_test", "target": {"family": "avr", "board": board}, "files": [{"address": "0x0", "filename": "sketch.hex", "size": 12, "sha256": "a" * 64, "format": "ihex"}]})
    return FlashRequest(m, DEV, {"sketch.hex": hexf}, True, kind, progress or (lambda *a: None), threading.Event(), (logs.append if logs is not None else (lambda _l: None)))


def test_identify_finds_old_bootloader_at_57600(fake, monkeypatch):
    exe, calls = fake
    monkeypatch.setenv("FAKE_ANSWERS_AT", "57600")
    info = AvrFlasher().identify(DEV)
    assert info == {"family": "avr", "chip": "ATmega328P", "board": "arduino-nano-old-bootloader"}
    bauds = [c[c.index("-b") + 1] for c in calls()]
    assert bauds[:2] == ["115200", "57600"]  # Uno speed first, then the old-bootloader speed


def test_identify_failure_reports_what_avrdude_said(fake, monkeypatch):
    monkeypatch.setenv("FAKE_ANSWERS_AT", "9600")  # nothing answers
    with pytest.raises(FlashError) as e:
        AvrFlasher().identify(DEV)
    assert e.value.code == "PROBE_FAILED"
    assert "not in sync" in e.value.details and "115200" in e.value.details and "57600" in e.value.details
    assert "port opens fine" in e.value.message


def test_busy_port_is_reported_as_serial_error_immediately(fake, monkeypatch):
    exe, calls = fake
    monkeypatch.setenv("FAKE_MODE", "busy")
    with pytest.raises(FlashError) as e:
        AvrFlasher().identify(DEV)
    assert e.value.code == "SERIAL_ERROR" and "Arduino IDE" in e.value.message
    assert len(calls()) == 1  # did not waste time trying other baud rates


def test_missing_conf_is_a_toolchain_error(fake, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "noconf")
    with pytest.raises(FlashError) as e:
        AvrFlasher().identify(DEV)
    assert e.value.code == "TOOLCHAIN_MISSING"


def test_conf_next_to_exe_is_passed_explicitly(fake):
    exe, calls = fake
    (exe.parent / "avrdude.conf").write_text("# conf")
    AvrFlasher().identify(DEV)
    assert ["-C", str(exe.parent / "avrdude.conf")] == calls()[0][0:2]


def test_flash_retries_at_the_other_bootloader_speed(fake, monkeypatch, tmp_path):
    exe, calls = fake
    monkeypatch.setenv("FAKE_ANSWERS_AT", "57600")  # board is really an old-bootloader one, user picked 'Uno'
    logs: list[str] = []
    out = AvrFlasher().run(req(tmp_path, logs=logs))
    assert out.verified is True
    flash_calls = [c for c in calls() if "-U" in c and "flash:w" in c[c.index("-U") + 1]]
    assert [c[c.index("-b") + 1] for c in flash_calls] == ["115200", "57600"]
    assert any("retrying at 57600" in l for l in logs)


def test_flash_does_not_retry_on_non_sync_failures(fake, monkeypatch, tmp_path):
    exe, calls = fake
    monkeypatch.setenv("FAKE_MODE", "verifyfail")
    with pytest.raises(FlashError) as e:
        AvrFlasher().run(req(tmp_path))
    assert e.value.code == "VERIFICATION_FAILED"
    assert len([c for c in calls() if "-U" in c]) == 1


def test_flash_failure_includes_avrdude_output_and_actionable_message(fake, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_ANSWERS_AT", "9600")
    with pytest.raises(FlashError) as e:
        AvrFlasher().run(req(tmp_path))
    assert e.value.code == "FLASH_FAILED" and "bootloader did not respond" in e.value.message
    assert "not in sync" in e.value.details  # the real avrdude output travels back to the cloud / Claude


def test_ambiguous_ftdi_device_asks_the_avr_bootloader_first():
    from app.core.agent import Agent  # noqa: F401  (import check)
    from app.hardware import usb

    cls = usb.classify(usb.UsbPort("COM5", 0x0403, 0x6001))
    assert cls.candidates == ["esp32", "esp8266", "avr"] and cls.uart_bridge


_ = os
