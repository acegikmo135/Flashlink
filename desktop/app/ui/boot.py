"""Instant-feedback start-up: a lightweight splash is painted before any heavy import (agent, serial, websockets…)."""
from __future__ import annotations

import sys

from PySide6.QtCore import QLockFile, QRectF, Qt
from PySide6.QtGui import QColor, QFont, QGuiApplication, QPainter, QPen
from PySide6.QtWidgets import QApplication, QWidget


def acquire_single_instance_lock(path: str) -> QLockFile | None:
    lock = QLockFile(path)
    lock.setStaleLockTime(0)
    return lock if lock.tryLock(100) else None


class Splash(QWidget):
    """Frameless rounded card with the logo; follows the OS light/dark setting."""

    def __init__(self, dark: bool) -> None:
        super().__init__(None, Qt.SplashScreen | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.dark = dark
        self.msg = "Starting…"
        self.resize(340, 190)
        scr = QGuiApplication.primaryScreen()
        if scr:
            g = scr.availableGeometry()
            self.move(g.center().x() - self.width() // 2, g.center().y() - self.height() // 2)

    def set_message(self, text: str) -> None:
        self.msg = text
        self.repaint()

    def paintEvent(self, _e) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        bg, fg, mut = (("#1c1c1e", "#ffffff", "#a1a1a6") if self.dark else ("#ffffff", "#000000", "#6c6c70"))
        p.setPen(QPen(QColor(255, 255, 255, 25) if self.dark else QColor(0, 0, 0, 25), 1))
        p.setBrush(QColor(bg))
        p.drawRoundedRect(QRectF(0.5, 0.5, self.width() - 1, self.height() - 1), 22, 22)
        # logo mark
        s = 52.0
        x, y = (self.width() - s) / 2, 38.0
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(fg))
        p.drawRoundedRect(QRectF(x, y, s, s), s * 0.23, s * 0.23)
        pen = QPen(QColor(bg))
        pen.setWidthF(s * 0.078)
        p.setPen(pen)
        p.setBrush(Qt.NoBrush)
        p.drawRect(QRectF(x + s * 0.25, y + s * 0.25, s * 0.5, s * 0.5))
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(bg))
        p.drawEllipse(QRectF(x + s * 0.5 - s * 0.094, y + s * 0.5 - s * 0.094, s * 0.188, s * 0.188))
        f = QFont("Segoe UI Variable Display")
        f.setPixelSize(19)
        f.setWeight(QFont.Bold)
        p.setFont(f)
        p.setPen(QColor(fg))
        p.drawText(QRectF(0, 104, self.width(), 28), Qt.AlignCenter, "MCU Bridge")
        f.setPixelSize(12)
        f.setWeight(QFont.Normal)
        p.setFont(f)
        p.setPen(QColor(mut))
        p.drawText(QRectF(0, 138, self.width(), 20), Qt.AlignCenter, self.msg)


def show_splash(app: QApplication) -> Splash:
    dark = True
    try:
        dark = app.styleHints().colorScheme() != Qt.ColorScheme.Light
    except Exception:
        pass
    sp = Splash(dark)
    sp.show()
    app.processEvents()
    return sp


_ = sys
