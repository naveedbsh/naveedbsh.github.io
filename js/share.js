// Public pages, no login:
//   /s/:token  a company's shared media on a map - check dates, select, request
//   /r/:token  the customer's request receipt, to send back to the company
/* global L */
import {
  store, $, $$, el, esc, modal, money, fdate, pill, sizeText, typeInfo, illumLabel, toast, toastError, busy,
  todayISO, addDays, daysBetween, copyText, waLink, directionsUrl, options,
} from './ui.js';
import { icon } from './icons.js';
import { createMap, pinIcon, clusterGroup, fitTo, legendHtml } from './maplib.js';

async function pub(path, { method = 'GET', body, form, query } = {}) {
  let url = '/api/public' + path;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v));
    if (qs.toString()) url += '?' + qs;
  }
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status, details: data.details || {} });
  return data;
}

function logoHtml(company) {
  return '<div class="logo" style="' + (company.logo_url ? 'background-image:url(' + esc(company.logo_url) + ')' : '') + '">' + (company.logo_url ? '' : esc((company.name || '?')[0])) + '</div>';
}

function contactButtons(company, text) {
  return (company.phone ? '<a class="btn sm" href="tel:' + esc(company.phone) + '">' + icon('phone') + ' Call</a>' +
    '<a class="btn sm wa" href="' + esc(waLink(text || 'Hi ' + company.name + ', ', company.phone)) + '" target="_blank" rel="noopener">' + icon('whatsapp') + ' WhatsApp</a>' : '') +
    (company.email ? '<a class="btn sm" href="mailto:' + esc(company.email) + '">Email</a>' : '');
}

const fail = (msg) => {
  $('#app').innerHTML = '<div class="receipt"><div class="card card-pad" style="text-align:center;margin-top:12vh"><h2>Link not available</h2><p class="muted mt">' + esc(msg) + '</p></div></div>';
};

/* ================================================================ share map */

