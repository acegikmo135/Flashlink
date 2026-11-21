"""Small custom-painted widgets: hairline progress bar, status dot, QR code."""
from __future__ import annotations

import segno
from PySide6.QtCore import QEasingCurve, QPointF, QPropertyAnimation, QRectF, QSize, Qt, QVariantAnimation, Signal
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QAbstractButton, QFrame, QGraphicsOpacityEffect, QHBoxLayout, QLabel, QPushButton, QSizePolicy, QVBoxLayout, QWidget

from . import theme


class Bar(QWidget):
    """Rounded progress bar whose fill glides to each new value (iOS-style ease-out)."""

    def __init__(self) -> None:
        super().__init__()
        self._target = 0.0
        self._shown = 0.0
        self._color: str | None = None
        self.setFixedHeight(6)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(320)
        self._anim.setEasingCurve(QEasingCurve.OutCubic)
        self._anim.valueChanged.connect(self._tick)

    def _tick(self, v) -> None:
        self._shown = float(v)
        self.update()

    def set(self, value: float, color: str | None = None) -> None:
        value = max(0.0, min(100.0, value))
        self._color = color
        if abs(value - self._target) > 0.05:
            self._anim.stop()
            self._anim.setStartValue(self._shown)
            self._anim.setEndValue(value)
            self._anim.start()
        self._target = value
        self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        h = self.height()
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(theme.LINE))
        p.drawRoundedRect(QRectF(0, 0, self.width(), h), h / 2, h / 2)
        w = self.width() * self._shown / 100.0
        if w > 0:
            p.setBrush(QColor(self._color or theme.ACCENT))
            p.drawRoundedRect(QRectF(0, 0, max(w, h), h), h / 2, h / 2)


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


class Switch(QAbstractButton):
    """iOS toggle: 51x31 track, white thumb that springs across."""

    def __init__(self, checked: bool = False) -> None:
        super().__init__()
        self._x = 1.0 if checked else 0.0
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(380)
        self._anim.setEasingCurve(QEasingCurve.OutBack)
        self._anim.valueChanged.connect(self._tick)
        self.setCheckable(True)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(51, 31)
        super().setChecked(checked)
        self.toggled.connect(self._animate)

    def _tick(self, v) -> None:
        self._x = float(v)
        self.update()

    def _animate(self, on: bool) -> None:
        self._anim.stop()
        self._anim.setStartValue(self._x)
        self._anim.setEndValue(1.0 if on else 0.0)
        self._anim.start()

    def setChecked(self, on: bool) -> None:  # noqa: N802
        """Programmatic change: snap without animation (user clicks animate via the toggled signal)."""
        self.blockSignals(True)
        super().setChecked(on)
        self.blockSignals(False)
        self._anim.stop()
        self._x = 1.0 if on else 0.0
        self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setOpacity(1.0 if self.isEnabled() else 0.45)
        off, on = QColor(theme.LINE2), QColor(theme.OK)
        t = max(0.0, min(1.0, self._x))
        col = QColor(int(off.red() + (on.red() - off.red()) * t), int(off.green() + (on.green() - off.green()) * t), int(off.blue() + (on.blue() - off.blue()) * t))
        p.setPen(Qt.NoPen)
        p.setBrush(col)
        p.drawRoundedRect(QRectF(0, 0, 51, 31), 15.5, 15.5)
        p.setBrush(QColor(0, 0, 0, 40))
        x = 2 + 20 * self._x
        p.drawEllipse(QRectF(x, 3.2, 27, 27))
        p.setBrush(QColor("#ffffff"))
        p.drawEllipse(QRectF(x, 2, 27, 27))


