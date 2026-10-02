// SVG charts for reports: columns, stacked columns, a line, and horizontal
// bars. Quiet by design: thin marks (bars at most 24px, 4px rounded ends,
// square at the baseline), hairline solid gridlines, a 2px white gap between
// touching marks, values labelled sparingly (the peak, the bar tips) with the
// rest in a hover/focus tooltip and in the tables beside every chart.
// Colours: the validated categorical order (slot 1 blue, slot 2 orange) and
// a one-hue ordinal ramp; the app's status colours only ever with a label.
import { esc } from './ui.js';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']; // light -> dark, for ordered buckets
const GRID = '#e7eaf0';
const AXIS = '#cfd6e0';
const INK = '#5b6678';
const INK_STRONG = '#0f172a';
const FONT = "font-family=\"Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif\"";

/* ---------------------------------------------------------------- numbers */

/** 4,50,000 -> "4.5L" (INR) or "450K"; for axis ticks and tight labels. */
export function compact(v, currency = 'INR') {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const sym = currency === 'INR' ? '₹' : '';
  const trim = (x) => String(+x.toFixed(x >= 100 ? 0 : 1));
  if (currency === 'INR') {
    if (a >= 1e7) return sym + trim(n / 1e7) + 'Cr';
    if (a >= 1e5) return sym + trim(n / 1e5) + 'L';
  } else if (a >= 1e6) return trim(n / 1e6) + 'M';
  if (a >= 1e3) return sym + trim(n / 1e3) + 'K';
  return sym + Math.round(n);
}

/** Clean axis steps: 0 / 25,000 / 50,000 ... */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

