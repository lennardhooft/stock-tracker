import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encrypt, decrypt, counts } from "../../web/lib/backup.js";

const DATA = { created_at: "2026-11-23T10:00:00Z", tables: { watchlist: [{ symbol: "NRDX" }], transactions: [{ symbol: "ORCA", kind: "buy" }, { symbol: "NRDX", kind: "buy", emotion: "plan" }] } };

test("round trip in the browser format", async () => {
  const blob = await encrypt(DATA, "fake passphrase for tests", 1000);
  assert.equal(JSON.stringify(blob).includes("NRDX"), false);
  assert.deepEqual(await decrypt(blob, "fake passphrase for tests"), DATA);
  assert.deepEqual(counts(DATA), { watchlist: 1, transactions: 2 });
});

test("wrong passphrase and short passphrase", async () => {
  const blob = await encrypt(DATA, "fake passphrase for tests", 1000);
  await assert.rejects(() => decrypt(blob, "another passphrase!!"), { code: "passphrase" });
  await assert.rejects(() => encrypt(DATA, "short"), { code: "short" });
});

test("opens a backup made by the weekly job (src/backup.py)", async () => {
  const blob = JSON.parse(readFileSync(new URL("../fixtures/backup_from_python.json", import.meta.url), "utf8"));
  const data = await decrypt(blob, "fake passphrase for tests");
  assert.deepEqual(counts(data), { watchlist: 1, thesis: 1 });
});

test("the committed browser-made fixture still opens (Python reads the same file)", async () => {
  const blob = JSON.parse(readFileSync(new URL("../fixtures/backup_from_browser.json", import.meta.url), "utf8"));
  assert.deepEqual(counts(await decrypt(blob, "fake passphrase for tests")), { watchlist: 1, transactions: 2 });
});
