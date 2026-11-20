"""Generate assets/icon.ico (run once; the .ico is committed). Needs PySide6."""
import os
import sys
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).parent))
from PySide6.QtGui import QGuiApplication, QImage  # noqa: E402

from app.ui.app import make_icon  # noqa: E402
from app.ui import theme  # noqa: E402

app = QGuiApplication([])
out = Path(__file__).parent / "assets"
out.mkdir(exist_ok=True)
pm = make_icon(256, "#0b0b0c", "#e8e8ea").pixmap(256, 256)
img: QImage = pm.toImage()
print("ico:", img.save(str(out / "icon.ico"), "ICO"), "png:", img.save(str(out / "icon.png"), "PNG"))
