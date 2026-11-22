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

/** Weekly RSI with Wilder's smoothing (same as src/indicators.py). Returns an array with nulls. */
export function rsiWilder(closes, period = 14) {
  const out = closes.map(() => null);
  let gain = 0;
  let loss = 0;
  let prev = null;
  let n = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    if (prev != null) {
      const d = c - prev;
      const g = Math.max(d, 0);
      const l = Math.max(-d, 0);
      n += 1;
      if (n <= period) { gain += g / period; loss += l / period; } else {
        gain = (gain * (period - 1) + g) / period;
        loss = (loss * (period - 1) + l) / period;
      }
      if (n >= period) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    prev = c;
  }
  return out;
}

/** % below the highest high so far (≤ 0), the "underwater" chart. */
export function drawdownSeries(highs, closes) {
  let peak = -Infinity;
  return closes.map((c, i) => {
    const h = highs?.[i] ?? c;
    if (h != null) peak = Math.max(peak, h);
    return c == null || !Number.isFinite(peak) ? null : (c / peak - 1) * 100;
  });
}

/** Return after `weeks` weeks from bar i, in %, or null when it's in the future. */
export function forwardReturn(closes, i, weeks) {
  const a = closes[i];
  const b = closes[i + weeks];
  return a == null || b == null ? null : (b / a - 1) * 100;
}

/** Index of the first bar of every run where values[i] >= min. */
export function runStarts(values, min) {
  const out = [];
  (values || []).forEach((v, i) => { if (v != null && v >= min && !(values[i - 1] >= min)) out.push(i); });
  return out;
}

/**
 * Weekly candles + 200-week MA + zones + markers + optional lines, with synced lower panels.
 * weekly: {t, o, h, l, c, v?, sma200, score, top?, levels: {zones, swings}}
 * opts: {
 *   show: {zones, ma, markers, range52, valuation},
 *   panels: {score, rsi, volume, drawdown}  → which panel elements get a chart,
 *   panelEls: {score, rsi, volume, drawdown} (elements; hidden ones are fine),
 *   lines: {high52, low52, cheap, expensive}, labels: {high52, low52, cheap, expensive},
 *   onHover(i), onMarker(i, kind)  kind = "bottom" | "top"
 * }
 * Returns {setRange(years), setShow(show), destroy(), rsi, drawdown, bottomStarts, topStarts}.
 */
