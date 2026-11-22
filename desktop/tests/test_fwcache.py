import hashlib
from types import SimpleNamespace as NS

from app.core.fwcache import FirmwareStore


def _bundle(tmp_path, name, data_app: bytes, data_boot: bytes = b"boot"):
    paths = {}
    files = []
    for fn, addr, data in (("bootloader.bin", 0x1000, data_boot), ("firmware.bin", 0x10000, data_app)):
        p = tmp_path / f"{name}_{fn}"
        p.write_bytes(data)
        paths[fn] = p
        files.append(NS(filename=fn, address=addr, size=len(data), sha256=hashlib.sha256(data).hexdigest()))
    return NS(board="esp32-generic", family="esp32", files=tuple(files)), paths


def test_keeps_only_last_five_and_gc_blobs(tmp_path):
    st = FirmwareStore(tmp_path / "fw", keep=5)
    shas = []
    for i in range(7):
        m, paths = _bundle(tmp_path, f"b{i}", f"app{i}".encode())
        st.save(m, paths, f"job{i}")
        shas.append(m.files[-1].sha256)
    kept = [b["app_sha256"] for b in st.list()]
    assert kept == list(reversed(shas[2:]))  # newest first, 5 versions
    assert st.find(shas[0], len(b"app0")) is None  # evicted
    assert st.find(shas[6], len(b"app6")) is not None
    boot_sha = hashlib.sha256(b"boot").hexdigest()
    assert st.find(boot_sha, 4) is not None  # shared blob stays while referenced


def test_same_firmware_is_moved_to_front_not_duplicated(tmp_path):
    st = FirmwareStore(tmp_path / "fw", keep=5)
    for name, data in (("a", b"one"), ("b", b"two"), ("c", b"one")):
        m, p = _bundle(tmp_path, name, data)
        st.save(m, p)
    lst = st.list()
    assert len(lst) == 2
    assert lst[0]["app_sha256"] == hashlib.sha256(b"one").hexdigest()


def test_corrupted_blob_is_not_used(tmp_path):
    st = FirmwareStore(tmp_path / "fw", keep=5)
    m, p = _bundle(tmp_path, "x", b"good-firmware")
    st.save(m, p)
    sha = m.files[-1].sha256
    assert st.find(sha, len(b"good-firmware")) is not None
    (tmp_path / "fw" / "blobs" / sha).write_bytes(b"evil-firmware")
    assert st.find(sha, len(b"good-firmware")) is None
    assert st.find(sha, 3) is None  # wrong size


def test_keep_zero_disables(tmp_path):
    st = FirmwareStore(tmp_path / "fw", keep=0)
    m, p = _bundle(tmp_path, "x", b"abc")
    st.save(m, p)
    assert st.list() == [] and st.find(m.files[-1].sha256, 3) is None
