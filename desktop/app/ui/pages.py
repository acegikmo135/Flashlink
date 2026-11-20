"""Application pages: pairing, dashboard, device detail, activity, settings."""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from PySide6.QtCore import QObject, Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QGuiApplication
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QComboBox, QFrame, QGridLayout, QHBoxLayout, QHeaderView, QLabel, QMessageBox,
                               QPlainTextEdit, QPushButton, QScrollArea, QSpinBox, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget)

from app.core.agent import Agent, JobView
from app.core.config import APP_VERSION, log_dir
from app.hardware import serialio, tools
from app.hardware.devices import HardwareManager

from . import theme
from .widgets import Bar, Qr, StatusChip, card, hline, label


def ago(t: float | None) -> str:
    if not t:
        return "—"
    s = max(0, int(time.time() - t))
    if s < 5:
        return "just now"
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60}m ago"
    if s < 86400:
        return f"{s // 3600}h ago"
    return f"{s // 86400}d ago"


def page_shell(title: str, subtitle: str = "") -> tuple[QWidget, QVBoxLayout, QLabel]:
    w = QWidget()
    w.setObjectName("page")
    lay = QVBoxLayout(w)
    lay.setContentsMargins(36, 30, 36, 24)
    lay.setSpacing(16)
    t = label(title, "h1")
    lay.addWidget(t)
    sub = label(subtitle, "muted", wrap=True)
    if subtitle:
        lay.addWidget(sub)
    return w, lay, sub


def scrollable(inner: QWidget) -> QScrollArea:
    sa = QScrollArea()
    sa.setWidgetResizable(True)
    sa.setFrameShape(QFrame.NoFrame)
    sa.setWidget(inner)
    inner.setObjectName("page")
    return sa


def style_table(t: QTableWidget) -> None:
    t.setSelectionBehavior(QAbstractItemView.SelectRows)
    t.setSelectionMode(QAbstractItemView.SingleSelection)
    t.setEditTriggers(QAbstractItemView.NoEditTriggers)
    t.setShowGrid(False)
    t.verticalHeader().setVisible(False)
    t.horizontalHeader().setStretchLastSection(True)
    t.horizontalHeader().setHighlightSections(False)
    t.horizontalHeader().setDefaultAlignment(Qt.AlignLeft | Qt.AlignVCenter)
    t.setFocusPolicy(Qt.NoFocus)


# ------------------------------------------------------------------ pairing

class PairingPage(QWidget):
    def __init__(self, agent: Agent) -> None:
        super().__init__()
        self.agent = agent
        self.setObjectName("page")
        outer = QHBoxLayout(self)
        outer.setContentsMargins(48, 40, 48, 40)
        outer.addStretch(1)
        col = QVBoxLayout()
        col.setSpacing(14)
        col.addWidget(label("MCU BRIDGE", "brand"))
        col.addSpacing(10)
        self.title = label("Connect this PC", "h1")
        col.addWidget(self.title)
        self.sub = label("Open the link below, sign in and approve this device. Credentials stay on this PC, protected by Windows.", "muted", wrap=True)
        self.sub.setMaximumWidth(420)
        col.addWidget(self.sub)
        row = QHBoxLayout()
        row.setSpacing(28)
        self.qr = Qr(168)
        row.addWidget(self.qr, 0, Qt.AlignTop)
        right = QVBoxLayout()
        right.setSpacing(6)
        right.addWidget(label("PAIRING CODE", "h2"))
        self.code = label("— — — —", "code")
        right.addWidget(self.code)
        self.url = label("", "mono", wrap=True)
        self.url.setMaximumWidth(300)
        right.addWidget(self.url)
        btns = QHBoxLayout()
        self.open_btn = QPushButton("Open in browser")
        self.open_btn.setObjectName("primary")
        self.open_btn.clicked.connect(self._open)
        self.copy_btn = QPushButton("Copy link")
        self.copy_btn.clicked.connect(lambda: QGuiApplication.clipboard().setText(self.url.text()))
        btns.addWidget(self.open_btn)
        btns.addWidget(self.copy_btn)
        btns.addStretch(1)
        right.addSpacing(6)
        right.addLayout(btns)
        right.addStretch(1)
        row.addLayout(right)
        col.addLayout(row)
        self.status = label("", "dim", wrap=True)
        col.addSpacing(6)
        col.addWidget(self.status)
        col.addStretch(1)
        outer.addLayout(col)
        outer.addStretch(1)
        self._shown = ""

    def _open(self) -> None:
        if self.url.text():
            QDesktopServices.openUrl(QUrl(self.url.text()))

    def refresh(self) -> None:
        st = self.agent.state
        p = st.pairing
        if p and p["url"] != self._shown:
            self._shown = p["url"]
            self.qr.set_text(p["url"])
            self.url.setText(p["url"])
        self.code.setText(p["code"] if p else "— — — —")
        server = urlparse(self.agent.store.settings.server_url).netloc
        if st.connection == "revoked":
            self.title.setText("Device was revoked")
            self.status.setText(st.detail + " Starting a new pairing…")
        elif st.connection == "offline":
            self.title.setText("Connect this PC")
            self.status.setText(f"Cannot reach {server}. {st.detail}")
        else:
            self.title.setText("Connect this PC")
            exp = f" · expires in {max(0, int(p['expires_at'] - time.time()) // 60)} min" if p else ""
            self.status.setText(f"Waiting for approval on {server}{exp}")


