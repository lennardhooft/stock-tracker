"""Quality Score 0–100, moat and verdict (CLAUDE.md 13.1, 13.16 A) — Phase 2E.

A low price alone is not enough: this checks whether the business behind it is healthy.

Input is a list of annual "years" (newest first), each a dict of plain numbers built from the
annual reports (see `years_from_yahoo`). Every part returns a sub-score 0..1 (or None = n/a with
a reason) plus the raw values, so the UI can always show the numbers behind it.

    quality = 100 × Σ(weight × part) / Σ(weight)   over the parts that could be computed
    (owner decision: equal weights, debt and ROIC 1.5×; weights in config/scoring.yaml → quality)

Pure functions, tested in tests/test_quality.py. `collect` is the only fetcher; it never raises
and never prints tickers or values.
"""

from __future__ import annotations

import statistics
from typing import Any

import pandas as pd

from src import log
from src.fetch import with_retries

Year = dict[str, Any]

# Yahoo row name(s) → our field. The first row that exists wins.
YAHOO_FIELDS: dict[str, tuple[str, ...]] = {
    "revenue": ("Total Revenue", "Operating Revenue"),
    "gross_profit": ("Gross Profit",),
    "operating_income": ("Operating Income", "Total Operating Income As Reported"),
    "net_income": ("Net Income", "Net Income Common Stockholders"),
    "ebit": ("EBIT",),
    "ebitda": ("EBITDA", "Normalized EBITDA"),
    "interest_expense": ("Interest Expense", "Interest Expense Non Operating"),
    "tax_rate": ("Tax Rate For Calcs",),
    "shares": ("Diluted Average Shares", "Basic Average Shares"),
    "shares_out": ("Ordinary Shares Number", "Share Issued"),
    "total_assets": ("Total Assets",),
    "current_assets": ("Current Assets",),
    "current_liabilities": ("Current Liabilities",),
    "total_liabilities": ("Total Liabilities Net Minority Interest",),
    "long_term_debt": ("Long Term Debt", "Long Term Debt And Capital Lease Obligation"),
    "total_debt": ("Total Debt",),
    "cash": (
        "Cash Cash Equivalents And Short Term Investments",
        "Cash And Cash Equivalents",
    ),
    "equity": ("Stockholders Equity", "Common Stock Equity"),
    "retained_earnings": ("Retained Earnings",),
    "working_capital": ("Working Capital",),
    "ocf": ("Operating Cash Flow", "Cash Flow From Continuing Operating Activities"),
    "fcf": ("Free Cash Flow",),
}

FINANCIAL_WORDS = ("bank", "insurance", "financial", "capital markets", "credit")


# ====================================================================== helpers


def _ok(*xs: Any) -> bool:
    return all(isinstance(x, (int, float)) and x == x for x in xs)  # x == x: not NaN


def _div(a: Any, b: Any) -> float | None:
    return a / b if _ok(a, b) and b != 0 else None


def lin(x: float, bad: float, good: float) -> float:
    """Linear 0..1 between `bad` (0) and `good` (1); works for either direction."""
    if good == bad:
        return 1.0 if x >= good else 0.0
    return max(0.0, min(1.0, (x - bad) / (good - bad)))


def _r(x: float | None, nd: int = 4) -> float | None:
    return None if x is None else round(float(x), nd)


def _part(key: str, score: float | None, value: Any = None, na: str | None = None) -> dict:
    return {
        "key": key,
        "score": None if score is None else round(score, 3),
        "value": value,
        "na": na,
    }


def is_financial(sector: str | None, industry: str | None) -> bool:
    text = f"{sector or ''} {industry or ''}".lower()
    return any(w in text for w in FINANCIAL_WORDS)


# ====================================================================== parts


