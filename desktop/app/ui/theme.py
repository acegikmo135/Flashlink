"""iOS-style design system: system colours, generous rounding, light + dark palettes that switch at runtime.

`apply(mode, app)` rebuilds the stylesheet and updates the module-level colour constants, so any widget that reads
`theme.FG`, `theme.OK`, … at paint/refresh time follows the active theme automatically.
"""
from __future__ import annotations

from typing import Callable

DARK = dict(
    BG="#000000", SIDEBAR="#111113", PANEL="#1c1c1e", RAISED="#2c2c2e", LINE="#38383a", LINE2="#48484a",
    FG="#ffffff", MUTED="#a1a1a6", DIM="#6e6e73", ACCENT="#0a84ff", OK="#30d158", WARN="#ff9f0a", ERR="#ff453a",
    FILL="rgba(120,120,128,0.24)", FILL_HOVER="rgba(120,120,128,0.36)", TINT="rgba(10,132,255,0.22)", TINT_ERR="rgba(255,69,58,0.20)", THUMB="#636366",
)
LIGHT = dict(
    BG="#f2f2f7", SIDEBAR="#e8e8ed", PANEL="#ffffff", RAISED="#f2f2f7", LINE="#e0e0e5", LINE2="#c7c7cc",
    FG="#000000", MUTED="#6c6c70", DIM="#8e8e93", ACCENT="#007aff", OK="#34c759", WARN="#ff9500", ERR="#ff3b30",
    FILL="rgba(120,120,128,0.14)", FILL_HOVER="rgba(120,120,128,0.24)", TINT="rgba(0,122,255,0.14)", TINT_ERR="rgba(255,59,48,0.14)", THUMB="#ffffff",
)

# --- active palette (module globals; updated by apply()) ---
BG = PANEL = RAISED = LINE = LINE2 = FG = MUTED = DIM = ACCENT = OK = WARN = ERR = SIDEBAR = ""
FILL = FILL_HOVER = TINT = TINT_ERR = THUMB = ""
MODE = "dark"
QSS = ""
UI_FONT = '"Segoe UI Variable Text", "SF Pro Text", "Segoe UI", "Inter", "Helvetica Neue", sans-serif'
DISPLAY_FONT = '"Segoe UI Variable Display", "SF Pro Display", "Segoe UI", "Inter", sans-serif'
MONO_FONT = '"Cascadia Mono", "SF Mono", "JetBrains Mono", "Consolas", "DejaVu Sans Mono", monospace'

_listeners: list[Callable[[str], None]] = []


def on_change(cb: Callable[[str], None]) -> None:
    _listeners.append(cb)


def system_mode(app=None) -> str:
    """'dark' or 'light' according to the OS (Qt >= 6.5 colour-scheme API)."""
    try:
        from PySide6.QtCore import Qt
        from PySide6.QtGui import QGuiApplication

        a = app or QGuiApplication.instance()
        if a is not None:
            cs = a.styleHints().colorScheme()
            if cs == Qt.ColorScheme.Light:
                return "light"
            if cs == Qt.ColorScheme.Dark:
                return "dark"
    except Exception:
        pass
    return "dark"


