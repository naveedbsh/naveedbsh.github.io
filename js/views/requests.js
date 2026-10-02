// Customer requests: booking requests from share links and enquiries from the
// public marketplace (which may carry creatives and may come without dates).
/* global L */
import { get, post, patch, del } from '../api.js';
import {
  $, $$, esc, money, fdate, ago, pill, typeInfo, sizeText, toast, toastError, busy, waLink, copyText, confirmDialog,
  daysBetween, addDays, todayISO,
} from '../ui.js';
import { icon } from '../icons.js';
import { navigate, can, refreshBadges } from '../app.js';
import { createMap, pinIcon, fitTo, destroyMap, later } from '../maplib.js';

const REQ_STATUS = {
  new: ['New', 'info'], reviewing: ['Reviewing', 'warn'], accepted: ['Accepted', 'ok'], partial: ['Partly accepted', 'ok'], rejected: ['Declined', 'bad'],
};
const reqPill = (s) => '<span class="pill ' + (REQ_STATUS[s]?.[1] || '') + '">' + (REQ_STATUS[s]?.[0] || s) + '</span>';
const sourcePill = (r) => (r.source === 'marketplace'
  ? '<span class="pill info" title="From the public marketplace">' + icon('globe') + ' Marketplace</span>'
  : '<span class="pill" title="From a link you shared">' + icon('share') + ' Share link</span>');
const proRata = (rate, days) => (rate && days ? Math.round((Number(rate) / 30) * days * 100) / 100 : 0);
const fileSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

