// Right-hand drawer for one medium: photos, live status, current booking and
// payment, specs, remarks (dated), bookings history and problem reports.
import { get, post, patch, del } from '../api.js';
import {
  $, $$, el, esc, pill, payPill, typeInfo, illumLabel, sizeText, money, fdate, ago, toast, toastError,
  confirmDialog, busy, todayISO, directionsUrl, osmUrl, store, modal,
} from '../ui.js';
import { icon } from '../icons.js';
import { can } from '../app.js';
import { openForm, uploadPhotos } from './medium-form.js';
import { openBookingModal, markPaid } from './booking-form.js';
import { openReportModal } from './report-form.js';
import { openShareModal } from './share-form.js';

let openSeq = 0;

export async function openDetail(ctx, id, { tab = 'remarks' } = {}) {
  const seq = ++openSeq;
  ctx.stopPick();
  ctx.drawerHost.innerHTML = '<div class="drawer"><div class="drawer-body"><div class="empty">Loading…</div></div></div>';
  let data;
  try {
    data = await get('/mediums/' + id);
  } catch (err) {
    toastError(err);
    ctx.drawerHost.innerHTML = '';
    return;
  }
  if (seq !== openSeq) return; // another medium was clicked meanwhile
  draw(ctx, data, tab);
}

function spec(label, value, wide = false) {
  if (value === null || value === undefined || value === '' || value === '—') return '';
  return '<div' + (wide ? ' class="wide"' : '') + '><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>';
}

function statusBox(m) {
  const b = m.booking;
  if (m.status === 'booked' || m.status === 'on_hold') {
    return '<div class="status-box st-' + m.status + '">' +
      '<div class="row spread"><div>' + pill(m.status) + '</div>' + payPill(b.payment_status) + '</div>' +
      '<div style="margin-top:8px;font-size:15px"><b>' + esc(b.client_name) + '</b>' + (b.campaign ? ' <span class="muted">· ' + esc(b.campaign) + '</span>' : '') + '</div>' +
      '<div class="muted small" style="margin-top:2px">' + fdate(b.start_date) + ' → ' + fdate(b.end_date) + ' · ' + b.days + ' days' +
      (b.days_left ? ' · <b>' + b.days_left + ' days left</b>' : '') + '</div>' +
      '<div class="row" style="margin-top:8px;gap:18px"><span><span class="faint small">Price</span><br><b>' + money(b.amount) + '</b></span>' +
      '<span><span class="faint small">Paid</span><br><b>' + money(b.amount_paid) + '</b></span>' +
      '<span><span class="faint small">Due</span><br><b>' + money(b.amount - b.amount_paid) + '</b></span></div>' +
      (m.available_from ? '<div class="small muted" style="margin-top:8px">Free again from <b>' + fdate(m.available_from) + '</b></div>' : '') +
      (can('manager') ? '<div class="row" style="margin-top:10px">' +
        (b.payment_status !== 'paid' ? '<button class="btn sm" data-paid="' + b.id + '">' + icon('check') + ' Mark paid</button>' : '') +
        '<button class="btn sm" data-edit-booking="' + b.id + '">' + icon('edit') + ' Edit booking</button></div>' : '') +
      '</div>';
  }
  if (m.status === 'available') {
    return '<div class="status-box st-available"><div class="row spread">' + pill('available') +
      (m.next_booking_start ? '<span class="small muted">Next booking starts ' + fdate(m.next_booking_start) + '</span>' : '<span class="small muted">No upcoming bookings</span>') + '</div></div>';
  }
  // Maintenance/inactive outrank booked in the status, but a client may still
  // hold the board - the owner needs to see who, and until when.
  const cur = m.booking
    ? '<div style="margin-top:8px;font-size:13.5px">Still booked by <b>' + esc(m.booking.client_name) + '</b> until ' + fdate(m.booking.end_date) +
      ' · ' + payPill(m.booking.payment_status) + '</div>'
    : '';
  return '<div class="status-box st-' + m.status + '">' + pill(m.status) +
    '<div class="small muted" style="margin-top:6px">' + (m.status === 'maintenance' ? 'Not offered to customers until it is fixed and set back to Active.' : 'Removed from sale and hidden from share links.') + '</div>' +
    cur + '</div>';
}

