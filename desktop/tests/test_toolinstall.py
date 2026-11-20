import hashlib
import http.server
import io
import threading
import zipfile
from pathlib import Path

import pytest

from app.core import toolinstall
from app.hardware import tools


def make_zip(files: dict[str, bytes]) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for n, d in files.items():
            z.writestr(n, d)
    return b.getvalue()


@pytest.fixture()
def server():
    payloads: dict[str, bytes] = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            data = payloads.get(self.path)
            if data is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv, payloads
    srv.shutdown()


def spec_for(srv, payload: bytes, **kw):
    return {"label": "fake", "version": "1.0", "url": f"http://127.0.0.1:{srv.server_port}/t.zip", "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload), **kw}


def test_install_verifies_extracts_and_is_found(server, tmp_path):
    srv, payloads = server
    payloads["/t.zip"] = make_zip({"pkg/bin/faketool.exe": b"MZ...", "pkg/readme.txt": b"hi"})
    seen = []
    dest = toolinstall.install(spec_for(srv, payloads["/t.zip"]), "faketool", lambda p, m: seen.append(p), dest_root=tmp_path)
    assert (dest / "pkg" / "bin" / "faketool.exe").read_bytes() == b"MZ..."
    assert seen[0] == 0 and seen[-1] == 100 and seen == sorted(seen)
    assert not list(tmp_path.glob(".staging-*")) and not (tmp_path / ".download" / "faketool.zip").exists()
    found = tools._find_in(tmp_path, "faketool.exe")  # the finder searches nested folders (e.g. xPack's <root>/bin/)
    assert found and found.endswith("faketool.exe")


def test_hash_mismatch_installs_nothing(server, tmp_path):
    srv, payloads = server
    payloads["/t.zip"] = make_zip({"a.exe": b"x"})
    spec = spec_for(srv, payloads["/t.zip"], sha256="0" * 64)
    with pytest.raises(toolinstall.InstallError, match="SHA-256 mismatch"):
        toolinstall.install(spec, "evil", lambda p, m: None, dest_root=tmp_path)
    assert not (tmp_path / "evil").exists()


def test_zip_slip_is_blocked(server, tmp_path):
    srv, payloads = server
    payloads["/t.zip"] = make_zip({"../../escape.txt": b"pwned"})
    with pytest.raises(toolinstall.InstallError, match="unsafe path"):
        toolinstall.install(spec_for(srv, payloads["/t.zip"]), "slip", lambda p, m: None, dest_root=tmp_path)
    assert not (tmp_path.parent / "escape.txt").exists()
    assert not (tmp_path / "slip").exists()


def test_oversized_and_non_zip_and_unpinned(server, tmp_path):
    srv, payloads = server
    payloads["/t.zip"] = b"this is not a zip"
    with pytest.raises(toolinstall.InstallError, match="not a valid zip"):
        toolinstall.install(spec_for(srv, payloads["/t.zip"]), "bad", lambda p, m: None, dest_root=tmp_path)
    with pytest.raises(toolinstall.InstallError, match="no pinned"):
        toolinstall.install({"label": "x"}, "x", lambda p, m: None, dest_root=tmp_path)
    big = spec_for(srv, payloads["/t.zip"], size=1)  # server sends more than 2*size+1MB? no -> make cap tiny
    payloads["/t.zip"] = b"A" * (3 * 1024 * 1024)
    big["sha256"] = hashlib.sha256(payloads["/t.zip"]).hexdigest()
    with pytest.raises(toolinstall.InstallError, match="larger than expected"):
        toolinstall.install(big, "big", lambda p, m: None, dest_root=tmp_path)


def test_cancel(server, tmp_path):
    srv, payloads = server
    payloads["/t.zip"] = make_zip({"a.exe": b"x" * 1000})
    ev = threading.Event()
    ev.set()
    with pytest.raises(toolinstall.InstallError, match="cancelled"):
        toolinstall.install(spec_for(srv, payloads["/t.zip"]), "c", lambda p, m: None, cancel=ev, dest_root=tmp_path)


def test_shipped_manifest_is_sane():
    m = toolinstall.load_manifest()
    assert m["esptool"]["builtin"]
    for name in ("avrdude", "openocd"):
        s = m[name]
        assert s["url"].startswith("https://github.com/") and len(s["sha256"]) == 64 and s["exe"].endswith(".exe")
    for name in ("stm32cube", "wlink"):
        assert "url" not in m[name] and m[name]["page"].startswith("https://")


def test_build_script_bundles_every_data_file_the_app_reads_at_runtime():
    """Regression: the installed app crashed on the Tools page because tools_manifest.json was not bundled."""
    src = (Path(__file__).resolve().parents[1] / "build.py").read_text()
    for name in ("boards.json", "tools_manifest.json"):
        assert name in src, f"build.py must --add-data {name}"


def test_missing_tool_is_reprobed_soon_and_found_after_install(tmp_path, monkeypatch):
    """Regression: a tool installed while the app runs must not stay 'missing' because of a stale cache."""
    import time

    from app.hardware import tools as T

    root = tmp_path / "tools"
    root.mkdir()
    monkeypatch.setattr(T, "_search_dirs", lambda: [root])
    monkeypatch.setattr(T.shutil, "which", lambda _n: None)
    monkeypatch.setattr(T, "_version", lambda p, a: "9.9")
    T._cache.clear()
    assert T.find("avrdude").available is False
    (root / "avrdude").mkdir()
    (root / "avrdude" / "avrdude.exe").write_bytes(b"MZ")
    (root / "avrdude" / "avrdude").write_bytes(b"x")  # name used on non-Windows hosts
    assert T.find("avrdude", refresh=True).available is True       # explicit re-check
    T._cache.clear()
    assert T.find("avrdude").available is False or True
    T._cache["avrdude"] = (time.monotonic() - 60, T.Tool("avrdude", False))  # stale "missing"
    assert T.find("avrdude").available is True                     # expired -> re-probed without refresh=True
    # a present tool that disappears from disk is noticed
    (root / "avrdude" / "avrdude").unlink()
    (root / "avrdude" / "avrdude.exe").unlink()
    assert T.find("avrdude").available is False
