// Reports: revenue, hoardings and collections for a period, narrowed by city,
// area, type and client. Charts with a table beside each, an Excel download
// (several sheets) and a print-ready PDF (/reports/print). Managers and admins.
import { get } from '../api.js';
import { store, $, $$, esc, fdate, money, toast, toastError, paged, todayISO, addDays } from '../ui.js';
import { icon } from '../icons.js';
import { navigate } from '../app.js';
import { columns, line, bars, bindTips, RAMP } from '../charts.js';
import { downloadXlsx } from '../xlsx.js';

/* ------------------------------------------------------------- periods */

const monthEnd = (k) => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shift = (k, n) => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

export function periods(today = todayISO()) {
  const key = today.slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  const q = y + '-' + String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0');
  const fy = m >= 4 ? y : y - 1;
  const span = (a, b) => [a + '-01', monthEnd(b)];
  return {
    this_month: ['This month', ...span(key, key)],
    last_month: ['Last month', ...span(shift(key, -1), shift(key, -1))],
    this_quarter: ['This quarter', ...span(q, shift(q, 2))],
    last_quarter: ['Last quarter', ...span(shift(q, -3), shift(q, -1))],
    last_6: ['Last 6 months', ...span(shift(key, -5), key)],
    last_12: ['Last 12 months', ...span(shift(key, -11), key)],
    this_fy: ['This financial year', ...span(fy + '-04', (fy + 1) + '-03')],
    last_fy: ['Last financial year', ...span((fy - 1) + '-04', fy + '-03')],
    custom: ['Custom dates', null, null],
  };
}

const TABS = [['revenue', 'Revenue'], ['hoardings', 'Hoardings'], ['collections', 'Collections']];
const STATUS_ROWS = [['booked', 'Booked', '#dc2626'], ['on_hold', 'On hold', '#d97706'], ['available', 'Available', '#16a34a'], ['maintenance', 'Maintenance', '#64748b'], ['inactive', 'Inactive', '#a1a8b5']];
const pct = (v) => (v === null || v === undefined ? '—' : v + '%');
const shortMonth = (label) => label.slice(0, 3) + " '" + label.slice(-2);

/** The filters as query parameters for the API (and the address bar). */
function apiQuery(f) {
  const p = periods()[f.period];
  const range = f.period === 'custom' ? [f.from, f.to] : [p[1], p[2]];
  return { from: range[0], to: range[1], city: f.city, area: f.area, type: f.type, client: f.client };
}

function filtersFrom(query) {
  const all = periods();
  return {
    period: all[query.period] ? query.period : 'last_12',
    from: /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDays(todayISO(), -89),
    to: /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : todayISO(),
    city: query.city || '', area: query.area || '', type: query.type || '', client: query.client || '',
    tab: TABS.some(([k]) => k === query.tab) ? query.tab : 'revenue',
  };
}

const describeFilters = (d) => [d.filters.city, d.filters.area, d.filters.type && (d.options.types.find((t) => t.key === d.filters.type) || {}).label, d.filters.client && 'client ' + d.filters.client]
  .filter(Boolean).join(' · ') || 'All boards and clients';

/* --------------------------------------------------------------- page */