export async function priceChart(el, weekly, opts = {}) {
  const LWC = await loadLib();
  const chart = LWC.createChart(el, baseOptions(LWC));
  const t = weekly.t;
  const hasOhlc = Array.isArray(weekly.o) && weekly.o.length === t.length;
  const up = token("--color-positive");
  const down = token("--color-negative");
  const price = hasOhlc
    ? chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceLineVisible: false })
    : chart.addLineSeries({ color: token("--chart-1"), lineWidth: 2, priceLineVisible: false });
  price.setData(t.map((time, i) => (hasOhlc
    ? { time, open: weekly.o[i], high: weekly.h[i], low: weekly.l[i], close: weekly.c[i] }
    : { time, value: weekly.c[i] })).filter((p) => (p.close ?? p.value) != null));
  const ma = chart.addLineSeries({ color: token("--chart-2"), lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  ma.setData(t.map((time, i) => ({ time, value: weekly.sma200?.[i] })).filter((p) => p.value != null));

  const zonesPrim = new ZonesPrimitive();
  price.attachPrimitive(zonesPrim);
  let zoneLines = [];
  let extraLines = [];

  const rsi = rsiWilder(weekly.c);
  const drawdown = drawdownSeries(weekly.h, weekly.c);
  const bottomStarts = runStarts(weekly.score, 4);
  const topStarts = runStarts(weekly.top, 2);
  const indexOf = new Map(t.map((d, i) => [d, i]));

  // markers: major previous bottoms/ceilings + start of every Bottom ≥ 4 / Top ≥ 2 period
  const lv = weekly.levels || { zones: [], swings: [] };
  const swingMarkers = (lv.swings || []).map((s) => ({
    time: weekOf(t, s.date), position: s.kind === "low" ? "belowBar" : "aboveBar", color: s.kind === "low" ? up : down,
    shape: s.kind === "low" ? "arrowUp" : "arrowDown", text: `${s.tf}`, size: s.tf === "Y" ? 1.4 : 1,
  }));
  const tradeMarkers = (opts.trades || []).filter((x) => x.date >= t[0]).map((x) => ({
    time: weekOf(t, x.date), position: x.kind === "sell" ? "aboveBar" : "belowBar",
    color: x.kind === "sell" ? down : up, shape: "circle", text: x.kind === "sell" ? "S" : "B", size: 1,
  }));
  const signalMarkers = [
    ...bottomStarts.map((i) => ({ time: t[i], position: "belowBar", color: token("--score-strong"), shape: "circle", text: "4+", size: 0.8 })),
    ...topStarts.map((i) => ({ time: t[i], position: "aboveBar", color: token("--top-trim"), shape: "arrowDown", text: "T", size: 0.8 })),
  ];

  // ---- lower panels, synced to the main time axis and crosshair
  const panelOpts = () => ({
    ...baseOptions(LWC), handleScale: false, handleScroll: false,
    layout: { ...baseOptions(LWC).layout, attributionLogo: false }, // attribution stays on the main chart
    rightPriceScale: { borderVisible: false, minimumWidth: 64, scaleMargins: { top: 0.14, bottom: 0.14 } },
    timeScale: { borderVisible: false, visible: false }, crosshair: { horzLine: { visible: false } },
  });
  const panels = [];
  const els = opts.panelEls || {};
  const scoreColour = (v) => token(v >= 6 ? "--score-extreme" : v >= 4 ? "--score-strong" : v >= 2 ? "--score-watch" : "--score-normal");
  if (els.score && weekly.score?.some((v) => v != null)) {
    const c = LWC.createChart(els.score, { ...panelOpts(), localization: { priceFormatter: (x) => String(Math.abs(Math.round(x))) } });
    const s = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
    s.setData(t.map((time, i) => (weekly.score[i] == null ? { time } : { time, value: Math.max(weekly.score[i], 0.15), color: scoreColour(weekly.score[i]) })));
    if (weekly.top?.some((v) => v)) {
      const tp = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } });
      tp.setData(t.map((time, i) => (weekly.top[i] ? { time, value: -weekly.top[i], color: token("--top-trim") } : { time })));
    }
    panels.push({ chart: c, series: s, value: (i) => weekly.score[i] ?? 0 });
  }
  if (els.rsi) {
    const c = LWC.createChart(els.rsi, panelOpts());
    const s = c.addLineSeries({ color: token("--chart-3") || token("--chart-1"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: "price", precision: 0, minMove: 1 } });
    s.setData(t.map((time, i) => (rsi[i] == null ? { time } : { time, value: +rsi[i].toFixed(1) })));
    for (const [lvl, col] of [[70, token("--top-trim")], [30, token("--score-strong")]]) {
      s.createPriceLine({ price: lvl, color: alpha(col, 0.8), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
    }
    c.priceScale("right").applyOptions({ autoScale: false });
    s.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    panels.push({ chart: c, series: s, value: (i) => rsi[i] ?? 50 });
  }
  if (els.volume && weekly.v?.some((v) => v)) {
    const c = LWC.createChart(els.volume, { ...panelOpts(), localization: { priceFormatter: (x) => compact(x) } });
    const s = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    const v = weekly.v;
    s.setData(t.map((time, i) => {
      if (!v[i]) return { time };
      const prev = v.slice(Math.max(0, i - 52), i).filter(Boolean);
      const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : v[i];
      return { time, value: v[i], color: prev.length >= 10 && v[i] >= 2 * avg ? token("--color-warning") : alpha(token("--chart-axis"), 0.45) };
    }));
    panels.push({ chart: c, series: s, value: (i) => v[i] ?? 0 });
  }
  if (els.drawdown) {
    const c = LWC.createChart(els.drawdown, { ...panelOpts(), localization: { priceFormatter: (x) => `${Math.round(x)} %` } });
    const s = c.addAreaSeries({ lineColor: down, topColor: alpha(down, 0.05), bottomColor: alpha(down, 0.35), lineWidth: 1, priceLineVisible: false, invertFilledArea: true });
    s.setData(t.map((time, i) => (drawdown[i] == null ? { time } : { time, value: +drawdown[i].toFixed(1) })));
    panels.push({ chart: c, series: s, value: (i) => drawdown[i] ?? 0 });
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) panels.forEach((p) => p.chart.timeScale().setVisibleLogicalRange(r)); });
  chart.subscribeCrosshairMove((param) => {
    const i = param?.time != null ? indexOf.get(param.time) : undefined;
    for (const p of panels) {
      if (i == null) p.chart.clearCrosshairPosition();
      else p.chart.setCrosshairPosition(p.value(i), param.time, p.series);
    }
    opts.onHover?.(i ?? null);
  });
  const bottomSet = new Set(bottomStarts.map((i) => t[i]));
  const topSet = new Set(topStarts.map((i) => t[i]));
  chart.subscribeClick((param) => {
    if (param?.time == null || !show.markers) return;
    const i = indexOf.get(param.time);
    if (bottomSet.has(param.time)) opts.onMarker?.(i, "bottom");
    else if (topSet.has(param.time)) opts.onMarker?.(i, "top");
  });

  let show = { zones: true, ma: true, markers: true, range52: false, valuation: true, ...(opts.show || {}) };
  let years = 5;
  let current = [];
  const lines = opts.lines || {};
  const labels = opts.labels || {};

  const draw = () => {
    ma.applyOptions({ visible: show.ma });
    current = show.zones ? visibleZones(lv.zones, zoneTfsForYears(years)) : [];
    zonesPrim.set(current.map((z) => {
      const base = token(z.role === "support" ? "--color-positive" : "--color-negative");
      return { ...z, fill: alpha(base, 0.13), edge: alpha(base, 0.55), width: Math.min(3, 1 + Math.floor(z.strength / 6)) };
    }));
    zoneLines.forEach((l) => price.removePriceLine(l));
    zoneLines = current.map((z) => price.createPriceLine({
      price: (z.low + z.high) / 2, color: "transparent", lineVisible: false, axisLabelVisible: true,
      axisLabelColor: alpha(token(z.role === "support" ? "--color-positive" : "--color-negative"), 0.85),
      axisLabelTextColor: token("--color-on-accent") || "#fff",
      title: `${z.tfs[0]} ${z.touches}×`, // longest timeframe the level was seen on
    }));
    extraLines.forEach((l) => price.removePriceLine(l));
    extraLines = [];
    const line = (value, colour, title) => value && extraLines.push(price.createPriceLine({
      price: value, color: alpha(colour, 0.9), lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title,
    }));
    if (show.range52) { line(lines.high52, token("--chart-axis"), labels.high52); line(lines.low52, token("--chart-axis"), labels.low52); }
    if (show.valuation) { line(lines.cheap, up, labels.cheap); line(lines.expensive, token("--top-trim"), labels.expensive); }
    if (opts.avgCost) line(opts.avgCost, token("--color-accent"), labels.avgCost || "avg");
    const markers = show.markers ? [...swingMarkers, ...signalMarkers, ...tradeMarkers].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)) : [];
    price.setMarkers(markers);
  };

  const setRange = (y) => {
    years = y;
    const last = t[t.length - 1];
    const from = new Date(last);
    if (y) from.setFullYear(from.getFullYear() - y);
    chart.timeScale().setVisibleRange({ from: y ? from.toISOString().slice(0, 10) : t[0], to: last });
    chart.priceScale("right").applyOptions({ mode: !y || y >= 5 ? 1 : 0 }); // log scale on 5Y+
    draw();
  };
  el.addEventListener("dblclick", () => setRange(years)); // double-tap resets the zoom

  return {
    setRange,
    setShow(next) { show = { ...show, ...next }; draw(); },
    visible: () => current,
    destroy() { chart.remove(); panels.forEach((p) => p.chart.remove()); },
    rsi, drawdown, bottomStarts, topStarts,
  };
}

