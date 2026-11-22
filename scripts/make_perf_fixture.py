"""FAKE returns history for the demo app (web/fixtures/app.json → portfolio.perf).

Runs the real src/performance.py on made-up prices for the fixture's made-up transactions, so the
demo shows exactly the shape the daily job writes. Deterministic (seeded).

    python scripts/make_perf_fixture.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import performance  # noqa: E402

END = date(2026, 11, 20)
FIX = ROOT / "web" / "fixtures" / "app.json"


def walk(start: str, last: float, drift: float, vol: float, seed: int) -> pd.Series:
    days = pd.bdate_range(start, END)
    rng = np.random.default_rng(seed)
    steps = rng.normal(drift / 252, vol / np.sqrt(252), len(days))
    path = np.exp(np.cumsum(steps))
    return pd.Series(path / path[-1] * last, index=days)


def main() -> None:
    d = json.loads(FIX.read_text())
    txs = d["portfolio"]["transactions"]
    last = {s["symbol"]: s["price"] for s in d["stocks"] if s.get("price")}
    last["OLDX"] = 31.0
    params = {
        "WORLD.AS": (0.08, 0.13),
        "NRDX": (0.25, 0.45),
        "ORCA": (0.15, 0.30),
        "BLMT.BR": (-0.05, 0.25),
        "HALD": (-0.30, 0.60),
        "OLDX": (-0.20, 0.40),
    }
    closes = {
        sym: walk("2024-01-02", last[sym], *params[sym], seed=i)
        for i, sym in enumerate(sorted({t["symbol"] for t in txs}))
    }
    fx = {"USD": walk("2024-01-02", 1.16, 0.02, 0.07, seed=99)}
    bench = walk("2024-03-01", 112.4, 0.10, 0.13, seed=29)
    types = {
        "WORLD.AS": "broad_etf",
        "NRDX": "stock",
        "ORCA": "stock",
        "BLMT.BR": "stock",
        "HALD": "speculative",
        "OLDX": "stock",
    }
    perf = performance.build(txs, closes, fx, bench, types, "IWDA.AS", END)
    d["portfolio"]["perf"] = perf
    FIX.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    print("perf fixture:", len(perf["series"]["t"]), "weeks, since", perf["since"])


if __name__ == "__main__":
    main()
