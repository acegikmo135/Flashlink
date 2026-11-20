"""Account page: profile, desktop apps, access tokens, connected apps — managed from the desktop."""
from __future__ import annotations

from urllib.parse import urlparse

from PySide6.QtCore import Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QGuiApplication
from PySide6.QtWidgets import (QDialog, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPlainTextEdit, QPushButton, QVBoxLayout, QWidget)

from app.core.agent import Agent
from app.networking.account import AccountClient
from app.networking.http import HttpError

from . import theme
from .async_util import run_async
from .pages import ago, scrollable
from .widgets import card, hline, label


def _ms_ago(ms: float | None) -> str:
    return ago(ms / 1000) if ms else "never"


class NewTokenDialog(QDialog):
    def __init__(self, parent, token: str, server: str) -> None:
        super().__init__(parent)
        self.setWindowTitle("New access token")
        self.setMinimumWidth(560)
        lay = QVBoxLayout(self)
        lay.setSpacing(10)
        lay.addWidget(label("Copy your token now — it is shown only once.", None))
        lay.addWidget(label("Anyone holding it can flash your allowed boards. Treat it like an SSH key.", "muted", wrap=True))
        box = QPlainTextEdit(token)
        box.setObjectName("mono")
        box.setReadOnly(True)
        box.setFixedHeight(58)
        lay.addWidget(box)
        cmd = f'claude mcp add --transport http mcu-bridge {server}/mcp --header "Authorization: Bearer {token}"'
        lay.addWidget(label("Add it to Claude Code", "h2"))
        box2 = QPlainTextEdit(cmd)
        box2.setObjectName("mono")
        box2.setReadOnly(True)
        box2.setFixedHeight(80)
        lay.addWidget(box2)
        row = QHBoxLayout()
        c1 = QPushButton("Copy token")
        c1.clicked.connect(lambda: QGuiApplication.clipboard().setText(token))
        c2 = QPushButton("Copy command")
        c2.clicked.connect(lambda: QGuiApplication.clipboard().setText(cmd))
        done = QPushButton("Done")
        done.setObjectName("primary")
        done.clicked.connect(self.accept)
        row.addWidget(c1)
        row.addWidget(c2)
        row.addStretch(1)
        row.addWidget(done)
        lay.addLayout(row)


class Section(QWidget):
    """A titled card whose body is rebuilt from data."""

    def __init__(self, title: str, subtitle: str = "", action: QPushButton | None = None) -> None:
        super().__init__()
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(8)
        head = QHBoxLayout()
        head.addWidget(label(title.upper(), "h2"))
        head.addStretch(1)
        if action:
            head.addWidget(action)
        outer.addLayout(head)
        self.frame, self.body = card()
        self.body.setSpacing(0)
        outer.addWidget(self.frame)
        if subtitle:
            self.sub = label(subtitle, "dim", wrap=True)
            outer.addWidget(self.sub)

    def clear(self) -> None:
        while self.body.count():
            it = self.body.takeAt(0)
            w = it.widget()
            if w:
                w.deleteLater()
            elif it.layout():
                while it.layout().count():
                    x = it.layout().takeAt(0).widget()
                    if x:
                        x.deleteLater()

    def add_row(self, title: str, meta: str, button: QPushButton | None = None, dot: str | None = None) -> None:
        if self.body.count():
            self.body.addWidget(hline())
        row = QWidget()
        h = QHBoxLayout(row)
        h.setContentsMargins(0, 10, 0, 10)
        if dot:
            d = QLabel("●")
            d.setStyleSheet(f"color:{dot};font-size:10px")
            h.addWidget(d)
        col = QVBoxLayout()
        col.setSpacing(1)
        col.addWidget(label(title, None))
        col.addWidget(label(meta, "dim"))
        h.addLayout(col, 1)
        if button:
            h.addWidget(button)
        self.body.addWidget(row)

    def empty(self, text: str) -> None:
        self.clear()
        self.body.addWidget(label(text, "dim", wrap=True))


