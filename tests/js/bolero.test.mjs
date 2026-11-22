// Bolero position overview parser — FAKE rows in the real layout (docs/importers/bolero.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBolero, suggestType } from "../../web/lib/bolero.js";

/** Build a sheet like Bolero's: empty spacer columns between the real ones, title + header rows. */
function sheet(dataRows, { isin = false } = {}) {
  const header = ["Type", "Munt", "Aantal ", "Geblokkeerd", "Naam", "Alerts", "Gem. aankoopkoers", "Slotkoers", "Totale aankoopwaarde", "Koers",
    "Wijziging (%)", "Wijziging", "Huidige waarde", "Waarde in EUR", "Rendement %", "Markt", "Rendement ( in munt)", ...(isin ? ["ISIN"] : [])];
  const spaced = (cells) => cells.flatMap((c) => ["", c]);
  return [[], [], [null, null, null, " "], [], [], [null, "Portfolio Positions"], [null, ""], [], spaced(header).map((c, i) => (i === 0 ? null : c)), [],
    ...dataRows.map((r) => spaced(r)), [], []];
}
const row = (type, cur, qty, name, avg, valueEur, market, isin) => [type, cur, qty, 0, name, "Nee", avg, 1, 1, 1, 0, 0, 1, valueEur, 0, market, 0, ...(isin ? [isin] : [])];

test("parses positions, cash and markets; ignores what isn't needed", () => {
  const out = parseBolero(sheet([
    row("Aandelen", "USD", 12, "EXAMPLE CORP", 101.5, 1050, "USA"),
    row("ETF's", "EUR", 30, "FAKE.II PLC WORLD IDX ETF-ACC", 88.12, 2700, "Euronext Amsterdam"),
    row("Cash", "EUR", "", "", "", 1234.56, ""),
  ]));
  assert.equal(out.positions.length, 2);
  assert.deepEqual(out.positions[0], { type: "Aandelen", name: "EXAMPLE CORP", qty: 12, avgPrice: 101.5, currency: "USD", market: "USA", isin: "", suggested: "stock" });
  assert.equal(out.positions[1].suggested, "broad_etf");
  assert.equal(out.cash, 1234.56);
});

test("reads the ISIN column by its header, wherever it is", () => {
  const out = parseBolero(sheet([row("Aandelen", "EUR", 5, "FAKE NV", 20, 100, "Euronext Brussel", "be0000000001")], { isin: true }));
  assert.equal(out.positions[0].isin, "BE0000000001");
});

test("text numbers in Belgian notation", () => {
  const out = parseBolero(sheet([row("Aandelen", "EUR", "1.000", "FAKE NV", "12,50", "12.500,00", "Euronext Brussel")]));
  assert.equal(out.positions[0].qty, 1000);
  assert.equal(out.positions[0].avgPrice, 12.5);
});

test("wrong or empty files are refused with a reason", () => {
  assert.throws(() => parseBolero([["Datum", "Omschrijving", "Bedrag"], ["2026-01-01", "x", 1]]), { code: "not_bolero" });
  assert.throws(() => parseBolero(sheet([])), { code: "empty" });
});

test("type suggestions for ETFs", () => {
  assert.equal(suggestType("ETF's", "FAKE GLB AGGREGATE BOND ETF"), "bond_etf");
  assert.equal(suggestType("ETF's", "FAKE AUTOMATION & ROBOTICS ETF"), "sector_etf");
  assert.equal(suggestType("ETF's", "FAKE FTSE ALL-WORLD ETF"), "broad_etf");
  assert.equal(suggestType("Aandelen", "WHATEVER"), "stock");
  assert.equal(suggestType("ETF's", "FK S.E.I-F.F.M.A.C.W.I.M.ETF"), "broad_etf"); // dotted ACWI abbreviation
});
