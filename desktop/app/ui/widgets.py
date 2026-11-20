"""Small custom-painted widgets: hairline progress bar, status dot, QR code."""
from __future__ import annotations

import segno
from PySide6.QtCore import QRectF, QSize, Qt
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout, QWidget

from . import theme


class Bar(QWidget):
    """3px progress bar."""

    def __init__(self) -> None:
        super().__init__()
        self._v = 0.0
        self._color = QColor(theme.FG)
        self.setFixedHeight(3)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

    def set(self, value: float, color: str | None = None) -> None:
        self._v = max(0.0, min(100.0, value))
        self._color = QColor(color or theme.FG)
        self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(theme.LINE2))
        p.fillRect(QRectF(0, 0, self.width() * self._v / 100.0, self.height()), self._color)


class Dot(QWidget):
    def __init__(self, color: str = theme.DIM) -> None:
        super().__init__()
        self._c = QColor(color)
        self.setFixedSize(8, 8)

    def set(self, color: str) -> None:
        self._c = QColor(color)
        self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        p.setBrush(self._c)
        p.drawEllipse(self.rect().adjusted(0, 0, -1, -1))


class StatusChip(QWidget):
    def __init__(self) -> None:
        super().__init__()
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(8)
        self.dot = Dot()
        self.label = QLabel("")
        lay.addWidget(self.dot, 0, Qt.AlignVCenter)
        lay.addWidget(self.label)

    def set(self, text: str, color: str) -> None:
        self.dot.set(color)
        self.label.setText(text)
        self.label.adjustSize()
        self.adjustSize()
        self.updateGeometry()


class Qr(QWidget):
    def __init__(self, size: int = 176) -> None:
        super().__init__()
        self._m: list[list[int]] = []
        self._size = size
        self.setFixedSize(size, size)

    def set_text(self, text: str) -> None:
        q = segno.make(text, error="m", micro=False)
        self._m = [list(r) for r in q.matrix]
        self.update()

    def sizeHint(self) -> QSize:
        return QSize(self._size, self._size)

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.fillRect(self.rect(), QColor("#f4f4f5"))
        if not self._m:
            return
        quiet = 2
        n = len(self._m) + quiet * 2
        cell = self._size / n
        p.setPen(Qt.NoPen)
        p.setBrush(QColor("#0b0b0c"))
        for y, row in enumerate(self._m):
            for x, v in enumerate(row):
                if v:
                    p.drawRect(QRectF((x + quiet) * cell, (y + quiet) * cell, cell + 0.5, cell + 0.5))


def hline() -> QFrame:
    f = QFrame()
    f.setObjectName("hline")
    f.setFrameShape(QFrame.NoFrame)
    return f


def card() -> tuple[QFrame, QVBoxLayout]:
    f = QFrame()
    f.setObjectName("card")
    lay = QVBoxLayout(f)
    lay.setContentsMargins(18, 16, 18, 16)
    lay.setSpacing(10)
    return f, lay


def label(text: str = "", name: str | None = None, wrap: bool = False) -> QLabel:
    l = QLabel(text)
    if name:
        l.setObjectName(name)
    l.setWordWrap(wrap)
    l.setTextInteractionFlags(Qt.TextSelectableByMouse)
    return l
