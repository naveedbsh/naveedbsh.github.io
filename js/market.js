// Public marketplace website: home, explore (map + filters), listing page,
// provider page, and the enquiry flow (with creative upload) that lands in
// each provider's dashboard.
/* global L */
import {
  store, $, $$, el, esc, modal, money, fdate, sizeText, typeInfo, illumLabel, toast, toastError, busy,
  todayISO, addDays, daysBetween, copyText, directionsUrl, STATUS, paged,
} from './ui.js';
import { icon } from './icons.js';
import { createMap, pinIcon, clusterGroup, fitTo, destroyMap, later } from './maplib.js';

/* ================================================================== api */

async function mk(path, query) {
  let url = '/api/market' + path;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if (qs.toString()) url += '?' + qs;
  }
  let res;
  try { res = await fetch(url); } catch { throw new Error('Cannot reach the server. Check your connection.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  return data;
}

async function postForm(path, form) {
  const res = await fetch(path, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = res.status === 413 ? 'A file is larger than the 25 MB limit' : (data.error || 'Could not send. Please try again.');
    throw Object.assign(new Error(msg), { details: data.details || {} });
  }
  return data;
}

/* ============================================================ helpers */

const KM = (d) => (d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km');
const statusPill = (m, range) => {
  if (m.status === 'available') return '<span class="pill st-available"><span class="dot"></span>' + (range ? 'Free for your dates' : 'Available') + '</span>';
  return '<span class="pill st-booked"><span class="dot"></span>' + (m.available_from ? 'Free from ' + fdate(m.available_from) : 'Booked') + '</span>';
};

/* ------------------------------------------------------ enquiry list */

const LIST_KEY = 'hh_enquiry_list';
const enquiry = {
  items() { try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; } },
  save(list) { try { localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* private mode */ } drawListBadge(); drawTray(); },
  has(id) { return this.items().some((i) => i.id === id); },
  toggle(m) {
    const list = this.items();
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) list.splice(i, 1);
    else {
      if (list.length >= 50) { toast('Your list is full (50). Send this enquiry first.', 'error'); return false; }
      list.push({ id: m.id, title: m.title, type: m.type, area: m.area, city: m.city, photo_url: m.photo_url, rate_month: m.rate_month, provider: m.provider?.name, width: m.width, height: m.height, unit: m.unit });
    }
    this.save(list);
    return i < 0;
  },
  remove(ids) { this.save(this.items().filter((i) => !ids.includes(i.id))); },
};

function drawListBadge() {
  const b = $('[data-list-btn]');
  if (!b) return;
  const n = enquiry.items().length;
  $('.badge', b)?.remove();
  if (n) b.append(el('<span class="badge">' + n + '</span>'));
}

function drawTray() {
  $('.enq-tray')?.remove();
  const n = enquiry.items().length;
  if (!n) return;
  const t = el('<div class="enq-tray"><span><b>' + n + '</b> in your enquiry list</span><button class="btn sm" data-view>View</button><button class="btn sm primary" data-send>' + icon('send') + ' Send enquiry</button></div>');
  $('[data-view]', t).addEventListener('click', () => openEnquiry(enquiry.items()));
  $('[data-send]', t).addEventListener('click', () => openEnquiry(enquiry.items()));
  document.body.append(t);
}

// Every listing drawn as a card, by id: the "Enquire" buttons add from here.
const cardCache = new Map();

