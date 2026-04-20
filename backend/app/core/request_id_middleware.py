from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.request_context import request_id_ctx

logger = logging.getLogger("crm.request")


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())[:12]
        token = request_id_ctx.set(rid)
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            ms = (time.perf_counter() - t0) * 1000
            logger.exception("request_failed rid=%s path=%s %.1fms", rid, request.url.path, ms)
            raise
        else:
            ms = (time.perf_counter() - t0) * 1000
            response.headers["X-Request-Id"] = rid
            if request.url.path not in ("/health",):
                logger.info(
                    "rid=%s %s %s -> %s %.1fms",
                    rid,
                    request.method,
                    request.url.path,
                    getattr(response, "status_code", "?"),
                    ms,
                )
            return response
        finally:
            request_id_ctx.reset(token)
