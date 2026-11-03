"""Равная раздача: mode none → round_robin при ensure."""

import asyncio
from types import SimpleNamespace

from app.services.lead_assignment import ensure_pipelines_equal_lead_assignment


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _Scalars(self._rows)


class _Session:
    def __init__(self, pipes):
        self.pipes = pipes
        self.flushed = False

    async def execute(self, _q):
        return _Result(self.pipes)

    async def flush(self):
        self.flushed = True


def test_ensure_sets_round_robin_from_none():
    pipe = SimpleNamespace(lead_assignment_mode="none")
    keep = SimpleNamespace(lead_assignment_mode="least_loaded")
    already = SimpleNamespace(lead_assignment_mode="round_robin")
    db = _Session([pipe, keep, already])
    out = asyncio.run(ensure_pipelines_equal_lead_assignment(db))
    assert out["updated"] == 1
    assert pipe.lead_assignment_mode == "round_robin"
    assert keep.lead_assignment_mode == "least_loaded"
    assert already.lead_assignment_mode == "round_robin"
    assert db.flushed
