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
const alpha = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Which zone timeframes belong to a zoom level (CLAUDE.md 6.5). */
export function zoneTfsForYears(years) {
  if (!years || years >= 10) return ["Y", "M"];
  if (years >= 3) return ["M", "W"];
  return ["W", "D"];
}

/** Up to `n` nearest zones per side that were seen on one of `tfs`. */
export function visibleZones(zones, tfs, n = 3) {
  const fit = (zones || []).filter((z) => z.tfs.some((x) => tfs.includes(x)));
  const near = (role) => fit.filter((z) => z.role === role).sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct)).slice(0, n);
  return [...near("support"), ...near("resistance")];
}

/* ------------------------------------------------ shaded zones as a series primitive */
class ZonesPrimitive {
  constructor() { this.zones = []; this.series = null; this.request = null; }
  attached({ series, requestUpdate }) { this.series = series; this.request = requestUpdate; }
  detached() { this.series = null; }
  set(zones) { this.zones = zones; this.request?.(); }
  updateAllViews() {}
  paneViews() {
    const self = this;
    return [{
      zOrder: () => "bottom",
      renderer: () => ({
        draw(target) {
          if (!self.series) return;
          target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, verticalPixelRatio: vr }) => {
            for (const z of self.zones) {
              const y1 = self.series.priceToCoordinate(z.high);
              const y2 = self.series.priceToCoordinate(z.low);
              if (y1 == null || y2 == null) continue;
              const top = Math.min(y1, y2) * vr;
              const h = Math.max(Math.abs(y2 - y1) * vr, 3 * vr);
              ctx.fillStyle = z.fill;
              ctx.fillRect(0, top - (h < 3 * vr ? 1 : 0), bitmapSize.width, h);
              ctx.fillStyle = z.edge;
              const lw = Math.round(z.width * vr);
              ctx.fillRect(0, top, bitmapSize.width, lw);
              ctx.fillRect(0, top + h - lw, bitmapSize.width, lw);
            }
          });
        },
      }),
    }];
  }
}

const baseOptions = (LWC) => ({
  autoSize: true,
  layout: { background: { color: "transparent" }, textColor: token("--chart-axis"), fontFamily: token("--font-sans") },
  grid: { vertLines: { color: token("--chart-grid") }, horzLines: { color: token("--chart-grid") } },
  rightPriceScale: { borderVisible: false, minimumWidth: 64 },
  timeScale: { borderVisible: false },
  crosshair: { mode: LWC.CrosshairMode.Normal },
  handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
  handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
});

/** Map a date (e.g. a month end) to the weekly bar that contains it. */
function weekOf(t, date) {
  let lo = 0;
  let hi = t.length - 1;
  if (date >= t[hi]) return t[hi];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < date) lo = mid + 1; else hi = mid;
  }
  return t[lo];
}

/**
 * Weekly candles + 200-week MA + support/resistance zones + markers, with a synced score panel.
 * weekly: {t, o, h, l, c, sma200, score, levels: {zones, swings}}
 * opts: {show: {zones, ma, markers}, labels: {support, resistance, bottom, ceiling, scoreHigh}, scoreEl}
 * Returns {setRange(years), setShow(show), visible(), destroy()}.
 */
