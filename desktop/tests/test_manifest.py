import json
from pathlib import Path

import pytest

from app.core.manifest import check

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "test-vectors" / "manifests.json").read_text())


@pytest.mark.parametrize("v", VECTORS, ids=[v["name"] for v in VECTORS])
def test_shared_vectors(v):
    m, issues = check(v["manifest"])
    assert (m is not None) == v["valid"], issues
    codes = [i["code"] for i in issues]
    for c in v["codes"]:
        assert c in codes