async function sharePage(token) {
  // meta is needed for type labels; the public page does not need a session.
  try { store.meta = await fetch('/api/meta').then((r) => r.json()); } catch { /* labels fall back to keys */ }

  const state = { from: '', to: '', types: [], onlyFree: false, q: '', data: null, selected: new Set(), markers: new Map() };
  try {
    const saved = JSON.parse(sessionStorage.getItem('hh_sel_' + token) || '[]');
    saved.forEach((id) => state.selected.add(id));
  } catch { /* nothing saved */ }

  let first;
  try { first = await pub('/share/' + token); } catch (err) { return fail(err.message); }
  state.data = first;
  store.company = { currency: first.company.currency };
  document.title = first.link.title + ' · ' + first.company.name;

  const app = $('#app');
  app.innerHTML = '';
  const page = el(`
    <div class="pub">
      <header class="pub-head">
        ${logoHtml(first.company)}
        <div class="grow" style="min-width:200px">
          <div class="small faint">${esc(first.company.name)}</div>
          <h2>${esc(first.link.title)}</h2>
        </div>
        <div class="row wrap">${contactButtons(first.company, 'Hi ' + first.company.name + ', I saw your media list "' + first.link.title + '". ')}</div>
      </header>
      <div class="pub-body">
        <aside class="panel">
          <div class="panel-head">
            ${first.link.message ? '<p class="small" style="white-space:pre-wrap;margin-bottom:10px">' + esc(first.link.message) + '</p>' : ''}
            <div class="field-label">Check availability for your dates</div>
            <div class="row"><input type="date" data-from min="${todayISO()}" aria-label="From"><span class="faint">→</span><input type="date" data-to min="${todayISO()}" aria-label="To"></div>
          </div>
          <div class="filters">
            <div class="search" style="position:relative"><input type="search" placeholder="Search area, landmark, code…" data-q></div>
            <div class="chips" data-types></div>
            <label class="check small"><input type="checkbox" data-free> Only show available</label>
          </div>
          <div class="results-head"><span class="grow" data-count></span></div>
          <div class="results" data-list></div>
        </aside>
        <div class="mapwrap">
          <div id="map"></div>
          <div class="map-legend">${legendHtml(['available', 'booked'])}</div>
          <div data-tray></div>
        </div>
      </div>
    </div>`);
  app.append(page);

  const map = createMap($('#map', page));
  const cluster = clusterGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  new ResizeObserver(() => map.invalidateSize()).observe($('.mapwrap', page));

  // Type chips only for the types this link actually contains.
  const presentTypes = [...new Set(first.mediums.map((m) => m.type))];
  $('[data-types]', page).innerHTML = presentTypes.length > 1 ? presentTypes.map((t) => '<button class="chip" data-t="' + esc(t) + '">' + esc(typeInfo(t).label) + '</button>').join('') : '';
  $('[data-types]', page).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    b.classList.toggle('on');
    state.types = $$('[data-t].on', page).map((x) => x.dataset.t);
    draw();
  });
  $('[data-free]', page).addEventListener('change', (e) => { state.onlyFree = e.target.checked; draw(); });
  let qt;
  $('[data-q]', page).addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); draw(); }, 200); });

  async function reloadForDates() {
    let from = $('[data-from]', page).value;
    let to = $('[data-to]', page).value;
    if (from && to && to < from) { to = from; $('[data-to]', page).value = to; }
    if (!from && to) { from = todayISO(); $('[data-from]', page).value = from; }
    state.from = from; state.to = to;
    try {
      state.data = await pub('/share/' + token, { query: { from, to } });
      draw();
    } catch (err) { toastError(err); }
  }
  $('[data-from]', page).addEventListener('change', reloadForDates);
  $('[data-to]', page).addEventListener('change', reloadForDates);

  const visible = () => state.data.mediums.filter((m) =>
    (!state.types.length || state.types.includes(m.type)) &&
    (!state.onlyFree || m.status === 'available') &&
    (!state.q || [m.code, m.title, m.area, m.city, m.landmark, m.address].join(' ').toLowerCase().includes(state.q)));

  const statusLine = (m) => (m.status === 'available' ? pill('available', state.from ? 'Free for your dates' : 'Available')
    : m.status === 'maintenance' ? pill('maintenance', 'Under maintenance')
      : pill('booked', 'Booked') + (m.available_from ? ' <span class="small muted">free from ' + fdate(m.available_from) + '</span>' : ''));

  function cardHtml(m) {
    const t = typeInfo(m.type);
    return '<div class="mcard' + (state.selected.has(m.id) ? ' selected' : '') + '" data-id="' + m.id + '">' +
      '<div class="thumb" style="' + (m.photo_url ? 'background-image:url(' + esc(m.photo_url) + ')' : '') + '">' + (m.photo_url ? '' : esc(t.abbr)) + '</div>' +
      '<div class="grow"><div class="t ellipsis">' + esc(m.title) + '</div>' +
      '<div class="meta">' + esc(t.label) + ' · ' + esc(sizeText(m, { area: false })) + '</div>' +
      '<div class="row" style="margin-top:5px">' + statusLine(m) + (m.rate_month ? '<span class="meta">' + money(m.rate_month) + '/mo</span>' : '') + '</div></div>' +
      (state.data.link.allow_requests ? '<input type="checkbox" class="sel"' + (state.selected.has(m.id) ? ' checked' : '') + ' aria-label="Select">' : '') + '</div>';
  }

  function popupHtml(m) {
    const t = typeInfo(m.type);
    const sel = state.selected.has(m.id);
    return '<div class="popup-card">' +
      (m.photo_url ? '<div class="ph" style="background-image:url(' + esc(m.photo_url) + ')"></div>' : '') +
      '<div class="small faint">' + esc(t.label) + ' · ' + esc(m.code) + '</div><b>' + esc(m.title) + '</b>' +
      '<div class="small muted">' + esc([m.landmark, m.area, m.city].filter(Boolean).join(', ')) + '</div>' +
      '<div style="margin:8px 0">' + statusLine(m) + '</div>' +
      '<div class="small">' + esc(sizeText(m)) + '</div>' +
      '<div class="small">' + esc(illumLabel(m.illumination)) + (m.facing ? ' · ' + esc(m.facing) : '') + '</div>' +
      (t.digital && m.slot_seconds ? '<div class="small">' + m.slot_seconds + ' s slot × ' + (m.loop_slots || '?') + (m.operating_hours ? ' · ' + esc(m.operating_hours) : '') + '</div>' : '') +
      (m.traffic_note ? '<div class="small faint">' + esc(m.traffic_note) + '</div>' : '') +
      (m.rate_month ? '<div style="margin-top:6px"><b>' + money(m.rate_month) + '</b> <span class="small muted">per month' + (m.min_days ? ' · min ' + m.min_days + ' days' : '') + '</span></div>' : '') +
      '<div class="row wrap" style="margin-top:10px">' +
      (state.data.link.allow_requests && m.status !== 'maintenance' ? '<button class="btn sm ' + (sel ? '' : 'primary') + '" data-toggle="' + m.id + '">' + (sel ? 'Remove' : icon('plus') + ' Select') + '</button>' : '') +
      (m.photos.length > 1 ? '<button class="btn sm" data-photos="' + m.id + '">' + icon('camera') + ' ' + m.photos.length + '</button>' : '') +
      '<a class="btn sm" href="' + directionsUrl(m) + '" target="_blank" rel="noopener">' + icon('nav') + '</a>' +
      (state.data.link.allow_reports ? '<button class="btn sm ghost" data-report="' + m.id + '" title="Report a problem">' + icon('alert') + '</button>' : '') +
      '</div></div>';
  }

  let fitted = false;
  function draw() {
    const list = visible();
    const free = list.filter((m) => m.status === 'available').length;
    $('[data-count]', page).textContent = list.length + ' locations · ' + free + ' available' + (state.from ? ' for ' + fdate(state.from) + (state.to && state.to !== state.from ? ' – ' + fdate(state.to) : '') : '');
    $('[data-list]', page).innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty">Nothing matches.</div>';

    cluster.clearLayers();
    state.markers.clear();
    for (const m of list) {
      const mk = L.marker([m.lat, m.lng], { icon: pinIcon({ ...m, abbr: typeInfo(m.type).abbr }, { selected: state.selected.has(m.id) }) });
      mk.bindPopup(() => popupHtml(m), { maxWidth: 280, minWidth: 250 });
      state.markers.set(m.id, mk);
      cluster.addLayer(mk);
    }
    if (!fitted) fitted = fitTo(map, list);
    drawTray();
  }

  function toggle(id) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    try { sessionStorage.setItem('hh_sel_' + token, JSON.stringify([...state.selected])); } catch { /* blocked */ }
    const m = state.data.mediums.find((x) => x.id === id);
    const mk = state.markers.get(id);
    if (m && mk) {
      mk.setIcon(pinIcon({ ...m, abbr: typeInfo(m.type).abbr }, { selected: state.selected.has(id) }));
      if (mk.isPopupOpen()) mk.setPopupContent(popupHtml(m));
    }
    const card = $('.mcard[data-id="' + id + '"]', page);
    if (card && m) card.outerHTML = cardHtml(m);
    drawTray();
  }

  function drawTray() {
    const tray = $('[data-tray]', page);
    tray.innerHTML = '';
    if (!state.data.link.allow_requests || !state.selected.size) return;
    const t = el('<div class="pub-tray"><span><b>' + state.selected.size + '</b> selected</span><button class="btn sm" data-clear>Clear</button><button class="btn sm primary" data-request>Request booking</button></div>');
    $('[data-clear]', t).addEventListener('click', () => { [...state.selected].forEach(toggle); });
    $('[data-request]', t).addEventListener('click', requestModal);
    tray.append(t);
  }

  $('[data-list]', page).addEventListener('click', (e) => {
    const card = e.target.closest('.mcard');
    if (!card) return;
    const id = Number(card.dataset.id);
    if (e.target.matches('.sel')) { toggle(id); return; }
    const mk = state.markers.get(id);
    if (mk) cluster.zoomToShowLayer ? cluster.zoomToShowLayer(mk, () => mk.openPopup()) : mk.openPopup();
  });
  map.getContainer().addEventListener('click', (e) => {
    const tg = e.target.closest('[data-toggle]');
    if (tg) { toggle(Number(tg.dataset.toggle)); return; }
    const ph = e.target.closest('[data-photos]');
    if (ph) { photosModal(state.data.mediums.find((m) => m.id === Number(ph.dataset.photos))); return; }
    const rp = e.target.closest('[data-report]');
    if (rp) reportModal(state.data.mediums.find((m) => m.id === Number(rp.dataset.report)));
  });

  function photosModal(m) {
    modal({ title: m.title, size: 'wide', foot: null, body: '<div class="stack">' + m.photos.map((u) => '<img src="' + esc(u) + '" alt="" style="width:100%;border-radius:10px">').join('') + '</div>' });
  }

  function reportModal(m) {
    const body = el(`<form novalidate>
      <p class="muted">${esc(m.code)} · ${esc(m.title)}</p>
      <label class="field"><span>What is wrong?</span><select name="category">${options(state.data.issue_categories, '', { blank: 'Choose…' })}</select></label>
      <label class="field mt"><span>Details</span><textarea name="description" maxlength="3000"></textarea></label>
      <label class="field mt"><span>Photo (optional)</span><input type="file" name="photo" accept="image/*" capture="environment"></label>
      <div class="grid-2 mt"><label class="field"><span>Your name</span><input type="text" name="name" maxlength="120"></label><label class="field"><span>Phone</span><input type="tel" name="phone" maxlength="40"></label></div>
      <label aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
    </form>`);
    const md = modal({ title: 'Report a problem', body, foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-send>Send</button>' });
    $('[data-send]', md.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
      if (!body.category.value) return toast('Choose what is wrong', 'error');
      const fd = new FormData(body);
      fd.set('medium_id', m.id);
      if (!body.photo.files.length) fd.delete('photo');
      try { await pub('/share/' + token + '/issue', { method: 'POST', form: fd }); md.close(); toast('Thank you - the owner has been told.', 'ok'); } catch (err) { toastError(err); }
    }));
  }

  function requestModal() {
    const chosen = state.data.mediums.filter((m) => state.selected.has(m.id));
    const from = state.from || addDays(todayISO(), 1);
    const to = state.to || addDays(from, 29);
    const body = el(`<form novalidate>
      <div class="card" style="box-shadow:none;max-height:180px;overflow:auto">${chosen.map((m) => '<div class="row" data-chosen="' + m.id + '" style="padding:8px 12px;border-bottom:1px solid var(--line)"><span class="grow small"><b>' + esc(m.code) + '</b> ' + esc(m.title) + '</span>' + (m.status === 'available' ? '' : '<span class="small" style="color:var(--st-booked)">booked' + (m.available_from ? ' till ' + fdate(addDays(m.available_from, -1)) : '') + '</span>') + '</div>').join('')}</div>
      <div class="grid-2 mt">
        <label class="field"><span>From *</span><input type="date" name="start_date" min="${todayISO()}" value="${from}"></label>
        <label class="field"><span>To *</span><input type="date" name="end_date" min="${todayISO()}" value="${to}"></label>
      </div>
      <div class="hint" data-days></div>
      <div class="grid-2 mt">
        <label class="field"><span>Your name *</span><input type="text" name="name" maxlength="120" autocomplete="name"></label>
        <label class="field"><span>Company / brand</span><input type="text" name="company" maxlength="160" autocomplete="organization"></label>
        <label class="field"><span>Phone *</span><input type="tel" name="phone" maxlength="40" autocomplete="tel"></label>
        <label class="field"><span>Email</span><input type="email" name="email" maxlength="190" autocomplete="email"></label>
      </div>
      <label class="field mt"><span>Campaign</span><input type="text" name="campaign" maxlength="160"></label>
      <label class="field mt"><span>Message</span><textarea name="message" maxlength="3000" placeholder="Anything the owner should know – budget, printing, flexibility on dates…"></textarea></label>
      <label class="check small mt"><input type="checkbox" name="whatsapp_updates" checked> Send me updates about this enquiry on WhatsApp</label>
      <label aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
      <div class="error-text mt hidden" data-err></div>
    </form>`);
    const md = modal({ title: 'Request ' + chosen.length + ' location' + (chosen.length > 1 ? 's' : ''), body, foot: '<button class="btn" data-close>Back</button><button class="btn primary" data-send>Send request</button>' });
    const syncDays = () => {
      const s = body.start_date.value; const e = body.end_date.value;
      $('[data-days]', body).textContent = s && e && e >= s ? daysBetween(s, e) + ' days' : '';
    };
    body.start_date.addEventListener('change', syncDays);
    body.end_date.addEventListener('change', syncDays);
    syncDays();
    $('[data-send]', md.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const err = $('[data-err]', body);
      err.classList.add('hidden');
      try {
        const r = await pub('/share/' + token + '/request', {
          method: 'POST',
          body: {
            medium_ids: chosen.map((m) => m.id), start_date: body.start_date.value, end_date: body.end_date.value,
            name: body.name.value, company: body.company.value, phone: body.phone.value, email: body.email.value,
            campaign: body.campaign.value, message: body.message.value, website: body.website.value, whatsapp_updates: body.whatsapp_updates.checked,
          },
        });
        md.close();
        state.selected.clear();
        try { sessionStorage.removeItem('hh_sel_' + token); } catch { /* blocked */ }
        draw();
        sentModal(r.url, chosen.length);
      } catch (ex) {
        // Locations no longer offered for these dates: unselect them here and in the saved selection.
        const gone = ex.details?.unavailable || [];
        for (const id of gone) {
          if (state.selected.has(id)) toggle(id);
          const i = chosen.findIndex((m) => m.id === id);
          if (i >= 0) chosen.splice(i, 1);
          $('[data-chosen="' + id + '"]', body)?.remove();
        }
        if (gone.length && !chosen.length) $('[data-send]', md.el).disabled = true;
        err.textContent = ex.message;
        err.classList.remove('hidden');
      }
    }));
  }

  function sentModal(url, n) {
    const c = state.data.company;
    const text = 'Hi ' + c.name + ', I have requested ' + n + ' location' + (n > 1 ? 's' : '') + '. Details: ' + url;
    const m = modal({
      title: 'Request sent', size: 'narrow',
      body: `<p><b>${esc(c.name)}</b> has received your request and will get back to you.</p>
        <p class="muted small mt">This is your request link. Send it to them, and keep it to check the status later.</p>
        <input type="text" readonly value="${esc(url)}" class="mt" data-url>
        <div class="row wrap mt">
          ${c.phone ? '<a class="btn wa" href="' + esc(waLink(text, c.phone)) + '" target="_blank" rel="noopener">' + icon('whatsapp') + ' Send to ' + esc(c.name) + '</a>' : ''}
          <button class="btn" data-copy>${icon('copy')} Copy link</button>
          <a class="btn" href="${esc(url)}">${icon('external')} View request</a>
        </div>`,
      foot: '<button class="btn" data-close>Close</button>',
    });
    $('[data-copy]', m.el).addEventListener('click', () => copyText(url));
    $('[data-url]', m.el).addEventListener('focus', (e) => e.target.select());
  }

  draw();
}