export async function render(root, params, query = {}) {
  const f = filtersFrom(query);
  let data = null;
  let seq = 0;
  root.innerHTML = `
    <div class="page-head"><h1>Reports</h1>
      <button class="btn" data-xlsx>${icon('download')} Excel</button>
      <button class="btn primary" data-pdf>${icon('file')} Download PDF</button></div>
    <div class="card rep-filters" data-filters></div>
    <div class="tabs wide" data-tabs style="margin-top:14px">${TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (k === f.tab ? ' class="on"' : '') + '>' + l + '</button>').join('')}</div>
    <div data-body style="margin-top:14px"><div class="card"><div class="empty">Loading…</div></div></div>`;
  const body = $('[data-body]', root);
  bindTips(body);

  function syncAddress() {
    const qs = new URLSearchParams(Object.entries({ period: f.period === 'last_12' ? '' : f.period, from: f.period === 'custom' ? f.from : '', to: f.period === 'custom' ? f.to : '', city: f.city, area: f.area, type: f.type, client: f.client, tab: f.tab === 'revenue' ? '' : f.tab }).filter(([, v]) => v)).toString();
    history.replaceState({}, '', '/reports' + (qs ? '?' + qs : ''));
  }

  function paintFilters() {
    const o = data ? data.options : { cities: [], areas: [], types: [], clients: [] };
    const areas = o.areas.filter((a) => !f.city || a.city === f.city);
    const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(l) + '</option>';
    $('[data-filters]', root).innerHTML = `<div class="toolbar">
      <select data-f="period" aria-label="Period" style="max-width:190px">${Object.entries(periods()).map(([k, [l]]) => opt(k, l, f.period)).join('')}</select>
      <span class="row" data-custom style="gap:6px"${f.period === 'custom' ? '' : ' hidden'}><input type="date" data-f="from" value="${esc(f.from)}" aria-label="From"><span class="faint">→</span><input type="date" data-f="to" value="${esc(f.to)}" aria-label="To"></span>
      <select data-f="city" aria-label="City" style="max-width:160px">${opt('', 'All cities', f.city)}${o.cities.map((c) => opt(c, c, f.city)).join('')}</select>
      <select data-f="area" aria-label="Area" style="max-width:180px">${opt('', 'All areas', f.area)}${areas.map((a) => opt(a.area, a.area + (f.city ? '' : ', ' + a.city), f.area)).join('')}</select>
      <select data-f="type" aria-label="Type" style="max-width:190px">${opt('', 'All types', f.type)}${o.types.map((t) => opt(t.key, t.label, f.type)).join('')}</select>
      <input type="search" data-f="client" list="rep-clients" placeholder="All clients" value="${esc(f.client)}" aria-label="Client" style="max-width:200px">
      <datalist id="rep-clients">${o.clients.map((c) => '<option value="' + esc(c) + '">').join('')}</datalist>
      <button class="btn sm ghost" data-reset${f.city || f.area || f.type || f.client || f.period !== 'last_12' ? '' : ' hidden'}>Reset</button>
      <span class="grow"></span><span class="small muted" data-range></span>
    </div>`;
    if (data) $('[data-range]', root).textContent = fdate(data.from) + ' – ' + fdate(data.to);
  }

  async function load() {
    const mine = ++seq;
    body.style.opacity = data ? '.55' : '';
    syncAddress();
    try {
      const d = await get('/reports', apiQuery(f));
      if (mine !== seq) return;
      data = d;
    } catch (err) { if (mine === seq) { body.style.opacity = ''; toastError(err); } return; }
    body.style.opacity = '';
    paintFilters();
    draw();
  }

  function draw() {
    if (!data) return;
    const width = Math.max(300, Math.min(1100, body.clientWidth - 40));
    body.innerHTML = { revenue: revenueTab, hoardings: hoardingsTab, collections: collectionsTab }[f.tab](data, { width, half: width < 760 ? width : Math.floor((width - 16) / 2) - 36 });
    if (f.tab === 'hoardings') {
      paged($('[data-board-rows]', body), data.boards, boardRow, { step: 100, colspan: 12, empty: '<tr><td colspan="12" class="empty">No boards match these filters.</td></tr>' });
    }
    if (f.tab === 'collections' && data.dues.length) paged($('[data-due-rows]', body), data.dues, dueRow, { step: 100, colspan: 9 });
  }

  $('[data-filters]', root).addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    f[k] = e.target.value.trim();
    if (k === 'city') f.area = '';
    if (k === 'period') { $('[data-custom]', root).hidden = f.period !== 'custom'; if (f.period === 'custom') return; }
    if ((k === 'from' || k === 'to') && f.to < f.from) { toast('The end date is before the start date', 'error'); return; }
    load();
  });
  $('[data-filters]', root).addEventListener('click', (e) => {
    if (!e.target.closest('[data-reset]')) return;
    Object.assign(f, { period: 'last_12', city: '', area: '', type: '', client: '' });
    load();
  });
  $('[data-tabs]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === f.tab) return;
    f.tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.classList.toggle('on', x === b));
    syncAddress();
    draw();
  });
  body.addEventListener('click', (e) => {
    const inv = e.target.closest('[data-new-invoice]');
    if (inv) navigate('/invoices?new=' + encodeURIComponent(inv.dataset.client) + '&booking=' + inv.dataset.newInvoice);
  });
  $('[data-xlsx]', root).addEventListener('click', () => { if (data) exportXlsx(data); });
  $('[data-pdf]', root).addEventListener('click', () => {
    const q = new URLSearchParams(Object.entries(apiQuery(f)).filter(([, v]) => v)).toString();
    window.open('/reports/print?' + q, '_blank', 'noopener');
  });
  let timer = null;
  const onResize = () => { clearTimeout(timer); timer = setTimeout(draw, 200); };
  window.addEventListener('resize', onResize);

  paintFilters();
  await load();
  return () => window.removeEventListener('resize', onResize);
}

