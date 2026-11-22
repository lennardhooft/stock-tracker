"""Generate tests/fixtures/bolero_positions_FAKE.xlsx: a FAKE Bolero position overview in the real
layout (docs/importers/bolero.md) for the importer's UI test. Invented names, numbers and ISINs.

    python scripts/make_bolero_fixture.py
"""

# ruff: noqa: E501  (wide data rows on purpose: they mirror the spreadsheet)
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
HEADER = ["Type", "Munt", "Aantal ", "Geblokkeerd", "Naam", "Alerts", "Gem. aankoopkoers", "Slotkoers",
          "Totale aankoopwaarde", "Koers", "Wijziging (%)", "Wijziging", "Huidige waarde", "Waarde in EUR",
          "Rendement %", "Markt", "Rendement ( in munt)", "ISIN"]  # fmt: skip
ROWS = [
    ["Aandelen", "USD", 20, 0, "NORDEX SEMICOND.CORP", "Nee", 125.5, 120, 2510, 118.4, -6.2, -7.8, 2368, 2041, -5.6, "USA", -142, "XX0000000001"],
    ["ETF's", "EUR", 150, 0, "FK GLOB.IDX WLD ETF-ACC", "Nee", 101.2, 126, 15180, 126.73, 0.3, 0.4, 19010, 19010, 25.2, "Euronext Amsterdam", 3830, "XX0000000002"],
    ["Aandelen", "USD", 10, 0, "NEWCO HOLD.INC-A", "Nee", 17.0, 18.5, 170, 18.9, 2.3, 0.4, 189, 163, 11.2, "USA", 19, ""],
    ["Cash", "EUR", "", "", "", "", "", "", "", "", "", "", "", 1234.56, "", "", "", ""],
]  # fmt: skip


def main() -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet0"
    ws.cell(row=6, column=2, value="Portfolio Positions")
    for i, h in enumerate(HEADER):
        ws.cell(row=9, column=2 + 2 * i, value=h)
    for r, row in enumerate(ROWS):
        for i, v in enumerate(row):
            ws.cell(row=11 + r, column=2 + 2 * i, value=v)
    out = ROOT / "tests" / "fixtures" / "bolero_positions_FAKE.xlsx"
    wb.save(out)
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
