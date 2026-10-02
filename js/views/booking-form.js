// Create / edit bookings. One modal books one or many media for the same
// client and dates; prices are quoted pro-rata from each monthly rate and
// can be overridden per medium.
import { get, post, patch, del } from '../api.js';
import {
  $, el, esc, modal, money, fdate, todayISO, addDays, daysBetween, toast, toastError, busy, formData, confirmDialog,
} from '../ui.js';
import { can } from '../app.js';

export async function markPaid(id) {
  try {
    await patch('/bookings/' + id, { payment_status: 'paid' });
    toast('Marked as paid', 'ok');
  } catch (err) { toastError(err); }
}

function clashHtml(list) {
  return '<div class="clash-box"><b>Already taken in these dates:</b><ul style="margin:6px 0 0;padding-left:18px">' +
    list.map((c) => '<li>' + esc(c.code || '') + ' — ' + esc(c.client_name) + ' (' + (c.status === 'hold' ? 'hold' : 'booked') + ', ' +
      fdate(c.start_date) + ' → ' + fdate(c.end_date) + ')</li>').join('') + '</ul></div>';
}

/**
 * openBookingModal({ mediums, booking, range, onSaved })
 *   mediums  media to book (may be empty: a picker is shown)
 *   booking  existing booking to edit (single medium)
 */
