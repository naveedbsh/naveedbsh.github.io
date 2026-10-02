// All bookings: who has what, for how long, at what price, paid or not.
import { get } from '../api.js';
import {
  $, $$, esc, money, fdate, payPill, pill, typeInfo, toastError, busy, paged,
} from '../ui.js';
import { icon } from '../icons.js';
import { can } from '../app.js';
import { openBookingModal, markPaid } from './booking-form.js';

const PERIODS = [['', 'All'], ['current', 'Running'], ['upcoming', 'Upcoming'], ['expiring', 'Ending ≤ 7 days'], ['past', 'Past']];

export async function render(root, params, query) {
  const state = {
    period: PERIODS.some(([k]) => k === query.period) ? query.period : '',
    payment: ['due', 'unpaid', 'partial', 'paid'].includes(query.payment) ? query.payment : '',
    status: ['confirmed', 'hold', 'cancelled'].includes(query.status) ? query.status : '',
    q: '',
  };
  root.innerHTML = `
    <div class="page-head">
      <h1>Bookings</h1>
      ${can('manager') ? '<button class="btn primary" data-new>' + icon('plus') + ' New booking</button>' : ''}
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="tabs" data-period>${PERIODS.map(([k, l]) => '<button data-p="' + k + '"' + (k === state.period ? ' class="on"' : '') + '>' + l + '</button>').join('')}</div>
        <select style="max-width:160px" data-payment>
          <option value="">Any payment</option><option value="due">Not fully paid</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option>
        </select>
        <select style="max-width:150px" data-status><option value="">Active</option><option value="confirmed">Confirmed</option><option value="hold">On hold</option><option value="cancelled">Cancelled</option></select>
        <input type="search" placeholder="Client, campaign, code, invoice…" style="max-width:260px" data-q>
      </div>
      <div class="table-wrap"><table class="tbl"><thead><tr>
        <th>Medium</th><th>Client</th><th>Period</th><th class="right">Days</th><th class="right">Amount</th><th class="right">Paid</th><th>Payment</th><th>Status</th><th></th>
      </tr></thead><tbody data-body><tr><td colspan="9" class="empty">Loading…</td></tr></tbody></table></div>
      <div class="totals" data-totals></div>
    </div>`;
  $('[data-payment]', root).value = state.payment;
  $('[data-status]', root).value = state.status;

  const body = $('[data-body]', root);
  let rows = [];
  let seq = 0;
  async function load() {
    const mine = ++seq;
    try {
      const d = await get('/bookings', state);
      if (mine !== seq) return; // only the latest filter or search draws
      rows = d.bookings;
      paged(body, rows, (b) => `
        <tr data-id="${b.id}">
          <td><a href="/map?open=${b.medium_id}" data-link><b>${esc(b.code)}</b></a><div class="small muted">${esc(typeInfo(b.type).label)} · ${esc(b.area || b.city || '')}</div></td>
          <td><b>${esc(b.client_name)}</b>${b.campaign ? '<div class="small muted">' + esc(b.campaign) + '</div>' : ''}${b.invoice_no ? '<div class="small faint">' + esc(b.invoice_no) + '</div>' : ''}</td>
          <td class="nowrap small">${fdate(b.start_date)} → ${fdate(b.end_date)}<div class="faint">${b.phase === 'current' ? 'running' : b.phase}</div></td>
          <td class="right num">${b.days}</td>
          <td class="right num nowrap">${money(b.amount)}</td>
          <td class="right num nowrap">${money(b.amount_paid)}</td>
          <td>${payPill(b.payment_status)}</td>
          <td>${b.status === 'cancelled' ? '<span class="pill">Cancelled</span>' : b.status === 'hold' ? pill('on_hold', 'Hold') : '<span class="pill info">Confirmed</span>'}</td>
          <td class="nowrap">${can('manager') ? (b.payment_status !== 'paid' && b.status !== 'cancelled' ? '<button class="btn sm" data-paid="' + b.id + '">Mark paid</button> ' : '') + '<button class="btn sm icon" data-edit="' + b.id + '" title="Edit">' + icon('edit') + '</button>' : ''}</td>
        </tr>`, { step: 200, colspan: 9, empty: '<tr><td colspan="9" class="empty">No bookings here.</td></tr>' });
      // Totals cover every matching booking, even when only the newest are listed.
      const count = d.count ?? rows.length;
      $('[data-totals]', root).innerHTML = '<span>' + (count > rows.length ? 'Newest ' + rows.length + ' of ' + count + ' bookings <span class="faint">- filter to find older ones</span>' : count + ' bookings') + '</span>' +
        '<span>Value <b>' + money(d.totals.amount) + '</b></span><span>Received <b>' + money(d.totals.paid) + '</b></span><span>Due <b>' + money(d.totals.due) + '</b></span>';
    } catch (err) { toastError(err); }
  }

  $('[data-period]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    state.period = b.dataset.p;
    $$('[data-p]', root).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('[data-payment]', root).addEventListener('change', (e) => { state.payment = e.target.value; load(); });
  $('[data-status]', root).addEventListener('change', (e) => { state.status = e.target.value; load(); });
  let t;
  $('[data-q]', root).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); });

  body.addEventListener('click', async (e) => {
    const paid = e.target.closest('[data-paid]');
    if (paid) { await busy(paid, () => markPaid(Number(paid.dataset.paid))); load(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const b = rows.find((r) => r.id === Number(ed.dataset.edit));
      openBookingModal({ mediums: [{ id: b.medium_id, code: b.code, title: b.title, rate_month: null }], booking: b, onSaved: load });
    }
  });
  $('[data-new]', root)?.addEventListener('click', () => openBookingModal({ mediums: [], onSaved: load }));
  await load();
}