def piotroski(years: list[Year]) -> dict:
    """Piotroski F-score (0–9) from the last two annual reports.

    Simplification (documented): ROA uses year-end assets. Tests that can't be computed are
    skipped; at least 7 of 9 are needed. Sub-score = passed / computed.
    """
    if len(years) < 2:
        return _part("piotroski", None, na="need_2_years")
    a, b = years[0], years[1]
    tests: dict[str, bool | None] = {}

    roa, roa_prev = (
        _div(a.get("net_income"), a.get("total_assets")),
        _div(b.get("net_income"), b.get("total_assets")),
    )
    tests["roa_positive"] = None if roa is None else roa > 0
    tests["ocf_positive"] = None if not _ok(a.get("ocf")) else a["ocf"] > 0
    tests["roa_up"] = None if roa is None or roa_prev is None else roa > roa_prev
    tests["ocf_above_income"] = (
        None if not _ok(a.get("ocf"), a.get("net_income")) else a["ocf"] > a["net_income"]
    )
    lev = _div(a.get("long_term_debt") or 0, a.get("total_assets"))
    lev_prev = _div(b.get("long_term_debt") or 0, b.get("total_assets"))
    tests["leverage_down"] = None if lev is None or lev_prev is None else lev <= lev_prev
    cr = _div(a.get("current_assets"), a.get("current_liabilities"))
    cr_prev = _div(b.get("current_assets"), b.get("current_liabilities"))
    tests["current_ratio_up"] = None if cr is None or cr_prev is None else cr > cr_prev
    tests["no_new_shares"] = (
        None if not _ok(a.get("shares"), b.get("shares")) else a["shares"] <= b["shares"] * 1.005
    )
    gm = _div(a.get("gross_profit"), a.get("revenue"))
    gm_prev = _div(b.get("gross_profit"), b.get("revenue"))
    tests["gross_margin_up"] = None if gm is None or gm_prev is None else gm > gm_prev
    at = _div(a.get("revenue"), a.get("total_assets"))
    at_prev = _div(b.get("revenue"), b.get("total_assets"))
    tests["asset_turnover_up"] = None if at is None or at_prev is None else at > at_prev

    done = [v for v in tests.values() if v is not None]
    if len(done) < 7:
        return _part("piotroski", None, {"tests": tests}, na="missing_figures")
    f = sum(done)
    return _part("piotroski", f / len(done), {"f": f, "n": len(done), "tests": tests})


def altman(year: Year, market_cap: float | None, financial: bool) -> dict:
    """Altman Z = 1.2·WC/TA + 1.4·RE/TA + 3.3·EBIT/TA + 0.6·MV/TL + 1.0·Sales/TA.

    < 1.8 distress (0), > 3 safe (1), linear in between. Not meaningful for financials.
    """
    if financial:
        return _part("altman", None, na="financial")
    ta, tl = year.get("total_assets"), year.get("total_liabilities")
    wc = year.get("working_capital")
    if not _ok(wc) and _ok(year.get("current_assets"), year.get("current_liabilities")):
        wc = year["current_assets"] - year["current_liabilities"]
    need = (ta, tl, wc, year.get("retained_earnings"), year.get("ebit"), year.get("revenue"))
    if not _ok(*need, market_cap) or ta <= 0 or tl <= 0:
        return _part("altman", None, na="missing_figures")
    z = (
        1.2 * wc / ta
        + 1.4 * year["retained_earnings"] / ta
        + 3.3 * year["ebit"] / ta
        + 0.6 * market_cap / tl
        + 1.0 * year["revenue"] / ta
    )
    zone = "safe" if z > 3 else "grey" if z >= 1.8 else "distress"
    return _part("altman", lin(z, 1.8, 3.0), {"z": round(z, 2), "zone": zone})


def debt(year: Year, financial: bool) -> dict:
    """Net debt / EBITDA (≤ 1 good, ≥ 4 bad) and interest cover EBIT/interest (≥ 8 good, ≤ 1.5).

    Sub-score = average of the two that exist. Net cash counts as fully good.
    """
    if financial:
        return _part("debt", None, na="financial")
    td, cash, ebitda = year.get("total_debt"), year.get("cash"), year.get("ebitda")
    nd = td - cash if _ok(td, cash) else None
    nd_ebitda = None
    parts = []
    if nd is not None and _ok(ebitda):
        if nd <= 0:
            nd_ebitda = round(nd / ebitda, 2) if ebitda > 0 else None
            parts.append(1.0)
        elif ebitda > 0:
            nd_ebitda = round(nd / ebitda, 2)
            parts.append(lin(nd_ebitda, 4.0, 1.0))
        else:
            parts.append(0.0)  # debt but no EBITDA
    cover = None
    ie, ebit = year.get("interest_expense"), year.get("ebit")
    if _ok(ie, ebit) and abs(ie) > 0:
        cover = round(ebit / abs(ie), 1)
        parts.append(lin(cover, 1.5, 8.0))
    elif _ok(ebit) and ebit > 0 and nd is not None and nd <= 0:
        parts.append(1.0)  # no interest to pay
    if not parts:
        return _part("debt", None, na="missing_figures")
    return _part(
        "debt",
        sum(parts) / len(parts),
        {
            "net_debt": _r(nd, 0),
            "nd_ebitda": nd_ebitda,
            "coverage": cover,
            "net_cash": nd is not None and nd <= 0,
        },
    )