# ---------------------------------------------------------------- dashboard

class DashboardPage(QWidget):
    open_device = Signal(str)

    def __init__(self, agent: Agent) -> None:
        super().__init__()
        self.agent = agent
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(36, 30, 36, 24)
        lay.setSpacing(16)
        head = QHBoxLayout()
        head.addWidget(label("Overview", "h1"))
        head.addStretch(1)
        self.chip = StatusChip()
        head.addWidget(self.chip)
        lay.addLayout(head)
        self.meta = label("", "muted")
        lay.addWidget(self.meta)
        lay.addSpacing(6)
        lay.addWidget(label("DEVICES", "h2"))
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["DEVICE", "PORT", "STATE", "REMOTE FLASHING", "LAST ACTIVITY"])
        style_table(self.table)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        for i, w in ((1, 70), (2, 100), (3, 140), (4, 100)):
            self.table.horizontalHeader().setSectionResizeMode(i, QHeaderView.Fixed)
            self.table.setColumnWidth(i, w)
        self.table.cellDoubleClicked.connect(self._open_row)
        lay.addWidget(self.table)
        self.empty = label("No microcontroller detected. Connect a board with a USB cable — it appears here automatically.", "dim", wrap=True)
        lay.addWidget(self.empty)
        lay.addWidget(label("LAST ACTIVITY", "h2"))
        self.last = label("No flashing activity yet.", "muted", wrap=True)
        lay.addWidget(self.last)
        lay.addStretch(1)
        self._ids: list[str] = []

    def _open_row(self, row: int, _c: int) -> None:
        if 0 <= row < len(self._ids):
            self.open_device.emit(self._ids[row])

    def device_state(self, d: dict) -> tuple[str, str]:
        for j in reversed(self.agent.state.jobs):
            if j.device_id == d["id"] and not j.finished:
                return ("Verifying" if j.status == "verifying" else "Flashing" if j.status in ("flashing", "transferring") else "Queued"), theme.WARN
        if not d["supported"]:
            return "Unsupported", theme.DIM
        if d["missing"]:
            return "Tool missing", theme.WARN
        if not d["allowed"]:
            return "Locked", theme.MUTED
        return "Ready", theme.OK

    def refresh(self) -> None:
        st = self.agent.state
        colors = {"connected": (theme.OK, "Connected"), "connecting": (theme.WARN, "Connecting"), "offline": (theme.ERR, "Offline"), "pairing": (theme.WARN, "Not paired"), "unpaired": (theme.WARN, "Not paired")}
        c, txt = colors.get(st.connection, (theme.DIM, st.connection.title()))
        self.chip.set(txt, c)
        server = urlparse(self.agent.store.settings.server_url).netloc
        self.meta.setText(f"{st.account_email or 'unknown account'}  ·  {server}  ·  {self.agent.store.settings.device_name}" + (f"  ·  {st.detail}" if st.detail and st.connection != "connected" else ""))
        devs = st.devices
        self._ids = [d["id"] for d in devs]
        self.table.setRowCount(len(devs))
        for r, d in enumerate(devs):
            state, color = self.device_state(d)
            last = max([j.finished_at or j.started_at for j in st.jobs if j.device_id == d["id"]] or [0])
            vals = [f"{d['label']}", d["port"] or "—", state, "On" if d["allowed"] else "Off", ago(last) if last else "—"]
            for ci, v in enumerate(vals):
                it = QTableWidgetItem(v)
                if ci == 2:
                    it.setForeground(__import__("PySide6.QtGui", fromlist=["QColor"]).QColor(color))
                self.table.setItem(r, ci, it)
            self.table.setRowHeight(r, 38)
        self.table.setFixedHeight(34 + 38 * max(len(devs), 1) + 6)
        self.table.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.empty.setVisible(not devs)
        done = [j for j in st.jobs if j.finished]
        if done:
            j = done[-1]
            ok = j.status == "completed"
            self.last.setText(f"{j.firmware} → {j.target}  ·  {'Completed' + (', verified' if j.verified else '') if ok else j.status.replace('_', ' ').title() + (' (' + j.error_code + ')' if j.error_code else '')}  ·  {ago(j.finished_at)}")


