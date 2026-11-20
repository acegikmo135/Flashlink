"""Run blocking work off the UI thread and deliver the result back on it."""
from __future__ import annotations

import threading
from typing import Any, Callable

from PySide6.QtCore import QObject, Qt, Signal

_live: set = set()


class _Job(QObject):
    done = Signal(object, object)
    progress = Signal(float, str)


def run_async(fn: Callable[..., Any], on_done: Callable[[Any, Exception | None], None], on_progress: Callable[[float, str], None] | None = None, with_progress: bool = False) -> None:
    job = _Job()
    _live.add(job)

    def finish(res, err) -> None:
        _live.discard(job)
        on_done(res, err)

    job.done.connect(finish, Qt.QueuedConnection)
    if on_progress:
        job.progress.connect(on_progress, Qt.QueuedConnection)

    def work() -> None:
        try:
            res = fn(job.progress.emit) if with_progress else fn()
            job.done.emit(res, None)
        except Exception as e:  # delivered to the UI, never lost
            job.done.emit(None, e)

    threading.Thread(target=work, daemon=True, name="ui-task").start()
