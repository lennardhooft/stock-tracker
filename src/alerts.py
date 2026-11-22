"""Alerts (CLAUDE.md 7.1, 7.2, 6.5, 13.14 E) — rules, de-duplication, quiet hours, Telegram.

The rule functions are pure: data in, list of Alert out. `send_telegram` is the only I/O.
Telegram only ever sends to the owner's chat (TELEGRAM_CHAT_ID). Token, chat id and message
contents are never printed (public Actions logs).
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import requests

from src import log
from src.fetch import HTTP_TIMEOUT, with_retries

API = "https://api.telegram.org/bot{token}/{method}"
MINUS = "−"
NNBSP = " "
CUR = {"USD": "$", "EUR": "€", "GBP": "£", "CHF": "CHF ", "DKK": "kr ", "SEK": "kr "}
SHORT = {
    "T1": "price is near its 4-year average",
    "T2": "RSI is oversold",
    "T3": "the price is far below its high",
    "T4": "the price is near a major previous bottom",
    "S1": "the whole market is fearful",
}
LABELS = {"normal": "Normal", "watch": "Watch", "strong": "Strong", "extreme": "Extreme"}


@dataclass
class Alert:
    user_id: str
    symbol: str
    kind: str
    title: str
    body: str
    url: str
    extreme: bool = False


# ---------------------------------------------------------------- formatting (Belgian format)


def num(v: float, decimals: int = 2) -> str:
    """1234.5 → '1.234,50' (nl-BE), with a real minus sign."""
    s = f"{abs(v):,.{decimals}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{MINUS}{s}" if v < 0 else s


def money(v: float, currency: str | None) -> str:
    sym = CUR.get(currency or "", f"{currency} " if currency else "")
    return f"{sym.strip()} {num(v)}" if sym.strip() in ("€", "$", "£") else f"{sym}{num(v)}"


def pct(v: float, decimals: int = 1, sign: bool = False) -> str:
    s = num(v, decimals)
    if sign and v > 0:
        s = f"+{s}"
    return f"{s}{NNBSP}%"


def zone_range(z: dict[str, Any], currency: str | None) -> str:
    if abs(z["high"] / z["low"] - 1) < 0.005:
        return money(z["low"], currency)
    return f"{money(z['low'], currency)}–{money(z['high'], currency)}"


def score_line(r: dict[str, Any]) -> str:
    if r.get("score") is None:
        return "Bottom Score: not scored yet"
    label = LABELS.get(r.get("label") or "normal", "Normal")
    return f"Bottom Score: {num(r['score'], 0)}/{num(r['max_score'], 0)} ({label})"


def price_line(r: dict[str, Any], price: float, cur: str | None, word: str = "Price") -> str:
    return f"{word} {money(price, cur)} · {pct(r.get('change_pct') or 0, sign=True)} today"


def link(cfg: dict[str, Any], symbol: str | None = None) -> str:
    base = str(cfg.get("app_url", "")).rstrip("/")
    if not base:
        return ""
    return f"{base}/#/ticker/{symbol}" if symbol else f"{base}/#/more/health"


def format_message(a: Alert) -> str:
    """Plain-text Telegram message: title, body, link (7.2)."""
    parts = [a.title, a.body]
    if a.url:
        parts.append(f"▶ {a.url}")
    return "\n".join(p for p in parts if p)


# ---------------------------------------------------------------- rules


def _support_zones(r: dict[str, Any], kcfg: dict[str, Any]) -> list[dict[str, Any]]:
    tfs = set(kcfg.get("timeframes", ["Y", "M"]))
    return [
        z
        for z in (r.get("zones") or [])
        if z.get("role") == "support"
        and set(z.get("tfs", [])) & tfs
        and z.get("touches", 0) >= int(kcfg.get("min_touches", 2))
    ]


def evaluate(
    rows: list[dict[str, Any]],
    alert_cfg: dict[str, Any],
    threshold: float,
    data_problem: dict[str, Any] | None = None,
) -> list[Alert]:
    """All alerts that the current data triggers, before de-duplication.

    rows: one dict per (owner, ticker) with price, prev_close, currency, change_pct, score,
          max_score, label, prev_score, buy_below, signals, zones, error, suspect, user_id, symbol.
    data_problem: {"user_id": ..., "suspect": n, "errors": n, "failed": bool} or None.
    """
    k = alert_cfg.get("kinds", {})
    on = lambda name: bool(k.get(name, {}).get("enabled"))  # noqa: E731
    out: list[Alert] = []
    for r in rows:
        # unscored or suspect data never triggers a price alert (13.14 E)
        if r.get("error") or r.get("price") is None or r.get("suspect"):
            continue
        sym, cur, price = r["symbol"], r.get("currency"), float(r["price"])
        url = link(alert_cfg, sym)
        extreme = r.get("label") == "extreme"

        # Bottom Score crosses up to >= threshold (7.1 "Score change")
        score, prev = r.get("score"), r.get("prev_score")
        if (
            on("score_cross")
            and score is not None
            and score >= threshold
            and (prev is None or prev < threshold)
        ):
            fired = [
                SHORT.get(s["code"], s["code"])
                for s in r.get("signals") or []
                if s.get("passed") is True
            ]
            why = (
                ", ".join(fired[:-1]) + (" and " if len(fired) > 1 else "") + fired[-1]
                if fired
                else ""
            )
            out.append(
                Alert(
                    r["user_id"],
                    sym,
                    "score_cross",
                    f"🟠 {sym}: {num(score, 0)}/{num(r['max_score'], 0)} bottom signals",
                    f"{why[:1].upper() + why[1:]}.\n{price_line(r, price, cur)}\n"
                    "Worth researching, not a buy signal.",
                    url,
                    extreme,
                )
            )

        # Price at or below the owner's buy level (7.1 "Price target hit")
        level = r.get("buy_below")
        if on("buy_level") and level and price <= float(level):
            out.append(
                Alert(
                    r["user_id"],
                    sym,
                    "buy_level",
                    f"🔔 {sym} reached your buy level",
                    f"Price {money(price, cur)} ≤ your level {money(float(level), cur)}\n"
                    f"{score_line(r)}",
                    url,
                    extreme,
                )
            )

        # Big daily drop / rise at the close (intraday version: stage 2D)
        chg = r.get("change_pct")
        if chg is not None:
            if on("drop") and chg <= -float(k["drop"].get("pct", 5)):
                out.append(
                    Alert(
                        r["user_id"],
                        sym,
                        "drop",
                        f"🔻 {sym} {pct(chg)} today ({money(price, cur)})",
                        score_line(r),
                        url,
                        extreme,
                    )
                )
            if on("rise") and chg >= float(k["rise"].get("pct", 5)):
                out.append(
                    Alert(
                        r["user_id"],
                        sym,
                        "rise",
                        f"🔺 {sym} {pct(chg, sign=True)} today ({money(price, cur)})",
                        score_line(r),
                        url,
                        extreme,
                    )
                )

        # Support zones (6.5): testing / broke below
        if on("support_test") or on("support_break"):
            prev_close = r.get("prev_close")
            for z in _support_zones(r, k.get("support_test", {})):
                dist = abs(z.get("distance_pct", 99))
                if on("support_test") and dist <= float(k["support_test"].get("within_pct", 2)):
                    years = ", ".join(str(y) for y in z.get("years", [])[-4:])
                    what = "bottoms" if z.get("lows", 1) >= z.get("highs", 0) else "ceilings"
                    out.append(
                        Alert(
                            r["user_id"],
                            sym,
                            "support_test",
                            f"🟢 {sym} is testing support {zone_range(z, cur)}",
                            f"{z['touches']} previous {what} ({years}) · "
                            f"price {money(price, cur)}\n{score_line(r)}",
                            url,
                            extreme,
                        )
                    )
                    break
            if on("support_break") and prev_close is not None:
                for z in _support_zones(r, k.get("support_break", {})):
                    if float(prev_close) >= z["low"] > price:
                        out.append(
                            Alert(
                                r["user_id"],
                                sym,
                                "support_break",
                                f"⚠️ {sym} broke below support {zone_range(z, cur)}",
                                f"{price_line(r, price, cur, 'Close')}\n{score_line(r)}",
                                url,
                                extreme,
                            )
                        )
                        break

    if (
        on("data_problem")
        and data_problem
        and (
            data_problem.get("failed") or data_problem.get("suspect") or data_problem.get("errors")
        )
    ):
        bits = []
        if data_problem.get("suspect"):
            n = data_problem["suspect"]
            bits.append(f"{n} stock{'s' if n != 1 else ''} with suspect prices")
        if data_problem.get("errors"):
            n = data_problem["errors"]
            bits.append(f"{n} stock{'s' if n != 1 else ''} without price data")
        if data_problem.get("failed"):
            bits.append("the database update failed")
        out.append(
            Alert(
                data_problem["user_id"],
                "_data",
                "data_problem",
                "⚠️ Data check: " + "; ".join(bits),
                "Affected stocks are left out of the scores until the data is confirmed.",
                link(alert_cfg),
            )
        )
    return out


def dedupe(alerts: list[Alert], already_sent: set[tuple[str, str, str]]) -> list[Alert]:
    """Drop alerts whose (user_id, symbol, kind) was already sent today (7.2)."""
    seen = set(already_sent)
    out = []
    for a in alerts:
        key = (a.user_id, a.symbol, a.kind)
        if key not in seen:
            seen.add(key)
            out.append(a)
    return out


def in_quiet_hours(now_utc: datetime, cfg: dict[str, Any]) -> bool:
    q = cfg.get("quiet_hours", {})
    if not q.get("enabled"):
        return False
    local = now_utc.astimezone(ZoneInfo(q.get("timezone", "Europe/Brussels"))).time()
    start = time.fromisoformat(q.get("start", "23:00"))
    end = time.fromisoformat(q.get("end", "07:00"))
    return (local >= start or local < end) if start > end else (start <= local < end)


def apply_quiet_hours(alerts: list[Alert], now_utc: datetime, cfg: dict[str, Any]) -> list[Alert]:
    """During quiet hours only allowed kinds with an Extreme score pass (7.2)."""
    if not in_quiet_hours(now_utc, cfg):
        return alerts
    allowed = set(cfg.get("quiet_hours", {}).get("allow_kinds_when_quiet", []))
    return [a for a in alerts if a.kind in allowed and a.extreme]


def brussels_day(now_utc: datetime) -> str:
    return now_utc.astimezone(ZoneInfo("Europe/Brussels")).strftime("%Y-%m-%d")


def to_log_row(a: Alert, delivered: bool, sent_at: str) -> dict[str, Any]:
    d = asdict(a)
    d.pop("extreme")
    return {**d, "delivered": delivered, "sent_at": sent_at}


# ---------------------------------------------------------------- Telegram


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
