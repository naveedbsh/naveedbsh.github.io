// Invoices to the company's clients: the list, raising one from a client's
// bookings (plus extra lines), recording payments, and sending it - WhatsApp,
// email, link, PDF. Managers and admins.
import { get, post, patch } from '../api.js';
import { store, $, $$, el, esc, fdate, money, modal, toast, toastError, busy, formData, confirmDialog, copyText, waLink, todayISO, addDays } from '../ui.js';
import { icon } from '../icons.js';
import { navigate } from '../app.js';
import { invoiceHtml, statePill, amt } from '../invoice-doc.js';

export async function render(root, params, query = {}) {
  if (params.id) return detail(root, Number(params.id));
  return list(root, query);
}

const pdfUrl = (inv) => '/i/' + inv.token + '?print=1';
const shareText = (i, seller, url) => 'Invoice ' + i.number + ' from ' + seller + ': ' + amt(i.total, i.currency) +
  (i.due > 0 ? '. ' + amt(i.due, i.currency) + ' due by ' + fdate(i.due_date) : '. Paid in full, thank you') + '. View' + (i.due > 0 ? ' and pay' : '') + ': ' + url;

/* ------------------------------------------------------------------ list */

async function list(root, query) {
  const f = { q: '', state: ['open', 'overdue', 'paid', 'cancelled', 'unpaid', 'partial'].includes(query.state) ? query.state : '' };
  const settings = await get('/invoices/settings');
  const s = settings.settings;
  const ready = s.bank.account_number || s.upi.vpa;
  root.innerHTML = `
    <div class="page-head"><h1>Invoices</h1>
      <a class="btn" href="/settings#invoice-details" data-link>${icon('settings')} Invoice details</a>
      <button class="btn primary" data-new>${icon('plus')} New invoice</button></div>
    ${ready ? '' : `<div class="note-box">${icon('bulb')}<div><b>Add your bank account and UPI ID</b> under <a href="/settings#invoice-details" data-link>Settings → Invoice details</a>: they print on every invoice, with a UPI QR code clients can scan to pay the exact amount.</div></div>`}
    <div class="stats" data-stats></div>
    <div class="card">
      <div class="toolbar">
        <input type="search" data-q class="grow" style="max-width:320px" placeholder="Invoice number or client" aria-label="Search invoices">
        <select data-state style="max-width:200px" aria-label="Status">
          <option value="">Every invoice</option><option value="open">Not fully paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select>
        <span class="grow small muted" data-count></span>
      </div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Invoice</th><th>Client</th><th>Due date</th><th class="right">Total</th><th class="right">Received</th><th class="right">Due</th><th>Status</th><th></th></tr></thead><tbody data-rows><tr><td colspan="8" class="empty">Loading…</td></tr></tbody></table></div>
    </div>`;
  $('[data-state]', root).value = f.state;
  let rows = [];
  let seq = 0;
  async function load() {
    const mine = ++seq;
    const r = await get('/invoices', { q: f.q, state: f.state });
    if (mine !== seq) return;
    rows = r.invoices;
    const t = r.totals;
    const c = store.company?.currency || 'INR';
    $('[data-stats]', root).innerHTML = `
      <div class="card stat accent"><div class="label">Invoiced</div><div class="value">${money(t.invoiced, c)}</div><div class="sub">${t.count} invoice${t.count === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="label">Received</div><div class="value">${money(t.paid, c)}</div></div>
      <div class="card stat"><div class="label">Due</div><div class="value">${money(t.due, c)}</div></div>
      <div class="card stat"><div class="label">Overdue</div><div class="value${t.overdue ? ' neg' : ''}">${money(t.overdue, c)}</div></div>`;
    $('[data-count]', root).textContent = rows.length + ' invoice' + (rows.length === 1 ? '' : 's');
    $('[data-rows]', root).innerHTML = rows.map((i) => `<tr class="click" data-id="${i.id}">
      <td class="nowrap"><b>${esc(i.number)}</b><div class="small faint">${fdate(i.issue_date)}</div></td>
      <td><b>${esc(i.client_name)}</b></td>
      <td class="small nowrap">${fdate(i.due_date)}</td>
      <td class="right num">${amt(i.total, i.currency)}</td>
      <td class="right num">${amt(i.paid, i.currency)}</td>
      <td class="right num">${i.due > 0 ? '<b' + (i.overdue ? ' class="neg"' : '') + '>' + amt(i.due, i.currency) + '</b>' : '<span class="faint">—</span>'}</td>
      <td>${statePill(i)}</td>
      <td class="nowrap">${i.state !== 'cancelled' && i.client_phone ? `<a class="btn sm icon" data-stop target="_blank" rel="noopener" title="Send on WhatsApp" href="${esc(waLink(shareText(i, store.company?.name || '', location.origin + '/i/' + i.token), i.client_phone))}">${icon('whatsapp')}</a>` : ''}
        <a class="btn sm icon" data-stop target="_blank" rel="noopener" title="Download PDF" href="${esc(pdfUrl(i))}">${icon('download')}</a></td>
    </tr>`).join('') || `<tr><td colspan="8" class="empty">${f.q || f.state ? 'No invoice matches.' : 'No invoices yet. Raise the first one from a client\'s bookings.'}</td></tr>`;
  }
  let timer = null;
  $('[data-q]', root).addEventListener('input', (e) => { f.q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(() => load().catch(toastError), 250); });
  $('[data-state]', root).addEventListener('change', (e) => { f.state = e.target.value; history.replaceState({}, '', '/invoices' + (f.state ? '?state=' + f.state : '')); load().catch(toastError); });
  $('[data-rows]', root).addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) navigate('/invoices/' + tr.dataset.id);
  });
  const open = (preset = {}) => invoiceForm({ preset, onSaved: (r) => navigate('/invoices/' + r.id) });
  $('[data-new]', root).addEventListener('click', () => open());
  await load();
  // From Reports -> Collections: "Create invoice" for one client's booking.
  if (query.new) {
    history.replaceState({}, '', '/invoices');
    open({ client: query.new, booking: Number(query.booking) || null });
  }
  return undefined;
}

