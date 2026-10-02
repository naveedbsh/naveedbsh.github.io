// Profit & loss and "what to do next", shared by a company's own pages
// (Dashboard, Profit & loss) and the platform admin's view of any company.
// Everything takes an api client ({ get, post, patch, del }) so the same code
// runs inside the company or, for the platform admin, from outside it.
import {
  $, $$, esc, money, fdate, todayISO, toastError, toast, modal, formData, busy, confirmDialog, options, store, paged,
} from '../ui.js';
import { icon } from '../icons.js';

/* ------------------------------------------------------------- periods */

const monthEnd = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const shiftMonth = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

function periodPresets(today = todayISO()) {
  const key = today.slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  const qKey = y + '-' + String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0');
  const fy = m >= 4 ? y : y - 1; // Indian financial year, April to March
  const span = (a, b) => ({ from: a + '-01', to: monthEnd(b) });
  const fyLabel = (s) => 'FY ' + s + '–' + String(s + 1).slice(2);
  return [
    { key: 'this_month', label: 'This month', ...span(key, key) },
    { key: 'last_month', label: 'Last month', ...span(shiftMonth(key, -1), shiftMonth(key, -1)) },
    { key: 'this_quarter', label: 'This quarter', ...span(qKey, shiftMonth(qKey, 2)) },
    { key: 'last_6', label: 'Last 6 months', ...span(shiftMonth(key, -5), key) },
    { key: 'last_12', label: 'Last 12 months', ...span(shiftMonth(key, -11), key) },
    { key: 'this_fy', label: 'This financial year (' + fyLabel(fy) + ')', ...span(fy + '-04', (fy + 1) + '-03') },
    { key: 'last_fy', label: 'Last financial year (' + fyLabel(fy - 1) + ')', ...span((fy - 1) + '-04', fy + '-03') },
    { key: 'custom', label: 'Custom dates…' },
  ];
}

/* ------------------------------------------------------------- helpers */

const pct = (v) => (v === null || v === undefined ? '—' : v + '%');
const change = (cur, prev) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null);

/** "▲ 12% vs Aug 2026" - green when the move is good for the business. */
function delta(cur, prev, { goodUp = true, label = 'vs previous period' } = {}) {
  const c = change(cur, prev);
  if (c === null) return '<span class="faint">' + esc(label) + ': —</span>';
  const tone = c === 0 ? '' : (c > 0) === goodUp ? 'good' : 'bad';
  return '<span class="delta ' + tone + '">' + (c > 0 ? '▲' : c < 0 ? '▼' : '') + ' ' + Math.abs(c) + '%</span> <span class="faint">' + esc(label) + '</span>';
}

const tone = (v) => (v < 0 ? 'neg' : '');
const marginText = (v) => (v === null || v === undefined ? '—' : v + '%');

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // A leading = + - @ would run as a formula when the file is opened in Excel.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

function downloadCsv(name, header, rows) {
  const body = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function chartHtml(months, cur) {
  if (!months.length) return '';
  const max = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.costs)));
  const h = (v) => Math.max(0, Math.round((v / max) * 100));
  const cols = months.map((m) => {
    const tip = m.label + (m.partial ? ' (incl. bookings to month end)' : '') +
      '\nRevenue ' + money(m.revenue, cur) + '\nCosts ' + money(m.costs, cur) + '\nProfit ' + money(m.profit, cur);
    return '<div class="col' + (m.partial ? ' partial' : '') + (m.profit < 0 ? ' loss' : '') + '" title="' + esc(tip) + '">' +
      '<div class="bars"><i class="rev" style="height:' + h(m.revenue) + '%"></i><i class="cost" style="height:' + h(m.costs) + '%"></i></div>' +
      '<div class="lbl">' + esc(m.label.slice(0, 3)) + (months.length <= 14 || m.label.startsWith('Jan') ? '<br>' + esc(m.label.slice(-4)) : '') + '</div></div>';
  }).join('');
  return '<div class="chart">' + cols + '</div>' +
    '<div class="legend chart-legend"><span><i style="background:var(--brand)"></i>Revenue</span><span><i style="background:var(--cost)"></i>Costs</span>' +
    (months.some((m) => m.partial) ? '<span class="faint">Faded: month not over yet (confirmed bookings to month end)</span>' : '') + '</div>';
}

