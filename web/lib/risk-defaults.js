/* Risk defaults — a copy of config/risk.yaml for the browser (checked by tests/test_risk_defaults.py).
 * The JSON between the markers must stay valid JSON. */
export const RISK_DEFAULTS = /*JSON*/ {
  "profiles": {
    "conservative": { "risk_per_position": 1.0, "k": 1.5, "core_min": 85, "satellite_max": 15, "speculative_max": 5, "cash_reserve": 5 },
    "balanced": { "risk_per_position": 1.5, "k": 1.5, "core_min": 70, "satellite_max": 30, "speculative_max": 10, "cash_reserve": 5 },
    "aggressive": { "risk_per_position": 2.5, "k": 1.5, "core_min": 50, "satellite_max": 50, "speculative_max": 15, "cash_reserve": 5 }
  },
  "type_caps": { "broad_etf": null, "bond_etf": null, "sector_etf": 15, "stock_quality": 8, "stock": 5, "speculative": 2, "crypto": 2, "other": 5 },
  "sector_max": 25,
  "region_max": 75,
  "multipliers": { "quality_high": 1.0, "quality_medium": 0.75, "quality_low": 0.5, "verdict_sale": 1.2, "verdict_trap": 0.5, "correlated": 0.7 },
  "typical_vol": { "broad_etf": 0.15, "sector_etf": 0.25, "bond_etf": 0.07, "stock": 0.35, "speculative": 0.8, "crypto": 0.8, "other": 0.3 }
} /*END*/;

/** Full settings object for a profile: profile numbers + the shared caps/multipliers. */
export function settingsFor(profile = "balanced") {
  const d = structuredClone(RISK_DEFAULTS);
  return { profile, ...d.profiles[profile] || d.profiles.balanced, type_caps: d.type_caps, sector_max: d.sector_max,
    region_max: d.region_max, multipliers: d.multipliers, typical_vol: d.typical_vol };
}
