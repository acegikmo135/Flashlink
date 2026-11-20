"""Real-browser test of the web app (headless Chromium via Playwright for Node)."""
import json
import os
import subprocess
import shutil

import pytest

from conftest import BASE


@pytest.mark.skipif(shutil.which("node") is None, reason="node required")
def test_web_ui_end_to_end(stack, agent, tmp_path):
    out = os.environ.get("MCUB_WEB_SHOTS", "/tmp/mcub-web-shots")
    node_path = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
    r = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "web_ui.cjs"), BASE, out, "e2e@example.com", "correct-horse-battery"], capture_output=True, text=True, env={**os.environ, "NODE_PATH": node_path}, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    results = json.loads(r.stdout.strip().splitlines()[-1])
    failed = [x for x in results if not x["ok"]]
    assert not failed, failed