/* ----------------------------------------------------------- sections */

const cur = () => store.company?.currency || 'INR';
const stat = (label, value, sub = '', cls = '') => `<div class="card stat${cls ? ' ' + cls : ''}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? '<div class="sub">' + sub + '</div>' : ''}</div>`;
const chartCard = (title, sub, chart, extra = '') => `<div class="card rep-card"><div class="card-head"><h3>${title}</h3>${sub ? '<span class="small muted">' + sub + '</span>' : ''}</div><div class="card-pad">${chart}</div>${extra}</div>`;

function revenueStats(d) {
  const t = d.totals;
  const c = cur();
  return `<div class="stats">
    ${stat('Revenue earned', money(t.revenue, c), t.bookings + ' booking' + (t.bookings === 1 ? '' : 's') + ' ran in the period', 'accent')}
    ${stat('Occupancy', pct(t.occupancy), t.boards + ' board' + (t.boards === 1 ? '' : 's'))}
    ${stat('Billed', money(t.billed, c), t.started + ' booking' + (t.started === 1 ? '' : 's') + ' started')}
    ${stat('Collected', money(t.collected, c), t.collection_rate === null ? 'nothing billed' : t.collection_rate + '% of billed')}
    ${stat('Still due', money(t.due, c), t.overdue ? money(t.overdue, c) + ' overdue' : 'none overdue')}
    ${stat('Per booked month', t.achieved_month === null ? '—' : money(t.achieved_month, c), 'what a booked board earns')}
  </div>`;
}

function revenueTab(d, { width, half }) {
  const c = cur();
  const months = d.months.map((m) => ({ label: m.label, short: shortMonth(m.label), value: m.revenue, sub: 'Revenue earned' }));
  const occ = d.months.map((m) => ({ label: m.label, short: shortMonth(m.label), value: m.occupancy }));
  const billed = d.months.map((m) => ({ label: m.label, short: shortMonth(m.label), parts: [m.collected, Math.max(0, m.billed - m.collected)] }));
  const top = (list, n, key = 'label') => list.slice(0, n).map((g) => ({ label: g[key], value: g.revenue, tip: g.boards ? g.boards + ' board' + (g.boards === 1 ? '' : 's') + ' · ' + pct(g.occupancy) + ' occupied' : '' }));
  return revenueStats(d) +
    chartCard('Revenue earned by month', 'each booking counted day by day', columns(months, { width, currency: c, tipFormat: (v) => money(v, c) }),
      table(['Month', 'Revenue earned', 'Occupancy', 'Billed', 'Collected'], d.months.map((m) => [m.label + (m.partial ? ' <span class="faint">(part)</span>' : ''), money(m.revenue, c), pct(m.occupancy), money(m.billed, c), money(m.collected, c)]), [1, 2, 3, 4])) +
    `<div class="rep-grid">
      ${chartCard('Occupancy by month', 'share of board-days booked', line(occ, { width: half, name: 'Occupancy' }))}
      ${chartCard('Billed each month', 'bookings starting that month', columns(billed, { width: half, currency: c, series: ['Collected', 'Still due'], tipFormat: (v) => money(v, c) }))}
      ${chartCard('Revenue by type', '', bars(top(d.by_type, 8), { width: half, currency: c, tipFormat: (v) => money(v, c) }))}
      ${chartCard('Revenue by area', d.by_area.length > 10 ? 'top 10 of ' + d.by_area.length : '', bars(top(d.by_area, 10), { width: half, currency: c, tipFormat: (v) => money(v, c) }))}
    </div>` +
    chartCard('Top clients', d.by_client.length > 10 ? 'top 10 of ' + d.by_client.length + ' by revenue earned' : 'by revenue earned',
      bars(d.by_client.slice(0, 10).map((x) => ({ label: x.client, value: x.revenue, tip: x.share + '% of revenue' })), { width, currency: c, tipFormat: (v) => money(v, c) }),
      table(['Client', 'Revenue earned', 'Share', 'Bookings', 'Boards', 'Billed', 'Paid', 'Due'], d.by_client.map((x) => [esc(x.client), money(x.revenue, c), x.share + '%', x.bookings, x.boards, money(x.billed, c), money(x.paid, c), x.due ? '<b class="neg">' + money(x.due, c) + '</b>' : '—']), [1, 2, 3, 4, 5, 6, 7]));
}

