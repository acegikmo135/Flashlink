"""Qt application shell: main window, tray icon, autostart, device-change hook."""
from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QAbstractNativeEventFilter, QLockFile, QObject, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QColor, QFont, QIcon, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QApplication, QHBoxLayout, QMainWindow, QMenu, QPushButton, QStackedWidget, QSystemTrayIcon, QVBoxLayout, QWidget

from app.core.agent import Agent
from app.core.config import APP_NAME, SettingsStore, data_dir
from app.hardware.devices import HardwareManager

from . import theme
from .pages import ActivityPage, DashboardPage, DevicePage, PairingPage, SettingsPage
from .widgets import label


def make_icon(size: int = 64, color: str = theme.FG, bg: str | None = None) -> QIcon:
    pm = QPixmap(size, size)
    pm.fill(QColor(bg) if bg else Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    pen = QPen(QColor(color))
    pen.setWidthF(size * 0.085)
    p.setPen(pen)
    m = size * 0.22
    p.drawRect(int(m), int(m), int(size - 2 * m), int(size - 2 * m))
    p.setBrush(QColor(color))
    c = size * 0.5
    r = size * 0.1
    p.drawEllipse(int(c - r), int(c - r), int(2 * r), int(2 * r))
    p.end()
    return QIcon(pm)


def set_autostart(enabled: bool) -> None:
    """Per-user 'start with Windows' via HKCU\\...\\Run (no admin rights needed)."""
    if sys.platform != "win32":
        return
    import winreg

    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
    try:
        if enabled:
            exe = sys.executable if getattr(sys, "frozen", False) else f'"{sys.executable}" "{Path(__file__).resolve().parents[2] / "run.py"}"'
            cmd = f'"{exe}" --minimized' if getattr(sys, "frozen", False) else f"{exe} --minimized"
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except FileNotFoundError:
                pass
    finally:
        winreg.CloseKey(key)


class Bridge(QObject):
    changed = Signal()


class _DeviceChange(QAbstractNativeEventFilter):
    """Windows WM_DEVICECHANGE → immediate re-scan (polling remains as a fallback)."""

    def __init__(self, cb) -> None:
        super().__init__()
        self.cb = cb

    def nativeEventFilter(self, event_type, message):  # noqa: N802
        if sys.platform == "win32" and event_type == b"windows_generic_MSG":
            try:
                import ctypes
                from ctypes import wintypes

                msg = wintypes.MSG.from_address(int(message))
                if msg.message == 0x0219 and msg.wParam in (0x8000, 0x8004):  # DBT_DEVICEARRIVAL / REMOVECOMPLETE
                    self.cb()
            except Exception:
                pass
        return False, 0


class MainWindow(QMainWindow):
    def __init__(self, agent: Agent, hw: HardwareManager) -> None:
        super().__init__()
        self.agent, self.hw = agent, hw
        self.setWindowTitle("MCU Bridge")
        self.setWindowIcon(make_icon(64))
        self.resize(1000, 700)
        self.setMinimumSize(820, 560)
        root = QWidget()
        root.setObjectName("root")
        self.setCentralWidget(root)
        hl = QHBoxLayout(root)
        hl.setContentsMargins(0, 0, 0, 0)
        hl.setSpacing(0)
        self.sidebar = QWidget()
        self.sidebar.setObjectName("sidebar")
        self.sidebar.setFixedWidth(184)
        sl = QVBoxLayout(self.sidebar)
        sl.setContentsMargins(0, 22, 0, 16)
        sl.setSpacing(2)
        brand = label("MCU BRIDGE", "brand")
        brand.setContentsMargins(20, 0, 0, 18)
        sl.addWidget(brand)
        self.navs: list[QPushButton] = []
        for i, name in enumerate(["Overview", "Activity", "Settings"]):
            b = QPushButton(name)
            b.setObjectName("nav")
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda _=False, i=i: self.go(i))
            sl.addWidget(b)
            self.navs.append(b)
        sl.addStretch(1)
        self.foot = label("", "dim")
        self.foot.setContentsMargins(20, 0, 8, 0)
        sl.addWidget(self.foot)
        hl.addWidget(self.sidebar)

        self.stack = QStackedWidget()
        self.pairing = PairingPage(agent)
        self.dash = DashboardPage(agent)
        self.activity = ActivityPage(agent)
        self.device = DevicePage(agent, hw)
        self.settings = SettingsPage(agent, hw, set_autostart)
        for w in (self.dash, self.activity, self.settings, self.device, self.pairing):
            self.stack.addWidget(w)
        hl.addWidget(self.stack, 1)
        self.dash.open_device.connect(self.show_device)
        self.device.back.connect(lambda: self.go(0))
        self._section = 0
        self.go(0)
        self._last_job_sig = ""

    # indices: 0 dash, 1 activity, 2 settings, 3 device, 4 pairing
    def go(self, i: int) -> None:
        self._section = i
        self.stack.setCurrentIndex(i)
        for k, b in enumerate(self.navs):
            b.setProperty("active", "true" if k == i else "false")
            b.style().unpolish(b)
            b.style().polish(b)
        self.refresh()

    def show_device(self, dev_id: str) -> None:
        self.device.show_device(dev_id)
        self._section = 3
        self.stack.setCurrentIndex(3)
        for b in self.navs:
            b.setProperty("active", "false")
            b.style().unpolish(b)
            b.style().polish(b)

    def refresh(self) -> None:
        st = self.agent.state
        needs_pairing = st.connection in ("unpaired", "pairing", "revoked") or (st.connection == "offline" and not self.agent.creds.load())
        self.sidebar.setVisible(not needs_pairing)
        if needs_pairing:
            self.stack.setCurrentIndex(4)
            self.pairing.refresh()
            return
        if self.stack.currentIndex() == 4:
            self.stack.setCurrentIndex(self._section if self._section != 3 else 0)
        cur = self.stack.currentWidget()
        if hasattr(cur, "refresh"):
            cur.refresh()  # type: ignore[attr-defined]
        active = [j for j in st.jobs if not j.finished]
        self.foot.setText(("● " + ("flashing" if active else st.connection)) if st.connection != "connected" or active else "")