function compact(x) {
  const a = Math.abs(x);
  if (a >= 1e9) return `${(x / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(0)}K`;
  return String(Math.round(x));
}

/**
 * Two lines indexed to 100 (Returns screen, 13.17 #13): yours vs the benchmark, with a legend.
 * series: {t: [dates], you: [..], bench: [..]}. Returns {destroy}.
 */
export async function compareChart(el, series, { youLabel, benchLabel } = {}) {
  const LWC = await loadLib();
  const chart = LWC.createChart(el, {
    ...baseOptions(LWC), handleScale: false, handleScroll: false,
    localization: { priceFormatter: (x) => (Math.round(x * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) },
  });
  const pts = (k) => series.t.map((time, i) => ({ time, value: series[k][i] })).filter((p) => p.value != null);
  const you = chart.addLineSeries({ color: token("--chart-1"), lineWidth: 2, priceLineVisible: false, title: youLabel || "" });
  you.setData(pts("you"));
  if (series.bench?.some((v) => v != null)) {
    const b = chart.addLineSeries({ color: token("--chart-2"), lineWidth: 2, lineStyle: 2, priceLineVisible: false, title: benchLabel || "" });
    b.setData(pts("bench"));
  }
  you.createPriceLine({ price: 100, color: token("--color-border"), lineWidth: 1, lineStyle: 1, axisLabelVisible: false });
  chart.timeScale().fitContent();
  return { destroy() { chart.remove(); } };
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
