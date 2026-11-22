/* Thesis checks (CLAUDE.md 13.14 D) — same rules as src/thesis.py (shared cases in
 * tests/fixtures/thesis_cases.json). Metric values come from latest_scores.metrics (daily job). */

// unit and decimals for showing each metric; the order is the order in the rule picker
export const METRICS = {
  quality_score: { unit: "pts", dec: 0 },
  sales_growth: { unit: "%", dec: 1 },
  operating_margin: { unit: "%", dec: 1 },
  net_debt_ebitda: { unit: "x", dec: 2 },
  interest_cover: { unit: "x", dec: 1 },
  roic: { unit: "%", dec: 1 },
  fcf_years: { unit: "yrs", dec: 0 },
  share_change: { unit: "%", dec: 1 },
  bottom_score: { unit: "pts", dec: 0 },
  from_high: { unit: "%", dec: 1 },
};

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Each rule {metric, op, value} with the actual value and ok (null = unknown). */
export function evaluate(rules, metrics) {
  return (rules || []).map((r) => {
    const actual = num(metrics?.[r.metric]);
    const target = num(r.value);
    let ok = null;
    if (actual != null && target != null && (r.op === ">=" || r.op === "<=")) ok = r.op === ">=" ? actual >= target : actual <= target;
    return { ...r, actual, ok };
  });
}

/** none · unknown · intact · broken1 · broken */
export function status(results) {
  if (!results?.length) return "none";
  const broken = results.filter((r) => r.ok === false).length;
  if (broken >= 2) return "broken";
  if (broken === 1) return "broken1";
  return results.some((r) => r.ok === true) ? "intact" : "unknown";
}