/** Toggle a card's "add to list" button in place. */
function syncAddButtons() {
  $$('[data-add]').forEach((b) => {
    const on = enquiry.has(Number(b.dataset.add));
    b.classList.toggle('on', on);
    b.innerHTML = on ? icon('check') + ' Added' : icon('plus') + ' Enquire';
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  e.preventDefault();
  const m = cardCache.get(Number(b.dataset.add));
  if (!m) return;
  const added = enquiry.toggle(m);
  if (added) toast('Added to your enquiry list', 'ok');
  syncAddButtons();
});

/* ------------------------------------------------------------ cards */

function card(m, { range = false } = {}) {
  cardCache.set(m.id, m);
  const t = typeInfo(m.type);
  const on = enquiry.has(m.id);
  return `<article class="lcard" data-id="${m.id}">
    <a class="ph" href="/m/${m.id}" data-link style="${m.photo_url ? 'background-image:url(' + esc(m.photo_url) + ')' : ''}">${m.photo_url ? '' : esc(t.abbr)}
      ${statusPill(m, range)}${m.distance_km !== undefined ? '<span class="dist">' + KM(m.distance_km) + '</span>' : ''}</a>
    <div class="bd">
      <div class="ty">${esc(t.label)}</div>
      <a class="tt" href="/m/${m.id}" data-link>${esc(m.title)}</a>
      <div class="loc">${icon('pin')} ${esc([m.area, m.city].filter(Boolean).join(', '))}</div>
      <div class="specs"><span>${icon('ruler')} ${esc(sizeText(m, { area: false }))}</span><span>${icon('bulb')} ${esc(illumLabel(m.illumination))}</span></div>
      <div class="ft">
        <div><div class="price">${m.rate_month ? money(m.rate_month) + ' <small>/ month</small>' : '<small>Price on request</small>'}</div>
        <div class="prov">by ${esc(m.provider?.name || '')}</div></div>
        <button class="btn sm add ${on ? 'on' : ''}" data-add="${m.id}">${on ? icon('check') + ' Added' : icon('plus') + ' Enquire'}</button>
      </div>
    </div>
  </article>`;
}

/* ------------------------------------------------------ place search */

/** Autocomplete for places via the server's rate-limited geocoder. */
function placeSearch(input, onPick) {
  const wrap = input.parentElement;
  let box = null; let results = []; let timer; let seq = 0; let active = -1;
  const close = () => { box?.remove(); box = null; active = -1; };
  const pick = (r) => { input.value = r.short; close(); onPick(r); };
  const draw = () => {
    close();
    if (!results.length) return;
    box = el('<div class="suggest"></div>');
    box.innerHTML = results.map((r, i) => '<button type="button" data-i="' + i + '">' + icon('pin') + '<span><b>' + esc(r.short) + '</b><small>' + esc(r.name) + '</small></span></button>').join('');
    box.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(results[Number(b.dataset.i)]); } });
    wrap.append(box);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { close(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const d = await mk('/geocode', { q });
        if (my !== seq) return;
        results = d.results.slice(0, 6).map((r) => ({ ...r, short: r.name.split(',').slice(0, 2).join(',').trim() }));
        draw();
      } catch { /* the user can still search by text */ }
    }, 450);
  });
  input.addEventListener('keydown', (e) => {
    if (!box) return;
    const btns = $$('button', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle('on', i === active));
    } else if (e.key === 'Enter' && results.length) {
      e.preventDefault();
      pick(results[Math.max(0, active)]);
    } else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

/* ------------------------------------------------------------ dropzone */

const ACCEPT = 'image/*,application/pdf,video/mp4,video/quicktime,video/webm,.zip,.psd,.ai,.cdr,.eps';
const MAX_FILES = 5;
const MAX_MB = 25;

/** A drag-and-drop file picker. Returns { el, files() }. */
function dropzone() {
  let files = [];
  const root = el(`<div>
    <label class="dropzone">${icon('upload')}<div><b>Upload your creative</b> (optional)</div>
      <div class="small faint">Drag files here or click · images, PDF, video, PSD/AI/CDR, ZIP · up to ${MAX_FILES} files, ${MAX_MB} MB each</div>
      <input type="file" multiple hidden accept="${ACCEPT}"></label>
    <div class="filelist"></div></div>`);
  const zone = $('.dropzone', root);
  const input = $('input', root);
  const list = $('.filelist', root);
  const draw = () => {
    list.innerHTML = files.map((f, i) => '<div>' + icon('file') + '<span>' + esc(f.name) + '</span><small class="faint">' + (f.size / 1048576).toFixed(1) + ' MB</small><button type="button" class="btn ghost sm icon" data-rm="' + i + '" aria-label="Remove">×</button></div>').join('');
  };
  const add = (list2) => {
    for (const f of list2) {
      if (files.length >= MAX_FILES) { toast('Up to ' + MAX_FILES + ' files', 'error'); break; }
      if (f.size > MAX_MB * 1048576) { toast(f.name + ' is over ' + MAX_MB + ' MB', 'error'); continue; }
      files.push(f);
    }
    draw();
  };
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => add([...e.dataTransfer.files]));
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(Number(b.dataset.rm), 1); draw(); } });
  return { el: root, files: () => files, clear: () => { files = []; draw(); } };
}

/* ------------------------------------------------------ enquiry form */

const SAVED_KEY = 'hh_enquirer';
const savedContact = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}'); } catch { return {}; } };

/**
 * The enquiry form for one or more listings. onSent(result) is called after
 * a successful submit; onGone(ids) when some listings left the marketplace
 * since they were added (they are dropped and the rest can be sent).
 */
function enquiryForm(items, { onSent, onGone, compact = false } = {}) {
  const me = savedContact();
  const form = el(`<form novalidate>
    <div class="grid-2">
      <label class="field"><span>Your name *</span><input type="text" name="name" maxlength="120" autocomplete="name" value="${esc(me.name || '')}"></label>
      <label class="field"><span>Phone *</span><input type="tel" name="phone" maxlength="40" autocomplete="tel" value="${esc(me.phone || '')}"></label>
    </div>
    <div class="grid-2 mt">
      <label class="field"><span>Email</span><input type="email" name="email" maxlength="190" autocomplete="email" value="${esc(me.email || '')}"></label>
      <label class="field"><span>Company / brand</span><input type="text" name="company" maxlength="160" autocomplete="organization" value="${esc(me.company || '')}"></label>
    </div>
    <div class="field-label mt">Dates you need (optional)</div>
    <div class="row"><input type="date" name="start_date" min="${todayISO()}" aria-label="From"><span class="faint">→</span><input type="date" name="end_date" min="${todayISO()}" aria-label="To"></div>
    <div class="hint" data-days></div>
    <label class="field mt"><span>Message</span><textarea name="message" maxlength="3000" rows="${compact ? 3 : 4}" placeholder="Campaign, budget, how long you need it, printing needs…"></textarea></label>
    <div class="mt" data-drop></div>
    <label class="check small mt"><input type="checkbox" name="whatsapp_updates" checked> Send me updates about this enquiry on WhatsApp</label>
    <label aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
    <div class="error-text mt hidden" data-err></div>
    <button class="btn primary mt" type="submit" style="width:100%;height:44px">${icon('send')} Send enquiry${items.length > 1 ? ' for ' + items.length + ' listings' : ''}</button>
    <p class="small faint mt" style="text-align:center">Goes straight to the owner${new Set(items.map((i) => i.provider)).size > 1 ? 's' : ''}. No sign-up needed.</p>
  </form>`);
  const dz = dropzone();
  $('[data-drop]', form).append(dz.el);
  const syncDays = () => {
    const s = form.start_date.value; const e = form.end_date.value;
    if (s && !e) form.end_date.value = addDays(s, 29);
    const e2 = form.end_date.value;
    $('[data-days]', form).textContent = s && e2 && e2 >= s ? daysBetween(s, e2) + ' days' : '';
  };
  form.start_date.addEventListener('change', syncDays);
  form.end_date.addEventListener('change', syncDays);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('[data-err]', form);
    err.classList.add('hidden');
    busy($('button[type=submit]', form), async () => {
      const fd = new FormData();
      fd.set('medium_ids', items.map((i) => i.id).join(','));
      for (const k of ['name', 'phone', 'email', 'company', 'message', 'start_date', 'end_date', 'website']) fd.set(k, form[k].value.trim());
      if (form.whatsapp_updates.checked) fd.set('whatsapp_updates', '1');
      dz.files().forEach((f) => fd.append('creatives', f));
      try {
        const r = await postForm('/api/market/enquiries', fd);
        try { localStorage.setItem(SAVED_KEY, JSON.stringify({ name: form.name.value, phone: form.phone.value, email: form.email.value, company: form.company.value })); } catch { /* */ }
        onSent?.(r);
      } catch (ex) {
        const gone = ex.details?.unavailable || [];
        if (gone.length) {
          // Listings taken down since they were saved: drop them, keep what was typed.
          for (const id of gone) { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1); }
          onGone?.(gone);
          err.textContent = gone.length + (gone.length === 1 ? ' listing is' : ' listings are') + ' no longer on the marketplace and ' +
            (gone.length === 1 ? 'was' : 'were') + ' removed from your list.' + (items.length ? ' Press Send again for the other ' + items.length + '.' : '');
          if (!items.length) $('button[type=submit]', form).disabled = true;
        } else err.textContent = ex.message;
        err.classList.remove('hidden');
      }
    });
  });
  return form;
}