# ------------------------------------------------------------ device detail

class SerialBridge(QObject):
    text = Signal(str)
    closed = Signal(str)


class DevicePage(QWidget):
    back = Signal()

    def __init__(self, agent: Agent, hw: HardwareManager) -> None:
        super().__init__()
        self.agent, self.hw = agent, hw
        self.dev_id: str | None = None
        self._stop: threading.Event | None = None
        self.bridge = SerialBridge()
        self.bridge.text.connect(self._append)
        self.bridge.closed.connect(self._serial_closed)
        inner = QWidget()
        lay = QVBoxLayout(inner)
        lay.setContentsMargins(36, 26, 36, 24)
        lay.setSpacing(14)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(scrollable(inner))
        b = QPushButton("← Devices")
        b.setObjectName("link")
        b.clicked.connect(self.back.emit)
        lay.addWidget(b, 0, Qt.AlignLeft)
        self.title = label("", "h1")
        lay.addWidget(self.title)
        self.sub = label("", "muted")
        lay.addWidget(self.sub)
        fr, fl = card()
        self.grid = QGridLayout()
        self.grid.setHorizontalSpacing(28)
        self.grid.setVerticalSpacing(8)
        fl.addLayout(self.grid)
        self.vals: dict[str, QLabel] = {}
        for i, k in enumerate(["Family", "Chip", "Board", "Port", "USB ID", "USB serial", "Flash size", "MAC", "Programmer", "Backend", "Capabilities", "Notes"]):
            self.grid.addWidget(label(k.upper(), "h2"), i, 0, Qt.AlignTop)
            v = label("", None, wrap=True)
            self.vals[k] = v
            self.grid.addWidget(v, i, 1)
        self.grid.setColumnStretch(1, 1)
        lay.addWidget(fr)
        actions = QHBoxLayout()
        self.allow = QCheckBox("Allow remote flashing")
        self.allow.clicked.connect(self._toggle_allow)
        self.ident = QPushButton("Identify chip")
        self.ident.clicked.connect(lambda: self._cmd("identify"))
        self.reset = QPushButton("Reset")
        self.reset.clicked.connect(lambda: self._cmd("reset"))
        actions.addWidget(self.allow)
        actions.addStretch(1)
        self.result = label("", "dim")
        actions.addWidget(self.result)
        actions.addWidget(self.ident)
        actions.addWidget(self.reset)
        lay.addLayout(actions)
        lay.addWidget(label("SERIAL MONITOR", "h2"))
        mrow = QHBoxLayout()
        self.baud = QComboBox()
        self.baud.addItems(["9600", "57600", "74880", "115200", "230400", "460800", "921600"])
        self.baud.setCurrentText("115200")
        self.toggle = QPushButton("Open")
        self.toggle.clicked.connect(self._toggle_serial)
        clr = QPushButton("Clear")
        clr.clicked.connect(lambda: self.mon.clear())
        mrow.addWidget(self.baud)
        mrow.addWidget(self.toggle)
        mrow.addWidget(clr)
        mrow.addStretch(1)
        lay.addLayout(mrow)
        self.mon = QPlainTextEdit()
        self.mon.setObjectName("mono")
        self.mon.setReadOnly(True)
        self.mon.setMaximumBlockCount(2000)
        self.mon.setFixedHeight(170)
        lay.addWidget(self.mon)
        lay.addWidget(label("FLASH HISTORY", "h2"))
        self.hist = QTableWidget(0, 4)
        self.hist.setHorizontalHeaderLabels(["WHEN", "FIRMWARE", "RESULT", "DETAIL"])
        style_table(self.hist)
        self.hist.setFixedHeight(190)
        self.hist.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        lay.addWidget(self.hist)
        lay.addStretch(1)

    def show_device(self, dev_id: str) -> None:
        if self._stop:
            self._stop.set()
        self.dev_id = dev_id
        self.mon.clear()
        self.result.setText("")
        self.refresh()

    def _dev(self) -> dict | None:
        return next((d for d in self.agent.state.devices if d["id"] == self.dev_id), None)

    def refresh(self) -> None:
        d = self._dev()
        if not d:
            self.title.setText("Device disconnected")
            self.sub.setText("Plug the board back in, or return to the device list.")
            return
        u = d["usb"]
        self.title.setText(d["label"])
        self.sub.setText(f"{d['port'] or 'no serial port'}  ·  {'identified by probe' if d['identified'] else 'detected from USB descriptors'}")
        fam = d["family"]
        backend = {"esp": "esptool", "avr": "avrdude", "stm32": "STM32CubeProgrammer / OpenOCD", "ch32v003": "wlink"}.get("esp" if (fam or "").startswith("esp") else fam or "", "decided after identification")
        set_ = {
            "Family": fam or "unknown (run Identify)", "Chip": d["chip"] or "—", "Board": d["board"] or "—", "Port": d["port"] or "—",
            "USB ID": f"{(u['vid'] or '----').upper()}:{(u['pid'] or '----').upper()}", "USB serial": u["serial_number"] or "—",
            "Flash size": d["flash_size"] or "—", "MAC": d["mac"] or "—", "Programmer": d["programmer"] or "USB-UART / native USB",
            "Backend": backend + ("  ·  missing: " + ", ".join(d["missing"]) if d["missing"] else ""),
            "Capabilities": ", ".join(d["capabilities"]) or "none", "Notes": " ".join(d["notes"]) or "—",
        }
        for k, v in set_.items():
            self.vals[k].setText(v)
        self.allow.blockSignals(True)
        self.allow.setChecked(d["allowed"])
        self.allow.setEnabled(d["supported"])
        self.allow.blockSignals(False)
        busy = bool(self.hw.busy.get(d["id"]))
        self.ident.setEnabled(not busy and d["supported"])
        self.reset.setEnabled(not busy and "reset" in d["capabilities"])
        self.toggle.setEnabled("serial" in d["capabilities"] and (not busy or self._stop is not None))
        jobs = [j for j in self.agent.state.jobs if j.device_id == d["id"]][-8:][::-1]
        self.hist.setRowCount(len(jobs))
        for r, j in enumerate(jobs):
            res = "Running" if not j.finished else ("Verified" if j.status == "completed" and j.verified else j.status.replace("_", " ").title())
            for c, v in enumerate([ago(j.finished_at or j.started_at), j.firmware, res, j.error_code or ""]):
                self.hist.setItem(r, c, QTableWidgetItem(v))
            self.hist.setRowHeight(r, 30)

    def _toggle_allow(self, checked: bool) -> None:
        if self.dev_id:
            self.hw.set_allowed(self.dev_id, checked)
            self.agent.rescan_now()

    def _cmd(self, name: str) -> None:
        if not self.dev_id:
            return
        dev_id = self.dev_id
        self.result.setText(f"{name}…")

        def work() -> None:
            try:
                data = self.agent._command(name, dev_id, {})
                msg = ", ".join(f"{k}: {v}" for k, v in data.items() if k in ("chip", "flash_size", "method") and v) or "done"
            except Exception as e:
                msg = getattr(e, "message", str(e))
            self.bridge.closed.emit("\0" + msg)

        threading.Thread(target=work, daemon=True).start()

    def _toggle_serial(self) -> None:
        d = self._dev()
        if self._stop:
            self._stop.set()
            return
        if not d or not d["port"] or self.hw.busy.get(d["id"]):
            return
        stop = self._stop = threading.Event()
        self.toggle.setText("Close")
        port, baud = d["port"], int(self.baud.currentText())
        sim = d["id"].startswith("dev_sim")

        def work() -> None:
            try:
                if sim:
                    while not stop.is_set():
                        self.bridge.text.emit("sim: tick\n")
                        stop.wait(1)
                else:
                    while not stop.is_set():
                        r = serialio.read(port, baud, 0.5, 8192, None, stop, None)
                        if r["text"]:
                            self.bridge.text.emit(r["text"])
                self.bridge.closed.emit("")
            except serialio.SerialError as e:
                self.bridge.closed.emit(str(e))

        threading.Thread(target=work, daemon=True).start()

    def _append(self, text: str) -> None:
        self.mon.moveCursor(self.mon.textCursor().MoveOperation.End)
        self.mon.insertPlainText(text)
        self.mon.verticalScrollBar().setValue(self.mon.verticalScrollBar().maximum())

    def _serial_closed(self, msg: str) -> None:
        if msg.startswith("\0"):
            self.result.setText(msg[1:][:90])
            self.agent.rescan_now()
            return
        self._stop = None
        self.toggle.setText("Open")
        if msg:
            self.result.setText(msg[:90])


