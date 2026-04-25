from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from typing import Any


@dataclass
class PathMetric:
    count: int = 0
    errors_4xx: int = 0
    errors_5xx: int = 0
    total_ms: float = 0.0
    last_status: int | None = None
    last_ms: float | None = None
    samples_ms: deque[float] = field(default_factory=lambda: deque(maxlen=400))


class RuntimeMetricsStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._started_at = datetime.now(UTC)
        self._in_flight = 0
        self._total_requests = 0
        self._errors_4xx = 0
        self._errors_5xx = 0
        self._samples_ms: deque[float] = deque(maxlen=2000)
        self._paths: dict[str, PathMetric] = {}

    def request_started(self) -> None:
        with self._lock:
            self._in_flight += 1

    def request_finished(self, *, path: str, status_code: int, duration_ms: float) -> None:
        with self._lock:
            self._in_flight = max(self._in_flight - 1, 0)
            self._total_requests += 1
            self._samples_ms.append(duration_ms)
            pm = self._paths.setdefault(path, PathMetric())
            pm.count += 1
            pm.total_ms += duration_ms
            pm.last_status = status_code
            pm.last_ms = duration_ms
            pm.samples_ms.append(duration_ms)
            if 400 <= status_code <= 499:
                self._errors_4xx += 1
                pm.errors_4xx += 1
            elif status_code >= 500:
                self._errors_5xx += 1
                pm.errors_5xx += 1

    @staticmethod
    def _percentile(samples: list[float], p: float) -> float:
        if not samples:
            return 0.0
        ordered = sorted(samples)
        idx = int(round((len(ordered) - 1) * p))
        return float(ordered[max(0, min(idx, len(ordered) - 1))])

    def snapshot(self, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            total = self._total_requests
            err4 = self._errors_4xx
            err5 = self._errors_5xx
            samples = list(self._samples_ms)
            uptime_sec = int((datetime.now(UTC) - self._started_at).total_seconds())
            paths: list[tuple[str, PathMetric]] = list(self._paths.items())
            in_flight = self._in_flight
            started_at = self._started_at

        path_rows = []
        for path, pm in sorted(paths, key=lambda x: x[1].count, reverse=True)[:15]:
            avg_ms = (pm.total_ms / pm.count) if pm.count else 0.0
            path_rows.append(
                {
                    "path": path,
                    "count": pm.count,
                    "errors_4xx": pm.errors_4xx,
                    "errors_5xx": pm.errors_5xx,
                    "avg_ms": round(avg_ms, 2),
                    "p95_ms": round(self._percentile(list(pm.samples_ms), 0.95), 2),
                    "last_status": pm.last_status,
                    "last_ms": round(pm.last_ms or 0.0, 2),
                }
            )

        avg_ms = (sum(samples) / len(samples)) if samples else 0.0
        out = {
            "started_at": started_at.isoformat(),
            "uptime_sec": uptime_sec,
            "in_flight": in_flight,
            "total_requests": total,
            "errors_4xx": err4,
            "errors_5xx": err5,
            "error_rate_pct": round(((err4 + err5) / total * 100.0), 2) if total else 0.0,
            "latency": {
                "avg_ms": round(avg_ms, 2),
                "p50_ms": round(self._percentile(samples, 0.50), 2),
                "p95_ms": round(self._percentile(samples, 0.95), 2),
                "p99_ms": round(self._percentile(samples, 0.99), 2),
            },
            "top_paths": path_rows,
        }
        if extra:
            out["extra"] = extra
        return out


runtime_metrics = RuntimeMetricsStore()
