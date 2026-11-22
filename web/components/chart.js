/* Chart wrapper (CLAUDE.md 8.1, 13.17): applies design tokens to Lightweight Charts so every
 * chart looks the same. The library is loaded lazily, only when a chart is shown (8.8). */
const LWC_URL = "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js";
let loading = null;

function loadLib() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = LWC_URL;
    s.onload = () => resolve(window.LightweightCharts);
    s.onerror = () => reject(new Error("chart library failed to load"));
    document.head.append(s);
  });
  return loading;
}

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Weekly price + 200-week MA.
 * weekly: {t: [YYYY-MM-DD], c: [close], sma200: [ma|null]}. Returns {setRange(years), destroy()}.
 */
export async function priceChart(el, weekly) {
  const LWC = await loadLib();
  const chart = LWC.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: token("--chart-axis"), fontFamily: token("--font-sans") },
    grid: { vertLines: { color: token("--chart-grid") }, horzLines: { color: token("--chart-grid") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: { mode: 0 },
    handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
    handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  });
  const price = chart.addLineSeries({ color: token("--chart-1"), lineWidth: 2, priceLineVisible: false });
  const ma = chart.addLineSeries({ color: token("--chart-2"), lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
  price.setData(weekly.t.map((d, i) => ({ time: d, value: weekly.c[i] })).filter((p) => p.value != null));
  ma.setData(weekly.t.map((d, i) => ({ time: d, value: weekly.sma200[i] })).filter((p) => p.value != null));

  const setRange = (years) => {
    const last = weekly.t[weekly.t.length - 1];
    const from = new Date(last);
    if (years) from.setFullYear(from.getFullYear() - years);
    chart.timeScale().setVisibleRange({ from: years ? from.toISOString().slice(0, 10) : weekly.t[0], to: last });
    chart.priceScale("right").applyOptions({ mode: years === 0 || years >= 5 ? 1 : 0 }); // log scale on 5Y+
  };
  return { setRange, destroy: () => chart.remove() };
}

/** Live TradingView widget (secondary tab). Yahoo suffix → TradingView exchange. */
export function tradingView(el, yahooSymbol, theme) {
  const map = { AS: "EURONEXT", BR: "EURONEXT", PA: "EURONEXT", LS: "EURONEXT", DE: "XETR", F: "FWB", L: "LSE",
    MI: "MIL", MC: "BME", SW: "SIX", CO: "OMXCOP", ST: "OMXSTO", HE: "OMXHEX", OL: "OSL", VI: "VIE", TO: "TSX" };
  const m = yahooSymbol.match(/^(.+)\.([A-Z]{1,2})$/);
  const symbol = m && map[m[2]] ? `${map[m[2]]}:${m[1].replace(/-/g, ".")}` : yahooSymbol.replace(/-/g, ".");
  el.innerHTML = '<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>';
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  s.async = true;
  s.textContent = JSON.stringify({
    symbol, interval: "W", theme, style: "1", locale: "en", autosize: true, timezone: "Europe/Brussels",
    hide_side_toolbar: true, allow_symbol_change: false, backgroundColor: token("--color-surface"),
  });
  el.firstChild.append(s);
}