function hoardingsTab(d, { width, half }) {
  const c = cur();
  const s = d.status;
  const t = d.totals;
  const issues = d.boards.reduce((n, b) => n + b.open_issues, 0);
  const statusBars = STATUS_ROWS.map(([k, label, color]) => ({ label, value: s[k] || 0, color, valueLabel: String(s[k] || 0), tip: label })).filter((x) => x.value > 0 || x.label !== 'Inactive');
  const occArea = d.by_area.filter((a) => a.occupancy !== null).sort((a, b) => b.occupancy - a.occupancy).slice(0, 12)
    .map((a) => ({ label: a.label, value: a.occupancy, valueLabel: a.occupancy + '%', tip: a.boards + ' board' + (a.boards === 1 ? '' : 's') }));
  const topBoards = [...d.boards].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((b) => ({ label: b.code + ' ' + b.title, value: b.revenue, tip: pct(b.occupancy) + ' occupied' }));
  return `<div class="stats">
      ${stat('Boards', t.boards, d.filters.city || d.filters.area || d.filters.type ? 'matching the filters' : 'in the inventory', 'accent')}
      ${stat('Occupancy', pct(t.occupancy), 'in the period')}
      ${stat('Booked today', s.booked || 0, (s.on_hold || 0) + ' on hold')}
      ${stat('Available today', s.available || 0, 'free to sell')}
      ${stat('Maintenance', s.maintenance || 0, (s.inactive || 0) + ' inactive')}
      ${stat('Open problems', issues, 'reported, not resolved')}
    </div>
    <div class="rep-grid">
      ${chartCard('Boards by status today', '', bars(statusBars, { width: half, format: (v) => String(v), labelWidth: 110 }))}
      ${chartCard('Occupancy by area', 'in the period', bars(occArea, { width: half, max: 100, format: (v) => v + '%' }))}
    </div>
    ${chartCard('Top boards by revenue', 'in the period', bars(topBoards, { width, currency: c, tipFormat: (v) => money(v, c), labelWidth: Math.min(320, width * 0.42) }))}
    <div class="card rep-card"><div class="card-head"><h3>Every board</h3><span class="small muted">${d.boards.length} board${d.boards.length === 1 ? '' : 's'} · status today, figures for the period</span></div>
      <div class="table-wrap"><table class="tbl rep-tbl"><thead><tr><th>Board</th><th>Type</th><th>Location</th><th>Size</th><th>Today</th><th>Client now</th><th class="right">Occupancy</th><th class="right">Revenue</th><th class="right">Rate / month</th><th class="right">Earned / booked month</th><th>Permit until</th><th class="right">Problems</th></tr></thead>
      <tbody data-board-rows></tbody></table></div></div>`;
}

const STATUS_LABEL = Object.fromEntries(STATUS_ROWS.map(([k, l]) => [k, l]));
function boardRow(b) {
  const c = cur();
  return `<tr><td><b>${esc(b.code)}</b><div class="small muted">${esc(b.title)}</div></td><td class="small">${esc(b.type_label)}</td>
    <td class="small">${esc([b.area, b.city].filter(Boolean).join(', '))}</td><td class="small nowrap">${esc(b.size)}</td>
    <td><span class="pill st-${esc(b.status)}"><span class="dot"></span>${esc(STATUS_LABEL[b.status] || b.status)}</span></td>
    <td class="small">${b.client_now ? esc(b.client_now) + '<div class="faint">until ' + fdate(b.until) + '</div>' : '<span class="faint">—</span>'}</td>
    <td class="right num">${pct(b.occupancy)}</td><td class="right num">${money(b.revenue, c)}</td><td class="right num">${b.rate_month ? money(b.rate_month, c) : '—'}</td>
    <td class="right num">${b.achieved_month === null ? '—' : money(b.achieved_month, c)}</td>
    <td class="small nowrap">${b.permit_expiry ? fdate(b.permit_expiry) : '—'}</td><td class="right">${b.open_issues || '<span class="faint">0</span>'}</td></tr>`;
}

