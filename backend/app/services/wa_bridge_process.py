"""Запуск сайдкара Baileys рядом с API. Сессия лежит в persistent /app/data."""

from __future__ import annotations

import logging
import os
import secrets
import shutil
import subprocess
import threading
import time
from pathlib import Path

from app.services.chat_media_store import chat_media_directory

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_stop = threading.Event()
_thread: threading.Thread | None = None
_proc: subprocess.Popen[bytes] | None = None


def data_root() -> Path:
    media = chat_media_directory()
    if media.name == "chat_media":
        return media.parent
    return media


def bridge_script() -> Path | None:
    here = Path(__file__).resolve()
    candidates = [
        Path("/app/wa_bridge/index.js"),
        here.parents[3] / "wa_bridge" / "index.js",
        here.parents[2] / "wa_bridge" / "index.js",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def bridge_token() -> str:
    path = data_root() / ".wa-bridge-token"
    try:
        if path.is_file():
            raw = path.read_text(encoding="utf-8").strip()
            if raw:
                return raw
    except OSError:
        pass
    token = secrets.token_hex(24)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
        os.chmod(path, 0o600)
    except OSError:
        logger.warning("wa bridge token file was not saved")
    return token


def _api_port() -> str:
    # uvicorn в образе слушает 8000. PORT у Amvera может быть служебным портом прокси.
    return str(os.environ.get("WA_BRIDGE_API_PORT") or "8000")


def _node_bin() -> str:
    chosen = (os.environ.get("WA_BRIDGE_NODE") or "").strip()
    if chosen:
        return chosen
    for name in ("node", "nodejs"):
        found = shutil.which(name)
        if found:
            return found
    return "node"


def _loop(script: Path) -> None:
    global _proc
    node = _node_bin()
    while not _stop.is_set():
        env = os.environ.copy()
        env["DATA_DIR"] = str(data_root())
        env["WA_BRIDGE_PORT"] = os.environ.get("WA_BRIDGE_PORT") or "8766"
        env["WA_BRIDGE_TOKEN"] = bridge_token()
        env["WEBHOOK_URL"] = (
            os.environ.get("WA_BRIDGE_WEBHOOK_URL")
            or f"http://127.0.0.1:{_api_port()}/api/integrations/wa-bridge/incoming"
        )
        env["BAILEYS_LOG"] = os.environ.get("BAILEYS_LOG") or "warn"
        env.setdefault("NODE_OPTIONS", "--max-old-space-size=128")
        try:
            proc = subprocess.Popen(
                [node, str(script)],
                cwd=str(script.parent),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            logger.warning("wa bridge did not start: %s", exc)
            return
        with _lock:
            _proc = proc
        while not _stop.is_set():
            if proc.poll() is not None:
                break
            time.sleep(0.5)
        if _stop.is_set():
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            break
        time.sleep(3)
    with _lock:
        _proc = None


def start_wa_bridge() -> None:
    global _thread
    if os.environ.get("WA_BRIDGE_DISABLED") == "1":
        return
    script = bridge_script()
    if script is None:
        logger.warning("wa bridge script is missing")
        return
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        _stop.clear()
        _thread = threading.Thread(target=_loop, args=(script,), name="wa-bridge", daemon=True)
        _thread.start()


def stop_wa_bridge() -> None:
    _stop.set()
    with _lock:
        proc = _proc
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