function sentHtml(r) {
  return '<div class="sent-list">' + r.requests.map((q) =>
    '<div><span class="grow"><b>Sent to ' + esc(q.provider) + '</b><br><span class="small muted">' + q.items + ' listing' + (q.items > 1 ? 's' : '') + '</span></span>' +
    '<a class="btn sm" href="' + esc(q.url) + '" target="_blank" rel="noopener">' + icon('external') + ' Track request</a>' +
    '<button type="button" class="btn sm" data-copy="' + esc(q.url) + '">' + icon('copy') + ' Copy link</button></div>').join('') +
    '</div><p class="small muted mt">Keep these links: they show the owner\'s reply, and you can add more artwork there later.</p>';
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy); });

/** The enquiry modal for everything in the list. */
function openEnquiry(items) {
  if (!items.length) return;
  const body = el('<div></div>');
  body.append(el('<div class="card" style="box-shadow:none;max-height:190px;overflow:auto;margin-bottom:14px">' + items.map((i) =>
    '<div class="row" style="padding:8px 12px;border-bottom:1px solid var(--line)"><span class="grow small"><b>' + esc(i.title) + '</b><br><span class="faint">' +
    esc(typeInfo(i.type).label) + ' · ' + esc(i.area || i.city || '') + ' · by ' + esc(i.provider || '') + '</span></span>' +
    '<button type="button" class="btn ghost sm icon" data-rm-item="' + i.id + '" aria-label="Remove">×</button></div>').join('') + '</div>'));
  const m = modal({ title: 'Enquire about ' + items.length + ' listing' + (items.length > 1 ? 's' : ''), body, foot: null });
  body.append(enquiryForm(items, {
    onSent: (r) => {
      enquiry.remove(items.map((i) => i.id));
      syncAddButtons();
      m.body.innerHTML = '<div class="status-box st-available"><b>' + icon('check') + ' Enquiry sent!</b><div class="small mt">The owner has it in their dashboard now and will contact you on your phone.</div></div>' + sentHtml(r);
    },
    onGone: (ids) => {
      enquiry.remove(ids);
      syncAddButtons();
      ids.forEach((id) => $('[data-rm-item="' + id + '"]', body)?.closest('.row')?.remove());
    },
  }));
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm-item]');
    if (!b) return;
    enquiry.remove([Number(b.dataset.rmItem)]);
    syncAddButtons();
    m.close();
    if (enquiry.items().length) openEnquiry(enquiry.items());
  });
}

/* ============================================================= layout */

let session = null;
let cleanup = null;
let renderSeq = 0; // a slow, older page must not install its cleanup over a newer one's
const DEFAULT_TITLE = 'HoardHub – Find hoardings, pole boards & LED screens';

function header(path) {
  const on = (p) => (path === p || (p !== '/' && path.startsWith(p)) ? ' class="on"' : '');
  return `<header class="mk-header"><div class="mk-wrap">
    <a class="mk-logo" href="/" data-link><div class="brand-mark">H</div>HoardHub</a>
    <nav class="mk-nav"><a href="/" data-link${on('/')}>Home</a><a href="/explore" data-link${on('/explore')}>Explore</a><a href="/explore?available=1&sort=newest" data-link>Available now</a></nav>
    <button class="btn mk-list-btn" data-list-btn title="Your enquiry list">${icon('inbox')}<span class="hide-sm">Enquiry list</span></button>
    ${session?.user ? '<a class="btn primary" href="/map">Dashboard</a>' : '<a class="btn" href="/login"><span class="hide-sm">Owner</span>Sign in</a>'}
  </div></header>`;
}

function footer() {
  return `<footer class="mk-footer"><div class="mk-wrap">
    <a class="mk-logo" href="/" data-link style="font-size:15px"><div class="brand-mark">H</div>HoardHub</a>
    <span class="grow">Outdoor advertising sites from verified media owners.</span>
    <a href="/explore" data-link>Explore</a><a href="/login">Media owner login</a>
    <span class="faint">Maps © OpenStreetMap contributors</span>
  </div></footer>`;
}

const ROUTES = [
  [/^\/$/, home],
  [/^\/explore\/?$/, explore],
  [/^\/m\/(\d+)\/?$/, listing],
  [/^\/p\/([\w-]+)\/?$/, provider],
];

export function go(href, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', href); else history.pushState({}, '', href);
  render();
}