function collectionsTab(d, { half }) {
  const c = cur();
  const t = d.totals;
  const owing = new Map();
  for (const x of d.dues) owing.set(x.client, (owing.get(x.client) || 0) + x.due);
  const byClient = [...owing].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }));
  const aging = d.aging.map((a) => ({ label: a.label, short: a.label, value: a.amount, sub: 'Due' }));
  return `<div class="stats">
      ${stat('Still due', money(t.due, c), d.dues.length + ' booking' + (d.dues.length === 1 ? '' : 's') + ' not fully paid', 'accent')}
      ${stat('Overdue', money(t.overdue, c), 'past the due date')}
      ${stat('Collected', money(t.collected, c), 'of ' + money(t.billed, c) + ' billed')}
      ${stat('Collection rate', t.collection_rate === null ? '—' : t.collection_rate + '%', 'of bookings that started in the period')}
      ${stat('Clients owing', owing.size, '')}
    </div>
    <div class="rep-grid">
      ${chartCard('Money due by age', 'days past the due date', columns(aging, { width: half, currency: c, colorOf: (x, i) => RAMP[i], tipFormat: (v) => money(v, c) }))}
      ${chartCard('Due by client', '', bars(byClient, { width: half, currency: c, tipFormat: (v) => money(v, c) }))}
    </div>
    <div class="card rep-card"><div class="card-head"><h3>Unpaid bookings</h3><span class="small muted">Due from the invoice's due date, or from the day the campaign starts when it has no invoice yet</span></div>
      ${d.dues.length ? `<div class="table-wrap"><table class="tbl rep-tbl"><thead><tr><th>Client</th><th>Board</th><th>Dates</th><th class="right">Amount</th><th class="right">Paid</th><th class="right">Due</th><th>Due date</th><th class="right">Days late</th><th>Invoice</th></tr></thead><tbody data-due-rows></tbody></table></div>`
    : '<div class="empty">Nothing is due. Every booking that started in this period is paid.</div>'}</div>`;
}

// Drawn a hundred at a time (paged): a big company has thousands of unpaid bookings.
function dueRow(x) {
  const c = cur();
  return `<tr><td><b>${esc(x.client)}</b>${x.campaign ? '<div class="small faint">' + esc(x.campaign) + '</div>' : ''}</td>
    <td class="small"><b>${esc(x.code)}</b><div class="faint">${esc(x.title)}</div></td><td class="small nowrap">${fdate(x.start_date)} – ${fdate(x.end_date)}</td>
    <td class="right num">${money(x.amount, c)}</td><td class="right num">${money(x.paid, c)}</td><td class="right num"><b class="neg">${money(x.due, c)}</b></td>
    <td class="small nowrap">${fdate(x.due_date)}</td><td class="right">${x.days_late ? '<span class="pill ' + (x.days_late > 60 ? 'bad' : 'warn') + '">' + x.days_late + '</span>' : '<span class="faint">—</span>'}</td>
    <td class="nowrap">${x.invoice ? '<a href="/invoices/' + x.invoice.id + '" data-link>' + esc(x.invoice.number) + '</a>' : '<button class="btn sm" data-new-invoice="' + x.booking_id + '" data-client="' + esc(x.client) + '">Create invoice</button>'}</td></tr>`;
}

/** A plain table under a chart: the same numbers, readable without hovering. */
function table(head, rows, right = []) {
  if (!rows.length) return '';
  return `<details class="rep-details"><summary>Show the numbers</summary><div class="table-wrap"><table class="tbl rep-tbl"><thead><tr>${head.map((h, i) => '<th' + (right.includes(i) ? ' class="right"' : '') + '>' + esc(h) + '</th>').join('')}</tr></thead><tbody>
    ${rows.map((r) => '<tr>' + r.map((v, i) => '<td' + (right.includes(i) ? ' class="right num"' : '') + '>' + v + '</td>').join('') + '</tr>').join('')}</tbody></table></div></details>`;
}

/* -------------------------------------------------------------- Excel */