def _build(p: dict) -> str:
    g = p
    return f"""
* {{ font-family: {UI_FONT}; font-size: 13px; color: {g['FG']}; outline: none; }}
QMainWindow, QWidget#root, QStackedWidget, QWidget#page {{ background: {g['BG']}; }}
QWidget#sidebar {{ background: {g['SIDEBAR']}; }}
QLabel {{ background: transparent; }}
QLabel#h1 {{ font-family: {DISPLAY_FONT}; font-size: 30px; font-weight: 700; }}
QLabel#h2 {{ font-size: 11px; font-weight: 600; color: {g['MUTED']}; letter-spacing: 0.6px; }}
QLabel#muted {{ color: {g['MUTED']}; }}
QLabel#dim {{ color: {g['DIM']}; font-size: 12px; }}
QLabel#mono, QPlainTextEdit#mono, QLabel#code {{ font-family: {MONO_FONT}; font-size: 12px; }}
QLabel#code {{ font-size: 28px; letter-spacing: 6px; }}
QLabel#brand {{ font-family: {DISPLAY_FONT}; font-weight: 700; font-size: 16px; }}
QFrame#card {{ background: {g['PANEL']}; border: none; border-radius: 16px; }}
QFrame#hline {{ background: {g['LINE']}; max-height: 1px; min-height: 1px; border: none; }}
QPushButton {{ background: {g['FILL']}; border: none; border-radius: 15px; padding: 6px 16px; min-height: 18px; color: {g['FG']}; font-weight: 500; }}
QPushButton:hover {{ background: {g['FILL_HOVER']}; }}
QPushButton:pressed {{ background: {g['FILL_HOVER']}; padding-top: 7px; }}
QPushButton:disabled {{ color: {g['DIM']}; background: {g['FILL']}; }}
QPushButton#primary {{ background: {g['ACCENT']}; color: #ffffff; font-weight: 600; }}
QPushButton#primary:hover {{ background: {g['ACCENT']}; }}
QPushButton#primary:pressed {{ background: {g['ACCENT']}; }}
QPushButton#danger {{ background: {g['TINT_ERR']}; color: {g['ERR']}; font-weight: 600; }}
QPushButton#danger:hover {{ background: {g['TINT_ERR']}; }}
QPushButton#link {{ background: transparent; padding: 2px 0; color: {g['ACCENT']}; text-align: left; font-weight: 500; }}
QPushButton#link:hover {{ background: transparent; }}
QPushButton#nav {{ background: transparent; border-radius: 12px; text-align: left; padding: 0 12px 0 52px; min-height: 44px; max-height: 44px; color: {g['FG']}; font-size: 14px; font-weight: 500; }}
QPushButton#nav:hover {{ background: {g['FILL']}; }}
QPushButton#nav[active="true"] {{ background: transparent; color: {g['ACCENT']}; font-weight: 600; }}
QTableWidget {{ background: {g['PANEL']}; border: none; border-radius: 16px; gridline-color: {g['LINE']}; selection-background-color: {g['TINT']}; selection-color: {g['FG']}; }}
QTableWidget::item {{ padding: 6px 12px; border-bottom: 1px solid {g['LINE']}; }}
QHeaderView::section {{ background: {g['PANEL']}; color: {g['MUTED']}; border: none; border-bottom: 1px solid {g['LINE']}; padding: 10px 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }}
QPlainTextEdit {{ background: {g['PANEL']}; border: none; border-radius: 14px; padding: 10px; selection-background-color: {g['TINT']}; }}
QLineEdit, QSpinBox, QComboBox {{ background: {g['FILL']}; border: 2px solid transparent; border-radius: 12px; padding: 5px 10px; selection-background-color: {g['TINT']}; }}
QLineEdit:focus, QSpinBox:focus, QComboBox:focus {{ border: 2px solid {g['TINT']}; }}
QComboBox::drop-down {{ border: none; width: 22px; }}
QComboBox QAbstractItemView {{ background: {g['PANEL']}; border: 1px solid {g['LINE']}; border-radius: 10px; selection-background-color: {g['TINT']}; padding: 4px; }}
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: {g['LINE2']}; min-height: 28px; border-radius: 3px; }}
QScrollBar::handle:vertical:hover {{ background: {g['DIM']}; }}
QScrollBar::add-line, QScrollBar::sub-line, QScrollBar::add-page, QScrollBar::sub-page {{ background: none; height: 0; }}
QToolTip {{ background: {g['RAISED']}; color: {g['FG']}; border: 1px solid {g['LINE']}; border-radius: 8px; padding: 5px 8px; }}
QMenu {{ background: {g['PANEL']}; border: 1px solid {g['LINE']}; border-radius: 12px; padding: 6px; }}
QMenu::item {{ padding: 7px 22px; border-radius: 8px; }}
QMenu::item:selected {{ background: {g['TINT']}; }}
QDialog {{ background: {g['BG']}; }}
QMessageBox {{ background: {g['PANEL']}; }}
"""


def apply(mode: str = "auto", app=None) -> str:
    """Activate 'light' | 'dark' | 'auto' (follow the OS). Returns the stylesheet and installs it on `app` if given."""
    global MODE, QSS
    eff = system_mode(app) if mode == "auto" else ("light" if mode == "light" else "dark")
    pal = LIGHT if eff == "light" else DARK
    g = globals()
    for k, v in pal.items():
        g[k] = v
    MODE = eff
    QSS = _build(pal)
    if app is not None:
        app.setStyleSheet(QSS)
    for cb in list(_listeners):
        try:
            cb(eff)
        except Exception:
            pass
    return QSS


apply("dark")  # sensible default at import time (tests/tools that never call apply())