async function render() {
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  const seq = ++renderSeq;
  // Listing and provider pages set their own title; every other page gets the site's back.
  document.title = DEFAULT_TITLE;
  const path = location.pathname;
  const query = Object.fromEntries(new URLSearchParams(location.search));
  const route = ROUTES.find(([rx]) => rx.test(path));
  const app = $('#app');
  app.innerHTML = header(path) + '<main data-main></main>' + (path.startsWith('/explore') ? '' : footer());
  $('[data-list-btn]').addEventListener('click', () => {
    const items = enquiry.items();
    if (!items.length) return toast('Your enquiry list is empty. Tap “Enquire” on any listing to add it.');
    openEnquiry(items);
  });
  drawListBadge();
  drawTray();
  const main = $('[data-main]');
  window.scrollTo(0, 0);
  if (!route) { main.innerHTML = '<div class="mk-wrap empty" style="padding:80px 0"><h2>Page not found</h2><p class="mt"><a href="/" data-link>Go to the home page</a></p></div>'; return; }
  try {
    const done = await route[1](main, path.match(route[0]).slice(1), query);
    if (seq === renderSeq) cleanup = done || null;
    else { try { done?.(); } catch { /* page already replaced */ } }
  } catch (err) {
    if (seq !== renderSeq) return; // a newer page owns the screen now
    if (err.status !== 404) console.error(err); // a listing taken down is not a fault
    main.innerHTML = '<div class="mk-wrap" style="padding:80px 0;text-align:center"><h2>' + (err.status === 404 ? 'Not found' : 'Something went wrong') + '</h2><p class="muted mt">' + esc(err.message) + '</p><p class="mt"><a class="btn" href="/explore" data-link>Browse all listings</a></p></div>';
  }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

/* =============================================================== home */

async function home(main) {
  const d = await mk('/overview');
  const typeSel = '<option value="">All media types</option>' + store.meta.types.map((t) => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('');
  main.innerHTML = `
    <section class="hero"><div class="mk-wrap">
      <span class="eyebrow">${icon('sparkle')} ${d.totals.mediums} sites from ${d.totals.providers} media owner${d.totals.providers === 1 ? '' : 's'}</span>
      <h1>Find the right <em>hoarding, pole board or screen</em> for your brand.</h1>
      <p class="lead">Search outdoor advertising near any place, see size and availability on the map, and send your enquiry and artwork straight to the owner.</p>
      <form class="search-card" data-search autocomplete="off">
        <div class="fld"><label>Where</label><input type="text" name="place" placeholder="Area, landmark or city – e.g. Hitech City"></div>
        <div class="fld"><label>What</label><select name="type">${typeSel}</select></div>
        <button class="btn primary" type="submit">${icon('search')} Search</button>
      </form>
      <div class="cities"><span>Popular:</span>${d.cities.slice(0, 8).map((c) => '<a href="/explore?cities=' + encodeURIComponent(c.city) + '" data-link>' + esc(c.city) + ' · ' + c.count + '</a>').join('')}
        <a href="#" data-near-me>${icon('locate')} Near me</a></div>
      <div class="hero-stats"><div><b>${d.totals.mediums}</b><span>sites listed</span></div><div><b>${d.totals.providers}</b><span>media owners</span></div><div><b>${d.totals.cities}</b><span>cit${d.totals.cities === 1 ? 'y' : 'ies'}</span></div></div>
    </div></section>

    <section class="mk-section"><div class="mk-wrap">
      <div class="section-head"><div><h2 class="title">Browse by type</h2><div class="sub">From centre-divider pole kiosks to rooftop giants and LED screens.</div></div><a class="btn" href="/explore" data-link>See everything</a></div>
      <div class="type-tiles">${d.types.map((t) => {
        const info = typeInfo(t.key);
        return '<a class="type-tile" href="/explore?types=' + t.key + '" data-link><span class="ab">' + esc(info.abbr) + '</span><span><b>' + esc(info.label) + '</b><small>' + t.count + ' listed</small></span></a>';
      }).join('')}</div>
    </div></section>

    <section class="mk-section" style="padding-top:0"><div class="mk-wrap">
      <div class="section-head"><div><h2 class="title">Available now</h2><div class="sub">Freshly listed sites you can book today.</div></div><a class="btn" href="/explore?available=1" data-link>View all available</a></div>
      <div class="lgrid">${d.featured.map((m) => card(m)).join('') || '<div class="empty">No listings yet.</div>'}</div>
    </div></section>

    <section class="mk-section" style="padding-top:0"><div class="mk-wrap">
      <div class="section-head"><div><h2 class="title">How it works</h2></div></div>
      <div class="steps">
        <div class="step"><div class="n">1</div><h3>Search the map</h3><p>Filter by place, radius, type, size, lighting and budget. Every site is pinned exactly where it stands.</p></div>
        <div class="step"><div class="n">2</div><h3>Check your dates</h3><p>See what is free for your campaign dates, and when booked sites open up again.</p></div>
        <div class="step"><div class="n">3</div><h3>Enquire & send artwork</h3><p>Pick one site or many, attach your creative, and it goes straight to each owner's dashboard. No sign-up.</p></div>
      </div>
    </div></section>

    <section class="mk-section" style="padding-top:0"><div class="mk-wrap">
      <div class="owner-cta"><div class="grow"><h2>Own hoardings, pole boards or screens?</h2>
        <p>Manage your whole inventory on one map – bookings, payments, site remarks, maintenance – and list the sites you choose here to get enquiries directly.</p></div>
        <a class="btn primary" href="/login" style="height:44px">Media owner sign in</a></div>
    </div></section>`;

  const form = $('[data-search]', main);
  let picked = null;
  placeSearch(form.place, (r) => { picked = r; });
  form.place.addEventListener('input', () => { picked = null; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new URLSearchParams();
    if (form.type.value) q.set('types', form.type.value);
    if (picked) { q.set('near', picked.lat.toFixed(5) + ',' + picked.lng.toFixed(5)); q.set('place', picked.short); q.set('radius', '5'); }
    else if (form.place.value.trim()) q.set('q', form.place.value.trim());
    go('/explore?' + q);
  });
  $('[data-near-me]', main).addEventListener('click', (e) => {
    e.preventDefault();
    if (!navigator.geolocation) return toast('This browser cannot share its location', 'error');
    navigator.geolocation.getCurrentPosition(
      (p) => go('/explore?near=' + p.coords.latitude.toFixed(5) + ',' + p.coords.longitude.toFixed(5) + '&place=Your%20location&radius=5'),
      () => toast('Location permission was denied', 'error'),
      { timeout: 10000 }
    );
  });
}

/* ============================================================ explore */

async function explore(main, params, query) {
  const f = {
    q: query.q || '', place: query.place || '', near: query.near || '', radius: query.radius || '5',
    types: (query.types || '').split(',').filter(Boolean), cities: query.cities || '',
    from: query.from || '', to: query.to || '', available: query.available || '', sort: query.sort || '',
    min_width: query.min_width || '', max_rate: query.max_rate || '', illumination: query.illumination || '', bbox: '',
  };

  main.innerHTML = `<div class="ex">
    <div class="ex-bar">
      <div class="loc">${icon('search')}<input type="search" placeholder="Search a place, area or keyword" data-place value="${esc(f.place || f.q)}" autocomplete="off"></div>
      <select data-radius title="Distance"${f.near ? '' : ' disabled'}>${[1, 2, 5, 10, 25, 50].map((r) => '<option value="' + r + '"' + (String(r) === f.radius ? ' selected' : '') + '>Within ' + r + ' km</option>').join('')}</select>
      <div class="dd"><button class="btn" data-types-btn>${icon('layers')} <span data-types-label>All types</span></button>
        <div class="dd-panel hidden" data-types-panel><div class="type-list" style="max-height:none">${store.meta.types.map((t) => '<label class="check"><input type="checkbox" value="' + t.key + '"' + (f.types.includes(t.key) ? ' checked' : '') + '> ' + esc(t.label) + '</label>').join('')}</div>
        <div class="row mt"><button class="btn sm ghost" data-types-clear>Clear</button><span class="grow"></span><button class="btn sm primary" data-types-done>Done</button></div></div></div>
      <input type="date" data-from min="${todayISO()}" value="${esc(f.from)}" title="From date" aria-label="From date">
      <input type="date" data-to min="${todayISO()}" value="${esc(f.to)}" title="To date" aria-label="To date">
      <label class="chip ${f.available ? 'on' : ''}" data-avail-chip><input type="checkbox" hidden data-avail ${f.available ? 'checked' : ''}><span class="dot" style="background:${STATUS.available.color}"></span> Available only</label>
      <div class="dd"><button class="btn" data-more-btn>${icon('filter')} More</button>
        <div class="dd-panel hidden" data-more-panel>
          <label class="field"><span>Minimum width (ft)</span><input type="number" min="0" data-minw value="${esc(f.min_width)}"></label>
          <label class="field mt"><span>Maximum rate per month</span><input type="number" min="0" step="1000" data-maxrate value="${esc(f.max_rate)}"></label>
          <label class="field mt"><span>Lighting</span><select data-illum><option value="">Any</option>${store.meta.illumination.map((i) => '<option value="' + i.key + '"' + (f.illumination === i.key ? ' selected' : '') + '>' + esc(i.label) + '</option>').join('')}</select></label>
          <div class="row mt"><span class="grow"></span><button class="btn sm primary" data-more-done>Apply</button></div>
        </div></div>
      <select data-sort title="Sort"><option value="">Newest</option><option value="near"${f.sort === 'near' ? ' selected' : ''}>Nearest</option><option value="price_asc"${f.sort === 'price_asc' ? ' selected' : ''}>Price: low to high</option><option value="price_desc"${f.sort === 'price_desc' ? ' selected' : ''}>Price: high to low</option><option value="size"${f.sort === 'size' ? ' selected' : ''}>Largest first</option></select>
      <button class="btn ghost" data-reset>Reset</button>
    </div>
    <div class="ex-body">
      <div class="ex-list"><div class="ex-head" data-head>Searching…</div><div class="lgrid" data-grid></div></div>
      <div class="ex-map"><div class="map" data-map></div><button class="btn hidden area-btn" data-area>${icon('search')} Search this area</button></div>
    </div>
  </div>`;

  const map = createMap($('[data-map]', main), { center: [store.meta.map_default.lat, store.meta.map_default.lng], zoom: store.meta.map_default.zoom });
  const cluster = clusterGroup().addTo(map);
  const markers = new Map();
  let circle = null;
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe($('.ex-map', main));

  const syncUrl = () => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (k === 'bbox' || k === 'radius' && !f.near) continue;
      const val = Array.isArray(v) ? v.join(',') : v;
      if (val) q.set(k, val);
    }
    history.replaceState({}, '', '/explore' + (q.toString() ? '?' + q : ''));
  };

  let seq = 0;
  let programmatic = false;
  async function load({ fit = true } = {}) {
    syncUrl();
    const my = ++seq;
    $('[data-head]', main).textContent = 'Searching…';
    let d;
    try {
      d = await mk('/mediums', {
        q: f.near ? '' : f.q, near: f.near, radius: f.near ? f.radius : '', types: f.types.join(','), cities: f.cities,
        from: f.from, to: f.to, available: f.available ? '1' : '', sort: f.sort, min_width: f.min_width, max_rate: f.max_rate,
        illumination: f.illumination, bbox: f.bbox,
      });
    } catch (err) { toastError(err); return; }
    if (my !== seq) return;
    const range = !!f.from;
    const where = f.bbox ? 'in this map area' : f.near ? 'within ' + f.radius + ' km of ' + (f.place || 'the chosen point') : f.cities ? 'in ' + f.cities : f.q ? 'for “' + f.q + '”' : '';
    const types = f.types.length ? ' · ' + f.types.map((t) => typeInfo(t).label).join(', ') : '';
    $('[data-head]', main).innerHTML = '<b style="color:var(--text)">' + d.total + '</b> site' + (d.total === 1 ? '' : 's') + ' ' + esc(where) + esc(types) +
      (range ? ' · <span>' + fdate(f.from) + (f.to && f.to !== f.from ? ' – ' + fdate(f.to) : '') + '</span>' : '') +
      (d.total > d.mediums.length ? ' <span class="faint">(showing ' + d.mediums.length + ' – zoom in or filter)</span>' : '');
    // Up to 1,000 results: cards come in batches (the map shows them all), so every
    // listing is registered now - the map popups' "Enquire" buttons look them up here.
    d.mediums.forEach((m) => cardCache.set(m.id, m));
    paged($('[data-grid]', main), d.mediums, (m) => card(m, { range }), {
      step: 48,
      empty: '<div class="card card-pad" style="grid-column:1/-1;text-align:center"><h3>No sites match</h3><p class="muted mt">Try a bigger radius, fewer filters, or other dates.</p></div>',
    });

    cluster.clearLayers();
    markers.clear();
    for (const m of d.mediums) {
      const mk2 = L.marker([m.lat, m.lng], { icon: pinIcon({ ...m, abbr: typeInfo(m.type).abbr }) });
      mk2.bindPopup(() => '<div class="popup-card">' + (m.photo_url ? '<div class="ph" style="background-image:url(' + esc(m.photo_url) + ')"></div>' : '') +
        '<div class="small faint">' + esc(typeInfo(m.type).label) + '</div><b>' + esc(m.title) + '</b><div class="small muted">' + esc(sizeText(m, { area: false })) + ' · ' + (m.rate_month ? money(m.rate_month) + '/mo' : 'Price on request') + '</div>' +
        '<div style="margin:6px 0">' + statusPill(m, range) + '</div><div class="row"><a class="btn sm primary" href="/m/' + m.id + '" data-link>View</a><button class="btn sm" data-add="' + m.id + '">' + (enquiry.has(m.id) ? icon('check') + ' Added' : icon('plus') + ' Enquire') + '</button></div></div>', { minWidth: 240 });
      mk2.on('mouseover', () => $('.lcard[data-id="' + m.id + '"]', main)?.classList.add('hl'));
      mk2.on('mouseout', () => $('.lcard[data-id="' + m.id + '"]', main)?.classList.remove('hl'));
      markers.set(m.id, mk2);
      cluster.addLayer(mk2);
    }
    circle?.remove();
    circle = null;
    if (f.near) {
      const [la, ln] = f.near.split(',').map(Number);
      circle = L.circle([la, ln], { radius: Number(f.radius) * 1000, color: '#2f5bea', weight: 1.5, fillOpacity: 0.05 }).addTo(map);
    }
    if (fit) {
      programmatic = true;
      if (circle) map.fitBounds(circle.getBounds(), { padding: [20, 20] });
      else if (!fitTo(map, d.mediums)) map.setView([store.meta.map_default.lat, store.meta.map_default.lng], 11);
      setTimeout(() => { programmatic = false; }, 600);
    }
    $('[data-area]', main).classList.add('hidden');
  }

  // Hovering a card lifts its pin.
  $('[data-grid]', main).addEventListener('mouseover', (e) => {
    const c = e.target.closest('.lcard');
    if (!c) return;
    const m = markers.get(Number(c.dataset.id));
    if (m) m.setZIndexOffset(1000);
  });

  map.on('moveend', () => { if (!programmatic) $('[data-area]', main).classList.remove('hidden'); });
  $('[data-area]', main).addEventListener('click', () => {
    const b = map.getBounds();
    f.bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(',');
    f.near = ''; f.place = ''; f.q = ''; f.cities = '';
    $('[data-place]', main).value = '';
    $('[data-radius]', main).disabled = true;
    load({ fit: false });
  });

  // Place / keyword.
  const placeInput = $('[data-place]', main);
  placeSearch(placeInput, (r) => {
    f.near = r.lat.toFixed(5) + ',' + r.lng.toFixed(5); f.place = r.short; f.q = ''; f.bbox = ''; f.cities = '';
    if (!f.sort) f.sort = 'near';
    $('[data-sort]', main).value = f.sort;
    $('[data-radius]', main).disabled = false;
    load();
  });
  placeInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || $('.suggest', main)) return;
    e.preventDefault();
    f.q = placeInput.value.trim(); f.near = ''; f.place = ''; f.bbox = ''; f.cities = '';
    $('[data-radius]', main).disabled = true;
    load();
  });
  placeInput.addEventListener('search', () => { if (!placeInput.value) { f.q = ''; f.near = ''; f.place = ''; load(); } });
  $('[data-radius]', main).addEventListener('change', (e) => { f.radius = e.target.value; load(); });

  // Types dropdown.
  const typesPanel = $('[data-types-panel]', main);
  const typesLabel = () => { $('[data-types-label]', main).textContent = f.types.length ? f.types.length === 1 ? typeInfo(f.types[0]).label : f.types.length + ' types' : 'All types'; };
  typesLabel();
  $('[data-types-btn]', main).addEventListener('click', () => { typesPanel.classList.toggle('hidden'); $('[data-more-panel]', main).classList.add('hidden'); });
  $('[data-types-clear]', main).addEventListener('click', () => $$('input', typesPanel).forEach((i) => { i.checked = false; }));
  $('[data-types-done]', main).addEventListener('click', () => {
    f.types = $$('input:checked', typesPanel).map((i) => i.value);
    typesPanel.classList.add('hidden');
    typesLabel();
    load();
  });
  const morePanel = $('[data-more-panel]', main);
  $('[data-more-btn]', main).addEventListener('click', () => { morePanel.classList.toggle('hidden'); typesPanel.classList.add('hidden'); });
  $('[data-more-done]', main).addEventListener('click', () => {
    f.min_width = $('[data-minw]', main).value; f.max_rate = $('[data-maxrate]', main).value; f.illumination = $('[data-illum]', main).value;
    morePanel.classList.add('hidden');
    load();
  });
  const outside = (e) => { if (!e.target.closest('.dd')) { typesPanel.classList.add('hidden'); morePanel.classList.add('hidden'); } };
  document.addEventListener('click', outside);

  // Dates, availability, sort.
  const onDates = () => {
    let from = $('[data-from]', main).value; let to = $('[data-to]', main).value;
    if (from && (!to || to < from)) { to = addDays(from, 29); $('[data-to]', main).value = to; }
    if (!from && to) { from = todayISO(); $('[data-from]', main).value = from; }
    f.from = from; f.to = to;
    load({ fit: false });
  };
  $('[data-from]', main).addEventListener('change', onDates);
  $('[data-to]', main).addEventListener('change', onDates);
  $('[data-avail]', main).addEventListener('change', (e) => { f.available = e.target.checked ? '1' : ''; $('[data-avail-chip]', main).classList.toggle('on', e.target.checked); load({ fit: false }); });
  $('[data-sort]', main).addEventListener('change', (e) => { f.sort = e.target.value; load({ fit: false }); });
  $('[data-reset]', main).addEventListener('click', () => go('/explore', { replace: true }));

  await load();
  return () => { ro.disconnect(); destroyMap(map); document.removeEventListener('click', outside); };
}