/** A bar's path: 4px rounded data-end, square at the baseline. */
function columnPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function barPath(x, y, w, h) {
  if (w <= 0) return '';
  const r = Math.min(4, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

const tipAttrs = (title, rows) => ` data-tip="${esc(JSON.stringify({ t: title, r: rows }))}" tabindex="0"`;

/* --------------------------------------------------------------- columns */

/**
 * Vertical columns over months or buckets.
 *   items: [{ label, value, sub? }]   or, stacked, [{ label, parts: [v1, v2] }]
 *   series: names of the stacked parts (a legend is drawn for two or more)
 */
export function columns(items, { width = 640, height = 220, currency = 'INR', format = (v) => compact(v, currency), tipFormat = format, series = null, colors = SERIES, colorOf = null, labelPeak = true } = {}) {
  if (!items.length) return '<div class="viz-empty">No data for this period</div>';
  const stacked = Array.isArray(items[0].parts);
  const totals = items.map((d) => (stacked ? d.parts.reduce((s, v) => s + Math.max(0, v), 0) : Math.max(0, d.value)));
  const ticks = niceTicks(Math.max(...totals));
  const top = ticks[ticks.length - 1];
  const left = 48; const right = 8; const topPad = 18; const bottom = 26;
  const plotW = width - left - right;
  const plotH = height - topPad - bottom;
  const band = plotW / items.length;
  const bw = Math.max(4, Math.min(24, band * 0.6));
  const y = (v) => topPad + plotH - (v / top) * plotH;
  let svg = '';
  for (const t of ticks) {
    svg += `<line x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? AXIS : GRID}" stroke-width="1" shape-rendering="crispEdges"/>`;
    svg += `<text x="${left - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${INK}" ${FONT}>${esc(format(t))}</text>`;
  }
  const every = Math.ceil(items.length / Math.max(1, Math.floor(plotW / 52))); // thin out crowded labels
  const peak = totals.indexOf(Math.max(...totals));
  items.forEach((d, i) => {
    const x = left + band * i + (band - bw) / 2;
    if (stacked) {
      let base = 0;
      const rows = [];
      d.parts.forEach((v, k) => {
        if (v <= 0) return;
        const y1 = y(base + v);
        const h = y(base) - y1 - (base > 0 ? 2 : 0); // 2px white gap between segments
        const isTop = d.parts.slice(k + 1).every((w) => w <= 0);
        svg += isTop ? `<path d="${columnPath(x, y1, bw, h)}" fill="${colors[k]}"/>` : `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, h)}" fill="${colors[k]}"/>`;
        base += v;
      });
      d.parts.forEach((v, k) => rows.push([series ? series[k] : '', tipFormat(v), colors[k]]));
      svg += `<rect class="viz-hit" x="${left + band * i}" y="${topPad}" width="${band}" height="${plotH}" fill="transparent"${tipAttrs(d.label, rows)}/>`;
    } else {
      const h = y(0) - y(Math.max(0, d.value));
      const color = colorOf ? colorOf(d, i) : colors[0];
      svg += `<path d="${columnPath(x, y(Math.max(0, d.value)), bw, h)}" fill="${color}"/>`;
      svg += `<rect class="viz-hit" x="${left + band * i}" y="${topPad}" width="${band}" height="${plotH}" fill="transparent"${tipAttrs(d.label, [[d.sub || '', tipFormat(d.value), color]])}/>`;
    }
    if (labelPeak && i === peak && totals[i] > 0) {
      svg += `<text x="${x + bw / 2}" y="${y(totals[i]) - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${INK_STRONG}" ${FONT}>${esc(format(totals[i]))}</text>`;
    }
    if (i % every === 0) svg += `<text x="${left + band * i + band / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${INK}" ${FONT}>${esc(d.short || d.label)}</text>`;
  });
  return legend(stacked && series && series.length > 1 ? series : null, colors, 'rect') +
    `<svg class="viz" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(items.map((d, i) => d.label + ' ' + format(totals[i])).join(', '))}">${svg}</svg>`;
}

/* ------------------------------------------------------------------ line */

/** One series over time; a crosshair finds the nearest point. Values 0..yMax. */
export function line(items, { width = 640, height = 200, yMax = 100, format = (v) => v + '%', color = SERIES[0], name = '' } = {}) {
  const pts = items.filter((d) => d.value !== null && d.value !== undefined);
  if (!pts.length) return '<div class="viz-empty">No data for this period</div>';
  const left = 40; const right = 12; const topPad = 14; const bottom = 26;
  const plotW = width - left - right;
  const plotH = height - topPad - bottom;
  const ticks = niceTicks(yMax);
  const top = ticks[ticks.length - 1];
  const step = items.length > 1 ? plotW / (items.length - 1) : 0;
  const x = (i) => left + (items.length > 1 ? step * i : plotW / 2);
  const y = (v) => topPad + plotH - (v / top) * plotH;
  let svg = '';
  for (const t of ticks) {
    svg += `<line x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? AXIS : GRID}" stroke-width="1" shape-rendering="crispEdges"/>`;
    svg += `<text x="${left - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${INK}" ${FONT}>${esc(format(t))}</text>`;
  }
  let d = '';
  items.forEach((p, i) => { if (p.value === null || p.value === undefined) return; d += (d ? 'L' : 'M') + x(i) + ',' + y(p.value); });
  svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const every = Math.ceil(items.length / Math.max(1, Math.floor(plotW / 52)));
  items.forEach((p, i) => {
    if (p.value !== null && p.value !== undefined) svg += `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    if (i % every === 0) svg += `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${INK}" ${FONT}>${esc(p.short || p.label)}</text>`;
    const w = items.length > 1 ? step : plotW;
    svg += `<rect class="viz-hit" data-cross="${x(i)}" x="${x(i) - w / 2}" y="${topPad}" width="${w}" height="${plotH}" fill="transparent"${tipAttrs(p.label, [[name, p.value === null || p.value === undefined ? '—' : format(p.value), color]])}/>`;
  });
  const last = [...items].reverse().find((p) => p.value !== null && p.value !== undefined);
  const li = items.lastIndexOf(last);
  svg += `<text x="${Math.min(x(li), width - right - 2)}" y="${y(last.value) - 10}" text-anchor="end" font-size="11" font-weight="600" fill="${INK_STRONG}" ${FONT}>${esc(format(last.value))}</text>`;
  svg += `<line class="viz-cross" x1="0" x2="0" y1="${topPad}" y2="${topPad + plotH}" stroke="${AXIS}" stroke-width="1" visibility="hidden"/>`;
  return `<svg class="viz" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(name + ': ' + items.map((p) => p.label + ' ' + (p.value ?? '—')).join(', '))}">${svg}</svg>`;
}

/* ------------------------------------------------------- horizontal bars */

/**
 * Ranked horizontal bars: label on the left, value at the tip.
 *   items: [{ label, value, color?, tip? }]  or stacked: [{ label, parts: [..] }]
 */
export function bars(items, { width = 640, currency = 'INR', format = (v) => compact(v, currency), tipFormat = format, max = null, series = null, colors = SERIES, labelWidth = null } = {}) {
  if (!items.length) return '<div class="viz-empty">Nothing to show</div>';
  const stacked = Array.isArray(items[0].parts);
  const totals = items.map((d) => (stacked ? d.parts.reduce((s, v) => s + Math.max(0, v), 0) : Math.max(0, d.value)));
  const top = max || Math.max(...totals) || 1;
  const lw = labelWidth || Math.min(200, Math.max(90, width * 0.32));
  const valueW = 64;
  const plotW = width - lw - valueW - 8;
  const rowH = 28; const bh = 14;
  const height = items.length * rowH + 6;
  let svg = '';
  const clip = (s) => { const str = String(s); const fit = Math.floor((lw - 10) / 6.4); return str.length > fit ? str.slice(0, fit - 1) + '…' : str; };
  items.forEach((d, i) => {
    const yy = 4 + i * rowH;
    svg += `<text x="${lw - 10}" y="${yy + bh - 2}" text-anchor="end" font-size="12" fill="${INK_STRONG}" ${FONT}><title>${esc(d.label)}</title>${esc(clip(d.label))}</text>`;
    const rows = [];
    if (stacked) {
      let base = 0;
      d.parts.forEach((v, k) => {
        if (v <= 0) return;
        const x0 = lw + (base / top) * plotW + (base > 0 ? 2 : 0);
        const w = (v / top) * plotW - (base > 0 ? 2 : 0);
        const isEnd = d.parts.slice(k + 1).every((z) => z <= 0);
        svg += isEnd ? `<path d="${barPath(x0, yy, Math.max(0, w), bh)}" fill="${colors[k]}"/>` : `<rect x="${x0}" y="${yy}" width="${Math.max(0, w)}" height="${bh}" fill="${colors[k]}"/>`;
        base += v;
      });
      d.parts.forEach((v, k) => rows.push([series ? series[k] : '', tipFormat(v), colors[k]]));
    } else {
      const color = d.color || colors[0];
      svg += `<path d="${barPath(lw, yy, (Math.max(0, d.value) / top) * plotW, bh)}" fill="${color}"/>`;
      rows.push([d.tip || '', tipFormat(d.value), color]);
    }
    const tipX = lw + (totals[i] / top) * plotW + 6;
    svg += `<text x="${tipX}" y="${yy + bh - 2}" font-size="12" font-weight="600" fill="${INK_STRONG}" ${FONT}>${esc(d.valueLabel ?? format(totals[i]))}</text>`;
    svg += `<rect class="viz-hit" x="0" y="${yy - 6}" width="${width}" height="${rowH}" fill="transparent"${tipAttrs(d.label, rows)}/>`;
  });
  return legend(stacked && series && series.length > 1 ? series : null, colors, 'rect') +
    `<svg class="viz" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(items.map((d, i) => d.label + ' ' + format(totals[i])).join(', '))}">${svg}</svg>`;
}

function legend(names, colors, kind) {
  if (!names) return '';
  return '<div class="viz-legend">' + names.map((n, i) => `<span><i style="background:${colors[i]}${kind === 'line' ? ';height:2px' : ''}"></i>${esc(n)}</span>`).join('') + '</div>';
}

/* --------------------------------------------------------------- tooltip */

let tip = null;
/** Hover and keyboard focus on any chart inside `root` show its tooltip. */
export function bindTips(root) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.hidden = true;
    document.body.append(tip);
  }
  const show = (target, x, y) => {
    let data;
    try { data = JSON.parse(target.getAttribute('data-tip')); } catch { return; }
    tip.replaceChildren();
    const t = document.createElement('div');
    t.className = 'viz-tip-title';
    t.textContent = data.t;
    tip.append(t);
    for (const [name, value, color] of data.r) {
      const row = document.createElement('div');
      row.className = 'viz-tip-row';
      const key = document.createElement('i');
      key.style.background = color;
      const v = document.createElement('b');
      v.textContent = value;
      row.append(key, v);
      if (name) { const n = document.createElement('span'); n.textContent = name; row.append(n); }
      tip.append(row);
    }
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 14)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
    const svg = target.ownerSVGElement;
    const cross = svg && svg.querySelector('.viz-cross');
    if (cross && target.dataset.cross) { cross.setAttribute('x1', target.dataset.cross); cross.setAttribute('x2', target.dataset.cross); cross.setAttribute('visibility', 'visible'); }
    target.classList.add('on');
  };
  const hide = (target) => {
    tip.hidden = true;
    target?.classList.remove('on');
    const cross = target?.ownerSVGElement?.querySelector('.viz-cross');
    if (cross) cross.setAttribute('visibility', 'hidden');
  };
  root.addEventListener('pointermove', (e) => { const h = e.target.closest('[data-tip]'); if (h) show(h, e.clientX, e.clientY); });
  root.addEventListener('pointerout', (e) => { const h = e.target.closest('[data-tip]'); if (h) hide(h); });
  root.addEventListener('focusin', (e) => { const h = e.target.closest('[data-tip]'); if (h) { const r = h.getBoundingClientRect(); show(h, r.left + r.width / 2, r.top); } });
  root.addEventListener('focusout', (e) => { const h = e.target.closest('[data-tip]'); if (h) hide(h); });
}