class Segmented(QWidget):
    """iOS segmented control with an animated sliding thumb."""

    changed = Signal(str)

    def __init__(self, options: list[tuple[str, str]], value: str, height: int = 32) -> None:
        super().__init__()
        self._opts = options
        self._idx = max(0, [o[0] for o in options].index(value)) if value in [o[0] for o in options] else 0
        self._pos = float(self._idx)
        self.setFixedHeight(height)
        self.setCursor(Qt.PointingHandCursor)
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(380)
        self._anim.setEasingCurve(QEasingCurve.OutBack)
        self._anim.valueChanged.connect(self._tick)

    def value(self) -> str:
        return self._opts[self._idx][0]

    def set_value(self, v: str) -> None:
        keys = [o[0] for o in self._opts]
        if v in keys and keys.index(v) != self._idx:
            self._go(keys.index(v), emit=False)

    def _tick(self, v) -> None:
        self._pos = float(v)
        self.update()

    def _go(self, i: int, emit: bool = True) -> None:
        self._idx = i
        self._anim.stop()
        self._anim.setStartValue(self._pos)
        self._anim.setEndValue(float(i))
        self._anim.start()
        if emit:
            self.changed.emit(self._opts[i][0])

    def mousePressEvent(self, e) -> None:  # noqa: N802
        i = int(e.position().x() // (self.width() / len(self._opts)))
        i = max(0, min(len(self._opts) - 1, i))
        if i != self._idx:
            self._go(i)

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        p.setPen(Qt.NoPen)
        base = QColor(theme.LINE2)
        base.setAlpha(90)
        p.setBrush(base)
        p.drawRoundedRect(QRectF(0, 0, w, h), h / 2, h / 2)
        seg = (w - 6) / len(self._opts)
        thumb = QRectF(3 + seg * self._pos, 3, seg, h - 6)
        p.setBrush(QColor(0, 0, 0, 50))
        p.drawRoundedRect(thumb.translated(0, 1), (h - 6) / 2, (h - 6) / 2)
        p.setBrush(QColor(theme.THUMB))
        p.drawRoundedRect(thumb, (h - 6) / 2, (h - 6) / 2)
        f = p.font()
        f.setPointSizeF(9.5)
        for i, (_k, text) in enumerate(self._opts):
            r = QRectF(3 + seg * i, 0, seg, h)
            p.setFont(f)
            p.setPen(QColor(theme.FG if i == self._idx else theme.MUTED))
            p.drawText(r, Qt.AlignCenter, text)


_GLYPHS = {
    "grid": lambda p, r: [p.drawRoundedRect(QRectF(r.x() + dx, r.y() + dy, r.width() * 0.34, r.height() * 0.34), 1.5, 1.5) for dx in (r.width() * 0.08, r.width() * 0.58) for dy in (r.height() * 0.08, r.height() * 0.58)],
}


def _glyph(kind: str, p: QPainter, r: QRectF) -> None:
    pen = QPen(QColor("#ffffff"))
    pen.setWidthF(1.7)
    pen.setCapStyle(Qt.RoundCap)
    pen.setJoinStyle(Qt.RoundJoin)
    p.setPen(pen)
    p.setBrush(Qt.NoBrush)
    x, y, w, h = r.x(), r.y(), r.width(), r.height()
    if kind == "grid":
        s = w * 0.3
        for dx in (0.14, 0.56):
            for dy in (0.14, 0.56):
                p.drawRoundedRect(QRectF(x + w * dx, y + h * dy, s, s), 1.5, 1.5)
    elif kind == "pulse":
        path = QPainterPath(QPointF(x + w * 0.08, y + h * 0.55))
        for fx, fy in ((0.3, 0.55), (0.42, 0.22), (0.58, 0.82), (0.7, 0.45), (0.92, 0.45)):
            path.lineTo(x + w * fx, y + h * fy)
        p.drawPath(path)
    elif kind == "tools":
        for fy, fx in ((0.25, 0.65), (0.5, 0.35), (0.75, 0.6)):
            p.drawLine(QPointF(x + w * 0.12, y + h * fy), QPointF(x + w * 0.88, y + h * fy))
            p.setBrush(QColor("#ffffff"))
            p.drawEllipse(QPointF(x + w * fx, y + h * fy), 2.1, 2.1)
            p.setBrush(Qt.NoBrush)
    elif kind == "person":
        p.drawEllipse(QPointF(x + w / 2, y + h * 0.34), w * 0.17, w * 0.17)
        path = QPainterPath()
        path.moveTo(x + w * 0.18, y + h * 0.86)
        path.quadTo(x + w / 2, y + h * 0.42, x + w * 0.82, y + h * 0.86)
        p.drawPath(path)
    elif kind == "gear":
        c = QPointF(x + w / 2, y + h / 2)
        p.drawEllipse(c, w * 0.17, w * 0.17)
        import math

        for k in range(8):
            a = math.pi * k / 4
            p.drawLine(QPointF(c.x() + math.cos(a) * w * 0.3, c.y() + math.sin(a) * w * 0.3), QPointF(c.x() + math.cos(a) * w * 0.42, c.y() + math.sin(a) * w * 0.42))


class NavIcon(QWidget):
    """Coloured rounded tile with a vector glyph (iOS Settings style)."""

    def __init__(self, kind: str, color: str) -> None:
        super().__init__()
        self.kind, self.color = kind, color
        self.setFixedSize(28, 28)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(self.color))
        p.drawRoundedRect(QRectF(0, 0, 28, 28), 7, 7)
        _glyph(self.kind, p, QRectF(6, 6, 16, 16))