/* ============================================================ listing */

function availabilityBar(busy) {
  const start = todayISO();
  const days = 180;
  const segs = busy.map((b) => {
    const s = Math.max(0, daysBetween(start, b.start < start ? start : b.start) - 1);
    const e = Math.min(days, daysBetween(start, b.end));
    return e > s ? '<i style="left:' + (s / days) * 100 + '%;width:' + ((e - s) / days) * 100 + '%" title="Booked ' + fdate(b.start) + ' – ' + fdate(b.end) + '"></i>' : '';
  }).join('');
  const months = [];
  const d = new Date(start + 'T00:00:00');
  for (let i = 0; i < 6; i++) months.push(new Date(d.getFullYear(), d.getMonth() + i, 1).toLocaleString('en', { month: 'short' }));
  return '<div class="avail-bar">' + segs + '</div><div class="avail-months">' + months.map((m) => '<span>' + m + '</span>').join('') + '</div>' +
    '<div class="legend"><span><i style="background:var(--st-available-soft);border:1px solid #bfe5cb"></i>Free</span><span><i style="background:#f3b1b1"></i>Booked</span></div>' +
    (busy.length ? '<div class="small muted mt">' + busy.slice(0, 4).map((b) => 'Booked ' + fdate(b.start) + ' – ' + fdate(b.end)).join(' · ') + '</div>' : '<div class="small muted mt">No bookings in the next six months.</div>');
}

