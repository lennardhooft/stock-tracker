"""Intraday checks (CLAUDE.md 7.1): big moves, volume spikes, buy levels, breaking news.

Pure rule functions + small helpers that turn yfinance frames into per-ticker numbers.
Alerts reuse src/alerts.py (formatting, de-dup kinds, Telegram).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd

from src.alerts import Alert, link, money, pct, score_line


def day_stats(
    daily: pd.DataFrame | None, intraday: pd.DataFrame | None, today: date
) -> dict[str, Any] | None:
    """Price now, previous close, volume so far today and the 20-day average daily volume.

    daily: daily bars (Close, Volume) incl. possibly today's partial bar.
    intraday: today's 5-minute bars (Close, Volume). Index may be tz-aware (exchange time).
    """
    if daily is None or daily.empty or intraday is None or intraday.empty:
        return None
    d = daily.dropna(subset=["Close"])
    d_dates = (
        pd.DatetimeIndex(d.index).tz_localize(None).normalize()
        if d.index.tz is not None
        else pd.DatetimeIndex(d.index).normalize()
    )
    past = d[d_dates < pd.Timestamp(today)]
    if past.empty:
        return None
    i = intraday.dropna(subset=["Close"])
    i_local = pd.DatetimeIndex(i.index)
    i_dates = (i_local.tz_localize(None) if i_local.tz is not None else i_local).normalize()
    today_bars = i[i_dates == pd.Timestamp(today)]
    if today_bars.empty:
        return None
    vols = past["Volume"].tail(20)
    return {
        "price": float(today_bars["Close"].iloc[-1]),
        "prev_close": float(past["Close"].iloc[-1]),
        "vol_today": float(today_bars["Volume"].sum()),
        "avg_vol20": float(vols.mean()) if len(vols) >= 5 else None,
    }


def evaluate_intraday(
    rows: list[dict[str, Any]], acfg: dict[str, Any], now_utc: datetime
) -> list[Alert]:
    """Intraday alerts before de-duplication.

    row: user_id, symbol, currency, price, prev_close, vol_today, avg_vol20, elapsed (0–1),
         minutes_open, buy_below, score, max_score, label, news [{headline, source, time}].
    """
    k = acfg.get("kinds", {})
    ik = acfg.get("intraday", {})
    out: list[Alert] = []
    for r in rows:
        if r.get("price") is None or not r.get("prev_close"):
            continue
        sym, cur, price = r["symbol"], r.get("currency"), float(r["price"])
        chg = (price / float(r["prev_close"]) - 1) * 100
        url = link(acfg, sym)
        extreme = r.get("label") == "extreme"
        now_txt = f"{pct(chg, sign=True)} today"

        if k.get("drop", {}).get("enabled") and chg <= -float(k["drop"].get("pct", 5)):
            news = (r.get("news") or [None])[0]
            why = f"\nNews: {news['headline']} ({news.get('source', '')})" if news else ""
            out.append(
                Alert(
                    r["user_id"],
                    sym,
                    "drop",
                    f"🔻 {sym} {pct(chg)} now ({money(price, cur)})",
                    score_line(r) + why,
                    url,
                    extreme,
                )
            )
        if k.get("rise", {}).get("enabled") and chg >= float(k["rise"].get("pct", 5)):
            out.append(
                Alert(
                    r["user_id"],
                    sym,
                    "rise",
                    f"🔺 {sym} {pct(chg, sign=True)} now ({money(price, cur)})",
                    score_line(r),
                    url,
                    extreme,
                )
            )

        vcfg = ik.get("volume_spike", {})
        avg = r.get("avg_vol20")
        if (
            vcfg.get("enabled")
            and avg
            and r.get("minutes_open", 0) >= float(vcfg.get("min_minutes", 30))
        ):
            expected = avg * max(float(r.get("elapsed") or 0), 0.05)
            ratio = float(r.get("vol_today") or 0) / expected
            if ratio >= float(vcfg.get("multiple", 2)):
                out.append(
                    Alert(
                        r["user_id"],
                        sym,
                        "volume_spike",
                        f"📊 {sym} volume {ratio:.1f}× normal so far".replace(".", ","),
                        f"Price {money(price, cur)} · {now_txt}\n{score_line(r)}",
                        url,
                        extreme,
                    )
                )

        level = r.get("buy_below")
        if k.get("buy_level", {}).get("enabled") and level and price <= float(level):
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

        ncfg = ik.get("news", {})
        if ncfg.get("enabled"):
            cut = now_utc - timedelta(minutes=float(ncfg.get("window_minutes", 35)))
            for n in r.get("news") or []:
                try:
                    t = datetime.fromisoformat(n["time"].replace("Z", "+00:00"))
                except (KeyError, ValueError):
                    continue
                if (t if t.tzinfo else t.replace(tzinfo=timezone.utc)) >= cut:
                    out.append(
                        Alert(
                            r["user_id"],
                            sym,
                            "news",
                            f"📰 {sym}: {n['headline']}",
                            f"{n.get('source', '')} · price {money(price, cur)} ({now_txt})",
                            url,
                            extreme,
                        )
                    )
                    break
    return out