def fcf(years: list[Year], financial: bool = False) -> dict:
    """Free cash flow positive in at least 3 of the last 4 years (sub-score = share positive).

    Not meaningful for banks/insurers (their cash flow is mostly customer money moving).
    """
    if financial:
        return _part("fcf", None, na="financial")
    vals = [y.get("fcf") for y in years[:4] if _ok(y.get("fcf"))]
    if len(vals) < 3:
        return _part("fcf", None, na="need_3_years")
    pos = sum(1 for v in vals if v > 0)
    return _part(
        "fcf", pos / len(vals), {"positive": pos, "n": len(vals), "latest": _r(vals[0], 0)}
    )


def growth(years: list[Year]) -> dict:
    """Revenue growth per year (CAGR) over up to 3 years: ≤ −5 % bad, ≥ +10 % good."""
    revs = [
        (i, y["revenue"])
        for i, y in enumerate(years[:4])
        if _ok(y.get("revenue")) and y["revenue"] > 0
    ]
    if len(revs) < 2:
        return _part("growth", None, na="need_2_years")
    (i0, new), (i1, old) = revs[0], revs[-1]
    span = i1 - i0
    cagr = (new / old) ** (1 / span) - 1
    return _part(
        "growth",
        lin(cagr, -0.05, 0.10),
        {"cagr": round(cagr, 4), "years": span, "shrinking": cagr < 0},
    )


def margins(years: list[Year]) -> dict:
    """Operating margin now vs its own earlier average: ≥ average good, 5 pts below bad."""
    ms = [_div(y.get("operating_income"), y.get("revenue")) for y in years[:5]]
    ms = [m for m in ms if m is not None]
    if len(ms) < 3:
        return _part("margins", None, na="need_3_years")
    now, avg = ms[0], sum(ms[1:]) / len(ms[1:])
    diff = now - avg
    sub = lin(diff, -0.05, 0.0)
    if now < 0:  # improving losses are still losses
        sub = min(sub, 0.5)
    return _part(
        "margins",
        sub,
        {
            "now": round(now, 4),
            "avg": round(avg, 4),
            "diff_pts": round(diff * 100, 1),
            "years": len(ms),
        },
    )


def dilution(years: list[Year]) -> dict:
    """Share count change per year over up to 3 years: ≤ 0 % good (buybacks), ≥ +5 %/yr bad."""
    sh = [
        (i, y["shares"])
        for i, y in enumerate(years[:4])
        if _ok(y.get("shares")) and y["shares"] > 0
    ]
    if len(sh) < 2:
        return _part("dilution", None, na="need_2_years")
    (i0, new), (i1, old) = sh[0], sh[-1]
    per_year = (new / old) ** (1 / (i1 - i0)) - 1
    return _part(
        "dilution", lin(per_year, 0.05, 0.0), {"per_year": round(per_year, 4), "years": i1 - i0}
    )


def roic_by_year(years: list[Year], default_tax: float = 0.21) -> list[dict]:
    """ROIC = EBIT × (1 − tax) ÷ (debt + equity − cash), plus gross margin, per year (newest first).

    Negative invested capital (lots of net cash) makes ROIC meaningless → None for that year.
    """
    out = []
    for y in years:
        tax = y.get("tax_rate")
        tax = min(max(tax, 0.0), 0.5) if _ok(tax) else default_tax
        ic = None
        if _ok(y.get("equity"), y.get("cash")):
            ic = (y.get("total_debt") or 0) + y["equity"] - y["cash"]
        roic = None
        if _ok(y.get("ebit")) and ic is not None and ic > 0:
            roic = y["ebit"] * (1 - tax) / ic
        roe = _div(y.get("net_income"), y.get("equity")) if (y.get("equity") or 0) > 0 else None
        out.append(
            {
                "year": y.get("year"),
                "roic": _r(roic),
                "roe": _r(roe),
                "gross_margin": _r(_div(y.get("gross_profit"), y.get("revenue"))),
            }
        )
    return out