async function listing(main, [id]) {
  const d = await mk('/mediums/' + id);
  const m = d.medium;
  const p = d.provider;
  const t = typeInfo(m.type);
  cardCache.set(m.id, m);
  document.title = m.title + ' – ' + t.label + ' | HoardHub';

  const fact = (label, value) => (value ? '<dl class="fact"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></dl>' : '');
  main.innerHTML = `<div class="mk-wrap">
    <div class="crumbs"><a href="/" data-link>Home</a>›<a href="/explore?types=${m.type}" data-link>${esc(t.label)}</a>›${m.city ? '<a href="/explore?cities=' + encodeURIComponent(m.city) + '" data-link>' + esc(m.city) + '</a>›' : ''}<span>${esc(m.area || m.title)}</span></div>
    <div class="lp">
      <div>
        <div class="lp-gallery">
          <div class="main" data-main-photo style="${m.photos[0] ? 'background-image:url(' + esc(m.photos[0]) + ')' : ''}">${m.photos[0] ? '' : esc(t.abbr)}</div>
          ${m.photos.length > 1 ? '<div class="thumbs">' + m.photos.map((u, i) => '<button data-ph="' + esc(u) + '" class="' + (i ? '' : 'on') + '" style="background-image:url(' + esc(u) + ')" aria-label="Photo ' + (i + 1) + '"></button>').join('') + '</div>' : ''}
        </div>
        <h1>${esc(m.title)}</h1>
        <div class="meta-line"><span class="pill info">${esc(t.label)}</span><span>${icon('pin')} ${esc([m.landmark, m.area, m.city].filter(Boolean).join(', '))}</span>
          <a href="${directionsUrl(m)}" target="_blank" rel="noopener">${icon('nav')} Directions</a></div>

        <h2 class="sec">Key details</h2>
        <div class="facts">
          ${fact('Size', esc(sizeText(m)))}
          ${fact('Lighting', esc(illumLabel(m.illumination)))}
          ${fact('Facing', esc(m.facing))}
          ${fact('Height from ground', m.elevation_ft ? m.elevation_ft + ' ft' : '')}
          ${fact('Minimum booking', m.min_days ? m.min_days + ' days' : '')}
          ${t.digital ? fact('Resolution', esc(m.resolution)) : ''}
          ${t.digital ? fact('Ad slot', m.slot_seconds ? m.slot_seconds + ' s, ' + (m.loop_slots || '?') + ' slots per loop' : '') : ''}
          ${t.digital ? fact('Screen hours', esc(m.operating_hours)) : ''}
          ${fact('Traffic', esc(m.traffic_note))}
        </div>
        ${m.description ? '<h2 class="sec">About this site</h2><p style="white-space:pre-wrap">' + esc(m.description) + '</p>' : ''}

        <h2 class="sec">Availability – next 6 months</h2>
        <div class="card card-pad">${m.status === 'available' ? '<b style="color:var(--st-available)">Available now.</b> ' : '<b style="color:var(--st-booked)">Booked now' + (m.available_from ? ', free from ' + fdate(m.available_from) : '') + '.</b> '}<span class="muted small">Send your dates in the enquiry to confirm.</span>
          <div class="mt">${availabilityBar(m.busy)}</div></div>

        <h2 class="sec">Location</h2>
        <div class="lp-map"><div class="map" data-map></div></div>

        ${d.nearby.length ? '<h2 class="sec">Nearby sites</h2><div class="lgrid">' + d.nearby.map((x) => card(x)).join('') + '</div>' : ''}
      </div>

      <aside class="side">
        <div class="card card-pad">
          <div class="price-big">${m.rate_month ? money(m.rate_month) : 'Price on request'}</div>
          <div class="muted small">${m.rate_month ? 'per month · final price confirmed by the owner' : 'Ask the owner for a quote'}</div>
          <button class="btn mt" style="width:100%" data-add="${m.id}"></button>
          <div class="form-section" id="enquire">Enquire about this site</div>
          <div data-form></div>
        </div>
        <div class="card card-pad">
          <div class="provider-card">
            <div class="lg" style="${p.logo_url ? 'background-image:url(' + esc(p.logo_url) + ')' : ''}">${p.logo_url ? '' : esc(p.name[0])}</div>
            <div class="grow"><div class="small faint">Listed by</div><b>${esc(p.name)}</b><div class="small muted">${p.listings} site${p.listings === 1 ? '' : 's'}${p.city ? ' · ' + esc(p.city) : ''}</div></div>
          </div>
          ${p.about ? '<p class="small muted mt">' + esc(p.about) + '</p>' : ''}
          <div class="row wrap mt"><a class="btn sm" href="/p/${esc(p.slug)}" data-link>All sites by ${esc(p.name)}</a>${p.phone ? '<a class="btn sm" href="tel:' + esc(p.phone) + '">' + icon('phone') + ' Call</a>' : ''}</div>
        </div>
      </aside>
    </div></div>
    <button class="btn primary mobile-cta" data-to-form>${icon('send')} Enquire${m.rate_month ? ' · ' + money(m.rate_month) + '/mo' : ''}</button>`;
  syncAddButtons();
  // Phone shortcut to the form, which sits below all the details there.
  $('[data-to-form]', main).addEventListener('click', () => {
    $('#enquire', main).scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('[data-form] [name=name]', main)?.focus({ preventScroll: true }), 500);
  });

  $$('[data-ph]', main).forEach((b) => b.addEventListener('click', () => {
    $('[data-main-photo]', main).style.backgroundImage = 'url(' + b.dataset.ph + ')';
    $$('[data-ph]', main).forEach((x) => x.classList.toggle('on', x === b));
  }));

  const formHost = $('[data-form]', main);
  formHost.append(enquiryForm([{ id: m.id, provider: p.name }], {
    compact: true,
    onSent: (r) => {
      enquiry.remove([m.id]);
      syncAddButtons();
      formHost.innerHTML = '<div class="status-box st-available"><b>' + icon('check') + ' Sent to ' + esc(p.name) + '</b><div class="small mt">They will contact you soon.</div></div>' + sentHtml(r);
    },
  }));

  const map = createMap($('[data-map]', main), { center: [m.lat, m.lng], zoom: 16 });
  L.marker([m.lat, m.lng], { icon: pinIcon({ ...m, abbr: t.abbr }) }).addTo(map);
  for (const x of d.nearby) {
    L.marker([x.lat, x.lng], { icon: pinIcon({ ...x, abbr: typeInfo(x.type).abbr }), opacity: 0.75 })
      .bindTooltip(esc(x.title)).on('click', () => go('/m/' + x.id)).addTo(map);
  }
  later(map, () => map.invalidateSize(), 60);
  return () => destroyMap(map);
}