function boardCell(b, links) {
  const name = '<b>' + esc(b.code) + '</b>';
  return (links ? '<a href="/map?open=' + b.id + '" data-link>' + name + '</a>' : name) +
    '<div class="small muted ellipsis" style="max-width:260px">' + esc(b.title) + '</div>';
}

/* --------------------------------------------------------------- expenses */

async function expenseModal({ api, expense = null, currency, mediums = [], onSaved }) {
  const e = expense || { expense_date: todayISO(), category: '' };
  const cats = store.meta?.expense_categories || [];
  const m = modal({
    title: expense ? 'Edit expense' : 'Add expense',
    body: `<form data-form>
      <div class="grid-2">
        <label class="field"><span>Date</span><input type="date" name="expense_date" required value="${esc(e.expense_date)}"></label>
        <label class="field"><span>Amount (${esc(currency)})</span><input type="number" name="amount" min="0.01" step="0.01" required value="${esc(e.amount ?? '')}"></label>
      </div>
      <label class="field mt"><span>Category</span><select name="category" required>${options(cats, e.category, { blank: 'Choose…' })}</select></label>
      <label class="field mt"><span>Board <span class="faint">(optional)</span></span><select name="medium_id">
        <option value="">Company-wide, not one board</option>
        ${mediums.map((b) => '<option value="' + b.id + '"' + (b.id === e.medium_id ? ' selected' : '') + '>' + esc(b.code + ' · ' + b.title) + '</option>').join('')}
      </select></label>
      <label class="field mt"><span>Paid to</span><input name="vendor" maxlength="160" value="${esc(e.vendor || '')}" placeholder="Landlord, printer, electricity board…"></label>
      <label class="field mt"><span>Note</span><input name="note" maxlength="500" value="${esc(e.note || '')}"></label>
      <div class="hint">A board's steady monthly cost (site rent, power) is better set once as its running cost, in the board's details. Use expenses for dated or company-wide spending.</div>
    </form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>' + icon('check') + ' Save</button>',
  });
  const form = $('[data-form]', m.el);
  const save = $('[data-save]', m.el);
  const submit = () => busy(save, async () => {
    if (!form.reportValidity()) return;
    const data = formData(form);
    try {
      if (expense) await api.patch('/finance/expenses/' + expense.id, data);
      else await api.post('/finance/expenses', data);
      toast(expense ? 'Expense updated' : 'Expense added', 'ok');
      m.close();
      onSaved?.();
    } catch (err) { toastError(err); }
  });
  save.addEventListener('click', submit);
  form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
}

/* ------------------------------------------------------------ the report */

const TABS = [['overview', 'Overview'], ['boards', 'By board'], ['areas', 'By area'], ['clients', 'By client'], ['expenses', 'Expenses']];

/**
 * The full P&L into `root`.
 *   api       client to call (own company, or scoped() for the platform admin)
 *   currency  the company's currency
 *   links     board names link to the map (only inside the company)
 *   canEdit   expenses can be added, changed and deleted
 *   tab       first tab; onTab(tab) is told when it changes
 * Returns { addExpense, reload }.
 */
export function renderPnl(root, { api, currency, links = true, canEdit = false, tab = 'overview', onTab, fileName = 'profit-loss' } = {}) {
  const presets = periodPresets();
  const state = {
    preset: 'last_12', from: null, to: null,
    tab: TABS.some(([k]) => k === tab) ? tab : 'overview',
    data: null, sort: 'profit', group: 'area', cat: '', q: '', expenses: null, mediums: null,
  };
  const range = () => {
    if (state.preset === 'custom') return { from: state.from, to: state.to };
    const p = presets.find((x) => x.key === state.preset);
    return { from: p.from, to: p.to };
  };

  root.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="toolbar" style="border-bottom:0">
        <select data-preset style="max-width:260px" aria-label="Period">${presets.map((p) => '<option value="' + p.key + '"' + (p.key === state.preset ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('')}</select>
        <span class="row" data-custom hidden><input type="date" data-from aria-label="From"><span class="faint">to</span><input type="date" data-to aria-label="To"><button class="btn sm" data-apply>Apply</button></span>
        <span class="grow small muted" data-compare></span>
        <button class="btn sm" data-csv title="Download this tab as a spreadsheet">${icon('download')} CSV</button>
      </div>
    </div>
    <div data-banner></div>
    <div class="stats" data-tiles><div class="card stat"><div class="label">Loading…</div></div></div>
    <div class="tabs wide" data-tabs>${TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (k === state.tab ? ' class="on"' : '') + '>' + l + '</button>').join('')}</div>
    <div data-body style="margin-top:14px"></div>`;

  const body = $('[data-body]', root);

  // Switching periods quickly: only the latest answer may draw.
  let loadSeq = 0;
  async function load() {
    const r = range();
    if (!r.from || !r.to) return;
    const seq = ++loadSeq;
    try {
      const data = await api.get('/finance/pnl', r);
      if (seq !== loadSeq) return;
      state.data = data;
      state.expenses = null;
      draw();
    } catch (err) {
      if (seq !== loadSeq) return;
      toastError(err);
      body.innerHTML = '<div class="card"><div class="empty">' + esc(err.message) + '</div></div>';
    }
  }

  function draw() {
    const d = state.data;
    const t = d.totals;
    const p = d.previous?.totals || {};
    const prevLabel = 'vs ' + fdate(d.previous.from) + ' – ' + fdate(d.previous.to);
    $('[data-compare]', root).textContent = fdate(d.from) + ' – ' + fdate(d.to) + ' · compared with the ' + Math.round((Date.parse(d.to) - Date.parse(d.from)) / 86400000 + 1) + ' days before';
    $('[data-banner]', root).innerHTML = d.has_costs ? '' :
      '<div class="note-box">' + icon('bulb') + '<div><b>No costs recorded yet, so profit is the same as revenue.</b> Add each board\'s running cost per month in its details' +
      (canEdit ? ', and log other spending under <a href="#" data-goto-expenses>Expenses</a>' : '') + '.</div></div>';
    $('[data-goto-expenses]', root)?.addEventListener('click', (e) => { e.preventDefault(); setTab('expenses'); });

    $('[data-tiles]', root).innerHTML = `
      <div class="card stat accent"><div class="label">Revenue earned</div><div class="value">${money(t.revenue, currency)}</div><div class="sub">${delta(t.revenue, p.revenue, { label: prevLabel })}</div></div>
      <div class="card stat"><div class="label">Costs</div><div class="value">${money(t.costs, currency)}</div><div class="sub">${money(t.site_costs, currency)} sites · ${money(t.expenses, currency)} expenses</div></div>
      <div class="card stat"><div class="label">Profit</div><div class="value ${tone(t.profit)}">${money(t.profit, currency)}</div><div class="sub">Margin ${marginText(t.margin)} · ${delta(t.profit, p.profit, { label: 'vs before' })}</div></div>
      <div class="card stat"><div class="label">Occupancy</div><div class="value">${pct(t.occupancy)}</div><div class="sub">${t.boards} boards · ${money(t.yield_month, currency)} / board / month</div></div>
      <div class="card stat"><div class="label">Billed in period</div><div class="value">${money(t.billed, currency)}</div><div class="sub">${money(t.collected, currency)} collected (${pct(t.collection_rate)})</div></div>
      <div class="card stat"><div class="label">Overdue</div><div class="value ${t.overdue > 0 ? 'neg' : ''}">${money(t.overdue, currency)}</div><div class="sub">ended, not fully paid</div></div>`;
    drawTab();
  }

  function setTab(k) {
    state.tab = k;
    $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    onTab?.(k);
    drawTab();
  }

  function drawTab() {
    if (!state.data) return;
    const fn = { overview: drawOverview, boards: drawBoards, areas: drawAreas, clients: drawClients, expenses: drawExpenses }[state.tab];
    fn();
  }

  function drawOverview() {
    const d = state.data;
    const cats = d.expenses_by_category;
    const catTotal = cats.reduce((s, c) => s + c.amount, 0);
    body.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>Revenue and costs by month</h3></div>
        ${chartHtml(d.months, currency)}
      </div>
      <div class="dash-split">
        <div class="card">
          <div class="card-head"><h3>Month by month</h3></div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="right">Revenue</th><th class="right">Site costs</th><th class="right">Expenses</th><th class="right">Profit</th><th class="right">Margin</th></tr></thead><tbody>
            ${d.months.slice().reverse().map((m) => `<tr><td><b>${esc(m.label)}</b>${m.partial ? ' <span class="pill warn">in progress</span>' : ''}</td>
              <td class="right num">${money(m.revenue, currency)}</td><td class="right num">${money(m.site_costs, currency)}</td><td class="right num">${money(m.expenses, currency)}</td>
              <td class="right num ${tone(m.profit)}"><b>${money(m.profit, currency)}</b></td><td class="right num">${m.revenue > 0 ? Math.round((m.profit / m.revenue) * 100) + '%' : '—'}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Where the money went</h3></div>
          <div class="card-pad stack">
            <div><div class="row spread small"><span>Board running costs</span><b class="num">${money(d.totals.site_costs, currency)}</b></div>
              <div class="bar cost-bar" style="margin-top:4px"><i style="width:${d.totals.costs ? Math.round((d.totals.site_costs / d.totals.costs) * 100) : 0}%"></i></div></div>
            ${cats.map((c) => `<div><div class="row spread small"><span>${esc(c.label)}</span><b class="num">${money(c.amount, currency)}</b></div>
              <div class="bar cost-bar" style="margin-top:4px"><i style="width:${d.totals.costs ? Math.round((c.amount / d.totals.costs) * 100) : 0}%"></i></div></div>`).join('')}
            ${!catTotal && !d.totals.site_costs ? '<div class="empty">No costs in this period.</div>' : ''}
          </div>
        </div>
      </div>`;
  }

  function drawBoards() {
    const rows = (state.data.by_medium || []).slice();
    const sorters = {
      profit: (a, b) => b.profit - a.profit,
      loss: (a, b) => a.profit - b.profit,
      revenue: (a, b) => b.revenue - a.revenue,
      occupancy: (a, b) => (b.occupancy ?? -1) - (a.occupancy ?? -1),
      idle: (a, b) => (a.occupancy ?? 101) - (b.occupancy ?? 101),
    };
    rows.sort(sorters[state.sort]);
    body.innerHTML = `
      <div class="card">
        <div class="toolbar"><span class="small muted">Sort</span>
          <select data-sort style="max-width:220px">${[['profit', 'Most profitable first'], ['loss', 'Least profitable first'], ['revenue', 'Highest revenue'], ['occupancy', 'Busiest'], ['idle', 'Emptiest']].map(([k, l]) => '<option value="' + k + '"' + (k === state.sort ? ' selected' : '') + '>' + l + '</option>').join('')}</select>
          <span class="grow"></span><span class="small muted">${rows.length} boards</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Board</th><th>Where</th><th class="right">Rate / mo</th><th class="right">Cost / mo</th><th class="right">Booked</th><th class="right">Revenue</th><th class="right">Costs</th><th class="right">Profit</th></tr></thead><tbody data-board-rows>
        </tbody></table></div>
      </div>`;
    // Every board is in the CSV; the table draws in batches so a large inventory stays responsive.
    paged($('[data-board-rows]', body), rows, (b) => `<tr>
            <td>${boardCell(b, links)}</td>
            <td class="small">${esc([b.area, b.city].filter(Boolean).join(', ') || '—')}<div class="faint">${esc(b.type_label)}${b.status !== 'active' ? ' · ' + esc(b.status) : ''}</div></td>
            <td class="right num">${money(b.rate_month, currency)}</td>
            <td class="right num">${money(b.cost_month, currency)}</td>
            <td class="right num">${pct(b.occupancy)}</td>
            <td class="right num">${money(b.revenue, currency)}</td>
            <td class="right num">${money(b.costs, currency)}</td>
            <td class="right num ${tone(b.profit)}"><b>${money(b.profit, currency)}</b></td></tr>`,
    { step: 200, colspan: 8, empty: '<tr><td colspan="8" class="empty">No boards in this period.</td></tr>' });
    $('[data-sort]', body).addEventListener('change', (e) => { state.sort = e.target.value; drawBoards(); });
  }

  function groupRows() {
    const d = state.data;
    return { area: d.by_area, city: d.by_city, type: d.by_type }[state.group] || [];
  }

  function drawAreas() {
    const rows = groupRows();
    const months = Math.max(1, (Date.parse(state.data.to) - Date.parse(state.data.from)) / 86400000 + 1) / 30.4375;
    body.innerHTML = `
      <div class="card">
        <div class="toolbar"><div class="tabs" data-group>${[['area', 'Area'], ['city', 'City'], ['type', 'Media type']].map(([k, l]) => '<button data-g="' + k + '"' + (k === state.group ? ' class="on"' : '') + '>' + l + '</button>').join('')}</div>
          <span class="grow"></span><span class="small muted">Which places and formats earn the most</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>${{ area: 'Area', city: 'City', type: 'Type' }[state.group]}</th><th class="right">Boards</th><th class="right">Booked</th><th class="right">Revenue</th><th class="right">Per board / mo</th><th class="right">Costs</th><th class="right">Profit</th><th class="right">Margin</th></tr></thead><tbody>
          ${rows.length ? rows.map((g) => `<tr><td><b>${esc(g.label)}</b></td><td class="right num">${g.boards}</td><td class="right num">${pct(g.occupancy)}</td>
            <td class="right num">${money(g.revenue, currency)}</td><td class="right num">${money(g.boards ? g.revenue / g.boards / months : 0, currency)}</td>
            <td class="right num">${money(g.costs, currency)}</td><td class="right num ${tone(g.profit)}"><b>${money(g.profit, currency)}</b></td><td class="right num">${marginText(g.margin)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Nothing in this period.</td></tr>'}
        </tbody></table></div>
      </div>`;
    $('[data-group]', body).addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (b) { state.group = b.dataset.g; drawAreas(); }
    });
  }

  function drawClients() {
    const rows = state.data.by_client || [];
    body.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Revenue by client</h3><span class="small muted">Top ${rows.length}</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Client</th><th class="right">Bookings</th><th class="right">Revenue</th><th style="width:30%">Share of revenue</th></tr></thead><tbody>
          ${rows.length ? rows.map((c) => `<tr><td><b>${esc(c.client)}</b></td><td class="right num">${c.bookings}</td><td class="right num">${money(c.revenue, currency)}</td>
            <td><div class="row"><div class="bar grow"><i style="width:${c.share}%"></i></div><span class="small num" style="width:38px;text-align:right">${c.share}%</span></div></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No bookings in this period.</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  async function loadMediums() {
    if (!state.mediums) {
      const d = await api.get('/mediums');
      state.mediums = d.mediums.map((m) => ({ id: m.id, code: m.code, title: m.title })).sort((a, b) => a.code.localeCompare(b.code));
    }
    return state.mediums;
  }

  async function addExpense(expense = null) {
    try {
      await expenseModal({ api, expense, currency, mediums: await loadMediums(), onSaved: load });
    } catch (err) { toastError(err); }
  }

  let expSeq = 0;
  async function drawExpenses() {
    const r = range();
    const seq = ++expSeq;
    body.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <select data-cat style="max-width:220px">${options(store.meta?.expense_categories || [], state.cat, { blank: 'All categories' })}</select>
          <input type="search" data-q placeholder="Paid to, note, board…" style="max-width:240px" value="${esc(state.q)}">
          <span class="grow"></span>
          ${canEdit ? '<button class="btn primary sm" data-add>' + icon('plus') + ' Add expense</button>' : ''}
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Category</th><th>Board</th><th>Paid to</th><th>Note</th><th class="right">Amount</th>${canEdit ? '<th></th>' : ''}</tr></thead>
          <tbody data-rows><tr><td colspan="7" class="empty">Loading…</td></tr></tbody></table></div>
        <div class="totals" data-sum></div>
      </div>`;
    const rowsEl = $('[data-rows]', body);
    try {
      const list = await api.get('/finance/expenses', { from: r.from, to: r.to, category: state.cat, q: state.q });
      if (seq !== expSeq) return; // a newer search is already on its way
      state.expenses = list;
    } catch (err) { toastError(err); return; }
    const list = state.expenses.expenses;
    rowsEl.innerHTML = list.length ? list.map((e) => `<tr>
      <td class="nowrap">${fdate(e.expense_date)}</td>
      <td>${esc(e.category_label)}</td>
      <td>${e.medium_id ? (links ? '<a href="/map?open=' + e.medium_id + '" data-link><b>' + esc(e.code) + '</b></a>' : '<b>' + esc(e.code) + '</b>') : '<span class="faint">Company-wide</span>'}</td>
      <td>${esc(e.vendor || '')}</td>
      <td class="small muted">${esc(e.note || '')}</td>
      <td class="right num"><b>${money(e.amount, currency)}</b></td>
      ${canEdit ? '<td class="nowrap"><button class="btn sm icon" data-edit="' + e.id + '" title="Edit">' + icon('edit') + '</button> <button class="btn sm icon danger" data-del="' + e.id + '" title="Delete">' + icon('trash') + '</button></td>' : ''}
    </tr>`).join('') : '<tr><td colspan="7" class="empty">No expenses in this period' + (canEdit ? '. Add rent, printing, salaries and other spending to see true profit.' : '.') + '</td></tr>';
    $('[data-sum]', body).innerHTML = '<span>' + state.expenses.count + ' expenses' + (state.expenses.count > list.length ? ' (latest ' + list.length + ' shown)' : '') + '</span><span>Total <b>' + money(state.expenses.total, currency) + '</b></span>';

    $('[data-cat]', body).addEventListener('change', (e) => { state.cat = e.target.value; drawExpenses(); });
    let timer;
    $('[data-q]', body).addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = e.target.value.trim(); drawExpenses().then(() => { const q = $('[data-q]', body); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 300);
    });
    $('[data-add]', body)?.addEventListener('click', () => addExpense());
    rowsEl.addEventListener('click', async (ev) => {
      const ed = ev.target.closest('[data-edit]');
      if (ed) return addExpense(list.find((x) => x.id === Number(ed.dataset.edit)));
      const del = ev.target.closest('[data-del]');
      if (del) {
        const e = list.find((x) => x.id === Number(del.dataset.del));
        if (!await confirmDialog('Delete the ' + e.category_label.toLowerCase() + ' expense of ' + money(e.amount, currency) + ' on ' + fdate(e.expense_date) + '?', { ok: 'Delete', danger: true })) return;
        try { await api.del('/finance/expenses/' + e.id); toast('Expense deleted', 'ok'); load(); } catch (err) { toastError(err); }
      }
    });
  }

  function exportCsv() {
    const d = state.data;
    if (!d) return;
    const stamp = d.from + '_to_' + d.to;
    if (state.tab === 'overview') {
      downloadCsv(fileName + '-months-' + stamp + '.csv', ['Month', 'Revenue', 'Site costs', 'Expenses', 'Total costs', 'Profit'],
        d.months.map((m) => [m.label, m.revenue, m.site_costs, m.expenses, m.costs, m.profit]).concat([['Total', d.totals.revenue, d.totals.site_costs, d.totals.expenses, d.totals.costs, d.totals.profit]]));
    } else if (state.tab === 'boards') {
      downloadCsv(fileName + '-boards-' + stamp + '.csv', ['Code', 'Title', 'Type', 'Area', 'City', 'Rate / month', 'Running cost / month', 'Booked %', 'Revenue', 'Site cost', 'Expenses', 'Profit'],
        (d.by_medium || []).map((b) => [b.code, b.title, b.type_label, b.area, b.city, b.rate_month, b.cost_month, b.occupancy, b.revenue, b.site_cost, b.expenses, b.profit]));
    } else if (state.tab === 'areas') {
      downloadCsv(fileName + '-by-' + state.group + '-' + stamp + '.csv', ['Group', 'Boards', 'Booked %', 'Revenue', 'Costs', 'Profit', 'Margin %'],
        groupRows().map((g) => [g.label, g.boards, g.occupancy, g.revenue, g.costs, g.profit, g.margin]));
    } else if (state.tab === 'clients') {
      downloadCsv(fileName + '-clients-' + stamp + '.csv', ['Client', 'Bookings', 'Revenue', 'Share %'],
        (d.by_client || []).map((c) => [c.client, c.bookings, c.revenue, c.share]));
    } else if (state.expenses) {
      downloadCsv(fileName + '-expenses-' + stamp + '.csv', ['Date', 'Category', 'Board', 'Paid to', 'Note', 'Amount'],
        state.expenses.expenses.map((e) => [e.expense_date, e.category_label, e.code || '', e.vendor, e.note, e.amount]));
    }
  }

  $('[data-preset]', root).addEventListener('change', (e) => {
    state.preset = e.target.value;
    const custom = state.preset === 'custom';
    $('[data-custom]', root).hidden = !custom;
    if (custom) {
      const d = state.data;
      $('[data-from]', root).value = state.from || d?.from || '';
      $('[data-to]', root).value = state.to || d?.to || '';
      return;
    }
    load();
  });
  $('[data-apply]', root).addEventListener('click', () => {
    state.from = $('[data-from]', root).value;
    state.to = $('[data-to]', root).value;
    if (!state.from || !state.to) return toast('Choose both dates', 'error');
    load();
  });
  $('[data-tabs]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) setTab(b.dataset.tab);
  });
  $('[data-csv]', root).addEventListener('click', exportCsv);

  load();
  return { addExpense: () => addExpense(), reload: load };
}

/* ------------------------------------------------------ recommendations */

const KIND = {
  cash: 'Cash flow', sales: 'Sales', pricing: 'Pricing', cost: 'Costs', compliance: 'Compliance',
  operations: 'Operations', risk: 'Risk', housekeeping: 'Data', growth: 'Growth',
};
const LEVEL = { high: 'Do now', medium: 'This week', low: 'When you can' };

/**
 * The ranked suggestions. `onAction(href)` handles a click on an action or an
 * item link; without it they are plain in-app links.
 */
function recommendationsHtml(recs, { currency, limit = 0, links = true } = {}) {
  if (!recs.length) {
    return '<div class="empty">' + icon('check') + '<div class="mt">Nothing needs attention right now. Good work.</div></div>';
  }
  const shown = limit ? recs.slice(0, limit) : recs;
  const a = (href, label, cls = '') => (href
    ? '<a href="' + esc(href) + '" ' + (links ? 'data-link' : 'data-rec-href="' + esc(href) + '"') + ' class="' + cls + '">' + label + '</a>'
    : label);
  return '<div class="recs">' + shown.map((r) => `
    <div class="rec ${esc(r.level)}">
      <span class="lvl" title="${esc(LEVEL[r.level] || '')}"></span>
      <div class="grow" style="min-width:0">
        <div class="rec-top"><h4>${esc(r.title)}</h4>${r.impact ? '<span class="impact">' + money(r.impact, currency) + '<small> ' + esc(r.impact_label) + '</small></span>' : ''}</div>
        <p>${esc(r.detail)}</p>
        ${r.items?.length ? '<details><summary>Show ' + (r.items.length < 5 ? r.items.length : 'top 5') + '</summary><div class="rec-items">' + r.items.map((it) => `
          <div><span class="grow ellipsis">${a(it.href, esc(it.label))}${it.sub ? ' <span class="faint">' + esc(it.sub) + '</span>' : ''}</span>${it.value ? '<b class="num nowrap">' + esc(it.value) + '</b>' : ''}</div>`).join('') + '</div></details>' : ''}
        <div class="rec-foot"><span class="tag">${esc(KIND[r.kind] || r.kind)}</span><span class="tag ${esc(r.level)}">${esc(LEVEL[r.level] || r.level)}</span>
          <span class="grow"></span>${r.action ? a(r.action.href, esc(r.action.label) + ' →', 'small') : ''}</div>
      </div>
    </div>`).join('') + '</div>' +
    (limit && recs.length > limit ? '<div class="card-pad" style="padding-top:0"><button class="btn sm" data-recs-all>Show all ' + recs.length + ' suggestions</button></div>' : '');
}

/** Wires a recommendations block: "show all", and actions when not plain links. */
export function bindRecommendations(container, recs, opts = {}) {
  const paint = (limit) => {
    container.innerHTML = recommendationsHtml(recs, { ...opts, limit });
    $('[data-recs-all]', container)?.addEventListener('click', () => paint(0));
  };
  paint(opts.limit || 0);
  if (opts.onAction) {
    container.addEventListener('click', (e) => {
      const link = e.target.closest('[data-rec-href]');
      if (!link) return;
      e.preventDefault();
      opts.onAction(link.dataset.recHref);
    });
  }
}

/** The handful of numbers an owner should glance at weekly, each explained. */
export function metricsHtml(m, { currency } = {}) {
  const row = (label, value, hint, extra = '') =>
    '<div><div class="grow"><b>' + label + '</b><div class="small faint">' + hint + '</div></div><div class="right"><b class="num">' + value + '</b>' + (extra ? '<div class="small">' + extra + '</div>' : '') + '</div></div>';
  return '<div class="list-rows">' + [
    row('Revenue, ' + esc(m.month_label), money(m.revenue_month, currency), 'Earned this month, including bookings to month end',
      delta(m.revenue_month, m.revenue_last_month, { label: 'vs ' + m.last_month_label })),
    row('Profit, ' + esc(m.month_label), '<span class="' + tone(m.profit_month) + '">' + money(m.profit_month, currency) + '</span>',
      m.has_costs ? 'After board running costs and expenses' : 'No costs recorded yet, so this equals revenue', 'margin ' + marginText(m.margin_month)),
    row('Booked for the next 90 days', money(m.booked_ahead_90, currency), 'Revenue already confirmed ahead. Low means sell now.'),
    row('Occupancy, last 6 months', pct(m.occupancy_180), 'Share of board-days that were sold'),
    row('Revenue per board per month', money(m.yield_month, currency), 'What one site earns on average, last 6 months'),
    row('Price achieved', pct(m.realization), 'Booked price against your rate card. Under 85% means heavy discounting.'),
    row('Collection rate', pct(m.collection_rate), 'Paid against billed, bookings ended in the last 6 months'),
    row('Average booking', m.avg_booking_days ? m.avg_booking_days + ' days' : '—', 'Longer bookings mean less selling effort per rupee'),
    row('Enquiry conversion', pct(m.enquiry_conversion), (m.enquiries_90 || 0) + ' customer requests in 90 days, share that became bookings'),
  ].join('') + '</div>';
}