# ----------------------------------------------------------------- activity

class JobRow(QWidget):
    def __init__(self, title: str) -> None:
        super().__init__()
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(5)
        row = QHBoxLayout()
        self.name = label(title, "muted")
        self.pct = label("0%", "mono")
        row.addWidget(self.name)
        row.addStretch(1)
        row.addWidget(self.pct)
        lay.addLayout(row)
        self.bar = Bar()
        lay.addWidget(self.bar)

    def set(self, v: float, active: bool, color: str | None = None) -> None:
        self.bar.set(v, color or (theme.FG if active else theme.MUTED))
        self.pct.setText(f"{v:.0f}%")


class ActivityPage(QWidget):
    def __init__(self, agent: Agent) -> None:
        super().__init__()
        self.agent = agent
        inner = QWidget()
        lay = QVBoxLayout(inner)
        lay.setContentsMargins(36, 30, 36, 24)
        lay.setSpacing(14)
        lay.addWidget(label("Activity", "h1"))
        fr, fl = card()
        top = QHBoxLayout()
        self.fw = label("No active job", None)
        self.fw.setStyleSheet("font-size:15px;font-weight:600")
        top.addWidget(self.fw)
        top.addStretch(1)
        self.badge = label("", "muted")
        top.addWidget(self.badge)
        fl.addLayout(top)
        self.target = label("Waiting for Claude to request a flash.", "muted", wrap=True)
        fl.addWidget(self.target)
        fl.addSpacing(6)
        self.r_tx, self.r_fl, self.r_vf = JobRow("Transfer"), JobRow("Flashing"), JobRow("Verification")
        for r in (self.r_tx, self.r_fl, self.r_vf):
            fl.addWidget(r)
        self.msg = label("", "dim", wrap=True)
        fl.addWidget(self.msg)
        self.err = label("", None, wrap=True)
        self.err.setStyleSheet(f"color:{theme.ERR}")
        self.err.hide()
        fl.addWidget(self.err)
        row = QHBoxLayout()
        row.addStretch(1)
        self.cancel = QPushButton("Cancel job")
        self.cancel.setObjectName("danger")
        self.cancel.clicked.connect(self._cancel)
        row.addWidget(self.cancel)
        fl.addLayout(row)
        lay.addWidget(fr)
        lay.addWidget(label("OUTPUT", "h2"))
        self.log = QPlainTextEdit()
        self.log.setObjectName("mono")
        self.log.setReadOnly(True)
        self.log.setMinimumHeight(120)
        self.log.setMaximumHeight(200)
        lay.addWidget(self.log)
        lay.addWidget(label("HISTORY", "h2"))
        self.hist = QTableWidget(0, 5)
        self.hist.setHorizontalHeaderLabels(["WHEN", "FIRMWARE", "TARGET", "RESULT", "ERROR"])
        style_table(self.hist)
        self.hist.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.hist.setMinimumHeight(180)
        lay.addWidget(self.hist, 1)
        self._scroll = scrollable(inner)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(self._scroll)
        self._cur: JobView | None = None

    def _cancel(self) -> None:
        if self._cur and not self._cur.finished:
            self.agent.cancel_job(self._cur.job_id)

    def refresh(self) -> None:
        jobs = self.agent.state.jobs
        j = jobs[-1] if jobs else None
        self._cur = j
        if j is None:
            return
        self.fw.setText(j.firmware or j.job_id)
        self.target.setText(f"{j.target}  ·  {j.port or 'port pending'}  ·  {'verify only' if j.kind == 'verify' else 'flash'}  ·  job {j.job_id}")
        active = not j.finished
        tx_done = j.transfer_pct >= 100
        self.r_tx.set(j.transfer_pct, active and not tx_done)
        self.r_fl.set(100 if j.finished and j.status == "completed" and j.kind == "flash" else j.flash_pct, j.status == "flashing")
        ok = j.status == "completed"
        self.r_vf.set(100 if ok and j.verified else j.verify_pct, j.status == "verifying", theme.OK if ok and j.verified else None)
        self.cancel.setVisible(active)
        if j.finished:
            if ok:
                self.badge.setText("Completed · verified" if j.verified else "Completed · not verified")
                self.badge.setStyleSheet(f"color:{theme.OK}")
            else:
                self.badge.setText(j.status.replace("_", " ").title())
                self.badge.setStyleSheet(f"color:{theme.ERR if j.status != 'cancelled' else theme.WARN}")
        else:
            self.badge.setText(j.status.replace("_", " ").title())
            self.badge.setStyleSheet(f"color:{theme.WARN}")
        self.msg.setText(j.message if active else "")
        if j.error_code:
            det = j.error_details if isinstance(j.error_details, str) else ""
            self.err.setText(f"{j.error_code}\n{j.error_message}" + (f"\n\n{det[-600:]}" if det else ""))
            self.err.show()
        else:
            self.err.hide()
        text = "\n".join(j.log)
        if text != self.log.toPlainText():
            self.log.setPlainText(text)
            self.log.verticalScrollBar().setValue(self.log.verticalScrollBar().maximum())
        hist = jobs[::-1][:30]
        self.hist.setRowCount(len(hist))
        for r, h in enumerate(hist):
            res = "Running" if not h.finished else ("Verified" if h.status == "completed" and h.verified else h.status.replace("_", " ").title())
            for c, v in enumerate([ago(h.finished_at or h.started_at), h.firmware, h.target, res, h.error_code or ""]):
                self.hist.setItem(r, c, QTableWidgetItem(v))
            self.hist.setRowHeight(r, 30)