/* ================================================================ receipt */

const REQ = {
  new: ['Sent – waiting for the owner', 'info'], reviewing: ['Being reviewed', 'warn'], accepted: ['Accepted', 'ok'],
  partial: ['Partly accepted', 'ok'], rejected: ['Not available', 'bad'],
};

async function receiptPage(token) {
  let d;
  try {
    [d, store.meta] = await Promise.all([pub('/request/' + token), fetch('/api/meta').then((r) => r.json()).catch(() => null)]);
  } catch (err) { return fail(err.message); }
  store.company = { currency: d.company.currency };
  const r = d.request;
  const c = d.company;
  const market = r.source === 'marketplace';
  document.title = (market ? 'Enquiry' : 'Booking request') + ' · ' + c.name;
  const url = location.href.split('#')[0];
  const when = r.start_date ? fdate(r.start_date) + ' to ' + fdate(r.end_date) : 'dates to be agreed';
  const text = 'Hi ' + c.name + ', about my ' + (market ? 'enquiry' : 'booking request') + ' (' + d.items.length + ' location' + (d.items.length > 1 ? 's' : '') + ', ' + when + '): ' + url;
  const files = d.files || [];

  $('#app').innerHTML = `
    <div class="pub-head">${logoHtml(c)}<div class="grow"><div class="small faint">${market ? 'Enquiry via HoardHub marketplace to' : 'Booking request to'}</div><h2>${c.profile_url ? '<a href="' + esc(c.profile_url) + '" style="color:inherit">' + esc(c.name) + '</a>' : esc(c.name)}</h2></div><div class="row wrap">${contactButtons(c, text)}</div></div>
    <div class="receipt">
      <div class="row wrap" style="margin-bottom:14px">
        <span class="pill ${REQ[r.status]?.[1] || ''}" style="height:28px;font-size:13px">${esc(REQ[r.status]?.[0] || r.status)}</span>
        <span class="muted small">Sent ${fdate(r.created_at, true)}</span><span class="grow"></span>
        <span data-staff></span>
        ${c.phone ? '<a class="btn wa sm" href="' + esc(waLink(text, c.phone)) + '" target="_blank" rel="noopener">' + icon('whatsapp') + ' Send this to ' + esc(c.name) + '</a>' : ''}
        <button class="btn sm" data-copy>${icon('copy')} Copy link</button>
        ${d.share_url ? '<a class="btn sm" href="' + esc(d.share_url) + '">' + icon('map') + ' Back to the list</a>' : ''}
        ${market ? '<a class="btn sm" href="/explore">' + icon('map') + ' Browse more sites</a>' : ''}
      </div>
      ${r.company_note ? '<div class="status-box st-available"><div class="small muted">Message from ' + esc(c.name) + '</div><div style="white-space:pre-wrap;margin-top:4px">' + esc(r.company_note) + '</div></div>' : ''}
      <div class="dash-grid" style="grid-template-columns:minmax(280px,1fr) minmax(280px,1.3fr)">
        <div class="card card-pad"><dl class="spec">
          <div class="wide"><dt>Dates</dt><dd>${r.start_date ? fdate(r.start_date) + ' → ' + fdate(r.end_date) + ' · ' + r.days + ' days' : 'To be agreed with the owner'}</dd></div>
          <div><dt>Name</dt><dd>${esc(r.customer_name)}</dd></div>
          <div><dt>Company</dt><dd>${esc(r.customer_company || '—')}</dd></div>
          <div><dt>Phone</dt><dd>${esc(r.phone)}</dd></div>
          <div><dt>Email</dt><dd>${esc(r.email || '—')}</dd></div>
          ${r.campaign ? '<div class="wide"><dt>Campaign</dt><dd>' + esc(r.campaign) + '</dd></div>' : ''}
          ${r.message ? '<div class="wide"><dt>Message</dt><dd style="white-space:pre-wrap">' + esc(r.message) + '</dd></div>' : ''}
        </dl></div>
        <div class="card" style="min-height:300px;position:relative"><div class="map" id="map" style="border-radius:var(--radius)"></div></div>
      </div>
      <div class="card mt-lg"><div class="card-head"><h3>${d.items.length} location${d.items.length > 1 ? 's' : ''}</h3></div>
        <div class="list-rows">${d.items.map((m) => `
          <div><div class="mcard" style="padding:0;border:0;cursor:default"><div class="thumb" style="${m.photo_url ? 'background-image:url(' + esc(m.photo_url) + ')' : ''}">${m.photo_url ? '' : esc(typeInfo(m.type).abbr)}</div></div>
          <div class="grow"><b>${esc(m.title)}</b><div class="small muted">${esc(typeInfo(m.type).label)} · ${esc(sizeText(m, { area: false }))} · ${esc(m.area || '')}</div></div>
          ${m.rate_month ? '<span class="small nowrap">' + money(m.rate_month) + '/mo</span>' : ''}
          ${m.item_status === 'accepted' ? '<span class="pill ok">Booked for you</span>' : m.item_status === 'rejected' ? '<span class="pill bad">Not available</span>' : m.status === 'available' ? '<span class="pill">Pending</span>' : pill('booked', 'Taken for these dates')}
          </div>`).join('')}</div>
      </div>
      <div class="card mt-lg">
        <div class="card-head"><h3>Your creative / artwork</h3><span class="small muted">${files.length} of ${d.max_files || 10} files</span></div>
        <div class="list-rows">${files.length ? files.map((f) => '<div>' + icon('file') + '<span class="grow ellipsis">' + esc(f.original_name) + '</span><span class="small faint">' + (f.size / 1048576).toFixed(1) + ' MB · ' + fdate(f.created_at, true) + '</span></div>').join('')
          : '<div class="muted small">No files yet. Upload your artwork here and it goes straight to ' + esc(c.name) + '.</div>'}</div>
        ${r.status !== 'rejected' && files.length < (d.max_files || 10) ? `<div class="card-pad" style="border-top:1px solid var(--line)">
          <label class="btn primary">${icon('upload')} Upload files<input type="file" multiple hidden data-more accept="image/*,application/pdf,video/mp4,video/quicktime,video/webm,.zip,.psd,.ai,.cdr,.eps"></label>
          <span class="small faint" style="margin-left:8px">Images, PDF, video, PSD/AI/CDR or ZIP · 25 MB each</span></div>` : ''}
      </div>
    </div>`;

  $('[data-copy]').addEventListener('click', () => copyText(url));
  $('[data-more]')?.addEventListener('change', async (e) => {
    const picked = [...e.target.files].slice(0, 5);
    if (!picked.length) return;
    const fd = new FormData();
    picked.forEach((f) => fd.append('creatives', f));
    toast('Uploading ' + picked.length + ' file' + (picked.length > 1 ? 's' : '') + '…');
    try {
      await pub('/request/' + token + '/files', { method: 'POST', form: fd });
      toast('Sent to ' + c.name, 'ok');
      receiptPage(token);
    } catch (err) {
      toastError(err.status === 413 ? new Error('A file is larger than 25 MB') : err);
    }
  });
  const map = createMap('map');
  for (const m of d.items) {
    const st = m.item_status === 'accepted' ? 'available' : m.item_status === 'rejected' ? 'booked' : m.status === 'available' ? 'on_hold' : 'booked';
    L.marker([m.lat, m.lng], { icon: pinIcon({ ...m, status: st, abbr: typeInfo(m.type).abbr }) }).bindTooltip(esc(m.title)).addTo(map);
  }
  setTimeout(() => { map.invalidateSize(); fitTo(map, d.items); }, 50);

  // If the company's own staff open the link while signed in, take them to the review screen.
  try {
    const me = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (me.ok) {
      const s = await me.json();
      if (s.user && s.user.company_id === r.company_id) {
        $('[data-staff]').innerHTML = '<a class="btn primary sm" href="/requests/' + r.id + '">' + icon('inbox') + ' Review in dashboard</a>';
      }
    }
  } catch { /* not signed in */ }
}

/* ================================================================ route */

const [, kind, token] = location.pathname.split('/');
if (kind === 's' && token) sharePage(token);
else if (kind === 'r' && token) receiptPage(token);
else fail('This link is not valid.');
