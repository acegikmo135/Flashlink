"""Visual language: dark-first, monochrome, hairline borders, restrained colour."""
from __future__ import annotations

BG = "#0b0b0c"
PANEL = "#111113"
RAISED = "#16161a"
LINE = "#222226"
LINE2 = "#2e2e34"
FG = "#e8e8ea"
MUTED = "#8b8b93"
DIM = "#5b5b63"
OK = "#9be3b0"
WARN = "#e6c27a"
ERR = "#f08a8a"

UI_FONT = '"Segoe UI Variable Text", "Segoe UI", "Inter", "Helvetica Neue", sans-serif'
MONO_FONT = '"Cascadia Mono", "JetBrains Mono", "Consolas", "DejaVu Sans Mono", monospace'

QSS = f"""
* {{ font-family: {UI_FONT}; font-size: 13px; color: {FG}; outline: none; }}
QMainWindow, QWidget#root, QStackedWidget, QWidget#page {{ background: {BG}; }}
QWidget#sidebar {{ background: {BG}; border-right: 1px solid {LINE}; }}
QLabel {{ background: transparent; }}
QLabel#h1 {{ font-size: 20px; font-weight: 600; letter-spacing: -0.2px; }}
QLabel#h2 {{ font-size: 11px; font-weight: 600; color: {MUTED}; letter-spacing: 1.2px; }}
QLabel#muted {{ color: {MUTED}; }}
QLabel#dim {{ color: {DIM}; font-size: 12px; }}
QLabel#mono, QPlainTextEdit#mono, QLabel#code {{ font-family: {MONO_FONT}; font-size: 12px; }}
QLabel#code {{ font-size: 28px; letter-spacing: 6px; }}
QLabel#brand {{ font-weight: 600; letter-spacing: 2px; font-size: 12px; }}
QFrame#card {{ background: {PANEL}; border: 1px solid {LINE}; border-radius: 3px; }}
QFrame#hline {{ background: {LINE}; max-height: 1px; min-height: 1px; border: none; }}
QPushButton {{ background: transparent; border: 1px solid {LINE2}; border-radius: 3px; padding: 6px 14px; color: {FG}; }}
QPushButton:hover {{ border-color: {MUTED}; background: {RAISED}; }}
QPushButton:pressed {{ background: {LINE}; }}
QPushButton:disabled {{ color: {DIM}; border-color: {LINE}; }}
QPushButton#primary {{ background: {FG}; color: {BG}; border-color: {FG}; font-weight: 600; }}
QPushButton#primary:hover {{ background: #ffffff; }}
QPushButton#danger {{ color: {ERR}; }}
QPushButton#danger:hover {{ border-color: {ERR}; }}
QPushButton#nav {{ border: none; border-radius: 0; text-align: left; padding: 9px 20px; color: {MUTED}; border-left: 2px solid transparent; }}
QPushButton#nav:hover {{ color: {FG}; background: transparent; }}
QPushButton#nav[active="true"] {{ color: {FG}; border-left: 2px solid {FG}; background: {PANEL}; }}
QPushButton#link {{ border: none; padding: 2px 0; color: {MUTED}; text-align: left; }}
QPushButton#link:hover {{ color: {FG}; background: transparent; }}
QTableWidget {{ background: {PANEL}; border: 1px solid {LINE}; gridline-color: {LINE}; selection-background-color: {RAISED}; selection-color: {FG}; }}
QTableWidget::item {{ padding: 6px 10px; border-bottom: 1px solid {LINE}; }}
QHeaderView::section {{ background: {PANEL}; color: {MUTED}; border: none; border-bottom: 1px solid {LINE}; padding: 8px 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; }}
QPlainTextEdit {{ background: {PANEL}; border: 1px solid {LINE}; border-radius: 3px; padding: 8px; selection-background-color: {LINE2}; }}
QLineEdit, QSpinBox, QComboBox {{ background: {BG}; border: 1px solid {LINE2}; border-radius: 3px; padding: 5px 8px; selection-background-color: {LINE2}; }}
QLineEdit:focus, QSpinBox:focus, QComboBox:focus {{ border-color: {MUTED}; }}
QComboBox::drop-down {{ border: none; width: 18px; }}
QComboBox QAbstractItemView {{ background: {PANEL}; border: 1px solid {LINE2}; selection-background-color: {RAISED}; }}
QCheckBox {{ spacing: 9px; }}
QCheckBox::indicator {{ width: 14px; height: 14px; border: 1px solid {LINE2}; border-radius: 2px; background: {BG}; }}
QCheckBox::indicator:checked {{ background: {FG}; border-color: {FG}; image: none; }}
QScrollBar:vertical {{ background: transparent; width: 9px; margin: 0; }}
QScrollBar::handle:vertical {{ background: {LINE2}; min-height: 24px; border-radius: 4px; }}
QScrollBar::add-line, QScrollBar::sub-line, QScrollBar::add-page, QScrollBar::sub-page {{ background: none; height: 0; }}
QToolTip {{ background: {RAISED}; color: {FG}; border: 1px solid {LINE2}; padding: 4px 6px; }}
QMenu {{ background: {PANEL}; border: 1px solid {LINE2}; padding: 4px; }}
QMenu::item {{ padding: 6px 22px; }}
QMenu::item:selected {{ background: {RAISED}; }}
"""