export function exportXlsx(d) {
  const c = cur();
  const name = store.company?.name || 'Company';
  const note = name + ' · ' + fdate(d.from) + ' to ' + fdate(d.to) + ' · ' + describeFilters(d) + ' · made ' + fdate(todayISO());
  const t = d.totals;
  const sheets = [
    { name: 'Summary', title: 'Business report', note, columns: [{ label: 'Figure', width: 34 }, { label: 'Value', width: 18, type: 'money' }, { label: 'Note', width: 44 }],
      rows: [
        ['Revenue earned', t.revenue, 'Bookings counted day by day inside the period'], ['Billed', t.billed, 'Bookings that started in the period'],
        ['Collected', t.collected, t.collection_rate === null ? '' : t.collection_rate + '% of billed'], ['Still due', t.due, ''], ['Overdue', t.overdue, 'Past the due date'],
        ['Earned per booked board-month', t.achieved_month, ''], ['Occupancy (%)', null, pct(t.occupancy)], ['Boards', null, String(t.boards)], ['Clients', null, String(t.clients)],
      ] },
    { name: 'By month', note, columns: [{ label: 'Month', width: 14 }, { label: 'Revenue earned', width: 16, type: 'money' }, { label: 'Occupancy', width: 12, type: 'pct' }, { label: 'Billed', width: 14, type: 'money' }, { label: 'Collected', width: 14, type: 'money' }],
      rows: d.months.map((m) => [m.label, m.revenue, m.occupancy, m.billed, m.collected]) },
    { name: 'Boards', note, columns: [{ label: 'Code', width: 10 }, { label: 'Title', width: 34 }, { label: 'Type', width: 18 }, { label: 'Area', width: 16 }, { label: 'City', width: 14 }, { label: 'Size', width: 14 },
      { label: 'Status today', width: 13 }, { label: 'Client now', width: 20 }, { label: 'Until', width: 12 }, { label: 'Occupancy', width: 11, type: 'pct' }, { label: 'Booked days', width: 12, type: 'int' },
      { label: 'Revenue earned', width: 15, type: 'money' }, { label: 'Rate / month', width: 14, type: 'money' }, { label: 'Earned / booked month', width: 18, type: 'money' }, { label: 'Permit until', width: 13 }, { label: 'Open problems', width: 13, type: 'int' }, { label: 'On marketplace', width: 14 }],
    rows: d.boards.map((b) => [b.code, b.title, b.type_label, b.area, b.city, b.size, STATUS_LABEL[b.status] || b.status, b.client_now, b.until, b.occupancy, b.booked_days, b.revenue, b.rate_month, b.achieved_month, b.permit_expiry, b.open_issues, b.is_public ? 'Yes' : 'No']) },
    { name: 'By type', note, columns: [{ label: 'Type', width: 24 }, { label: 'Boards', width: 9, type: 'int' }, { label: 'Revenue earned', width: 16, type: 'money' }, { label: 'Occupancy', width: 12, type: 'pct' }],
      rows: d.by_type.map((g) => [g.label, g.boards, g.revenue, g.occupancy]) },
    { name: 'By area', note, columns: [{ label: 'Area', width: 30 }, { label: 'Boards', width: 9, type: 'int' }, { label: 'Revenue earned', width: 16, type: 'money' }, { label: 'Occupancy', width: 12, type: 'pct' }],
      rows: d.by_area.map((g) => [g.label, g.boards, g.revenue, g.occupancy]) },
    { name: 'Clients', note, columns: [{ label: 'Client', width: 28 }, { label: 'Revenue earned', width: 16, type: 'money' }, { label: 'Share', width: 9, type: 'pct' }, { label: 'Bookings', width: 10, type: 'int' }, { label: 'Boards', width: 9, type: 'int' },
      { label: 'Billed', width: 14, type: 'money' }, { label: 'Paid', width: 14, type: 'money' }, { label: 'Due', width: 14, type: 'money' }],
    rows: d.by_client.map((x) => [x.client, x.revenue, x.share, x.bookings, x.boards, x.billed, x.paid, x.due]) },
    { name: 'Unpaid bookings', note, columns: [{ label: 'Client', width: 24 }, { label: 'Board', width: 10 }, { label: 'Title', width: 30 }, { label: 'Campaign', width: 18 }, { label: 'Start', width: 12 }, { label: 'End', width: 12 },
      { label: 'Amount', width: 13, type: 'money' }, { label: 'Paid', width: 13, type: 'money' }, { label: 'Due', width: 13, type: 'money' }, { label: 'Due date', width: 12 }, { label: 'Days late', width: 10, type: 'int' }, { label: 'Invoice', width: 18 }],
    rows: d.dues.map((x) => [x.client, x.code, x.title, x.campaign, x.start_date, x.end_date, x.amount, x.paid, x.due, x.due_date, x.days_late, x.invoice ? x.invoice.number : '']) },
  ];
  const file = (name.replace(/[^\w]+/g, '-') + '-report-' + d.from + '-to-' + d.to).replace(/-+/g, '-') + '.xlsx';
  downloadXlsx(file, sheets, { currency: c });
  toast('Excel file downloaded', 'ok');
}