def run_gui(store: SettingsStore, hw: HardwareManager, agent: Agent, start_hidden: bool = False) -> int:
    import asyncio
    import threading

    app = QApplication(sys.argv[:1])
    app.setApplicationName("MCU Bridge")
    app.setQuitOnLastWindowClosed(False)
    app.setStyleSheet(theme.QSS)
    f = QFont()
    f.setPointSize(10)
    app.setFont(f)

    lock = QLockFile(str(data_dir() / "app.lock"))
    lock.setStaleLockTime(0)
    if not lock.tryLock(100):
        return 0  # already running

    bridge = Bridge()
    agent.on_change = bridge.changed.emit
    win = MainWindow(agent, hw)
    bridge.changed.connect(win.refresh, Qt.QueuedConnection)
    ticker = QTimer()
    ticker.timeout.connect(win.refresh)
    ticker.start(1000)  # relative timestamps, tray tooltip

    tray = QSystemTrayIcon(make_icon(64), win)
    menu = QMenu()
    show = QAction("Open MCU Bridge")
    show.triggered.connect(lambda: (win.showNormal(), win.activateWindow()))
    status = QAction("Starting…")
    status.setEnabled(False)
    quit_ = QAction("Quit")
    menu.addAction(show)
    menu.addAction(status)
    menu.addSeparator()
    menu.addAction(quit_)
    tray.setContextMenu(menu)
    tray.activated.connect(lambda r: (win.showNormal(), win.activateWindow()) if r in (QSystemTrayIcon.Trigger, QSystemTrayIcon.DoubleClick) else None)
    tray.show()

    def update_tray() -> None:
        st = agent.state
        active = [j for j in st.jobs if not j.finished]
        txt = f"Flashing {active[-1].firmware}…" if active else {"connected": "Connected", "offline": "Offline — reconnecting", "pairing": "Waiting for pairing"}.get(st.connection, st.connection.title())
        n = len([d for d in st.devices if d["supported"]])
        status.setText(f"{txt} · {n} device{'s' if n != 1 else ''}")
        tray.setToolTip("MCU Bridge — " + status.text())

    bridge.changed.connect(update_tray, Qt.QueuedConnection)
    prev_jobs: dict[str, str] = {}

    def notify() -> None:
        for j in agent.state.jobs[-5:]:
            if j.finished and prev_jobs.get(j.job_id) != j.status:
                prev_jobs[j.job_id] = j.status
                if j.finished_at and j.finished_at > __import__("time").time() - 10:
                    ok = j.status == "completed"
                    tray.showMessage("Flash " + ("completed" if ok else "failed"), f"{j.firmware} → {j.target}" + ("" if ok else f"\n{j.error_code}"), QSystemTrayIcon.Information if ok else QSystemTrayIcon.Warning, 5000)

    bridge.changed.connect(notify, Qt.QueuedConnection)

    filt = _DeviceChange(agent.rescan_now)
    app.installNativeEventFilter(filt)

    def quit_app() -> None:
        agent.stop()
        tray.hide()
        app.quit()

    quit_.triggered.connect(quit_app)

    t = threading.Thread(target=lambda: asyncio.run(agent.run()), name="agent", daemon=True)
    t.start()

    def closeEvent(ev) -> None:  # close-to-tray
        ev.ignore()
        win.hide()

    win.closeEvent = closeEvent  # type: ignore[method-assign]
    if not start_hidden:
        win.show()
    code = app.exec()
    lock.unlock()
    return code