export async function openBookingModal({ mediums = [], booking = null, range = {}, onSaved } = {}) {
  const editing = !!booking;
  let items = mediums.map((m) => ({ id: m.id, code: m.code, title: m.title, rate_month: m.rate_month, amount: null, touched: false, clashes: [] }));
  const start0 = booking?.start_date || range.from || todayISO();
  const end0 = booking?.end_date || range.to || addDays(start0, 29);

  let all = null; // lazily loaded for the picker
  const body = el(`
    <form novalidate autocomplete="off">
      ${editing ? '' : `<div data-picker>
        <label class="field"><span>Add media</span><input type="search" list="hh-media-list" placeholder="Type a code or place…" data-pick></label>
        <datalist id="hh-media-list"></datalist>
      </div>`}
      <div class="grid-2 ${editing ? '' : 'mt'}">
        <label class="field"><span>Start date *</span><input type="date" name="start_date" value="${esc(start0)}" required></label>
        <label class="field"><span>End date *</span><input type="date" name="end_date" value="${esc(end0)}" required></label>
      </div>
      <div class="hint" data-days></div>
      <div class="mt" data-items></div>
      <div class="form-section">Client</div>
      <div class="grid-2">
        <label class="field"><span>Client / company *</span><input type="text" name="client_name" maxlength="160" value="${esc(booking?.client_name || '')}" required></label>
        <label class="field"><span>Contact person</span><input type="text" name="client_contact" maxlength="120" value="${esc(booking?.client_contact || '')}"></label>
        <label class="field"><span>Phone</span><input type="tel" name="client_phone" maxlength="40" value="${esc(booking?.client_phone || '')}"></label>
        <label class="field"><span>Email</span><input type="email" name="client_email" maxlength="190" value="${esc(booking?.client_email || '')}"></label>
      </div>
      <label class="field mt"><span>Campaign</span><input type="text" name="campaign" maxlength="160" value="${esc(booking?.campaign || '')}"></label>
      <div class="form-section">Status & payment</div>
      <div class="grid-3">
        <label class="field"><span>Booking status</span><select name="status">
          <option value="confirmed"${booking?.status === 'confirmed' || !booking ? ' selected' : ''}>Confirmed</option>
          <option value="hold"${booking?.status === 'hold' ? ' selected' : ''}>On hold (tentative)</option>
          ${editing ? '<option value="cancelled"' + (booking.status === 'cancelled' ? ' selected' : '') + '>Cancelled</option>' : ''}
        </select></label>
        <label class="field"><span>Payment</span><select name="payment_status">
          <option value="unpaid"${booking?.payment_status === 'unpaid' || !booking ? ' selected' : ''}>Unpaid</option>
          <option value="partial"${booking?.payment_status === 'partial' ? ' selected' : ''}>Part paid</option>
          <option value="paid"${booking?.payment_status === 'paid' ? ' selected' : ''}>Paid in full</option>
        </select></label>
        <label class="field" data-paid-wrap><span>Amount received</span><input type="number" min="0" step="0.01" name="amount_paid" value="${booking ? booking.amount_paid : ''}"></label>
      </div>
      <div class="grid-2 mt">
        <label class="field"><span>Invoice no.</span><input type="text" name="invoice_no" maxlength="60" value="${esc(booking?.invoice_no || '')}"></label>
        <span></span>
      </div>
      <label class="field mt"><span>Notes</span><textarea name="notes" maxlength="5000">${esc(booking?.notes || '')}</textarea></label>
      <div class="mt" data-clash></div>
      <div class="error-text mt hidden" data-err></div>
    </form>`);

  const foot = el('<div class="row" style="width:100%">' +
    (editing && can('admin') ? '<button class="btn danger" data-delete>Delete</button>' : '') +
    '<span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>' + (editing ? 'Save booking' : 'Create booking') + '</button></div>');

  const m = modal({ title: editing ? 'Edit booking' : 'Book media', body, foot, size: 'wide' });
  const form = body;

  /* ------------------------------------------------------------ items */
  const itemsEl = $('[data-items]', body);
  function drawItems() {
    const days = currentDays();
    if (!items.length) { itemsEl.innerHTML = '<div class="empty small">Add at least one medium above.</div>'; return; }
    let total = 0;
    itemsEl.innerHTML = '<div class="card" style="box-shadow:none"><table class="tbl"><thead><tr><th>Medium</th><th class="right">Rate / month</th><th class="right" style="width:170px">Price for ' + (days || '?') + ' days</th>' + (editing ? '' : '<th></th>') + '</tr></thead><tbody>' +
      items.map((it, i) => {
        const amt = it.amount ?? '';
        total += Number(amt) || 0;
        return '<tr><td><b>' + esc(it.code) + '</b> <span class="muted small">' + esc(it.title) + '</span>' +
          (it.clashes.length ? '<div class="small" style="color:var(--st-booked)">Clashes with ' + esc(it.clashes.map((c) => c.client_name + ' (' + fdate(c.start_date) + '–' + fdate(c.end_date) + ')').join(', ')) + '</div>' : '') +
          '</td><td class="right num">' + money(it.rate_month) + '</td>' +
          '<td class="right"><input type="number" min="0" step="0.01" data-amt="' + i + '" value="' + amt + '" style="height:32px;text-align:right"></td>' +
          (editing ? '' : '<td><button type="button" class="btn ghost sm icon" data-rm="' + i + '" title="Remove">×</button></td>') + '</tr>';
      }).join('') + '</tbody></table>' +
      '<div class="totals"><span>Total <b class="num" data-total>' + money(total) + '</b></span><span>' + items.length + ' medi' + (items.length === 1 ? 'um' : 'a') + '</span></div></div>';
  }
  itemsEl.addEventListener('input', (e) => {
    const i = e.target.dataset.amt;
    if (i === undefined) return;
    items[i].amount = e.target.value === '' ? null : Number(e.target.value);
    items[i].touched = true;
    const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    $('[data-total]', itemsEl).textContent = money(total);
  });
  itemsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    items.splice(Number(b.dataset.rm), 1);
    drawItems();
  });

  const currentDays = () => {
    const s = form.start_date.value; const e = form.end_date.value;
    return s && e && e >= s ? daysBetween(s, e) : 0;
  };

  let quoteSeq = 0;
  async function quote() {
    const days = currentDays();
    $('[data-days]', body).textContent = days ? days + ' days · ' + fdate(form.start_date.value) + ' → ' + fdate(form.end_date.value) : 'End date must be on or after the start date';
    if (!days || !items.length) { drawItems(); return; }
    const seq = ++quoteSeq;
    try {
      const q = await post('/bookings/quote', {
        medium_ids: items.map((i) => i.id), start_date: form.start_date.value, end_date: form.end_date.value, ignore_id: booking?.id || 0,
      });
      if (seq !== quoteSeq) return;
      for (const it of items) {
        const r = q.items.find((x) => x.medium_id === it.id);
        if (!r) continue;
        it.clashes = r.clashes;
        it.rate_month = r.rate_month;
        // Keep a price the user typed (or the saved one when editing) - only fill blanks.
        if (!it.touched) it.amount = r.amount;
      }
    } catch (err) { toastError(err); }
    drawItems();
  }

  if (editing) {
    items = [{ id: booking.medium_id || mediums[0]?.id, code: mediums[0]?.code || booking.code, title: mediums[0]?.title || booking.title, rate_month: mediums[0]?.rate_month ?? null, amount: booking.amount, touched: true, clashes: [] }];
  }
  form.start_date.addEventListener('change', () => { if (form.end_date.value < form.start_date.value) form.end_date.value = addDays(form.start_date.value, 29); quote(); });
  form.end_date.addEventListener('change', quote);
  quote();

  /* ------------------------------------------------------------ picker */
  const pick = $('[data-pick]', body);
  if (pick) {
    pick.addEventListener('focus', async () => {
      if (all) return;
      try {
        all = (await get('/mediums')).mediums;
        $('#hh-media-list', body).innerHTML = all.map((x) => '<option value="' + esc(x.code + ' · ' + x.title) + '"></option>').join('');
      } catch (err) { toastError(err); }
    }, { once: true });
    pick.addEventListener('change', () => {
      const found = all?.find((x) => x.code + ' · ' + x.title === pick.value);
      if (found && !items.some((i) => i.id === found.id)) {
        items.push({ id: found.id, code: found.code, title: found.title, rate_month: found.rate_month, amount: null, touched: false, clashes: [] });
        quote();
      }
      pick.value = '';
    });
  }

  /* ----------------------------------------------------------- payment */
  const paidWrap = $('[data-paid-wrap]', body);
  const syncPay = () => { paidWrap.style.visibility = form.payment_status.value === 'partial' ? 'visible' : 'hidden'; };
  form.payment_status.addEventListener('change', syncPay);
  syncPay();

  /* -------------------------------------------------------------- save */
  async function save(force = false) {
    const err = $('[data-err]', body);
    err.classList.add('hidden');
    $('[data-clash]', body).innerHTML = '';
    const d = formData(form);
    if (!items.length) { err.textContent = 'Add at least one medium.'; err.classList.remove('hidden'); return; }
    if (!d.client_name.trim()) { err.textContent = 'Client name is required.'; err.classList.remove('hidden'); form.client_name.focus(); return; }
    if (d.payment_status !== 'partial') delete d.amount_paid;
    try {
      if (editing) {
        await patch('/bookings/' + booking.id, { ...d, amount: items[0].amount ?? 0, force });
        toast('Booking saved', 'ok');
      } else {
        const amounts = Object.fromEntries(items.map((i) => [i.id, i.amount ?? '']));
        const r = await post('/bookings', { ...d, medium_ids: items.map((i) => i.id), amounts, amount: items.length === 1 ? items[0].amount : undefined, force });
        toast(r.bookings.length === 1 ? 'Booked ' + r.bookings[0].code : r.bookings.length + ' media booked', 'ok');
      }
      m.close();
      onSaved?.();
    } catch (ex) {
      if (ex.status === 409 && ex.payload?.details?.clashes) {
        const box = $('[data-clash]', body);
        box.innerHTML = clashHtml(ex.payload.details.clashes) +
          (can('manager') ? '<div class="row mt"><span class="small muted grow">Double-booking is allowed only if you are sure (e.g. a multi-slot screen).</span><button type="button" class="btn danger sm" data-force>Book anyway</button></div>' : '');
        $('[data-force]', box)?.addEventListener('click', (e) => busy(e.currentTarget, () => save(true)));
        box.scrollIntoView({ block: 'nearest' });
      } else {
        err.textContent = ex.message;
        err.classList.remove('hidden');
      }
    }
  }
  $('[data-save]', foot).addEventListener('click', (e) => busy(e.currentTarget, () => save(false)));
  $('[data-close]', foot).addEventListener('click', m.close);
  $('[data-delete]', foot)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this booking permanently? Use "Cancelled" status instead if you want to keep a record.', { ok: 'Delete', danger: true }))) return;
    try { await del('/bookings/' + booking.id); toast('Booking deleted'); m.close(); onSaved?.(); } catch (err) { toastError(err); }
  });
}