class AccountPage(QWidget):
    signed_out = Signal()

    def __init__(self, agent: Agent) -> None:
        super().__init__()
        self.agent = agent
        self._loaded = False
        inner = QWidget()
        lay = QVBoxLayout(inner)
        lay.setContentsMargins(36, 30, 36, 24)
        lay.setSpacing(16)
        head = QHBoxLayout()
        head.addWidget(label("Account", "h1"))
        head.addStretch(1)
        self.status = label("", "dim")
        head.addWidget(self.status)
        rb = QPushButton("Refresh")
        rb.clicked.connect(self.reload)
        head.addWidget(rb)
        lay.addLayout(head)

        # profile
        fr, fl = card()
        self.email = label("", None)
        self.email.setStyleSheet("font-size:15px;font-weight:600")
        fl.addWidget(self.email)
        self.srv = label("", "muted")
        fl.addWidget(self.srv)
        stats = QHBoxLayout()
        self.stat_labels = {}
        for k in ("Computers online", "Boards ready", "Flashes", "Success"):
            col = QVBoxLayout()
            col.addWidget(label(k.upper(), "h2"))
            v = label("—", None)
            v.setStyleSheet("font-size:20px;font-weight:600")
            self.stat_labels[k] = v
            col.addWidget(v)
            stats.addLayout(col)
        stats.addStretch(1)
        fl.addSpacing(6)
        fl.addLayout(stats)
        btns = QHBoxLayout()
        web = QPushButton("Open web dashboard")
        web.setObjectName("primary")
        web.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(self.agent.store.settings.server_url + "/dashboard")))
        cpy = QPushButton("Copy connector URL")
        cpy.clicked.connect(lambda: QGuiApplication.clipboard().setText(self.agent.store.settings.server_url + "/mcp"))
        so = QPushButton("Disconnect this PC…")
        so.setObjectName("danger")
        so.clicked.connect(self._disconnect)
        btns.addWidget(web)
        btns.addWidget(cpy)
        btns.addStretch(1)
        btns.addWidget(so)
        fl.addSpacing(6)
        fl.addLayout(btns)
        lay.addWidget(fr)

        newtok = QPushButton("New token")
        newtok.clicked.connect(self._new_token)
        self.s_agents = Section("Desktop apps", "Each installation has its own revocable credential.")
        self.s_apps = Section("Connected apps", "Applications authorised through the claude.ai connector sign-in.")
        self.s_tokens = Section("Access tokens", "Long-lived Bearer tokens for clients that cannot use the connector.", newtok)
        for s in (self.s_agents, self.s_apps, self.s_tokens):
            lay.addWidget(s)
        lay.addStretch(1)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(scrollable(inner))

    # ---- data
    def _client(self) -> AccountClient | None:
        tok = self.agent.creds.load()
        return AccountClient(self.agent.store.settings.server_url, tok) if tok else None

    def reload(self) -> None:
        c = self._client()
        if not c:
            self.status.setText("Not signed in")
            return
        self.status.setText("Loading…")
        run_async(c.overview, self._show)

    def on_show(self) -> None:
        if not self._loaded:
            self._loaded = True
            self.reload()

    def _show(self, data, err) -> None:
        if err:
            self.status.setText("Offline" if isinstance(err, ConnectionError) else f"Error: {err}")
            return
        self.status.setText("")
        self.email.setText(data["email"])
        self.srv.setText(f"{urlparse(self.agent.store.settings.server_url).netloc}  ·  this PC: {self.agent.store.settings.device_name}")
        st = data["stats"]
        self.stat_labels["Computers online"].setText(f"{st['agents_online']}/{len(data['agents'])}")
        self.stat_labels["Boards ready"].setText(str(st["devices_ready"]))
        self.stat_labels["Flashes"].setText(str(st["jobs_total"]))
        self.stat_labels["Success"].setText(f"{round(100 * st['jobs_ok'] / st['jobs_total'])}%" if st["jobs_total"] else "—")

        self.s_agents.clear()
        for a in data["agents"]:
            me = a["id"] == data["agent_id"]
            btn = None
            if not me:
                btn = QPushButton("Revoke")
                btn.setObjectName("danger")
                btn.clicked.connect(lambda _=False, i=a["id"], n=a["name"]: self._act("Revoke desktop app", f"Revoke “{n}”? It is disconnected immediately.", lambda c: c.revoke_agent(i)))
            self.s_agents.add_row(a["name"] + ("  (this PC)" if me else ""), f"{'online' if a['online'] else 'offline · last seen ' + _ms_ago(a['last_seen_at'])}  ·  {a.get('os') or a['platform']}", btn, theme.OK if a["online"] else theme.DIM)
        if not data["agents"]:
            self.s_agents.empty("No desktop apps.")

        self.s_apps.clear()
        for a in data["apps"]:
            btn = QPushButton("Disconnect")
            btn.setObjectName("danger")
            btn.clicked.connect(lambda _=False, i=a["client_id"], n=a["name"]: self._act("Disconnect app", f"Disconnect “{n}”? It loses access immediately.", lambda c: c.revoke_app(i)))
            self.s_apps.add_row(a["name"], f"connected {_ms_ago(a['since'])}", btn)
        if not data["apps"]:
            self.s_apps.empty("No connected apps. Add the connector URL in claude.ai → Settings → Connectors.")

        self.s_tokens.clear()
        for t in data["tokens"]:
            btn = QPushButton("Revoke")
            btn.setObjectName("danger")
            btn.clicked.connect(lambda _=False, i=t["id"], n=t["name"]: self._act("Revoke token", f"Revoke “{n}”? Clients using it stop working immediately.", lambda c: c.revoke_token(i)))
            self.s_tokens.add_row(t["name"], f"created {_ms_ago(t['created_at'])}  ·  last used {_ms_ago(t['last_used_at'])}", btn)
        if not data["tokens"]:
            self.s_tokens.empty("No tokens.")

    # ---- actions
    def _act(self, title: str, text: str, fn) -> None:
        if QMessageBox.question(self, title, text) != QMessageBox.Yes:
            return
        c = self._client()
        if c:
            run_async(lambda: fn(c), lambda r, e: (self.status.setText(f"Error: {e}") if e else None, self.reload()))

    def _new_token(self) -> None:
        c = self._client()
        if not c:
            return

        def done(r, e) -> None:
            if e:
                msg = getattr(e, "body", str(e))
                self.status.setText(f"Error: {msg[:80]}")
                return
            NewTokenDialog(self, r["token"], self.agent.store.settings.server_url).exec()
            self.reload()

        run_async(lambda: c.create_token("Claude Code"), done)

    def _disconnect(self) -> None:
        if QMessageBox.question(self, "Disconnect this PC", "Revoke this computer's credential and sign out? You will need to pair again.") == QMessageBox.Yes:
            import threading

            threading.Thread(target=self.agent.revoke_this_device, daemon=True).start()
            self.signed_out.emit()


_ = (QLabel, QLineEdit, Qt, HttpError)
