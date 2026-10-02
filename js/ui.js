// Small DOM and formatting helpers shared by every view.
import { icon } from './icons.js';

export const store = {
  meta: null,      // /api/meta
  user: null,
  company: null,   // company being worked in (own, or opened by the super admin)
  badges: { requests: 0, issues: 0 },
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

/** Parse an HTML string into a single element. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* --------------------------------------------------------------- format */

export function money(v, currency) {
  if (v === null || v === undefined || v === '') return '—';
  const cur = currency || store.company?.currency || 'INR';
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(v));
  } catch {
    return cur + ' ' + Math.round(Number(v)).toLocaleString();
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-09-29' or '2026-09-29 10:11:12' -> '29 Sep 2026' */
export function fdate(s, withTime = false) {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return esc(s);
  let out = +m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
  if (withTime && m[4]) out += ', ' + m[4] + ':' + m[5];
  return out;
}

export function ago(s) {
  if (!s) return '';
  const t = Date.parse(String(s).replace(' ', 'T'));
  if (!Number.isFinite(t)) return fdate(s);
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
  if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
  if (sec < 86400 * 7) return Math.floor(sec / 86400) + ' d ago';
  return fdate(s);
}

export function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;

export const STATUS = {
  available: { label: 'Available', color: '#16a34a' },
  on_hold: { label: 'On hold', color: '#d97706' },
  booked: { label: 'Booked', color: '#dc2626' },
  maintenance: { label: 'Maintenance', color: '#64748b' },
  inactive: { label: 'Inactive', color: '#a1a8b5' },
  booked_for_you: { label: 'Booked for you', color: '#16a34a' },
};

export const pill = (status, text) =>
  '<span class="pill st-' + esc(status) + '"><span class="dot"></span>' + esc(text || STATUS[status]?.label || status) + '</span>';

export const payPill = (p) => '<span class="pill pay-' + esc(p) + '">' + esc({ paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid' }[p] || p) + '</span>';

export const typeInfo = (key) => store.meta?.types.find((t) => t.key === key) || { key, label: key, abbr: '?' };
export const illumLabel = (k) => store.meta?.illumination.find((i) => i.key === k)?.label || k || '—';

const trim = (n) => String(+Number(n).toFixed(2));

/** "40 × 20 ft · 800 sq ft" */
export function sizeText(m, { area = true } = {}) {
  if (!m.width || !m.height) return '—';
  const u = m.unit || 'ft';
  let s = trim(m.width) + ' × ' + trim(m.height) + ' ' + u;
  if (area) {
    const total = m.width * m.height * (m.faces || 1) * (m.quantity || 1);
    s += ' · ' + trim(total) + ' sq ' + u;
    if ((m.faces || 1) > 1 || (m.quantity || 1) > 1) {
      s += ' (' + [(m.quantity || 1) > 1 ? m.quantity + ' units' : '', (m.faces || 1) > 1 ? m.faces + ' faces' : ''].filter(Boolean).join(', ') + ')';
    }
  }
  return s;
}

export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/* --------------------------------------------------------------- toasts */

export function toast(message, kind = '') {
  let box = $('.toasts');
  if (!box) { box = el('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.append(box); }
  const t = el('<div class="toast ' + kind + '"></div>');
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}
export const toastError = (err) => toast(err?.message || String(err), 'error');

/* --------------------------------------------------------------- modals */

/**
 * modal({ title, body, foot, size }) -> { el, body, close, onClose }
 * body and foot are HTML strings or elements.
 */
export function modal({ title, body = '', foot = '', size = '', onClose } = {}) {
  const back = el('<div class="modal-back"><div class="modal ' + size + '" role="dialog" aria-modal="true">' +
    '<div class="modal-head"><h2></h2><button class="btn ghost icon" data-close aria-label="Close">' + icon('x') + '</button></div>' +
    '<div class="modal-body"></div>' + (foot !== null ? '<div class="modal-foot"></div>' : '') + '</div></div>');
  $('h2', back).textContent = title || '';
  const bodyEl = $('.modal-body', back);
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
  const footEl = $('.modal-foot', back);
  if (footEl) { if (typeof foot === 'string') footEl.innerHTML = foot; else footEl.append(foot); }

  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  // Only the dialog on top answers Escape: a "Delete?" confirm over a form must
  // not close the form underneath (and lose what was typed) with it.
  const onKey = (e) => {
    if (e.key === 'Escape' && back === [...document.querySelectorAll('.modal-back')].pop()) close();
  };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  setTimeout(() => $('input:not([type=hidden]):not([readonly]), select, textarea', bodyEl)?.focus(), 30);
  return { el: back, body: bodyEl, foot: footEl, close };
}

export function confirmDialog(message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, size: 'narrow',
      body: '<p>' + esc(message) + '</p>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn ' + (danger ? 'danger solid' : 'primary') + '" data-ok>' + esc(ok) + '</button>',
      onClose: () => { if (!done) resolve(false); },
    });
    $('[data-ok]', m.el).addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

/** Form -> plain object. Checkboxes become booleans; multi-selects become arrays. */
export function formData(form) {
  const out = {};
  for (const f of form.elements) {
    if (!f.name || f.disabled) continue;
    if (f.type === 'checkbox') {
      if (f.dataset.multi !== undefined) { (out[f.name] ||= []); if (f.checked) out[f.name].push(f.value); }
      else out[f.name] = f.checked;
    } else if (f.type === 'radio') { if (f.checked) out[f.name] = f.value; }
    else if (f.type === 'file') continue;
    else out[f.name] = f.value;
  }
  return out;
}

/**
 * Draws a long list a batch at a time, with "Show more" at the end. Thousands
 * of rows at once (3,000 boards made 56,000 page elements) freeze phones.
 *   host     the element to fill: a list container, or a <tbody> (give colspan)
 *   items    everything; row(item, index) -> HTML for one item
 * Returns reveal(index): draws batches until that item is on the page.
 */
export function paged(host, items, row, { step = 200, empty = '', colspan = 0 } = {}) {
  let shown = 0;
  const more = () => {
    const left = items.length - shown;
    const btn = '<button type="button" class="btn sm" data-more-rows>Show ' + Math.min(step, left) + ' more <span class="faint">(' + left + ' left)</span></button>';
    return colspan ? '<tr class="more-row"><td colspan="' + colspan + '" class="more-cell">' + btn + '</td></tr>' : '<div class="more-row">' + btn + '</div>';
  };
  const next = () => {
    [...host.children].filter((c) => c.classList.contains('more-row')).forEach((c) => c.remove());
    const from = shown;
    const chunk = items.slice(from, from + step);
    shown += chunk.length;
    host.insertAdjacentHTML('beforeend', chunk.map((it, i) => row(it, from + i)).join('') + (shown < items.length ? more() : ''));
  };
  host.innerHTML = items.length ? '' : empty;
  if (items.length) next();
  host._pagedNext = next;
  if (!host._pagedBound) {
    host._pagedBound = true;
    host.addEventListener('click', (e) => { if (e.target.closest('[data-more-rows]')) host._pagedNext(); });
  }
  return (index) => {
    const batches = Math.ceil((Math.min(index + 1, items.length) - shown) / step);
    for (let i = 0; i < batches; i++) next();
  };
}

/** Disables a button while an async action runs. */
export async function busy(btn, fn) {
  if (!btn) return fn();
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Working…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied', 'ok'); }
  catch {
    const ta = el('<textarea style="position:fixed;opacity:0"></textarea>');
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Link copied', 'ok'); } catch { toast('Copy failed - select and copy the link manually', 'error'); }
    ta.remove();
  }
}

/**
 * wa.me link; phone optional. Numbers are written many ways in India:
 * 98480 12345, 098480 12345, +91 98480 12345, 0091 98480 12345 - all become 919848012345.
 */
export function waLink(text, phone) {
  let p = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
  if (p.length === 11 && p.startsWith('0')) p = p.slice(1); // trunk prefix
  if (p.length === 10) p = '91' + p;
  return 'https://wa.me/' + (p || '') + '?text=' + encodeURIComponent(text);
}

export function options(list, selected, { blank } = {}) {
  return (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') +
    list.map((o) => '<option value="' + esc(o.key) + '"' + (String(o.key) === String(selected ?? '') ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
}

export const directionsUrl = (m) => 'https://www.google.com/maps/dir/?api=1&destination=' + m.lat + ',' + m.lng;
export const osmUrl = (m) => 'https://www.openstreetmap.org/?mlat=' + m.lat + '&mlon=' + m.lng + '#map=18/' + m.lat + '/' + m.lng;
