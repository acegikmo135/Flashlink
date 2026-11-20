"""Tiny HTTPS helpers on urllib (honours Windows system proxy + cert store)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from app.core.config import APP_VERSION

UA = f"MCUBridge/{APP_VERSION}"


class HttpError(Exception):
    def __init__(self, status: int, body: str = "") -> None:
        super().__init__(f"HTTP {status}: {body[:200]}")
        self.status = status
        self.body = body


def post_json(url: str, payload: dict, token: str | None = None, timeout: float = 20) -> dict:
    headers = {"content-type": "application/json", "user-agent": UA}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, json.dumps(payload).encode(), headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read().decode("utf-8", "replace")) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ConnectionError(str(e)) from e


def get_json(url: str, token: str | None = None, timeout: float = 20) -> dict:
    headers = {"user-agent": UA}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read().decode("utf-8", "replace")) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ConnectionError(str(e)) from e
