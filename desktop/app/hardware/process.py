"""Safe subprocess execution: argv lists only, never a shell."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from typing import Callable, Sequence


class ToolRunResult:
    def __init__(self, returncode: int, lines: list[str], cancelled: bool, timed_out: bool) -> None:
        self.returncode = returncode
        self.lines = lines
        self.cancelled = cancelled
        self.timed_out = timed_out

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.cancelled and not self.timed_out

    def tail(self, n: int = 25) -> str:
        return "\n".join(self.lines[-n:])


_SPLIT = re.compile(rb"[\r\n]+")
_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def run_tool(
    argv: Sequence[str],
    on_line: Callable[[str], None] | None = None,
    cancel: threading.Event | None = None,
    timeout: float = 300,
    cwd: str | None = None,
) -> ToolRunResult:
    """Run an external flashing tool. `argv` must be a list; shell is never used."""
    if isinstance(argv, str):  # defensive: a str would be a shell-injection foot-gun
        raise TypeError("argv must be a sequence of strings")
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    env = {k: v for k, v in os.environ.items() if k.upper() not in ("PYTHONPATH", "PYTHONHOME")}
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.Popen(
        list(argv), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        shell=False, cwd=cwd, env=env, creationflags=flags,
    )
    lines: list[str] = []

    def reader() -> None:
        assert proc.stdout is not None
        buf = b""
        while True:
            chunk = proc.stdout.read1(4096) if hasattr(proc.stdout, "read1") else proc.stdout.read(1)  # type: ignore[attr-defined]
            if not chunk:
                break
            buf += chunk
            parts = _SPLIT.split(buf)
            buf = parts.pop()
            for p in parts:
                if p:
                    text = _ANSI.sub("", p.decode("utf-8", "replace")).rstrip()
                    if text:
                        lines.append(text)
                        if len(lines) > 2000:
                            del lines[:500]
                        if on_line:
                            on_line(text)
        if buf:
            text = _ANSI.sub("", buf.decode("utf-8", "replace")).rstrip()
            if text:
                lines.append(text)
                if on_line:
                    on_line(text)

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    cancelled = timed_out = False
    deadline = time.monotonic() + timeout
    while proc.poll() is None:
        if cancel is not None and cancel.is_set():
            cancelled = True
        if time.monotonic() > deadline:
            timed_out = True
        if cancelled or timed_out:
            proc.terminate()
            try:
                proc.wait(3)
            except subprocess.TimeoutExpired:
                proc.kill()
            break
        time.sleep(0.05)
    t.join(2)
    return ToolRunResult(proc.returncode if proc.returncode is not None else -1, lines, cancelled, timed_out)