export async function priceChart(el, weekly, opts = {}) {
  const LWC = await loadLib();
  const chart = LWC.createChart(el, baseOptions(LWC));
  const hasOhlc = Array.isArray(weekly.o) && weekly.o.length === weekly.t.length;
  const up = token("--color-positive");
  const down = token("--color-negative");
  const price = hasOhlc
    ? chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceLineVisible: false })
    : chart.addLineSeries({ color: token("--chart-1"), lineWidth: 2, priceLineVisible: false });
  price.setData(weekly.t.map((time, i) => (hasOhlc
    ? { time, open: weekly.o[i], high: weekly.h[i], low: weekly.l[i], close: weekly.c[i] }
    : { time, value: weekly.c[i] })).filter((p) => (p.close ?? p.value) != null));
  const ma = chart.addLineSeries({ color: token("--chart-2"), lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  ma.setData(weekly.t.map((time, i) => ({ time, value: weekly.sma200?.[i] })).filter((p) => p.value != null));

  const zonesPrim = new ZonesPrimitive();
  price.attachPrimitive(zonesPrim);
  let priceLines = [];

  // markers: major previous bottoms/ceilings (monthly/yearly) + first week of every score ≥ 4 period
  const lv = weekly.levels || { zones: [], swings: [] };
  const swingMarkers = (lv.swings || []).map((s) => ({
    time: weekOf(weekly.t, s.date),
    position: s.kind === "low" ? "belowBar" : "aboveBar",
    color: s.kind === "low" ? up : down,
    shape: s.kind === "low" ? "arrowUp" : "arrowDown",
    text: `${s.tf}`,
    size: s.tf === "Y" ? 1.4 : 1,
  }));
  const scoreMarkers = [];
  (weekly.score || []).forEach((v, i) => {
    if (v >= 4 && !(weekly.score[i - 1] >= 4)) {
      scoreMarkers.push({ time: weekly.t[i], position: "belowBar", color: token("--score-strong"), shape: "circle", text: "4+", size: 0.8 });
    }
  });

  // score history panel
  let scoreChart = null;
  if (opts.scoreEl && weekly.score?.some((v) => v != null)) {
    scoreChart = LWC.createChart(opts.scoreEl, { ...baseOptions(LWC), handleScale: false, handleScroll: false,
      layout: { ...baseOptions(LWC).layout, attributionLogo: false }, // attribution stays on the main chart
      rightPriceScale: { borderVisible: false, minimumWidth: 64, scaleMargins: { top: 0.1, bottom: 0 } },
      timeScale: { borderVisible: false, visible: false }, crosshair: { horzLine: { visible: false } } });
    const colour = (v) => token(v >= 6 ? "--score-extreme" : v >= 4 ? "--score-strong" : v >= 2 ? "--score-watch" : "--score-normal");
    const hist = scoreChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    hist.setData(weekly.t.map((time, i) => (weekly.score[i] == null ? { time } : { time, value: Math.max(weekly.score[i], 0.15), color: colour(weekly.score[i]) })));
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) scoreChart.timeScale().setVisibleLogicalRange(r); });
  }

  let show = { zones: true, ma: true, markers: true, ...(opts.show || {}) };
  let years = 5;
  let current = [];

  const draw = () => {
    ma.applyOptions({ visible: show.ma });
    current = show.zones ? visibleZones(lv.zones, zoneTfsForYears(years)) : [];
    zonesPrim.set(current.map((z) => {
      const base = token(z.role === "support" ? "--color-positive" : "--color-negative");
      return { ...z, fill: alpha(base, 0.13), edge: alpha(base, 0.55), width: Math.min(3, 1 + Math.floor(z.strength / 6)) };
    }));
    priceLines.forEach((l) => price.removePriceLine(l));
    priceLines = current.map((z) => price.createPriceLine({
      price: (z.low + z.high) / 2, color: "transparent", lineVisible: false, axisLabelVisible: true,
      axisLabelColor: alpha(token(z.role === "support" ? "--color-positive" : "--color-negative"), 0.85),
      axisLabelTextColor: token("--color-on-accent") || "#fff",
      title: `${z.tfs[0]} ${z.touches}×`, // longest timeframe the level was seen on
    }));
    const markers = show.markers ? [...swingMarkers, ...scoreMarkers].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)) : [];
    price.setMarkers(markers);
  };

  const setRange = (y) => {
    years = y;
    const last = weekly.t[weekly.t.length - 1];
    const from = new Date(last);
    if (y) from.setFullYear(from.getFullYear() - y);
    chart.timeScale().setVisibleRange({ from: y ? from.toISOString().slice(0, 10) : weekly.t[0], to: last });
    chart.priceScale("right").applyOptions({ mode: !y || y >= 5 ? 1 : 0 }); // log scale on 5Y+
    draw();
  };

  return {
    setRange,
    setShow(next) { show = { ...show, ...next }; draw(); },
    visible: () => current,
    destroy() { chart.remove(); scoreChart?.remove(); },
  };
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
