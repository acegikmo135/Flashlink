"""Renders every page offscreen and writes screenshots for visual inspection."""
import os
import time
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
OUT = Path(os.environ.get("MCUB_SHOTS", "/tmp/mcub-shots"))


def test_pages_render(tmp_path, monkeypatch):
    monkeypatch.setenv("MCUBRIDGE_HOME", str(tmp_path))
    monkeypatch.setenv("MCUBRIDGE_SIMULATE", "1")
    monkeypatch.setenv("MCUBRIDGE_SIM_DEVICES", "esp32,avr")
    from PySide6.QtTest import QTest
    from PySide6.QtWidgets import QApplication

    from app.core.agent import Agent, JobView
    from app.core.config import SettingsStore
    from app.hardware.devices import HardwareManager
    from app.security.credstore import CredentialStore
    from app.ui import theme
    from app.ui.app import MainWindow

    app = QApplication.instance() or QApplication([])
    theme.apply("dark", app)
    store = SettingsStore(tmp_path / "s.json")
    creds = CredentialStore(tmp_path / "c.bin")
    hw = HardwareManager(store)
    agent = Agent(store, creds, hw)
    devs = hw.scan()
    agent.state.devices = [{**d.to_wire(), "label": d.label} for d in devs]
    agent.state.connection = "pairing"
    agent.state.pairing = {"code": "K7QM-X2PD", "url": "https://mcu-bridge.example.workers.dev/pair?code=K7QM-X2PD", "expires_at": time.time() + 540}
    win = MainWindow(agent, hw)
    win.resize(1000, 700)
    OUT.mkdir(parents=True, exist_ok=True)
    win.show()
    win.refresh()
    QTest.qWait(700)
    win.grab().save(str(OUT / "1-pairing.png"))

    creds.save("mcb_agent_x")
    store.settings.account_email = "you@example.com"
    agent.state.account_email = "you@example.com"
    agent.state.connection = "connected"
    agent.state.pairing = None
    j = JobView("job_demo_0001", "flash", "bootloader.bin, firmware.bin", "esp32-wroom-32 (esp32)", devs[0].id, "SIM1")
    j.status, j.phase, j.transfer_pct, j.flash_pct, j.message = "flashing", "flashing", 100, 62, "Writing at 0x00010000 62%"
    j.log.extend(["esptool v5.6.0", "Connected to ESP32 on COM3", "Writing at 0x00010000... 62%"])
    done = JobView("job_demo_0000", "flash", "blink.bin", "esp32-wroom-32 (esp32)", devs[0].id, "SIM1", "completed", "done", 100, 100, 100, "", True)
    done.finished_at = time.time() - 120
    agent.state.jobs = [done, j]
    win.go(0)
    QTest.qWait(700)
    win.grab().save(str(OUT / "2-dashboard.png"))
    win.go(1)
    QTest.qWait(700)
    win.grab().save(str(OUT / "3-activity.png"))
    win.go(2)
    QTest.qWait(700)
    win.grab().save(str(OUT / "4-tools.png"))
    win.go(3)
    QTest.qWait(700)
    win.grab().save(str(OUT / "4b-account.png"))
    win.go(4)
    QTest.qWait(700)
    win.grab().save(str(OUT / "4c-settings.png"))
    win.show_device(devs[0].id)
    win.refresh()
    QTest.qWait(700)
    win.grab().save(str(OUT / "5-device.png"))
    assert (OUT / "5-device.png").stat().st_size > 5000
    # light theme (runtime switch)
    theme.apply("light", app)
    win.go(0)
    QTest.qWait(700)
    win.grab().save(str(OUT / "6-dashboard-light.png"))
    win.go(2)
    QTest.qWait(700)
    win.grab().save(str(OUT / "7-tools-light.png"))
    assert theme.MODE == "light" and theme.BG == "#f2f2f7"
    theme.apply("dark", app)
