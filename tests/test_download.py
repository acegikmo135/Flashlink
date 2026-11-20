"""The Worker serves the installer from static-asset parts as one resumable file."""
import hashlib

from conftest import BASE, http


def get(headers=None, method="GET"):
    s, body, h = http(method, BASE + "/download/MCUBridge-Setup.exe", None, headers or {})
    return s, body, {k.lower(): v for k, v in h.items()}  # header names are case-insensitive


def test_full_download_is_reassembled_exactly(stack):
    s, body, h = get()
    assert s == 200 and body == stack.installer
    assert h["content-length"] == str(len(stack.installer)) and h["accept-ranges"] == "bytes"
    assert h["x-sha256"] == hashlib.sha256(stack.installer).hexdigest()
    assert "attachment" in h["content-disposition"] and "MCUBridge-Setup.exe" in h["content-disposition"]


def test_head_has_headers_and_no_body(stack):
    s, body, h = get(method="HEAD")
    assert s == 200 and body == b"" and h["content-length"] == str(len(stack.installer))


def test_ranges_including_across_part_boundaries(stack):
    data = stack.installer
    for rng, (a, b) in {"bytes=0-9": (0, 9), "bytes=995-1005": (995, 1005), "bytes=1990-2010": (1990, 2010), "bytes=2400-": (2400, len(data) - 1), "bytes=-100": (len(data) - 100, len(data) - 1), "bytes=500-2400": (500, 2400)}.items():
        s, body, h = get({"Range": rng})
        assert s == 206, rng
        assert body == data[a : b + 1], rng
        assert h["content-range"] == f"bytes {a}-{b}/{len(data)}"


def test_invalid_ranges_and_etag(stack):
    for bad in ("bytes=99999-", "bytes=5-2", "bytes=-0", "pages=1-2", "bytes=-"):
        s, _, h = get({"Range": bad})
        assert s == 416 and h["content-range"] == f"bytes */{len(stack.installer)}", bad
    s, _, h = get()
    s2, body, _ = get({"If-None-Match": h["etag"]})
    assert s2 == 304 and body == b""


def test_resume_simulation_matches_full_download(stack):
    """A client that got the first N bytes then resumes with Range must end with the identical file."""
    first = stack.installer[:1337]
    s, rest, _ = get({"Range": "bytes=1337-"})
    assert s == 206 and first + rest == stack.installer


def test_dashboard_config_points_to_edge_route(stack):
    s, d = stack.web.get("/api/web/session")
    assert d["config"]["installer_url"] == BASE + "/download/MCUBridge-Setup.exe"