export async function render(root, params) {
  if (params.id) return detail(root, Number(params.id));

  let filter = 'open';
  let source = '';
  root.innerHTML = `
    <div class="page-head"><h1>Customer requests</h1>
      <div class="tabs" data-src><button data-s="" class="on">All sources</button><button data-s="marketplace">${icon('globe')} Marketplace</button><button data-s="share">${icon('share')} Share links</button></div>
      <div class="tabs" data-f><button data-v="open" class="on">Open</button><button data-v="">All</button><button data-v="accepted">Accepted</button><button data-v="rejected">Declined</button></div>
    </div>
    <p class="muted" style="margin:-8px 0 16px">Enquiries from the public marketplace (with any artwork they uploaded) and booking requests from links you shared both land here.</p>
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Source</th><th>Dates</th><th>Media</th><th>Received</th><th>Status</th></tr></thead>
    <tbody data-body><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table></div></div>`;
  const body = $('[data-body]', root);
  async function load() {
    const { requests, total = 0 } = await get('/requests', { status: filter, source });
    body.innerHTML = requests.length ? requests.map((r) => `
      <tr class="click" data-id="${r.id}">
        <td><b>${esc(r.customer_company || r.customer_name)}</b>${r.status === 'new' ? ' <span class="pill info">new</span>' : ''}<div class="small muted">${esc(r.customer_name)} · ${esc(r.phone)}</div></td>
        <td>${sourcePill(r)}${r.share_title ? '<div class="small faint">' + esc(r.share_title) + '</div>' : ''}</td>
        <td class="small nowrap">${r.start_date ? fdate(r.start_date) + ' → ' + fdate(r.end_date) + '<div class="faint">' + r.days + ' days</div>' : '<span class="faint">Not given</span>'}</td>
        <td class="small">${esc(r.first_item || '')}${r.items > 1 ? ' <span class="faint">+' + (r.items - 1) + ' more</span>' : ''}
          <div class="faint">${r.accepted ? r.accepted + ' booked · ' : ''}${r.files ? icon('file') + ' ' + r.files + ' file' + (r.files > 1 ? 's' : '') : ''}</div></td>
        <td class="small nowrap">${ago(r.created_at)}</td>
        <td>${reqPill(r.status)}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">Nothing here yet. List media on the marketplace, or share a link from the map.</td></tr>';
    if (total > requests.length) {
      body.insertAdjacentHTML('beforeend', '<tr class="more-row"><td colspan="6" class="more-cell small muted">Newest ' + requests.length + ' of ' + total + ' shown. Use the tabs above to narrow the list.</td></tr>');
    }
  }
  $('[data-f]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    filter = b.dataset.v;
    $$('[data-v]', root).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('[data-src]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    source = b.dataset.s;
    $$('[data-s]', root).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  body.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) navigate('/requests/' + tr.dataset.id); });
  await load();
  return undefined;
}

function filesCard(files) {
  if (!files.length) return '';
  return `<div class="card mt-lg">
    <div class="card-head"><h3>${icon('file')} Customer's creative / artwork</h3><span class="small muted">${files.length} file${files.length > 1 ? 's' : ''}</span></div>
    <div class="card-pad" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
      ${files.map((f) => {
        const isImg = /^image\/(jpeg|png|webp|gif)$/.test(f.mime);
        const isVid = /^video\//.test(f.mime);
        return `<div class="card" style="box-shadow:none;overflow:hidden">
          <a href="${esc(f.url)}" target="_blank" rel="noopener" style="display:grid;place-items:center;height:120px;background:var(--surface-2) ${isImg ? 'url(' + esc(f.url) + ') center/contain no-repeat' : ''};color:var(--faint);font-weight:700;text-decoration:none">
            ${isImg ? '' : isVid ? icon('eye') + ' Video' : esc((f.original_name.split('.').pop() || 'file').toUpperCase())}</a>
          <div style="padding:8px 10px"><div class="small ellipsis" title="${esc(f.original_name)}"><b>${esc(f.original_name)}</b></div>
            <div class="row small faint" style="margin-top:2px"><span class="grow">${fileSize(f.size)} · ${ago(f.created_at)}</span>
            <a class="btn sm icon" href="${esc(f.url)}?download=1" title="Download">${icon('download')}</a></div></div>
        </div>`;
      }).join('')}
    </div></div>`;
}

async function detail(root, id) {
  root.innerHTML = '<div class="empty">Loading…</div>';
  let map;
  async function load() {
    const { request: r, items, files = [] } = await get('/requests/' + id);
    refreshBadges();
    const pending = items.filter((m) => m.item_status === 'pending');
    const hasDates = !!r.start_date;
    const market = r.source === 'marketplace';
    const when = hasDates ? fdate(r.start_date) + ' to ' + fdate(r.end_date) : '';
    const msgText = 'Hi ' + r.customer_name + ', this is about your ' + (market ? 'enquiry on HoardHub' : 'booking request') + ' for ' +
      (items.length === 1 ? items[0].title : items.length + ' media') + (when ? ' (' + when + ')' : '') + ': ';

    root.innerHTML = `
      <div class="page-head">
        <a class="btn ghost icon" href="/requests" data-link title="Back">${icon('back')}</a>
        <h1>${esc(r.customer_company || r.customer_name)}</h1>
        ${sourcePill(r)} ${reqPill(r.status)}
        ${can('admin') ? '<button class="btn danger sm" data-delete>' + icon('trash') + '</button>' : ''}
      </div>
      <div class="dash-grid" style="grid-template-columns:minmax(300px,1fr) minmax(300px,1.4fr)">
        <div class="card card-pad">
          <dl class="spec">
            <div><dt>Contact</dt><dd>${esc(r.customer_name)}</dd></div>
            <div><dt>Company</dt><dd>${esc(r.customer_company || '—')}</dd></div>
            <div><dt>Phone</dt><dd><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></dd></div>
            <div><dt>Email</dt><dd>${r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '—'}</dd></div>
            <div class="wide"><dt>Dates asked for</dt><dd>${hasDates ? fdate(r.start_date) + ' → ' + fdate(r.end_date) + ' · ' + r.days + ' days' : '<span class="muted">Not given – agree them with the customer</span>'}</dd></div>
            ${r.campaign ? '<div class="wide"><dt>Campaign</dt><dd>' + esc(r.campaign) + '</dd></div>' : ''}
            ${r.message ? '<div class="wide"><dt>Message</dt><dd style="white-space:pre-wrap">' + esc(r.message) + '</dd></div>' : ''}
            <div class="wide"><dt>Received</dt><dd>${fdate(r.created_at, true)}${market ? ' from the public marketplace' : r.share_title ? ' via “' + esc(r.share_title) + '”' : ''}</dd></div>
          </dl>
          <div class="row wrap mt">
            <a class="btn wa sm" href="${esc(waLink(msgText, r.phone))}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
            <a class="btn sm" href="tel:${esc(r.phone)}">${icon('phone')} Call</a>
            ${r.email ? '<a class="btn sm" href="mailto:' + esc(r.email) + '?subject=' + encodeURIComponent('Your enquiry') + '">Email</a>' : ''}
            <button class="btn sm" data-copy>${icon('copy')} Customer's link</button>
          </div>
          <label class="field mt"><span>Note to customer (shown on their link)</span><textarea data-note maxlength="3000" placeholder="e.g. Confirmed 3 of 4. Printing to be arranged by you.">${esc(r.company_note || '')}</textarea></label>
          ${can('manager') ? '<div class="row mt"><span class="grow"></span><button class="btn sm" data-save-note>Save note</button></div>' : ''}
        </div>
        <div class="card" style="min-height:320px;position:relative"><div class="map" data-map style="border-radius:var(--radius)"></div></div>
      </div>
      ${filesCard(files)}
      <div class="card mt-lg">
        <div class="card-head"><h3>Requested media</h3><span class="muted small">${hasDates ? 'Availability for the requested dates' : 'Availability today'}</span></div>
        ${!hasDates && can('manager') && pending.length ? `<div class="toolbar" style="background:var(--st-on_hold-soft)">
          <span class="small"><b>No dates yet.</b> Set the dates you agreed to price and book:</span>
          <input type="date" data-set-from min="${todayISO()}" style="width:auto"><span class="faint">→</span><input type="date" data-set-to min="${todayISO()}" style="width:auto">
          <span class="small muted" data-set-days></span></div>` : ''}
        <div class="table-wrap"><table class="tbl"><thead><tr>${can('manager') ? '<th style="width:32px"><input type="checkbox" data-all' + (pending.length ? '' : ' disabled') + '></th>' : ''}<th>Medium</th><th>Size</th><th>${hasDates ? 'For these dates' : 'Today'}</th><th class="right">Rate / mo</th><th class="right" style="width:160px" data-price-head>${hasDates ? 'Price for ' + r.days + ' days' : 'Price'}</th><th>Decision</th></tr></thead>
        <tbody>${items.map((m) => `
          <tr data-mid="${m.id}" data-rate="${m.rate_month ?? ''}">
            ${can('manager') ? '<td>' + (m.item_status === 'pending' ? '<input type="checkbox" data-pick' + (m.clashes.length ? '' : ' checked') + '>' : '') + '</td>' : ''}
            <td><a href="/map?open=${m.id}" data-link><b>${esc(m.code)}</b></a> ${esc(m.title)}<div class="small muted">${esc(typeInfo(m.type).label)} · ${esc(m.area || '')}</div></td>
            <td class="small nowrap">${esc(sizeText(m, { area: false }))}</td>
            <td class="small">${m.item_status === 'accepted' ? '<span class="pill ok">Booked for them</span>' : m.clashes.length
              ? pill('booked', 'Taken') + '<div class="faint">' + esc(m.clashes.map((c) => c.client_name + ' till ' + fdate(c.end_date)).join(', ')) + '</div>'
              : m.status === 'maintenance' ? pill('maintenance') : m.status === 'booked' || m.status === 'on_hold' ? pill(m.status) + (m.available_from ? '<div class="faint">free ' + fdate(m.available_from) + '</div>' : '') : pill('available', 'Free')}</td>
            <td class="right num">${money(m.rate_month)}</td>
            <td class="right">${m.item_status === 'pending' && can('manager') ? '<input type="number" min="0" step="0.01" data-amount value="' + (m.quote ?? '') + '" placeholder="' + (hasDates ? '' : 'set dates') + '" style="height:32px;text-align:right">' : money(m.quote)}</td>
            <td>${m.item_status === 'pending' ? '<span class="pill">Pending</span>' : m.item_status === 'accepted' ? '<span class="pill ok">Accepted</span>' : '<span class="pill bad">Declined</span>'}</td>
          </tr>`).join('')}</tbody></table></div>
        ${can('manager') && pending.length ? `<div class="totals" style="align-items:center">
          <span class="grow">Tick the media to act on. Prices are pro-rata from the monthly rate; change them before accepting.</span>
          <button class="btn danger" data-reject>Decline ticked</button>
          <button class="btn" data-accept="hold">Accept as hold</button>
          <button class="btn primary" data-accept="confirmed">${icon('check')} Accept & book</button>
        </div>` : ''}
      </div>`;

    // Map of the requested media.
    destroyMap(map);
    map = createMap($('[data-map]', root));
    for (const m of items) {
      const st = m.item_status === 'accepted' ? 'available' : m.clashes.length ? 'booked' : m.status;
      L.marker([m.lat, m.lng], { icon: pinIcon({ ...m, status: st, abbr: typeInfo(m.type).abbr }) })
        .bindTooltip('<b>' + esc(m.code) + '</b> ' + esc(m.title)).addTo(map);
    }
    later(map, () => { map.invalidateSize(); fitTo(map, items); });

    // Enquiry without dates: the owner sets them here, prices follow.
    const setFrom = $('[data-set-from]', root);
    const setTo = $('[data-set-to]', root);
    const agreedDays = () => (setFrom?.value && setTo?.value && setTo.value >= setFrom.value ? daysBetween(setFrom.value, setTo.value) : 0);
    const reprice = () => {
      if (setFrom.value && (!setTo.value || setTo.value < setFrom.value)) setTo.value = addDays(setFrom.value, 29);
      const days = agreedDays();
      $('[data-set-days]', root).textContent = days ? days + ' days' : '';
      $('[data-price-head]', root).textContent = days ? 'Price for ' + days + ' days' : 'Price';
      $$('tr[data-mid]', root).forEach((tr) => {
        const inp = $('[data-amount]', tr);
        if (inp && !inp.dataset.touched) inp.value = days ? proRata(tr.dataset.rate, days) : '';
      });
    };
    setFrom?.addEventListener('change', reprice);
    setTo?.addEventListener('change', reprice);
    $$('[data-amount]', root).forEach((i) => i.addEventListener('input', () => { i.dataset.touched = '1'; }));

    $('[data-copy]', root).addEventListener('click', () => copyText(r.url));
    $('[data-save-note]', root)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try { await patch('/requests/' + id, { company_note: $('[data-note]', root).value }); toast('Note saved', 'ok'); } catch (err) { toastError(err); }
    }));
    $('[data-all]', root)?.addEventListener('change', (e) => $$('[data-pick]', root).forEach((c) => { c.checked = e.target.checked; }));
    $('[data-delete]', root)?.addEventListener('click', async () => {
      if (!(await confirmDialog('Delete this request and its files? Bookings already created from it are kept.', { ok: 'Delete', danger: true }))) return;
      try { await del('/requests/' + id); navigate('/requests'); } catch (err) { toastError(err); }
    });

    const picked = () => $$('tr[data-mid]', root).filter((tr) => $('[data-pick]', tr)?.checked);
    async function decide(btn, payload) {
      await busy(btn, async () => {
        const body = { ...payload, company_note: $('[data-note]', root).value };
        try {
          await post('/requests/' + id + '/decide', body);
          toast('Done', 'ok');
          await load();
        } catch (err) {
          if (err.status === 409) {
            if (await confirmDialog(err.message + '. Book anyway?', { title: 'Dates clash', ok: 'Book anyway', danger: true })) {
              await post('/requests/' + id + '/decide', { ...body, force: true }).catch(toastError);
              await load();
            }
          } else toastError(err);
        }
      });
    }
    $$('[data-accept]', root).forEach((btn) => btn.addEventListener('click', () => {
      const rows = picked();
      if (!rows.length) return toast('Tick at least one medium', 'error');
      const payload = {
        booking_status: btn.dataset.accept,
        accept: rows.map((tr) => ({ medium_id: Number(tr.dataset.mid), amount: $('[data-amount]', tr)?.value ?? '' })),
      };
      if (!hasDates) {
        if (!agreedDays()) { setFrom?.focus(); return toast('Set the booking dates first', 'error'); }
        payload.start_date = setFrom.value;
        payload.end_date = setTo.value;
      }
      decide(btn, payload);
    }));
    $('[data-reject]', root)?.addEventListener('click', (e) => {
      const rows = picked();
      if (!rows.length) return toast('Tick at least one medium', 'error');
      decide(e.currentTarget, { reject: rows.map((tr) => Number(tr.dataset.mid)) });
    });
  }
  try { await load(); } catch (err) { root.innerHTML = '<div class="empty">' + esc(err.message) + '</div>'; }
  return () => destroyMap(map);
}