def moat(rows: list[dict], *, wacc: float = 0.085, financial: bool = False) -> dict:
    """ROIC & moat check (13.16 A). Four points:

    1. average ROIC ≥ 15 % · 2. ROIC > cost of capital in all but at most one year
    3. low ROIC volatility (std < 5 pts) · 4. stable gross margin (std < 3 pts)
    wide = ≥ 3 points with average ROIC ≥ 15 % · narrow = ≥ 2 · none otherwise.
    Point 2 is required for any moat: steadily low returns are no moat.
    """
    if financial:
        return roe_part(rows)
    roics = [r["roic"] for r in rows[:10] if r["roic"] is not None]
    gms = [r["gross_margin"] for r in rows[:10] if r["gross_margin"] is not None]
    if len(roics) < 3:
        return _part("roic", None, na="need_3_years") | {"moat": None}
    avg = sum(roics) / len(roics)
    above = sum(1 for r in roics if r > wacc)
    std = statistics.pstdev(roics)
    gm_std = statistics.pstdev(gms) if len(gms) >= 3 else None
    checks = {
        "avg_15": avg >= 0.15,
        "beats_wacc": above >= len(roics) - 1,
        "steady_roic": std < 0.05,
        "steady_margin": None if gm_std is None else gm_std < 0.03,
    }
    points = sum(1 for v in checks.values() if v)
    # a moat needs returns above the cost of capital: steadily *low* returns are no moat
    if not checks["beats_wacc"]:
        kind = "none"
    elif points >= 3 and checks["avg_15"]:
        kind = "wide"
    else:
        kind = "narrow" if points >= 2 else "none"
    return _part(
        "roic",
        points / 4,
        {
            "avg": round(avg, 4),
            "above_wacc": above,
            "n": len(roics),
            "wacc": wacc,
            "std_pts": round(std * 100, 1),
            "gm_std_pts": None if gm_std is None else round(gm_std * 100, 1),
            "checks": checks,
        },
    ) | {"moat": kind}


def roe_part(rows: list[dict]) -> dict:
    """Banks/insurers: return on equity instead of ROIC (≤ 5 % bad, ≥ 15 % good). No moat label."""
    roes = [r["roe"] for r in rows[:10] if r.get("roe") is not None]
    if len(roes) < 3:
        return _part("roic", None, na="need_3_years") | {"moat": None}
    avg = sum(roes) / len(roes)
    return _part(
        "roic", lin(avg, 0.05, 0.15), {"metric": "roe", "avg": round(avg, 4), "n": len(roes)}
    ) | {"moat": None}


# ====================================================================== combine


DEFAULT_CFG: dict[str, Any] = {
    "weights": {
        "piotroski": 1,
        "altman": 1,
        "debt": 1.5,
        "fcf": 1,
        "growth": 1,
        "margins": 1,
        "dilution": 1,
        "roic": 1.5,
    },
    "min_parts": 4,
    "high": 70,
    "medium": 40,
    "wacc": 0.085,
}


def quality_label(score: float | None, cfg: dict) -> str | None:
    if score is None:
        return None
    return "high" if score >= cfg["high"] else "medium" if score >= cfg["medium"] else "low"


def build_quality(
    years: list[Year],
    *,
    market_cap: float | None,
    financial: bool,
    cfg: dict | None = None,
) -> dict:
    """Quality Score from annual figures (newest first). Returns the full breakdown."""
    c = {**DEFAULT_CFG, **(cfg or {})}
    w = {**DEFAULT_CFG["weights"], **(c.get("weights") or {})}
    if not years:
        return {
            "score": None,
            "label": None,
            "na": "no_reports",
            "parts": [],
            "moat": None,
            "roic_years": [],
        }
    rows = roic_by_year(years)
    m = moat(rows, wacc=float(c["wacc"]), financial=financial)
    parts = [
        piotroski(years),
        altman(years[0], market_cap, financial),
        debt(years[0], financial),
        fcf(years, financial),
        growth(years),
        margins(years),
        dilution(years),
        {k: v for k, v in m.items() if k != "moat"},
    ]
    for p in parts:
        p["weight"] = float(w.get(p["key"], 1))
    have = [p for p in parts if p["score"] is not None]
    if len(have) < int(c["min_parts"]):
        score = None
        na = "too_few_parts"
    else:
        score = round(
            100 * sum(p["weight"] * p["score"] for p in have) / sum(p["weight"] for p in have)
        )
        na = None
    return {
        "score": score,
        "label": quality_label(score, c),
        "na": na,
        "parts": parts,
        "n_parts": len(have),
        "moat": m.get("moat"),
        "financial": financial,
        "years": len(years),
        "latest_year": years[0].get("year"),
        "roic_years": rows[:10],
    }