/* =========================================================== provider */

async function provider(main, [slug]) {
  const d = await mk('/providers/' + slug);
  const p = d.provider;
  document.title = p.name + ' – outdoor media | HoardHub';
  main.innerHTML = `
    <section class="pv-hero"><div class="mk-wrap">
      <div class="lg" style="${p.logo_url ? 'background-image:url(' + esc(p.logo_url) + ')' : ''}">${p.logo_url ? '' : esc(p.name[0])}</div>
      <div class="grow" style="min-width:260px"><h1>${esc(p.name)}</h1>
        <div class="muted mt">${p.listings} site${p.listings === 1 ? '' : 's'} listed${p.cities.length ? ' in ' + esc(p.cities.join(', ')) : ''} · on HoardHub since ${fdate(p.since)}</div>
        ${p.about ? '<p class="mt" style="max-width:720px">' + esc(p.about) + '</p>' : ''}</div>
      ${p.phone ? '<a class="btn" href="tel:' + esc(p.phone) + '">' + icon('phone') + ' ' + esc(p.phone) + '</a>' : ''}
    </div></section>
    <section class="mk-section" style="padding-top:28px"><div class="mk-wrap">
      <div class="pv-map"><div class="map" data-map></div></div>
      <div class="section-head"><div><h2 class="title">Sites</h2><div class="sub">${p.types.map((t) => esc(typeInfo(t).label)).join(' · ')}</div></div>
        <label class="chip" data-av><input type="checkbox" hidden> Available only</label></div>
      <div class="lgrid" data-grid></div>
    </div></section>`;

  let onlyFree = false;
  const draw = () => {
    const rows = onlyFree ? d.mediums.filter((m) => m.status === 'available') : d.mediums;
    rows.forEach((m) => cardCache.set(m.id, m));
    paged($('[data-grid]', main), rows, (m) => card(m), { step: 48, empty: '<div class="empty">Nothing available right now.</div>' });
  };
  $('[data-av]', main).addEventListener('click', (e) => { e.preventDefault(); onlyFree = !onlyFree; e.currentTarget.classList.toggle('on', onlyFree); draw(); });
  draw();

  const map = createMap($('[data-map]', main));
  const cluster = clusterGroup().addTo(map);
  for (const m of d.mediums) {
    cluster.addLayer(L.marker([m.lat, m.lng], { icon: pinIcon({ ...m, abbr: typeInfo(m.type).abbr }) })
      .bindTooltip(esc(m.title)).on('click', () => go('/m/' + m.id)));
  }
  later(map, () => { map.invalidateSize(); fitTo(map, d.mediums); }, 60);
  return () => destroyMap(map);
}

/* =============================================================== boot */

(async function boot() {
  try { store.meta = await fetch('/api/meta').then((r) => r.json()); } catch { store.meta = { types: [], illumination: [], map_default: { lat: 20.59, lng: 78.96, zoom: 5 } }; }
  store.company = { currency: 'INR' };
  try { session = await fetch('/api/auth/session', { credentials: 'same-origin' }).then((r) => r.json()); } catch { session = null; }
  render();
})();
