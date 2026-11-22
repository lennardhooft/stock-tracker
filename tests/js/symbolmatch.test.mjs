import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchVariants, nameMatch, rankCandidates, pickBest, prefFor } from "../../web/lib/symbolmatch.js";

const block = (s) => s.slice(s.indexOf("/*SHARED*/"), s.indexOf("/*END*/"));

test("Edge Function has an exact copy of the matching code", () => {
  const lib = readFileSync(new URL("../../web/lib/symbolmatch.js", import.meta.url), "utf8");
  const fn = readFileSync(new URL("../../backend/functions/lookup-symbols/index.ts", import.meta.url), "utf8");
  assert.ok(block(lib).length > 500);
  assert.equal(block(fn), block(lib));
});

test("abbreviated fund names become searchable variants (fake names)", () => {
  const v = searchVariants("ISHS CORE MSCI WLD UCITS ETF USD ACC");
  assert.equal(v[0], "ISHS CORE MSCI WLD UCITS ETF USD ACC");
  assert.ok(v.includes("ISHARES CORE MSCI WORLD"));
  assert.ok(v.includes("ISHARES CORE"));
  assert.equal(v.at(-1), "ISHARES");
});

test("name match ignores legal suffixes and expands abbreviations", () => {
  assert.equal(nameMatch("NORDEX SEMICOND INC", "Nordex Semiconductor Corporation"), 1);
  assert.equal(nameMatch("ISHS CORE MSCI WLD", "iShares Core MSCI World UCITS ETF"), 1);
  assert.ok(nameMatch("ISHS CORE MSCI WLD", "iShares MSCI Japan") < 0.6);
});

test("ranking: broker's exchange first, then currency, then name", () => {
  const cands = [
    { symbol: "WRLD.L", name: "Global Index Tracker", exchange: "LSE", currency: "USD", priced: true },
    { symbol: "WRLD.DE", name: "Global Index Tracker", exchange: "GER", currency: "EUR", priced: true },
    { symbol: "OTHR.DE", name: "Other Fund", exchange: "GER", currency: "EUR", priced: true },
  ];
  const r = rankCandidates(cands, { name: "GLB INDEX TRACKER", market: "Frankfurt (Xetra)", currency: "EUR" });
  assert.equal(r[0].symbol, "WRLD.DE");
  assert.equal(pickBest(r, "Frankfurt (Xetra)"), "WRLD.DE");
});

test("no suggestion when the only listing on the right exchange has no prices", () => {
  const r = rankCandidates([
    { symbol: "OLD.AS", name: "Fund", exchange: "AMS", priced: false },
    { symbol: "FND.L", name: "Fund", exchange: "LSE", priced: true },
  ], { name: "FUND", market: "Euronext Amsterdam" });
  assert.equal(pickBest(r, "Euronext Amsterdam"), null);
});

test("Toronto includes Yahoo's other Canadian exchange codes", () => {
  assert.deepEqual(prefFor("Toronto").slice(0, 2), ["TOR", "VAN"]);
});