def weakest(quality: dict | None, n: int = 2) -> list[str]:
    """Keys of the weakest parts (score < 0.5), lowest first — for "value trap" sentences."""
    parts = [
        p for p in (quality or {}).get("parts", []) if p["score"] is not None and p["score"] < 0.5
    ]
    return [p["key"] for p in sorted(parts, key=lambda p: p["score"])[:n]]


def summary(quality: dict | None) -> dict | None:
    """Small version for latest_scores (list/cards): no per-part details."""
    if not quality:
        return None
    return {
        "score": quality.get("score"),
        "label": quality.get("label"),
        "moat": quality.get("moat"),
        "na": quality.get("na"),
        "weak": weakest(quality),
    }


def verdict(bottom_score: float | None, quality: dict | None, threshold: float = 4) -> str | None:
    """Combined verdict (13.1): sale | check | trap | none. None when there's no Bottom Score."""
    if bottom_score is None:
        return None
    if bottom_score < threshold:
        return "none"
    label = (quality or {}).get("label")
    return {"high": "sale", "medium": "check", "low": "trap"}.get(label, "check")


# ====================================================================== Yahoo → years (fetch)


def years_from_frames(*frames: pd.DataFrame | None) -> list[Year]:
    """Merge Yahoo annual income / balance / cash-flow frames into years (newest first)."""
    cols: dict[pd.Timestamp, Year] = {}
    for df in frames:
        if df is None or df.empty:
            continue
        for col in df.columns:
            ts = pd.Timestamp(col)
            y = cols.setdefault(ts, {"year": str(ts.date())})
            for field, names in YAHOO_FIELDS.items():
                if field in y and y[field] is not None:
                    continue
                for name in names:
                    if name in df.index:
                        v = df.at[name, col]
                        if pd.notna(v):
                            y[field] = float(v)
                            break
    years = [cols[k] for k in sorted(cols, reverse=True)]
    # keep years that have at least revenue or total assets (Yahoo pads old columns with NaN)
    return [y for y in years if _ok(y.get("revenue")) or _ok(y.get("total_assets"))]


def collect(symbol: str, price: float | None, cfg: dict | None = None) -> dict:
    """Quality for one ticker from Yahoo. Never raises; returns {"na": reason} on failure."""
    try:
        import yfinance as yf

        t = yf.Ticker(symbol)
        info = with_retries(lambda: t.info or {}, "yahoo info") or {}
        if (info.get("quoteType") or "").upper() in {"ETF", "MUTUALFUND", "INDEX"}:
            return {"score": None, "label": None, "na": "etf", "parts": []}

        def _frame(name: str) -> pd.DataFrame:
            df = getattr(t, name)
            return df if df is not None else pd.DataFrame()

        frames = [
            with_retries(lambda n=n: _frame(n), f"annual {n}")
            for n in ("income_stmt", "balance_sheet", "cashflow")
        ]
        years = years_from_frames(*frames)
        if not years:
            return {"score": None, "label": None, "na": "no_reports", "parts": []}
        mcap = info.get("marketCap")
        if not _ok(mcap) and _ok(price) and _ok(years[0].get("shares_out")):
            mcap = price * years[0]["shares_out"]
        out = build_quality(
            years,
            market_cap=mcap,
            financial=is_financial(info.get("sector"), info.get("industry")),
            cfg=cfg,
        )
        out["source"] = "Yahoo"
        out["market_cap"] = round(float(mcap), 0) if _ok(mcap) else None
        return out
    except Exception as exc:  # noqa: BLE001 — one ticker must never crash the run
        log.error(f"quality: failed ({log.exc_kind(exc)})")
        return {"score": None, "label": None, "na": "failed", "parts": []}
