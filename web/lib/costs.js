/* Taxes and costs (estimates) — a copy of config/costs.yaml for the browser (checked by tests/test_costs.py).
 * VERIFY the rates against current Belgian rules. The JSON between the markers must stay valid JSON. */
export const COSTS = /*JSON*/ {
  "dividend_tax": {
    "belgium": 0.3,
    "foreign": {
      "US": 0.15,
      "CA": 0.25,
      "NL": 0.15,
      "DE": 0.26375,
      "FR": 0.25,
      "CH": 0.35,
      "GB": 0.0,
      "IE": 0.25,
      "DK": 0.27,
      "SE": 0.3,
      "NO": 0.25,
      "FI": 0.35,
      "ES": 0.19,
      "IT": 0.26,
      "PT": 0.25,
      "AT": 0.275,
      "BE": 0.0
    },
    "etf_foreign": 0.0,
    "suffix_country": {
      "": "US",
      ".TO": "CA",
      ".V": "CA",
      ".NE": "CA",
      ".AS": "NL",
      ".DE": "DE",
      ".F": "DE",
      ".PA": "FR",
      ".SW": "CH",
      ".L": "GB",
      ".IR": "IE",
      ".CO": "DK",
      ".ST": "SE",
      ".OL": "NO",
      ".HE": "FI",
      ".MC": "ES",
      ".MI": "IT",
      ".LS": "PT",
      ".VI": "AT",
      ".BR": "BE"
    },
    "pay_days_after_ex": 21
  },
  "capital_gains": {
    "method": "fifo"
  },
  "tob": {
    "stock": {
      "rate": 0.0035,
      "max": 1600
    },
    "etf": {
      "rate": 0.0012,
      "max": 1300
    },
    "etf_be_accumulating": {
      "rate": 0.0132,
      "max": 4000
    }
  },
  "broker": {
    "name": "Bolero",
    "markets": {
      "euronext": {
        "suffixes": [
          ".BR",
          ".PA",
          ".AS",
          ".LS",
          ".IR",
          ".MI",
          ".OL"
        ],
        "currency": "EUR",
        "tiers": [
          [
            250,
            2.5
          ],
          [
            1000,
            5.0
          ],
          [
            2500,
            7.5
          ]
        ],
        "mid": {
          "up_to": 70000,
          "block": 10000,
          "fee": 15,
          "max": 50
        },
        "high": {
          "base": 50,
          "block": 10000,
          "fee": 15
        }
      },
      "germany": {
        "suffixes": [
          ".DE",
          ".F"
        ],
        "currency": "EUR",
        "tiers": [
          [
            250,
            2.5
          ],
          [
            1000,
            5.0
          ],
          [
            2500,
            15.0
          ]
        ],
        "mid": {
          "up_to": 70000,
          "block": 10000,
          "fee": 30,
          "max": 60
        },
        "high": {
          "pct": 0.0015
        }
      },
      "europe": {
        "suffixes": [
          ".ST",
          ".SW",
          ".L",
          ".MC",
          ".CO",
          ".HE",
          ".VI"
        ],
        "currency": "EUR",
        "tiers": [
          [
            250,
            2.5
          ],
          [
            1000,
            5.0
          ],
          [
            2500,
            15.0
          ]
        ],
        "rest": {
          "pct": 0.005,
          "min": 30
        }
      },
      "toronto": {
        "suffixes": [
          ".TO",
          ".V",
          ".NE"
        ],
        "currency": "EUR",
        "tiers": [
          [
            250,
            2.5
          ],
          [
            1000,
            5.0
          ],
          [
            2500,
            15.0
          ]
        ],
        "rest": {
          "pct": 0.005,
          "min": 20
        }
      },
      "us": {
        "suffixes": [
          ""
        ],
        "currency": "USD",
        "tiers": [
          [
            250,
            2.5
          ],
          [
            1000,
            5.0
          ],
          [
            2500,
            15.0
          ]
        ],
        "mid": {
          "up_to": 70000,
          "block": 10000,
          "fee": 20,
          "max": 50
        },
        "high": {
          "base": 50,
          "block": 10000,
          "fee": 20
        }
      }
    },
    "fx_pct": null
  }
} /*END*/;

const SUFFIX = /\.[A-Z]{1,3}$/;

/** Country whose withholding applies, from the Yahoo ticker suffix (approximation). */
export function countryOf(symbol) {
  const m = String(symbol || "").toUpperCase().match(SUFFIX);
  return COSTS.dividend_tax.suffix_country[m ? m[0] : ""] || null;
}

/** Share of a gross dividend you keep after foreign + Belgian withholding (estimate). */
export function netShare(symbol, assetType) {
  const dt = COSTS.dividend_tax;
  const etf = /etf/.test(assetType || "");
  const foreign = etf ? dt.etf_foreign : dt.foreign[countryOf(symbol)] ?? 0;
  return (1 - foreign) * (1 - dt.belgium);
}
