"""Build the Windows application with PyInstaller (one-folder, windowed).

    python build.py            -> dist/MCUBridge/MCUBridge.exe  (+ dist/MCUBridge-win64.zip)

Size/RAM notes: only QtCore/QtGui/QtWidgets are bundled (Qt Quick, QML,
WebEngine, Multimedia, 3D, Charts... are excluded). One-folder mode avoids the
temp-extraction cost of one-file builds, so startup is fast and no extra copy of
the runtime sits in %TEMP%.
"""
from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SEP = ";" if sys.platform == "win32" else ":"

EXCLUDES = [
    "PySide6.QtQml", "PySide6.QtQuick", "PySide6.QtQuickWidgets", "PySide6.QtQuick3D", "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
    "PySide6.QtWebChannel", "PySide6.QtMultimedia", "PySide6.QtMultimediaWidgets", "PySide6.Qt3DCore", "PySide6.QtCharts", "PySide6.QtDataVisualization",
    "PySide6.QtSql", "PySide6.QtTest", "PySide6.QtPdf", "PySide6.QtSvg", "PySide6.QtNetwork", "PySide6.QtOpenGL", "PySide6.QtBluetooth", "PySide6.QtSensors",
    "tkinter", "unittest", "pydoc", "test", "numpy",
]


# Qt parts this app never loads (QtWidgets raster rendering only). The CI self-test re-verifies startup after pruning.
PRUNE_PATTERNS = [
    "**/translations/*", "**/opengl32sw.dll", "**/d3dcompiler_47.dll", "**/Qt6Pdf*.dll", "**/Qt6Quick*.dll", "**/Qt6Qml*.dll", "**/Qt6Svg*.dll",
    "**/Qt6VirtualKeyboard*.dll", "**/Qt6OpenGL*.dll", "**/plugins/iconengines/*", "**/plugins/imageformats/qsvg*", "**/plugins/imageformats/qpdf*",
    "**/plugins/imageformats/qtiff*", "**/plugins/imageformats/qwebp*", "**/plugins/imageformats/qgif*", "**/plugins/imageformats/qicns*",
    "**/plugins/imageformats/qtga*", "**/plugins/imageformats/qwbmp*", "**/plugins/networkinformation/*", "**/plugins/tls/*",
    "**/plugins/generic/*", "**/plugins/platforminputcontexts/*", "**/*.pdb", "**/*.lib", "**/*.prl",
]


def prune(root: Path) -> list[Path]:
    removed: list[Path] = []
    for pat in PRUNE_PATTERNS:
        for f in root.glob(pat):
            if f.is_file():
                f.unlink()
                removed.append(f)
    return removed


def main() -> int:
    try:
        import PyInstaller.__main__ as pyi
    except ImportError:
        print("pip install pyinstaller", file=sys.stderr)
        return 1
    (HERE / "tools").mkdir(exist_ok=True)
    args = [
        str(HERE / "run.py"), "--noconfirm", "--clean", "--name", "MCUBridge", "--windowed", "--onedir",
        "--icon", str(HERE / "assets" / "icon.ico"), "--distpath", str(HERE / "dist"), "--workpath", str(HERE / "build"), "--specpath", str(HERE / "build"),
        "--paths", str(HERE),
        "--add-data", f"{ROOT / 'shared' / 'boards.json'}{SEP}.",
        "--add-data", f"{HERE / 'tools_manifest.json'}{SEP}.",
        "--collect-all", "esptool", "--collect-submodules", "serial.tools",
        "--hidden-import", "serial.tools.list_ports_windows", "--hidden-import", "app.ui.app",
    ]
    if (HERE / "server_url.txt").exists():
        args += ["--add-data", f"{HERE / 'server_url.txt'}{SEP}."]
    import importlib.util

    for extra in ("esp_idf_nvs_partition_gen", "espsecure", "espefuse", "esp_idf_size", "bitstring", "reedsolo", "intelhex", "yaml"):
        if importlib.util.find_spec(extra):
            args += ["--collect-all", extra]
    for m in EXCLUDES:
        args += ["--exclude-module", m]
    pyi.run(args)

    out = HERE / "dist" / "MCUBridge"
    before = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    removed = prune(out)
    after = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"pruned {len(removed)} files: {before // 1_000_000} MB -> {after // 1_000_000} MB")
    shutil.copytree(HERE / "tools", out / "tools", dirs_exist_ok=True)
    (out / "tools" / "README.txt").write_text(
        "Optional flashing utilities (not bundled; MCU Bridge never installs them silently).\n\n"
        "  avrdude.exe                  Arduino Uno/Nano/Mega        https://github.com/avrdudes/avrdude/releases\n"
        "  STM32_Programmer_CLI.exe     STM32 via ST-Link            (install STM32CubeProgrammer)\n"
        "  openocd\\bin\\openocd.exe      STM32 alternative/verify     https://openocd.org\n"
        "  wlink.exe                    CH32V003 via WCH-LinkE       https://github.com/ch32-rs/wlink/releases\n\n"
        "Drop each tool (or its folder) here, or put it on PATH. ESP32/ESP8266 need nothing extra: esptool is built in.\n",
        encoding="utf-8",
    )
    zpath = HERE / "dist" / "MCUBridge-win64.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in out.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(out.parent))
    print(f"built {out} ({sum(f.stat().st_size for f in out.rglob('*') if f.is_file()) // 1_000_000} MB), {zpath}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
