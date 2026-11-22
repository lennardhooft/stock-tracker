"""Market open/closed logic (CLAUDE.md 7.3). GitHub cron runs in UTC without DST, so the
intraday job is scheduled in a wide window and asks here whether a market is open right now.

Holiday lists are hard-coded per year (update every December). Sources: NYSE and Euronext
published holiday calendars. EU uses the Euronext calendar (Amsterdam, Brussels, Paris, Lisbon);
Xetra is open on Whit Monday-style days Euronext closes, which only means a few missed checks.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Market:
    tz: str
    open: time
    close: time
    holidays: frozenset[str]
    early_close: dict[str, time]


US = Market(
    tz="America/New_York",
    open=time(9, 30),
    close=time(16, 0),
    holidays=frozenset(
        {
            # 2026
            "2026-01-01",
            "2026-01-19",
            "2026-02-16",
            "2026-04-03",
            "2026-05-25",
            "2026-06-19",
            "2026-07-03",
            "2026-09-07",
            "2026-11-26",
            "2026-12-25",
            # 2027
            "2027-01-01",
            "2027-01-18",
            "2027-02-15",
            "2027-03-26",
            "2027-05-31",
            "2027-06-18",
            "2027-07-05",
            "2027-09-06",
            "2027-11-25",
            "2027-12-24",
        }
    ),
    early_close={"2026-11-27": time(13, 0), "2026-12-24": time(13, 0), "2027-11-26": time(13, 0)},
)

EU = Market(
    tz="Europe/Brussels",
    open=time(9, 0),
    close=time(17, 30),
    holidays=frozenset(
        {
            "2026-01-01",
            "2026-04-03",
            "2026-04-06",
            "2026-05-01",
            "2026-12-25",
            "2027-01-01",
            "2027-03-26",
            "2027-03-29",
            "2027-12-24",
        }
    ),
    early_close={"2026-12-24": time(14, 5), "2026-12-31": time(14, 5), "2027-12-31": time(14, 5)},
)

MARKETS = {"US": US, "EU": EU}


def market_for(symbol: str, market_field: str | None = None) -> str:
    """'US' or 'EU' for a watchlist row (Yahoo suffix wins over the stored field)."""
    if "." in symbol:
        return "EU"
    return "US" if (market_field or "US") != "EU" else "EU"


def session(m: Market, day: date) -> tuple[time, time] | None:
    """(open, close) in local time for `day`, or None on weekends/holidays."""
    if day.weekday() >= 5 or day.isoformat() in m.holidays:
        return None
    return m.open, m.early_close.get(day.isoformat(), m.close)


def is_open(market: str, now_utc: datetime) -> bool:
    m = MARKETS[market]
    local = now_utc.astimezone(ZoneInfo(m.tz))
    s = session(m, local.date())
    return bool(s) and s[0] <= local.time() < s[1]


def elapsed_fraction(market: str, now_utc: datetime) -> float:
    """How much of today's session has passed (0–1). 0 when closed."""
    m = MARKETS[market]
    local = now_utc.astimezone(ZoneInfo(m.tz))
    s = session(m, local.date())
    if not s:
        return 0.0
    start = datetime.combine(local.date(), s[0], local.tzinfo)
    end = datetime.combine(local.date(), s[1], local.tzinfo)
    return max(0.0, min(1.0, (local - start) / (end - start)))


def minutes_open(market: str, now_utc: datetime) -> float:
    m = MARKETS[market]
    local = now_utc.astimezone(ZoneInfo(m.tz))
    s = session(m, local.date())
    if not s or local.time() < s[0]:
        return 0.0
    return (local - datetime.combine(local.date(), s[0], local.tzinfo)).total_seconds() / 60