# ----------------------------------------------------------------- settings

class SettingsPage(QWidget):
    revoked = Signal()

    def __init__(self, agent: Agent, hw: HardwareManager, apply_autostart) -> None:
        super().__init__()
        self.agent, self.hw, self.apply_autostart = agent, hw, apply_autostart
        s = agent.store.settings
        inner = QWidget()
        lay = QVBoxLayout(inner)
        lay.setContentsMargins(36, 30, 36, 24)
        lay.setSpacing(12)
        lay.addWidget(label("Settings", "h1"))

        lay.addWidget(label("ACCOUNT & PAIRING", "h2"))
        fr, fl = card()
        self.acct = label("", None)
        fl.addWidget(self.acct)
        self.srv = label("", "mono")
        fl.addWidget(self.srv)
        fl.addWidget(label("This desktop holds a revocable, device-specific credential (Windows DPAPI). Revoking disconnects it immediately and requires pairing again.", "dim", wrap=True))
        rb = QHBoxLayout()
        rb.addStretch(1)
        self.revoke = QPushButton("Disconnect and revoke this device")
        self.revoke.setObjectName("danger")
        self.revoke.clicked.connect(self._revoke)
        rb.addWidget(self.revoke)
        fl.addLayout(rb)
        lay.addWidget(fr)

        lay.addWidget(label("STARTUP", "h2"))
        fr, fl = card()
        self.auto = QCheckBox("Start MCU Bridge when I sign in to Windows")
        self.auto.setChecked(s.start_with_windows)
        self.auto.clicked.connect(self._auto)
        self.mini = QCheckBox("Start minimised to the system tray")
        self.mini.setChecked(s.start_minimized)
        self.mini.clicked.connect(lambda v: self._set("start_minimized", v))
        fl.addWidget(self.auto)
        fl.addWidget(self.mini)
        lay.addWidget(fr)

        lay.addWidget(label("SECURITY", "h2"))
        fr, fl = card()
        row = QHBoxLayout()
        row.addWidget(label("New devices", None))
        row.addStretch(1)
        self.policy = QComboBox()
        self.policy.addItems(["Allow recognised boards automatically", "Require my approval for each device"])
        self.policy.setCurrentIndex(0 if s.trust_policy == "auto" else 1)
        self.policy.currentIndexChanged.connect(lambda i: self._set("trust_policy", "auto" if i == 0 else "manual"))
        row.addWidget(self.policy)
        fl.addLayout(row)
        fl.addWidget(label("Only the device-specific allow switch lets the cloud flash a board. Claude can never run commands or touch files on this PC — only the fixed flash / verify / reset / serial operations.", "dim", wrap=True))
        lay.addWidget(fr)

        lay.addWidget(label("RECONNECTION", "h2"))
        fr, fl = card()
        row = QHBoxLayout()
        row.addWidget(label("Retry delay", None))
        row.addStretch(1)
        self.rmin, self.rmax = QSpinBox(), QSpinBox()
        for sp, lo, hi, v, suf in ((self.rmin, 1, 30, s.reconnect_min_seconds, " s min"), (self.rmax, 5, 600, s.reconnect_max_seconds, " s max")):
            sp.setRange(lo, hi)
            sp.setValue(v)
            sp.setSuffix(suf)
            row.addWidget(sp)
        self.rmin.valueChanged.connect(lambda v: self._set("reconnect_min_seconds", v))
        self.rmax.valueChanged.connect(lambda v: self._set("reconnect_max_seconds", v))
        fl.addLayout(row)
        fl.addWidget(label("Reconnects automatically with exponential backoff after network outages.", "dim"))
        lay.addWidget(fr)

        lay.addWidget(label("TOOLCHAIN", "h2"))
        fr, fl = card()
        self.tools_lbl = label("", "mono", wrap=True)
        fl.addWidget(self.tools_lbl)
        tb = QHBoxLayout()
        rescan = QPushButton("Re-check tools")
        rescan.clicked.connect(self._recheck)
        opent = QPushButton("Open tools folder")
        opent.clicked.connect(self._open_tools)
        tb.addWidget(rescan)
        tb.addWidget(opent)
        tb.addStretch(1)
        fl.addLayout(tb)
        lay.addWidget(fr)

        lay.addWidget(label("LOGS", "h2"))
        fr, fl = card()
        self.logv = QPlainTextEdit()
        self.logv.setObjectName("mono")
        self.logv.setReadOnly(True)
        self.logv.setMinimumHeight(140)
        fl.addWidget(self.logv)
        lb = QHBoxLayout()
        ref = QPushButton("Refresh log")
        ref.clicked.connect(self._load_log)
        fold = QPushButton("Open log folder")
        fold.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(log_dir()))))
        lb.addWidget(ref)
        lb.addWidget(fold)
        lb.addStretch(1)
        lb.addWidget(label(f"MCU Bridge {APP_VERSION}", "dim"))
        fl.addLayout(lb)
        lay.addWidget(fr)
        lay.addStretch(1)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(scrollable(inner))
        self._load_log()
        self._recheck()

    def _set(self, k: str, v) -> None:
        setattr(self.agent.store.settings, k, v)
        self.agent.store.save()

    def _auto(self, v: bool) -> None:
        self._set("start_with_windows", v)
        self.apply_autostart(v)

    def _recheck(self) -> None:
        lines = []
        for name, t in tools.all_tools(True).items():
            mark = "●" if t.available else "○"
            lines.append(f"{mark} {name:<10} {(t.version or '') if t.available else 'not found'}  {t.path if t.available and t.path != 'built-in' else ('built in' if t.available else '')}")
        self.tools_lbl.setText("\n".join(lines))

    def _open_tools(self) -> None:
        from app.core.config import data_dir

        d = data_dir() / "tools"
        d.mkdir(parents=True, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(d)))

    def _load_log(self) -> None:
        p = Path(log_dir()) / "mcubridge.log"
        try:
            self.logv.setPlainText("\n".join(p.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]))
            self.logv.verticalScrollBar().setValue(self.logv.verticalScrollBar().maximum())
        except OSError:
            self.logv.setPlainText("(no log yet)")

    def _revoke(self) -> None:
        if QMessageBox.question(self, "Revoke this device", "Disconnect from your account and revoke this device's credential? You will need to pair again.") == QMessageBox.Yes:
            threading.Thread(target=self.agent.revoke_this_device, daemon=True).start()
            self.revoked.emit()

    def refresh(self) -> None:
        st = self.agent.state
        self.acct.setText(f"Signed in as {st.account_email or '—'}   ·   {self.agent.store.settings.device_name}")
        self.srv.setText(self.agent.store.settings.server_url)
        self.revoke.setEnabled(st.connection not in ("pairing", "unpaired"))