/* -------------------------------------------------------- printable PDF */

// A big company has thousands of boards and unpaid bookings: the PDF lists the
// ones that matter and points to the Excel file, which always has all of them.
const BOARDS_IN_PDF = 100;
const DUES_IN_PDF = 150;
const capNote = (n, cap, what, which) => (n > cap ? '<p class="rep-note">' + n.toLocaleString('en-IN') + ' ' + what + ': ' + which + ' are listed here. The Excel download has every one.</p>' : '');

/** /reports/print: the whole report as a document, then the print dialog (Save as PDF). */
export async function renderPrint(root, params, query = {}) {
  root.innerHTML = '<div class="empty" style="padding-top:20vh">Preparing the report…</div>';
  let d;
  try { d = await get('/reports', query); } catch (err) { root.innerHTML = '<div class="empty">' + esc(err.message) + '</div>'; return undefined; }
  const c = cur();
  const co = store.company || {};
  const W = 680;
  const half = 330;
  const logo = co.logo ? '<img class="rep-logo" src="/uploads/photos/' + encodeURIComponent(co.logo) + '" alt="">' : '';
  const months = d.months.map((m) => ({ label: m.label, short: shortMonth(m.label), value: m.revenue }));
  const occ = d.months.map((m) => ({ label: m.label, short: shortMonth(m.label), value: m.occupancy }));
  const billed = d.months.map((m) => ({ label: m.label, short: shortMonth(m.label), parts: [m.collected, Math.max(0, m.billed - m.collected)] }));
  const top = (list, n) => list.slice(0, n).map((g) => ({ label: g.label, value: g.revenue }));
  const t = d.totals;
  const kpi = (l, v, s = '') => `<div class="rep-kpi"><div class="l">${l}</div><div class="v">${v}</div>${s ? '<div class="s">' + s + '</div>' : ''}</div>`;
  const tbl = (head, rows, right = []) => `<table class="rep-ptable"><thead><tr>${head.map((h, i) => '<th' + (right.includes(i) ? ' class="r"' : '') + '>' + esc(h) + '</th>').join('')}</tr></thead><tbody>${rows.map((r) => '<tr>' + r.map((v, i) => '<td' + (right.includes(i) ? ' class="r"' : '') + '>' + v + '</td>').join('') + '</tr>').join('')}</tbody></table>`;
  document.title = (co.name || 'Company') + ' report ' + d.from + ' to ' + d.to;
  root.innerHTML = `
  <div class="rep-print-bar no-print"><button class="btn" data-back>${icon('back')} Back</button><span class="grow small muted">Choose “Save as PDF” as the printer to download it.</span><button class="btn primary" data-print>${icon('download')} Save as PDF</button></div>
  <article class="rep-doc">
    <header class="rep-cover">
      ${logo}
      <div class="grow"><div class="rep-co">${esc(co.name || '')}</div><h1>Business report</h1>
        <div class="rep-sub">${fdate(d.from)} – ${fdate(d.to)} · ${esc(describeFilters(d))}</div></div>
      <div class="rep-made">Made ${fdate(todayISO())}</div>
    </header>
    <section class="rep-kpis">
      ${kpi('Revenue earned', money(t.revenue, c), t.bookings + ' bookings ran')}${kpi('Occupancy', pct(t.occupancy), t.boards + ' boards')}
      ${kpi('Billed', money(t.billed, c), t.started + ' bookings started')}${kpi('Collected', money(t.collected, c), t.collection_rate === null ? '' : t.collection_rate + '% of billed')}
      ${kpi('Still due', money(t.due, c), t.overdue ? money(t.overdue, c) + ' overdue' : 'none overdue')}${kpi('Per booked month', t.achieved_month === null ? '—' : money(t.achieved_month, c), 'earned by a booked board')}
    </section>
    <section class="rep-block"><h2>Revenue earned by month</h2>${columns(months, { width: W, height: 220, currency: c })}</section>
    <section class="rep-two">
      <div class="rep-block"><h2>Occupancy by month</h2>${line(occ, { width: half, height: 190, name: 'Occupancy' })}</div>
      <div class="rep-block"><h2>Billed each month</h2>${columns(billed, { width: half, height: 190, currency: c, series: ['Collected', 'Still due'] })}</div>
    </section>
    <section class="rep-block">${tbl(['Month', 'Revenue earned', 'Occupancy', 'Billed', 'Collected'], d.months.map((m) => [m.label, money(m.revenue, c), pct(m.occupancy), money(m.billed, c), money(m.collected, c)]), [1, 2, 3, 4])}</section>
    <section class="rep-two">
      <div class="rep-block"><h2>Revenue by type</h2>${bars(top(d.by_type, 8), { width: half, currency: c })}</div>
      <div class="rep-block"><h2>Revenue by area</h2>${bars(top(d.by_area, 8), { width: half, currency: c })}</div>
    </section>
    <section class="rep-block"><h2>Top clients</h2>${bars(d.by_client.slice(0, 10).map((x) => ({ label: x.client, value: x.revenue })), { width: W, currency: c })}
      ${tbl(['Client', 'Revenue earned', 'Share', 'Bookings', 'Billed', 'Paid', 'Due'], d.by_client.slice(0, 25).map((x) => [esc(x.client), money(x.revenue, c), x.share + '%', x.bookings, money(x.billed, c), money(x.paid, c), x.due ? money(x.due, c) : '—']), [1, 2, 3, 4, 5, 6])}</section>
    <section class="rep-block rep-break"><h2>Hoardings</h2>
      <div class="rep-two">
        <div>${bars(STATUS_ROWS.map(([k, label, color]) => ({ label, value: d.status[k] || 0, color, valueLabel: String(d.status[k] || 0) })), { width: half, format: (v) => String(v), labelWidth: 110 })}</div>
        <div>${bars(d.by_area.filter((a) => a.occupancy !== null).sort((a, b) => b.occupancy - a.occupancy).slice(0, 8).map((a) => ({ label: a.label, value: a.occupancy, valueLabel: a.occupancy + '%' })), { width: half, max: 100, format: (v) => v + '%' })}</div>
      </div>
      ${capNote(d.boards.length, BOARDS_IN_PDF, 'boards', 'the top ' + BOARDS_IN_PDF + ' by revenue')}${tbl(['Board', 'Type', 'Location', 'Today', 'Occupancy', 'Revenue', 'Rate / month'], [...d.boards].sort((a, b) => b.revenue - a.revenue).slice(0, BOARDS_IN_PDF).map((b) => ['<b>' + esc(b.code) + '</b> ' + esc(b.title), esc(b.type_label), esc([b.area, b.city].filter(Boolean).join(', ')), esc(STATUS_LABEL[b.status] || b.status) + (b.client_now ? ' · ' + esc(b.client_now) : ''), pct(b.occupancy), money(b.revenue, c), b.rate_month ? money(b.rate_month, c) : '—']), [4, 5, 6])}
    </section>
    <section class="rep-block rep-break"><h2>Collections</h2>
      <div class="rep-two">
        <div>${columns(d.aging.map((a) => ({ label: a.label, short: a.label, value: a.amount })), { width: half, height: 190, currency: c, colorOf: (x, i) => RAMP[i] })}</div>
        <div class="rep-kpis small">${kpi('Still due', money(t.due, c))}${kpi('Overdue', money(t.overdue, c))}${kpi('Collected', money(t.collected, c))}</div>
      </div>
      ${capNote(d.dues.length, DUES_IN_PDF, 'unpaid bookings', 'the ' + DUES_IN_PDF + ' most overdue')}${d.dues.length ? tbl(['Client', 'Board', 'Dates', 'Due', 'Due date', 'Days late', 'Invoice'], d.dues.slice(0, DUES_IN_PDF).map((x) => [esc(x.client), esc(x.code), fdate(x.start_date) + ' – ' + fdate(x.end_date), money(x.due, c), fdate(x.due_date), x.days_late || '—', x.invoice ? esc(x.invoice.number) : '—']), [3, 5]) : '<p class="muted">Nothing is due.</p>'}
    </section>
    <footer class="rep-foot">${esc(co.name || '')} · ${fdate(d.from)} – ${fdate(d.to)} · Revenue is earned day by day; billed, collected and due count bookings that started in the period.</footer>
  </article>`;
  $('[data-print]', root).addEventListener('click', () => window.print());
  $('[data-back]', root).addEventListener('click', () => { if (history.length > 1 && document.referrer) history.back(); else navigate('/reports'); });
  setTimeout(() => window.print(), 400);
  return undefined;
}