/* ------------------------------------------------------------- one invoice */

async function detail(root, id) {
  let doc;
  try { doc = await get('/invoices/' + id); } catch (err) {
    root.innerHTML = '<div class="page-head"><a class="btn ghost icon" href="/invoices" data-link>' + icon('back') + '</a><h1>Invoice</h1></div><div class="card"><div class="empty">' + esc(err.message) + '</div></div>';
    return undefined;
  }
  const i = doc.invoice;
  const live = i.state !== 'cancelled';
  const url = location.origin + '/i/' + i.token;
  root.innerHTML = `
    <div class="page-head inv-actions">
      <a class="btn ghost icon" href="/invoices" data-link title="All invoices">${icon('back')}</a>
      <h1 class="grow" style="min-width:0">${esc(i.number)} <span style="vertical-align:middle">${statePill(i)}</span></h1>
      <a class="btn" href="${esc(pdfUrl(i))}" target="_blank" rel="noopener">${icon('download')} PDF</a>
      ${live && i.due > 0 ? `<button class="btn primary" data-pay>${icon('rupee')} Record payment</button>` : ''}
    </div>
    <div class="row wrap" style="gap:8px;margin:-6px 0 16px">
      ${live ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(waLink(shareText(i, doc.seller.legal_name, url), i.client.phone || ''))}">${icon('whatsapp')} WhatsApp</a>
      <button class="btn sm" data-email>${icon('send')} Email</button>` : ''}
      <button class="btn sm" data-copy>${icon('copy')} Copy client link</button>
      ${live ? `<button class="btn sm" data-edit>${icon('edit')} Edit</button><button class="btn sm ghost danger" data-cancel>Cancel invoice</button>` : ''}
    </div>
    <div class="inv-host">${invoiceHtml(doc)}</div>`;
  const again = () => detail(root, id);
  $('[data-copy]', root).addEventListener('click', () => copyText(url));
  $('[data-pay]', root)?.addEventListener('click', () => paymentModal(doc, again));
  $('[data-email]', root)?.addEventListener('click', () => emailModal(doc, again));
  $('[data-edit]', root)?.addEventListener('click', () => invoiceForm({ doc, onSaved: again }));
  $('[data-cancel]', root)?.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Cancel invoice ' + i.number + '? It stays on record (numbers are never reused), its bookings can go on a new invoice, and the client\'s link shows it as cancelled.', { ok: 'Cancel invoice', danger: true }))) return;
    busy(e.currentTarget, async () => { try { await post('/invoices/' + id + '/cancel'); toast('Invoice cancelled'); again(); } catch (err) { toastError(err); } });
  });
  return undefined;
}

function paymentModal(doc, onDone) {
  const i = doc.invoice;
  const body = el(`<form novalidate>
    <p class="muted">${amt(i.due, i.currency)} is due. A payment pays the invoice's bookings first, so their own "paid" figures update too.</p>
    <div class="grid-2">
      <label class="field"><span>Amount received</span><input type="number" name="amount" min="0.01" step="0.01" value="${i.due.toFixed(2)}"></label>
      <label class="field"><span>Date received</span><input type="date" name="paid_on" value="${todayISO()}" max="${todayISO()}"></label>
      <label class="field"><span>How</span><select name="method"><option value="upi">UPI</option><option value="bank" selected>Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label>
      <label class="field"><span>Reference (UTR, cheque no.)</span><input type="text" name="reference" maxlength="120"></label>
    </div>
    <div class="error-text mt hidden" data-err></div></form>`);
  const m = modal({ title: 'Record a payment on ' + i.number, body, size: 'narrow', foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Record payment</button>' });
  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    try {
      const r = await post('/invoices/' + i.id + '/payments', formData(body));
      m.close();
      toast(r.state === 'paid' ? 'Paid in full' : amt(r.due, i.currency) + ' still due', 'ok');
      onDone();
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  }));
}

function emailModal(doc, onDone) {
  const i = doc.invoice;
  const m = modal({
    title: 'Email ' + i.number, size: 'narrow',
    body: `<p class="muted">The client gets an email with the amount, the due date and a link to view, download and pay the invoice.</p>
      <label class="field"><span>Send to</span><input type="email" data-to value="${esc(i.client.email || '')}" placeholder="client@company.com"></label>
      <div class="error-text mt hidden" data-err></div>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-send>' + icon('send') + ' Send</button>',
  });
  $('[data-send]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    try { await post('/invoices/' + i.id + '/email', { to: $('[data-to]', m.el).value }); m.close(); toast('Invoice emailed', 'ok'); onDone(); } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  }));
}