function draw(ctx, data, tab) {
  const { medium: m, photos, bookings, remarks, issues } = data;
  const t = typeInfo(m.type);
  const openIssues = issues.filter((i) => i.status !== 'resolved');
  const isDigital = t.digital;

  const cover = m.photo_url || photos[0]?.url;
  const drawer = el(`
    <div class="drawer">
      <div class="drawer-head">
        <div class="grow">
          <div class="small faint">${esc(t.label)} · ${esc(m.code)}</div>
          <h2 style="margin-top:2px">${esc(m.title)}</h2>
          <div class="small muted" style="margin-top:3px">${esc([m.address, m.landmark].filter(Boolean).join(' · ') || [m.area, m.city].filter(Boolean).join(', '))}</div>
        </div>
        <button class="btn ghost icon" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="drawer-body">
        <div class="gallery">
          <div class="cover ${cover ? '' : 'none'}" style="${cover ? 'background-image:url(' + esc(cover) + ')' : ''}">${cover ? '' : 'No photos yet'}</div>
          ${photos.length > 1 || can('manager') ? `<div class="thumbs">
            ${photos.map((p) => '<button data-photo="' + p.id + '" data-url="' + esc(p.url) + '" class="' + (p.url === cover ? 'on' : '') + '" style="background-image:url(' + esc(p.url) + ')" title="Show">' + (can('manager') ? '<span class="x" data-del-photo="' + p.id + '">×</span>' : '') + '</button>').join('')}
            ${can('manager') ? '<label class="btn sm" style="height:42px;flex:none">' + icon('camera') + ' Add<input type="file" accept="image/*" multiple hidden data-upload></label>' : ''}
          </div>` : ''}
        </div>
        ${statusBox(m)}
        <div class="row card" style="box-shadow:none;padding:10px 12px;margin-bottom:12px;${m.is_public ? 'background:var(--brand-soft);border-color:#c9d4ff' : ''}">
          ${icon('globe')}
          <span class="grow small">${m.is_public
            ? (m.condition_status === 'active' ? '<b>Listed on the public marketplace</b>' : '<b>Listed</b>, but hidden while ' + esc(m.condition_status))
            : '<b>Private</b> – not on the public marketplace'}</span>
          ${m.is_public && m.condition_status === 'active' ? '<a class="btn sm" href="/m/' + m.id + '" target="_blank" rel="noopener">' + icon('external') + ' View</a>' : ''}
          ${can('manager') ? '<button class="btn sm ' + (m.is_public ? '' : 'primary') + '" data-publish="' + (m.is_public ? 0 : 1) + '">' + (m.is_public ? 'Unlist' : 'List publicly') + '</button>' : ''}
        </div>
        <div class="actions-grid">
          ${can('manager') ? '<button class="btn primary" data-book>' + icon('calendar') + ' Book</button>' : ''}
          ${can('manager') ? '<button class="btn" data-edit>' + icon('edit') + ' Edit</button>' : ''}
          <button class="btn" data-report>${icon('alert')} Report</button>
          <a class="btn" href="${directionsUrl(m)}" target="_blank" rel="noopener">${icon('nav')} Directions</a>
          ${can('manager') ? '<button class="btn" data-share>' + icon('share') + ' Share</button>' : ''}
          ${can('manager') && m.condition_status !== 'active' ? '<button class="btn" data-activate>' + icon('check') + ' Set active</button>' : ''}
          ${can('manager') && m.condition_status === 'active' ? '<button class="btn" data-maint>Maintenance</button>' : ''}
        </div>
        ${openIssues.length ? '<div class="clash-box" style="margin-bottom:12px">' + icon('alert') + ' <b>' + openIssues.length + ' open problem' + (openIssues.length > 1 ? 's' : '') + '</b>: ' + openIssues.map((i) => esc(i.category_label || i.category)).slice(0, 3).join(', ') + '</div>' : ''}
        <dl class="spec" style="margin:0">
          ${spec('Size', esc(sizeText(m)), true)}
          ${spec('Illumination', esc(illumLabel(m.illumination)))}
          ${spec('Facing', esc(m.facing))}
          ${spec('Rate / month', m.rate_month !== null ? money(m.rate_month) : '')}
          ${spec('Minimum period', m.min_days ? m.min_days + ' days' : '')}
          ${spec('Printing', m.printing_cost !== null ? money(m.printing_cost) : '')}
          ${spec('Mounting', m.mounting_cost !== null ? money(m.mounting_cost) : '')}
          ${spec('Height from ground', m.elevation_ft ? m.elevation_ft + ' ft' : '')}
          ${isDigital ? spec('Resolution', esc(m.resolution)) : ''}
          ${isDigital ? spec('Ad slot', m.slot_seconds ? m.slot_seconds + ' s × ' + (m.loop_slots || '?') + ' slots' : '') : ''}
          ${isDigital ? spec('Operating hours', esc(m.operating_hours)) : ''}
          ${spec('Traffic', esc(m.traffic_note), true)}
          ${spec('Permit', m.permit_no ? esc(m.permit_no) + (m.permit_expiry ? ' · expires ' + fdate(m.permit_expiry) : '') : '', true)}
          ${spec('Coordinates', '<a href="' + esc(osmUrl(m)) + '" target="_blank" rel="noopener">' + m.lat.toFixed(6) + ', ' + m.lng.toFixed(6) + '</a>', true)}
          ${spec('Description', esc(m.description).replace(/\n/g, '<br>'), true)}
        </dl>
        <div class="tabs mt-lg" data-tabs>
          <button data-tab="remarks">Remarks (${remarks.length})</button>
          <button data-tab="bookings">Bookings (${bookings.length})</button>
          <button data-tab="issues">Problems (${issues.length})</button>
        </div>
        <div class="mt" data-tab-body></div>
      </div>
      ${can('admin') ? '<div class="drawer-foot"><button class="btn danger sm" data-delete>' + icon('trash') + ' Delete</button></div>' : ''}
    </div>`);

  ctx.drawerHost.innerHTML = '';
  ctx.drawerHost.append(drawer);
  const reopen = (nextTab = tab) => openDetail(ctx, m.id, { tab: nextTab });
  const refresh = async (nextTab) => { await ctx.reload(); reopen(nextTab); };

  $('[data-close]', drawer).addEventListener('click', ctx.closeDrawer);

  /* photos */
  $$('[data-photo]', drawer).forEach((b) => b.addEventListener('click', async (e) => {
    if (e.target.closest('[data-del-photo]')) {
      e.stopPropagation();
      if (!(await confirmDialog('Delete this photo?', { ok: 'Delete', danger: true }))) return;
      try { await del('/mediums/' + m.id + '/photos/' + b.dataset.photo); refresh(); } catch (err) { toastError(err); }
      return;
    }
    $('.cover', drawer).style.backgroundImage = 'url(' + b.dataset.url + ')';
    $('.cover', drawer).classList.remove('none');
    $('.cover', drawer).textContent = '';
    $$('[data-photo]', drawer).forEach((x) => x.classList.toggle('on', x === b));
    if (can('manager')) {
      // Choosing a thumbnail also makes it the cover shown on the map and in lists.
      post('/mediums/' + m.id + '/photos/' + b.dataset.photo + '/cover').catch(() => {});
    }
  }));
  $('[data-upload]', drawer)?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    toast('Uploading ' + files.length + ' photo' + (files.length > 1 ? 's' : '') + '…');
    try { await uploadPhotos(m.id, files); toast('Photos added', 'ok'); } catch (err) { toastError(err); }
    refresh(); // also when only some made it in (e.g. the 30-photo limit was reached part-way)
  });

  /* actions */
  $('[data-book]', drawer)?.addEventListener('click', () => openBookingModal({ mediums: [m], range: ctx.range(), onSaved: () => refresh('bookings') }));
  $('[data-edit]', drawer)?.addEventListener('click', () => openForm(ctx, { medium: m }));
  $('[data-report]', drawer).addEventListener('click', () => openReportModal({ medium: m, onSaved: () => refresh('issues') }));
  $('[data-share]', drawer)?.addEventListener('click', () => openShareModal({ mode: 'selection', ids: [m.id], title: m.code + ' - ' + m.title }));
  $('[data-activate]', drawer)?.addEventListener('click', async () => {
    try { await patch('/mediums/' + m.id, { condition_status: 'active' }); toast('Back on sale', 'ok'); refresh(); } catch (err) { toastError(err); }
  });
  $('[data-publish]', drawer)?.addEventListener('click', async (e) => {
    const on = e.currentTarget.dataset.publish === '1';
    try {
      await patch('/mediums/' + m.id, { is_public: on });
      toast(on ? 'Listed on the public marketplace' : 'Removed from the marketplace', 'ok');
      refresh();
    } catch (err) { toastError(err); }
  });
  $('[data-maint]', drawer)?.addEventListener('click', async () => {
    try { await patch('/mediums/' + m.id, { condition_status: 'maintenance' }); toast('Marked under maintenance'); refresh(); } catch (err) { toastError(err); }
  });
  $('[data-paid]', drawer)?.addEventListener('click', async (e) => {
    await busy(e.currentTarget, () => markPaid(Number(e.currentTarget.dataset.paid)));
    refresh();
  });
  $('[data-edit-booking]', drawer)?.addEventListener('click', (e) => {
    const b = bookings.find((x) => x.id === Number(e.currentTarget.dataset.editBooking));
    openBookingModal({ mediums: [m], booking: b, onSaved: () => refresh('bookings') });
  });
  $('[data-delete]', drawer)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete ' + m.code + ' permanently? Its bookings, remarks, photos and reports go with it.', { ok: 'Delete', danger: true }))) return;
    const gone = () => { toast('Deleted'); ctx.closeDrawer(); ctx.reload(); };
    try { await del('/mediums/' + m.id); gone(); } catch (err) {
      if (err.payload?.details?.code !== 'HAS_HISTORY') return toastError(err);
      // It has booking history: offer to retire it instead, which keeps the money on record.
      const d = err.payload.details;
      const box = modal({
        title: 'Keep its history?', size: 'narrow',
        body: '<p>' + esc(m.code) + ' has <b>' + d.bookings + ' booking' + (d.bookings === 1 ? '' : 's') + '</b> worth <b>' + money(d.amount) + '</b>. ' +
          'Deleting it removes that revenue from Profit &amp; loss and client history.</p>' +
          '<p class="muted mt">Taken down for good? Mark it <b>Inactive</b>: it leaves the map, share links and the marketplace, and the past stays correct.</p>',
        foot: '<button class="btn danger" data-force>Delete anyway</button><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-retire>Mark inactive</button>',
      });
      $('[data-retire]', box.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        try { await patch('/mediums/' + m.id, { condition_status: 'inactive', is_public: false }); box.close(); toast('Marked inactive - history kept', 'ok'); refresh(); } catch (ex) { toastError(ex); }
      }));
      $('[data-force]', box.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        try { await del('/mediums/' + m.id, { force: true }); box.close(); gone(); } catch (ex) { toastError(ex); }
      }));
    }
  });

  /* tabs */
  const body = $('[data-tab-body]', drawer);
  const tabs = {
    remarks: () => {
      body.innerHTML = `
        <form class="card card-pad" data-remark-form style="box-shadow:none">
          <textarea name="body" placeholder="Add a remark – what you saw on site, a client note, a follow-up…" required maxlength="5000"></textarea>
          <div class="row mt"><label class="row small muted" style="gap:6px">Remark date <input type="date" name="remark_date" value="${todayISO()}" max="${todayISO()}" style="width:auto;height:32px"></label>
          <span class="grow"></span><button class="btn primary sm" type="submit">Add remark</button></div>
        </form>
        <div class="timeline mt">${remarks.length ? remarks.map((r) => `
          <div>
            <div class="row"><b class="small">${fdate(r.remark_date)}</b><span class="when grow">· ${esc(r.author || 'Unknown')} · added ${ago(r.created_at)}</span>
            ${r.user_id === store.user?.id || can('admin') ? '<button class="btn ghost sm icon" data-del-remark="' + r.id + '" title="Delete">' + icon('trash') + '</button>' : ''}</div>
            <div style="margin-top:4px;white-space:pre-wrap">${esc(r.body)}</div>
          </div>`).join('') : '<div class="empty">No remarks yet.</div>'}</div>`;
      $('[data-remark-form]', body).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        await busy($('button[type=submit]', f), async () => {
          try { await post('/mediums/' + m.id + '/remarks', { body: f.body.value, remark_date: f.remark_date.value }); toast('Remark added', 'ok'); refresh('remarks'); } catch (err) { toastError(err); }
        });
      });
      $$('[data-del-remark]', body).forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog('Delete this remark?', { ok: 'Delete', danger: true }))) return;
        try { await del('/mediums/' + m.id + '/remarks/' + b.dataset.delRemark); reopen('remarks'); } catch (err) { toastError(err); }
      }));
    },
    bookings: () => {
      body.innerHTML = bookings.length ? '<div class="timeline">' + bookings.map((b) => `
        <div>
          <div class="row"><b class="grow ellipsis">${esc(b.client_name)}</b>${b.status === 'cancelled' ? '<span class="pill">Cancelled</span>' : b.status === 'hold' ? pill('on_hold', 'Hold') : ''} ${payPill(b.payment_status)}</div>
          <div class="small muted">${fdate(b.start_date)} → ${fdate(b.end_date)} · ${b.days} days · ${money(b.amount)}${b.amount_paid && b.payment_status !== 'paid' ? ' (paid ' + money(b.amount_paid) + ')' : ''}</div>
          ${b.campaign ? '<div class="small faint">' + esc(b.campaign) + (b.invoice_no ? ' · ' + esc(b.invoice_no) : '') + '</div>' : ''}
          ${can('manager') ? '<div class="row" style="margin-top:6px"><button class="btn sm" data-bk="' + b.id + '">' + icon('edit') + ' Edit</button>' +
            (b.payment_status !== 'paid' && b.status !== 'cancelled' ? '<button class="btn sm" data-bk-paid="' + b.id + '">Mark paid</button>' : '') + '</div>' : ''}
        </div>`).join('') + '</div>' : '<div class="empty">Never booked yet.</div>';
      $$('[data-bk]', body).forEach((btn) => btn.addEventListener('click', () => {
        openBookingModal({ mediums: [m], booking: bookings.find((b) => b.id === Number(btn.dataset.bk)), onSaved: () => refresh('bookings') });
      }));
      $$('[data-bk-paid]', body).forEach((btn) => btn.addEventListener('click', async () => {
        await busy(btn, () => markPaid(Number(btn.dataset.bkPaid)));
        refresh('bookings');
      }));
    },
    issues: () => {
      body.innerHTML = issues.length ? issues.map((i) => `
        <div class="issue-card">
          <div class="row"><b class="grow">${esc(i.category_label || i.category)}</b>
            <span class="small sev-${i.severity}">● ${esc(i.severity)}</span>
            <span class="pill ${i.status === 'resolved' ? 'ok' : i.status === 'in_progress' ? 'warn' : 'bad'}">${esc(i.status.replace('_', ' '))}</span></div>
          ${i.description ? '<div style="margin-top:4px;white-space:pre-wrap">' + esc(i.description) + '</div>' : ''}
          ${i.photo_url ? '<a href="' + esc(i.photo_url) + '" target="_blank" rel="noopener"><img src="' + esc(i.photo_url) + '" alt="Problem photo"></a>' : ''}
          <div class="small faint" style="margin-top:6px">${esc(i.source === 'public' ? (i.reporter_name || 'Customer') + ' (via share link)' : i.reporter_user || i.reporter_name || '')} · ${ago(i.created_at)}</div>
          ${i.resolution ? '<div class="small" style="margin-top:4px"><b>Resolution:</b> ' + esc(i.resolution) + '</div>' : ''}
          ${can('manager') && i.status !== 'resolved' ? '<div class="row" style="margin-top:8px">' +
            (i.status === 'open' ? '<button class="btn sm" data-iss="' + i.id + '" data-to="in_progress">Start work</button>' : '') +
            '<button class="btn sm primary" data-iss="' + i.id + '" data-to="resolved">Resolve</button></div>' : ''}
        </div>`).join('') : '<div class="empty">No problems reported. Use <b>Report</b> above if something is wrong on site.</div>';
      $$('[data-iss]', body).forEach((b) => b.addEventListener('click', async () => {
        const payload = { status: b.dataset.to };
        if (b.dataset.to === 'resolved') {
          const note = prompt('What was done to fix it? (optional)');
          if (note === null) return;
          payload.resolution = note;
          payload.reactivate = m.condition_status === 'maintenance' && openIssues.length === 1;
        }
        try {
          const r = await patch('/issues/' + b.dataset.iss, payload);
          toast(r.reactivated ? 'Resolved – back on sale' : 'Updated', 'ok');
          refresh('issues');
        } catch (err) { toastError(err); }
      }));
    },
  };

  const tabBar = $('[data-tabs]', drawer);
  const show = (name) => {
    $$('button', tabBar).forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    tabs[name]();
  };
  tabBar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  show(tabs[tab] ? tab : 'remarks');
}
