/* "Export everything" (CLAUDE.md 13.14 E): encrypts on this device with the owner's passphrase.
 * Same format as src/backup.py (PBKDF2-SHA256 → AES-256-GCM), so `python -m src.backup restore` reads it.
 * Tested in tests/js/backup.test.mjs (both directions with Python). */
export const FORMAT = "bottom-tracker-backup";
export const ITERATIONS = 600000;
export const TABLES = ["watchlist", "portfolio_settings", "risk_settings", "risk_settings_log", "transactions", "thesis", "pending_decisions", "reviews"];

const subtle = () => globalThis.crypto.subtle;
const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(passphrase, salt, iterations, usage) {
  const base = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
}

export async function encrypt(data, passphrase, iterations = ITERATIONS) {
  if (String(passphrase).length < 12) throw Object.assign(new Error("passphrase too short"), { code: "short" });
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, await key(passphrase, salt, iterations, "encrypt"), new TextEncoder().encode(JSON.stringify(data)));
  return { format: FORMAT, v: 1, kdf: "pbkdf2-sha256", iter: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function decrypt(blob, passphrase) {
  if (blob?.format !== FORMAT || blob.v !== 1 || blob.kdf !== "pbkdf2-sha256") throw Object.assign(new Error("not a backup"), { code: "format" });
  try {
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, await key(passphrase, unb64(blob.salt), blob.iter, "decrypt"), unb64(blob.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw Object.assign(new Error("wrong passphrase or damaged file"), { code: "passphrase" });
  }
}

export const counts = (data) => Object.fromEntries(Object.entries(data?.tables || {}).map(([k, v]) => [k, v.length]));
