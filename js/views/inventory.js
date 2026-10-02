// Table view of the whole inventory, with CSV export.
import { get, actingCompany } from '../api.js';
import {
  store, $, esc, pill, payPill, typeInfo, sizeText, money, fdate, illumLabel, paged,
} from '../ui.js';
import { icon } from '../icons.js';
import { navigate, can } from '../app.js';

export async function render(root) {
  const state = { q: '', type: '', status: '', rows: [] };
  root.innerHTML = `
    <div class="page-head">
      <h1>Inventory</h1>
      <a class="btn" href="#" data-export>${icon('download')} Export CSV</a>
      ${can('manager') ? '<a class="btn primary" href="/map?add=1" data-link>' + icon('plus') + ' Add new</a>' : ''}
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="Search code, title, area…" style="max-width:280px" data-q>
        <select style="max-width:220px" data-type><option value="">All types</option>${store.meta.types.map((t) => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('')}</select>
        <select style="max-width:170px" data-status><option value="">Any status</option><option value="available">Available</option><option value="on_hold">On hold</option><option value="booked">Booked</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option></select>
        <span class="grow"></span><span class="muted small" data-count></span>
      </div>
      <div class="table-wrap"><table class="tbl"><thead><tr>
        <th>Code</th><th style="min-width:220px">Medium</th><th>Size</th><th>Lighting</th><th class="right">Rate / mo</th><th>Status</th><th style="min-width:150px">Client · till</th><th>Payment</th><th title="Listed on the public marketplace">Public</th>
      </tr></thead><tbody data-body><tr><td colspan="9" class="empty">Loading…</td></tr></tbody></table></div>
    </div>`;

  const body = $('[data-body]', root);
  const params = () => ({ q: state.q, types: state.type, statuses: state.status });

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const data = await get('/mediums', params());
    if (mine !== seq) return; // typing fast: only the latest search draws
    state.rows = data.mediums;
    $('[data-count]', root).textContent = data.capped ? 'first ' + state.rows.length + ' of ' + data.total + ' media - narrow the search' : state.rows.length + ' media';
    paged(body, state.rows, (m) => `
      <tr class="click" data-id="${m.id}">
        <td class="nowrap"><b>${esc(m.code)}</b>${m.open_issues ? ' <span class="pill warn" title="Open problems">!' + m.open_issues + '</span>' : ''}</td>
        <td>${esc(m.title)}<div class="small muted">${esc(typeInfo(m.type).label)} · ${esc([m.area, m.city].filter(Boolean).join(', '))}</div></td>
        <td class="nowrap small">${esc(sizeText(m, { area: false }))}${m.quantity > 1 ? ' ×' + m.quantity : ''}</td>
        <td class="nowrap small">${esc(illumLabel(m.illumination))}</td>
        <td class="right num nowrap">${money(m.rate_month)}</td>
        <td>${pill(m.status)}</td>
        <td class="small">${m.booking ? esc(m.booking.client_name) + '<div class="faint">till ' + fdate(m.booking.end_date) + '</div>' : m.available_from ? 'Free ' + fdate(m.available_from) : ''}</td>
        <td>${m.booking ? payPill(m.booking.payment_status) : ''}</td>
        <td>${m.is_public ? '<span class="pill info" title="Listed on the public marketplace">' + icon('globe') + ' Listed</span>' : '<span class="faint small">Private</span>'}</td>
      </tr>`, { step: 250, colspan: 9, empty: '<tr><td colspan="9" class="empty">No media match.</td></tr>' });
  }

  let t;
  $('[data-q]', root).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); });
  $('[data-type]', root).addEventListener('change', (e) => { state.type = e.target.value; load(); });
  $('[data-status]', root).addEventListener('change', (e) => { state.status = e.target.value; load(); });
  body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) navigate('/map?open=' + tr.dataset.id);
  });
  $('[data-export]', root).addEventListener('click', (e) => {
    e.preventDefault();
    const qs = new URLSearchParams(Object.entries(params()).filter(([, v]) => v));
    // The download goes through a plain link, so the super admin's company choice travels in the URL.
    if (actingCompany.get()) qs.set('_company', actingCompany.get());
    window.location.href = '/api/mediums/export.csv?' + qs.toString();
  });
  await load();
}
