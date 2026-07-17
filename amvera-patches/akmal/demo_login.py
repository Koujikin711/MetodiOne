"""
StarMIX (Amvera project `akmal`) — passwordless sandbox login.

Wire into the FastAPI app next to the existing `/api/auth/login` router:

    from demo_login import router as demo_login_router
    app.include_router(demo_login_router, prefix="/api/auth", tags=["auth"])

Also serve `demo.html` at GET `/demo` *before* the SPA catch-all
(see `mount_demo_page` below), same pattern as FuelOps / CraftLine / StaffDesk.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

router = APIRouter()

# Seed accounts already present in the StarMIX frontend when PRODUCTION=false.
# demo-login prefers an existing director; otherwise creates a sandbox user.
DEMO_EMAIL = os.getenv("DEMO_LOGIN_EMAIL", "demo.starmix@gmail.com")
DEMO_PASSWORD = os.getenv("DEMO_LOGIN_PASSWORD", "StudioDemo2026")
DEMO_NAME = os.getenv("DEMO_LOGIN_NAME", "Демо-директор")
DEMO_ROLE = os.getenv("DEMO_LOGIN_ROLE", "director")


def mount_demo_page(app: Any, html_path: Optional[Path] = None) -> None:
    """Register GET /demo that returns the passwordless entry HTML."""
    path = html_path or Path(__file__).with_name("demo.html")
    html = path.read_text(encoding="utf-8")

    @app.get("/demo", include_in_schema=False)
    async def demo_entry() -> HTMLResponse:
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})


def _build_router(
    *,
    get_user_by_email: Callable[[str], Any],
    create_sandbox_user: Callable[[str, str, str, str], Any],
    issue_access_token: Callable[[Any], str],
    verify_password: Optional[Callable[[str, str], bool]] = None,
    prefer_emails: Optional[list[str]] = None,
) -> APIRouter:
    """
    Factory used when integrating into the real StarMIX codebase.

    Pass project-specific DB/auth helpers from akmal's auth module.
    """
    emails = prefer_emails or [
        DEMO_EMAIL,
        "director@stroymat.ru",
        "admin@starmix.local",
    ]

    @router.post("/demo-login")
    async def demo_login() -> dict[str, str]:
        if os.getenv("PRODUCTION", "").lower() in {"1", "true", "yes"} and os.getenv(
            "ALLOW_DEMO_LOGIN", "true"
        ).lower() in {"0", "false", "no"}:
            raise HTTPException(status_code=403, detail="Demo login disabled")

        user = None
        for email in emails:
            user = get_user_by_email(email)
            if user is not None:
                break

        if user is None:
            user = create_sandbox_user(DEMO_EMAIL, DEMO_PASSWORD, DEMO_NAME, DEMO_ROLE)

        token = issue_access_token(user)
        return {"access_token": token, "token_type": "bearer"}

    return router


# Default export when helpers are monkey-patched after import (optional).
__all__ = ["router", "mount_demo_page", "_build_router", "DEMO_EMAIL", "DEMO_PASSWORD"]