def fade_in(container: QWidget, ms: int = 280) -> None:
    """Page-change transition: a solid background-coloured veil over the container fades out, revealing the new page.

    (Fading the page itself with QGraphicsOpacityEffect produces artefacts on scroll areas; a veil is cheap and reliable.)
    """
    veil = getattr(container, "_veil", None)
    if veil is None:
        veil = QWidget(container)
        veil.setAttribute(Qt.WA_TransparentForMouseEvents)
        veil._eff = QGraphicsOpacityEffect(veil)  # type: ignore[attr-defined]
        veil.setGraphicsEffect(veil._eff)  # type: ignore[attr-defined]
        veil._anim = QPropertyAnimation(veil._eff, b"opacity", veil)  # type: ignore[attr-defined]
        veil._anim.finished.connect(veil.hide)  # type: ignore[attr-defined]
        container._veil = veil  # type: ignore[attr-defined]
    veil.setStyleSheet(f"background:{theme.BG};")
    veil.setGeometry(container.rect())
    veil.show()
    veil.raise_()
    anim = veil._anim  # type: ignore[attr-defined]
    anim.stop()
    anim.setDuration(ms)
    anim.setStartValue(0.92)
    anim.setEndValue(0.0)
    anim.setEasingCurve(QEasingCurve.OutCubic)
    anim.start()


_ = (QPushButton, _GLYPHS)


def logo_pixmap(size: int):
    """The app logo (ink tile, two bridge arches) scaled crisply for `size` logical px."""
    import base64

    from PySide6.QtGui import QGuiApplication, QPixmap

    from .logo_data import LOGO_PNG_B64

    dpr = QGuiApplication.primaryScreen().devicePixelRatio() if QGuiApplication.primaryScreen() else 1.0
    pm = QPixmap()
    pm.loadFromData(base64.b64decode(LOGO_PNG_B64), "PNG")
    pm = pm.scaled(int(size * dpr), int(size * dpr), Qt.KeepAspectRatio, Qt.SmoothTransformation)
    pm.setDevicePixelRatio(dpr)
    return pm


class BrandMark(QWidget):
    """Logo mark: ink rounded tile with the two-arch bridge mark (same glyph as the web app)."""

    def __init__(self, size: int = 26) -> None:
        super().__init__()
        self._s = size
        self.setFixedSize(size, size)
        self._pm = None

    def paintEvent(self, _e) -> None:
        if self._pm is None:
            self._pm = logo_pixmap(self._s)
        p = QPainter(self)
        p.drawPixmap(0, 0, self._pm)


class NavButton(QPushButton):
    """Sidebar row: coloured icon tile + label, icon always vertically centred."""

    def __init__(self, text: str, glyph: str, color: str) -> None:
        super().__init__(text)
        self.setObjectName("nav")
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedHeight(44)
        self._icon = NavIcon(glyph, color)
        self._icon.setParent(self)
        self._place()

    def _place(self) -> None:
        self._icon.move(12, (self.height() - self._icon.height()) // 2)

    def resizeEvent(self, e) -> None:  # noqa: N802
        super().resizeEvent(e)
        self._place()


class UserCard(QFrame):
    """Account chip at the bottom of the sidebar: avatar initial, email and connection state."""

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("usercard")
        self._email = ""
        self._status = ("", "")
        self.setFixedHeight(54)

    def set(self, email: str, status: str, color: str) -> None:
        if (email, status, color) != (self._email, self._status[0], self._status[1]):
            self._email, self._status = email, (status, color)
            self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(Qt.NoPen)
        fill = QColor(theme.LINE2)
        fill.setAlpha(70)
        p.setBrush(fill)
        p.drawRoundedRect(QRectF(0, 0, self.width(), self.height()), 14, 14)
        p.setBrush(QColor(theme.ACCENT))
        p.drawEllipse(QRectF(10, 11, 32, 32))
        f = p.font()
        f.setPointSizeF(10.5)
        f.setBold(True)
        p.setFont(f)
        p.setPen(QColor("#ffffff"))
        p.drawText(QRectF(10, 11, 32, 32), Qt.AlignCenter, (self._email[:1] or "?").upper())
        f.setBold(False)
        f.setPointSizeF(9.5)
        p.setFont(f)
        p.setPen(QColor(theme.FG))
        fm = p.fontMetrics()
        p.drawText(QRectF(52, 9, self.width() - 62, 18), Qt.AlignVCenter | Qt.AlignLeft, fm.elidedText(self._email or "Not signed in", Qt.ElideRight, self.width() - 62))
        f.setPointSizeF(8.5)
        p.setFont(f)
        p.setPen(QColor(self._status[1] or theme.DIM))
        p.drawText(QRectF(52, 27, self.width() - 62, 16), Qt.AlignVCenter | Qt.AlignLeft, "● " + (self._status[0] or ""))
