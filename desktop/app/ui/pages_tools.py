"""Tools page: status of every flashing tool, with a Download button beside each missing one."""
from __future__ import annotations

import threading

from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QHBoxLayout, QMessageBox, QPushButton, QVBoxLayout, QWidget

from app.core import toolinstall
from app.hardware import tools

from . import theme
from .async_util import run_async
from .pages import scrollable
from .widgets import Bar, card, hline, label


class ToolRow(QWidget):
    def __init__(self, name: str, spec: dict, on_change) -> None:
        super().__init__()
        self.name, self.spec, self.on_change = name, spec, on_change
        self._cancel: threading.Event | None = None
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 12, 0, 12)
        lay.setSpacing(6)
        top = QHBoxLayout()
        col = QVBoxLayout()
        col.setSpacing(1)
        self.title = label(spec["label"], None)
        self.title.setStyleSheet("font-weight:600")
        col.addWidget(self.title)
        col.addWidget(label(spec["purpose"], "muted"))
        self.detail = label("", "dim", wrap=True)
        col.addWidget(self.detail)
        top.addLayout(col, 1)
        self.state = label("", None)
        top.addWidget(self.state)
        self.btn = QPushButton("Download")
        self.btn.setObjectName("primary")
        self.btn.clicked.connect(self._primary)
        self.remove = QPushButton("Remove")
        self.remove.clicked.connect(self._remove)
        top.addWidget(self.btn)
        top.addWidget(self.remove)
        lay.addLayout(top)
        self.bar = Bar()
        self.bar.hide()
        lay.addWidget(self.bar)

    def refresh(self) -> None:
        t = tools.find(self.name) if not self.spec.get("builtin") else tools.find("esptool")
        pinned = bool(self.spec.get("url"))
        managed = toolinstall.installed_dir(self.name).exists()
        busy = self._cancel is not None
        if t.available:
            self.state.setText(f"● Installed{(' ' + t.version) if t.version else ''}" if not self.spec.get("builtin") else "● Built in")
            self.state.setStyleSheet(f"color:{theme.OK}")
            self.detail.setText(t.path if t.path and t.path != "built-in" else "Ships with MCU Bridge — nothing to install.")
        else:
            self.state.setText("○ Missing")
            self.state.setStyleSheet(f"color:{theme.WARN}")
            self.detail.setText(self.spec.get("manual") or f"Official release {self.spec.get('version', '')} · SHA-256 verified before install.")
        if busy:
            self.btn.setText("Cancel")
            self.btn.setObjectName("")
            self.btn.setVisible(True)
        else:
            self.btn.setObjectName("primary")
            self.btn.setText("Download" if pinned else "Get…")
            self.btn.setVisible(not t.available and not self.spec.get("builtin"))
        self.btn.style().unpolish(self.btn)
        self.btn.style().polish(self.btn)
        self.remove.setVisible(managed and not busy)

    def _primary(self) -> None:
        if self._cancel is not None:
            self._cancel.set()
            return
        if not self.spec.get("url"):
            QDesktopServices.openUrl(QUrl(self.spec["page"]))
            return
        ev = threading.Event()
        self._cancel = ev
        self.bar.show()
        self.bar.set(0)
        self.refresh()

        def prog(p: float, msg: str) -> None:
            self.bar.set(p)
            self.detail.setText(msg)

        def done(_r, err) -> None:
            self._cancel = None
            self.bar.hide()
            if err:
                self.detail.setText(f"Failed: {err}")
                self.detail.setStyleSheet(f"color:{theme.ERR}")
            else:
                self.detail.setStyleSheet("")
            self.refresh()
            self.on_change()

        run_async(lambda p: toolinstall.install(self.spec, self.name, lambda pct, m: p(pct, m), ev), done, prog, with_progress=True)

    def _remove(self) -> None:
        if QMessageBox.question(self, "Remove tool", f"Remove {self.spec['label']} from MCU Bridge's tools folder?") == QMessageBox.Yes:
            toolinstall.uninstall(self.name)
            self.refresh()
            self.on_change()


class ToolsPage(QWidget):
    def __init__(self, on_change=lambda: None) -> None:
        super().__init__()
        inner = QWidget()
        lay = QVBoxLayout(inner)
        lay.setContentsMargins(36, 30, 36, 24)
        lay.setSpacing(14)
        head = QHBoxLayout()
        head.addWidget(label("Tools", "h1"))
        head.addStretch(1)
        rc = QPushButton("Re-check")
        rc.clicked.connect(self.refresh)
        op = QPushButton("Open tools folder")
        op.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(toolinstall.tools_root()))))
        head.addWidget(rc)
        head.addWidget(op)
        lay.addLayout(head)
        lay.addWidget(label("Flashing utilities. MCU Bridge never installs anything silently — press Download next to a missing tool. Downloads come from the official release and are SHA-256 verified before they are unpacked.", "muted", wrap=True))
        fr, fl = card()
        fl.setSpacing(0)
        self.rows: list[ToolRow] = []
        for i, (name, spec) in enumerate(toolinstall.load_manifest().items()):
            if i:
                fl.addWidget(hline())
            r = ToolRow(name, spec, on_change)
            self.rows.append(r)
            fl.addWidget(r)
        lay.addWidget(fr)
        lay.addWidget(label("Drivers (CP210x, CH340, ST-Link, WCH-Link) are installed by Windows Update or the vendor and cannot be bundled here.", "dim", wrap=True))
        lay.addStretch(1)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(scrollable(inner))

    def refresh(self) -> None:
        """Re-probe tools in the background (version checks spawn processes), then update the rows."""
        run_async(lambda: tools.all_tools(True), lambda _r, _e: [r.refresh() for r in self.rows])

    def on_show(self) -> None:
        for r in self.rows:  # instant: cached status
            r.refresh()
        self.refresh()