/* ------------------------------------------------------- raise or change */

/**
 * The invoice form. New: pick a client, tick their bookings, add lines.
 * Edit (`doc`): the same, for an existing invoice.
 */
async function invoiceForm({ doc = null, preset = {}, onSaved }) {
  const [billable, cfg] = await Promise.all([get('/invoices/billable'), get('/invoices/settings')]);
  const s = cfg.settings;
  const seller = cfg.seller;
  const cur = store.company?.currency || 'INR';
  const lower = (x) => String(x || '').trim().toLowerCase();
  const clients = billable.clients;
  const inv = doc && doc.invoice;
  // For an edit, the invoice's own bookings are listed (ticked) with the client's others.
  const own = doc ? doc.items.filter((it) => it.booking_id).map((it) => ({ id: it.booking_id, label: it.description, start_date: it.period_start, end_date: it.period_end, amount: it.amount, own: true })) : [];
  const lines = doc ? doc.items.filter((it) => !it.booking_id).map((it) => ({ description: it.description, amount: it.amount })) : [];
  let client = doc ? { client_name: inv.client.name, client_contact: inv.client.contact || '', client_phone: inv.client.phone || '', client_email: inv.client.email || '', client_address: inv.client.address || '', client_gstin: inv.client.gstin || '', client_state: inv.client.state_code || '', bookings: (clients.find((c) => lower(c.client_name) === lower(inv.client.name)) || { bookings: [] }).bookings }
    : clients.find((c) => lower(c.client_name) === lower(preset.client)) || null;
  let dueTouched = !!doc;
  const stateOptions = (sel) => '<option value="">—</option>' + cfg.states.map(([code, name]) => '<option value="' + code + '"' + (code === sel ? ' selected' : '') + '>' + code + ' · ' + esc(name) + '</option>').join('');

  const body = el(`<form novalidate autocomplete="off" class="inv-form">
    ${doc ? '' : `<label class="field"><span>Client</span><select data-client>
      <option value="">Choose a client…</option>
      ${clients.map((c, k) => '<option value="' + k + '"' + (client === c ? ' selected' : '') + '>' + esc(c.client_name) + (c.bookings.length ? ' · ' + c.bookings.length + ' booking' + (c.bookings.length === 1 ? '' : 's') + ' to invoice' : '') + '</option>').join('')}
      <option value="new">Another client…</option></select></label>`}
    <div data-rest${client || doc ? '' : ' hidden'}>
      <div class="form-section">Bookings</div>
      <div data-bookings class="inv-pick"></div>
      <div class="form-section">Extra lines <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500">(printing, mounting, design…)</span></div>
      <div data-lines style="display:grid;gap:8px"></div>
      <div class="row wrap mt" style="gap:6px"><button type="button" class="btn sm" data-add-line>${icon('plus')} Add line</button>
        <button type="button" class="btn sm ghost" data-quick="Printing of flex">Printing</button><button type="button" class="btn sm ghost" data-quick="Mounting charges">Mounting</button><button type="button" class="btn sm ghost" data-quick="Creative design">Design</button></div>
      <div class="form-section">Bill to</div>
      <div class="grid-2">
        <label class="field"><span>Client name *</span><input type="text" name="client_name" maxlength="160"></label>
        <label class="field"><span>Contact person</span><input type="text" name="client_contact" maxlength="120"></label>
        <label class="field"><span>Phone (for WhatsApp)</span><input type="tel" name="client_phone" maxlength="40"></label>
        <label class="field"><span>Email</span><input type="email" name="client_email" maxlength="190"></label>
      </div>
      <label class="field mt"><span>Billing address</span><textarea name="client_address" rows="2" maxlength="500"></textarea></label>
      <div class="grid-2 mt">
        <label class="field"><span>Client GSTIN</span><input type="text" name="client_gstin" maxlength="15" style="text-transform:uppercase" placeholder="15 characters, if registered"></label>
        <label class="field"><span>Client state (place of supply)</span><select name="client_state">${stateOptions('')}</select></label>
      </div>
      <div class="form-section">Dates &amp; tax</div>
      <div class="grid-4">
        <label class="field"><span>Invoice date</span><input type="date" name="issue_date" value="${esc(inv ? inv.issue_date : todayISO())}"></label>
        <label class="field"><span>Due date</span><input type="date" name="due_date" value="${esc(inv ? inv.due_date : addDays(todayISO(), s.terms_days))}"></label>
        ${seller.gst_registered ? `<label class="field"><span>GST</span><select name="tax_type"><option value="cgst_sgst">CGST + SGST (same state)</option><option value="igst">IGST (other state)</option><option value="none">No GST</option></select></label>
        <label class="field"><span>GST rate</span><select name="tax_rate">${[5, 12, 18, 28].map((r) => '<option value="' + r + '"' + (r === Number(inv ? inv.tax_rate || s.gst_rate : s.gst_rate) ? ' selected' : '') + '>' + r + '%</option>').join('')}</select></label>`
    : '<div class="small muted" style="grid-column:span 2;align-self:end">No GST: add your GSTIN to the company profile to charge it.</div>'}
      </div>
      <label class="field mt"><span>Note on this invoice (optional)</span><textarea name="notes" rows="2" maxlength="2000">${esc(inv ? inv.notes : '')}</textarea></label>
      <div class="inv-preview" data-preview></div>
    </div>
    <div class="error-text mt hidden" data-err></div>
  </form>`);
  const m = modal({ title: doc ? 'Edit ' + inv.number : 'New invoice', body, size: 'wide', foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save' + (client || doc ? '' : ' disabled') + '>' + (doc ? 'Save invoice' : 'Create invoice') + '</button>' });
  const save = $('[data-save]', m.el);

  function fillClient(c) {
    for (const k of ['client_name', 'client_contact', 'client_phone', 'client_email', 'client_address', 'client_gstin']) body[k].value = c ? c[k] || '' : '';
    body.client_state.value = c ? c.client_state || '' : '';
    autoTax();
  }
  function paintBookings() {
    const box = $('[data-bookings]', body);
    const list = [...own, ...((client && client.bookings) || []).map((b) => ({ id: b.id, label: b.code + ' – ' + b.title, start_date: b.start_date, end_date: b.end_date, amount: b.amount, paid: b.amount_paid, status: b.status }))];
    const tick = (b) => b.own || (preset.booking ? b.id === preset.booking : true);
    box.innerHTML = list.length ? list.map((b) => `<label class="inv-pick-row"><input type="checkbox" value="${b.id}" data-booking${tick(b) ? ' checked' : ''}>
      <span class="grow"><b>${esc(b.label)}</b><span class="small faint">${fdate(b.start_date)} – ${fdate(b.end_date)}${b.status === 'hold' ? ' · on hold' : ''}${b.paid ? ' · ' + money(b.paid, cur) + ' paid' : ''}</span></span>
      <span class="num">${amt(b.amount, cur)}</span></label>`).join('') : '<div class="small muted">No bookings of this client are waiting for an invoice. Add lines below.</div>';
  }
  function paintLines() {
    $('[data-lines]', body).innerHTML = lines.map((l, k) => `<div class="row" style="gap:8px" data-line="${k}">
      <input type="text" class="grow" data-ld maxlength="500" placeholder="Description" value="${esc(l.description)}" aria-label="Description">
      <input type="number" data-la min="0.01" step="0.01" placeholder="Amount" value="${l.amount ?? ''}" style="max-width:140px" aria-label="Amount">
      <button type="button" class="btn sm icon ghost" data-remove title="Remove line">${icon('x')}</button></div>`).join('');
  }
  function autoTax() {
    if (!seller.gst_registered || doc) return;
    const st = body.client_state.value || (body.client_gstin.value.length >= 2 ? body.client_gstin.value.slice(0, 2) : '');
    body.tax_type.value = st && seller.state_code && st !== seller.state_code ? 'igst' : 'cgst_sgst';
  }
  function preview() {
    const picked = new Set($$('[data-booking]:checked', body).map((x) => Number(x.value)));
    const all = [...own, ...((client && client.bookings) || [])];
    let sub = all.filter((b) => picked.has(b.id)).reduce((t, b) => t + Number(b.amount), 0);
    sub += lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
    const type = body.tax_type ? body.tax_type.value : 'none';
    const rate = type === 'none' ? 0 : Number(body.tax_rate ? body.tax_rate.value : 0);
    const tax = Math.round(sub * rate) / 100;
    $('[data-preview]', body).innerHTML = `<div><span>${type === 'none' ? 'Total' : 'Taxable value'}</span><b>${amt(sub, cur)}</b></div>` +
      (type === 'none' ? '' : `<div><span>${type === 'igst' ? 'IGST' : 'CGST + SGST'} ${rate}%</span><b>${amt(tax, cur)}</b></div><div class="total"><span>Total</span><b>${amt(sub + tax, cur)}</b></div>`);
  }

  if (doc) {
    fillClient(client);
    body.client_state.value = inv.client.state_code || '';
    if (body.tax_type) body.tax_type.value = inv.tax_type;
  } else if (client) fillClient(client);
  paintBookings();
  paintLines();
  preview();

  $('[data-client]', body)?.addEventListener('change', (e) => {
    const v = e.target.value;
    client = v === 'new' ? { client_name: '', bookings: [] } : clients[Number(v)] || null;
    preset.booking = null;
    $('[data-rest]', body).hidden = !client;
    save.disabled = !client;
    fillClient(client && v !== 'new' ? client : null);
    paintBookings();
    preview();
    if (v === 'new') body.client_name.focus();
  });
  body.addEventListener('input', (e) => {
    const row = e.target.closest('[data-line]');
    if (row) {
      const l = lines[Number(row.dataset.line)];
      if (e.target.matches('[data-ld]')) l.description = e.target.value;
      if (e.target.matches('[data-la]')) l.amount = e.target.value;
    }
    if (e.target.name === 'client_gstin') autoTax();
    if (e.target.name === 'due_date') dueTouched = true;
    preview();
  });
  body.addEventListener('change', (e) => {
    if (e.target.name === 'client_state') autoTax();
    if (e.target.name === 'issue_date' && !dueTouched && e.target.value) body.due_date.value = addDays(e.target.value, s.terms_days);
    preview();
  });
  body.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-line]') || e.target.closest('[data-quick]');
    if (add) { lines.push({ description: add.dataset.quick || '', amount: '' }); paintLines(); const r = $$('[data-line]', body).pop(); $(add.dataset.quick ? '[data-la]' : '[data-ld]', r).focus(); preview(); }
    const rm = e.target.closest('[data-remove]');
    if (rm) { lines.splice(Number(rm.closest('[data-line]').dataset.line), 1); paintLines(); preview(); }
  });

  save.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    const d = formData(body);
    const payload = {
      client_name: d.client_name, client_contact: d.client_contact, client_phone: d.client_phone, client_email: d.client_email,
      client_address: d.client_address, client_gstin: d.client_gstin, client_state: d.client_state,
      issue_date: d.issue_date, due_date: d.due_date, tax_type: d.tax_type, tax_rate: d.tax_rate, notes: d.notes,
      booking_ids: $$('[data-booking]:checked', body).map((x) => Number(x.value)),
      lines: lines.filter((l) => String(l.description).trim() || l.amount).map((l) => ({ description: l.description, amount: l.amount })),
    };
    try {
      const r = doc ? await patch('/invoices/' + inv.id, payload) : await post('/invoices', payload);
      m.close();
      toast(doc ? 'Invoice saved' : 'Invoice ' + r.number + ' created', 'ok');
      onSaved(doc ? { id: inv.id } : r);
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  }));
  return m;
}

