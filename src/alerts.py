"""Telegram alerts (CLAUDE.md 7.2, 2.1 rule 7).

Only ever sends to the owner's chat (TELEGRAM_CHAT_ID). Token and chat id come from env vars
(GitHub Secrets) and are never printed. Message content is never logged (public Actions logs).
Stage 2B adds de-duplication and the alert rules on top of `send_telegram`.
"""

from __future__ import annotations

import os

import requests

from src import log
from src.fetch import HTTP_TIMEOUT, with_retries

API = "https://api.telegram.org/bot{token}/{method}"


def telegram_configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


def send_telegram(text: str, *, silent: bool = False) -> bool:
    """Send a message to the owner's chat. Returns True on success, never raises."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        log.error("telegram: not configured")
        return False

    def _send() -> bool:
        r = requests.post(
            API.format(token=token, method="sendMessage"),
            json={
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": True,
                "disable_notification": silent,
            },
            timeout=HTTP_TIMEOUT,
        )
        r.raise_for_status()
        return bool(r.json().get("ok"))

    return bool(with_retries(_send, "telegram send"))
