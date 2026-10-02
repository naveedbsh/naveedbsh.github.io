// The main screen: every medium on a map, filters and a list on the left,
// details / add / edit in a drawer on the right, multi-select for booking
// and sharing.
/* global L */
import { get, post } from '../api.js';
import {
  store, $, $$, el, esc, pill, typeInfo, sizeText, fdate, toast, toastError, todayISO, STATUS, paged,
} from '../ui.js';
import { icon } from '../icons.js';
import {
  createMap, pinIcon, newPinIcon, clusterGroup, fitTo, legendHtml, destroyMap, later, isLive,
} from '../maplib.js';
import { can } from '../app.js';
import { openDetail } from './medium-detail.js';
import { openForm, chooseType } from './medium-form.js';
import { openBookingModal } from './booking-form.js';
import { openShareModal } from './share-form.js';

const FILTER_KEY = 'hh_map_filters';

export async function render(root, params, query) {
  // A link that names boards (?open= / ?select=, e.g. from a dashboard suggestion)
  // starts unfiltered: last session's filters could hide exactly those boards.
  const deepLink = !!(query.open || query.select);
  const saved = deepLink ? {} : (() => { try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; } })();
  // Dates saved days ago (a tab left open) that are already over would show yesterday's availability.
  if (saved.to && saved.to < todayISO()) { saved.from = ''; saved.to = ''; }
  else if (saved.from && saved.from < todayISO()) saved.from = todayISO();
  const state = {
    filters: { q: '', types: [], statuses: [], cities: [], areas: [], from: '', to: '', listing: '', ...saved },
    mediums: [],
    facets: [],
    selected: new Set(),
    selectMode: false,
    activeId: null,
    markers: new Map(),
    fitted: false,
  };

  const view = el(`
    <div class="mapview">
      <aside class="panel">
        <div class="panel-head">
          <div class="row">
            <div class="search grow">${icon('search')}<input type="search" placeholder="Search code, place, landmark…" data-q></div>
            <button class="btn icon" data-toggle-panel title="Filters">${icon('filter')}</button>
            <button class="btn mobile-only" data-toggle-list title="Show the list">${icon('list')} <span data-list-count></span></button>
          </div>
        </div>
        <div class="filters">
          <div>
            <div class="field-label">Availability for dates</div>
            <div class="row"><input type="date" data-from aria-label="From"><span class="faint">→</span><input type="date" data-to aria-label="To"></div>
          </div>
          <div class="chips" data-status-chips></div>
          <details data-types-box>
            <summary>${icon('chevron')} Media types <span class="faint" data-types-count></span></summary>
            <div class="type-list" data-types></div>
          </details>
          <div class="grid-2">
            <select data-city><option value="">All cities</option></select>
            <select data-area><option value="">All areas</option></select>
          </div>
          <select data-listing title="Public marketplace">
            <option value="">Public and private</option><option value="public">Listed on marketplace</option><option value="private">Private only</option>
          </select>
        </div>
        <div class="results-head">
          <span class="grow" data-count>Loading…</span>
          <button class="btn sm ghost" data-clear-filters>Reset</button>
          ${can('manager') ? '<button class="btn sm" data-share-view title="Share these results">' + icon('share') + ' Share</button>' : ''}
        </div>
        <div class="results" data-list></div>
      </aside>
      <div class="mapwrap">
        <div id="map"></div>
        <div class="map-tools">
          ${can('manager') ? '<button class="btn primary" data-add>' + icon('plus') + ' Add new</button>' : ''}
          <button class="btn" data-select-mode>${icon('select')} Select</button>
          <button class="btn icon" data-locate title="My location">${icon('locate')}</button>
          <button class="btn icon" data-fit title="Zoom to fit all results" aria-label="Zoom to fit all results">${icon('fit')}</button>
        </div>
        <div class="map-legend">${legendHtml()}</div>
        <div data-drawer-host></div>
        <div data-bar-host></div>
      </div>
    </div>`);
  root.append(view);

  const md = store.meta?.map_default || { lat: 20.59, lng: 78.96, zoom: 5 };
  const map = createMap($('#map', view), { center: [md.lat, md.lng], zoom: md.zoom });
  const cluster = clusterGroup().addTo(map);
  later(map, () => map.invalidateSize());
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe($('.mapwrap', view));

  /* ------------------------------------------------------------ filters */

  const qInput = $('[data-q]', view);
  qInput.value = state.filters.q;
  $('[data-from]', view).value = state.filters.from;
  $('[data-to]', view).value = state.filters.to;

  const chipBox = $('[data-status-chips]', view);
  function drawChips() {
    chipBox.innerHTML = ['available', 'on_hold', 'booked', 'maintenance', 'inactive'].map((s) =>
      '<button class="chip' + (state.filters.statuses.includes(s) ? ' on' : '') + '" data-st="' + s + '"><span class="dot" style="background:' +
      STATUS[s].color + '"></span>' + STATUS[s].label + '</button>').join('');
  }
  drawChips();
  chipBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    const s = b.dataset.st;
    state.filters.statuses = state.filters.statuses.includes(s) ? state.filters.statuses.filter((x) => x !== s) : [...state.filters.statuses, s];
    drawChips();
    load();
  });

  const typesBox = $('[data-types]', view);
  let lastGroup = '';
  typesBox.innerHTML = (store.meta?.types || []).map((t) => {
    const g = t.group !== lastGroup ? '<div class="grp">' + esc(t.group) + '</div>' : '';
    lastGroup = t.group;
    return g + '<label class="check"><input type="checkbox" value="' + t.key + '"' + (state.filters.types.includes(t.key) ? ' checked' : '') + '> ' + esc(t.label) + '</label>';
  }).join('');
  const typesCount = () => { $('[data-types-count]', view).textContent = state.filters.types.length ? '(' + state.filters.types.length + ')' : ''; };
  typesCount();
  typesBox.addEventListener('change', () => {
    state.filters.types = $$('input:checked', typesBox).map((i) => i.value);
    typesCount();
    load();
  });

  const citySel = $('[data-city]', view);
  const areaSel = $('[data-area]', view);
  function drawFacets() {
    const cities = [...new Set(state.facets.map((f) => f.city).filter(Boolean))].sort();
    citySel.innerHTML = '<option value="">All cities</option>' + cities.map((c) => '<option' + (state.filters.cities[0] === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    const areas = [...new Set(state.facets.filter((f) => !state.filters.cities[0] || f.city === state.filters.cities[0]).map((f) => f.area).filter(Boolean))].sort();
    areaSel.innerHTML = '<option value="">All areas</option>' + areas.map((a) => '<option' + (state.filters.areas[0] === a ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
  }
  $('[data-listing]', view).value = state.filters.listing || '';
  $('[data-listing]', view).addEventListener('change', (e) => { state.filters.listing = e.target.value; load(); });
  citySel.addEventListener('change', () => { state.filters.cities = citySel.value ? [citySel.value] : []; state.filters.areas = []; load(); });
  areaSel.addEventListener('change', () => { state.filters.areas = areaSel.value ? [areaSel.value] : []; load(); });

  let qTimer;
  qInput.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.filters.q = qInput.value.trim(); load(); }, 250); });
  const onDates = () => {
    let from = $('[data-from]', view).value;
    let to = $('[data-to]', view).value;
    if (from && to && to < from) { to = from; $('[data-to]', view).value = to; }
    if (!from && to) { from = todayISO(); $('[data-from]', view).value = from; }
    state.filters.from = from; state.filters.to = to;
    load();
  };
  $('[data-from]', view).addEventListener('change', onDates);
  $('[data-to]', view).addEventListener('change', onDates);

  $('[data-clear-filters]', view).addEventListener('click', () => {
    state.filters = { q: '', types: [], statuses: [], cities: [], areas: [], from: '', to: '', listing: '' };
    $('[data-listing]', view).value = '';
    qInput.value = ''; $('[data-from]', view).value = ''; $('[data-to]', view).value = '';
    $$('input', typesBox).forEach((i) => { i.checked = false; });
    drawChips(); typesCount();
    load();
  });
  // On a phone the panel starts folded away so the map gets the screen; these open its parts.
  const panelEl = $('.panel', view);
  const isPhone = () => window.matchMedia('(max-width: 860px)').matches;
  $('[data-toggle-panel]', view).addEventListener('click', () => {
    panelEl.classList.toggle('show-filters');
    $('[data-toggle-panel]', view).classList.toggle('primary', panelEl.classList.contains('show-filters'));
  });
  $('[data-toggle-list]', view).addEventListener('click', () => {
    panelEl.classList.toggle('show-list');
    $('[data-toggle-list]', view).classList.toggle('primary', panelEl.classList.contains('show-list'));
  });
  const foldPanel = () => {
    if (!isPhone()) return;
    panelEl.classList.remove('show-list', 'show-filters');
    $('[data-toggle-list]', view).classList.remove('primary');
    $('[data-toggle-panel]', view).classList.remove('primary');
  };

  /* --------------------------------------------------------------- data */

  let loadSeq = 0;
  let centredOnCity = false;
  async function load({ keepView = true } = {}) {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(state.filters)); } catch { /* blocked */ }
    const seq = ++loadSeq;
    $('[data-count]', view).textContent = 'Loading…';
    try {
      const data = await get('/mediums', state.filters);
      if (seq !== loadSeq) return;
      state.mediums = data.mediums;
      state.facets = data.facets;
      state.capped = data.capped ? data.total : 0;
      for (const m of state.mediums) m.abbr = typeInfo(m.type).abbr;
      drawFacets();
      drawList();
      drawMarkers();
      if (!state.fitted || !keepView) { state.fitted = fitTo(map, state.mediums) || state.fitted; }
      // A brand-new company has nothing to fit to: start over its own city.
      if (!state.fitted && !state.mediums.length && store.company?.city && !centredOnCity) {
        centredOnCity = true;
        get('/geocode/search', { q: store.company.city })
          .then(({ results }) => { if (results[0] && !state.mediums.length && isLive(map)) map.setView([results[0].lat, results[0].lng], 12); })
          .catch(() => { /* stay on the default view */ });
      }
    } catch (err) {
      toastError(err);
      $('[data-count]', view).textContent = 'Could not load';
    }
  }

  /* ---------------------------------------------------------------- list */

  const listEl = $('[data-list]', view);
  function cardHtml(m) {
    const t = typeInfo(m.type);
    const sub = m.booking
      ? esc(m.booking.client_name) + ' · till ' + fdate(m.booking.end_date)
      : m.available_from ? 'Free from ' + fdate(m.available_from) : esc(t.label);
    return '<div class="mcard' + (state.activeId === m.id ? ' active' : '') + (state.selected.has(m.id) ? ' selected' : '') + '" data-id="' + m.id + '">' +
      '<div class="thumb" style="' + (m.photo_url ? 'background-image:url(' + esc(m.photo_url) + ')' : '') + '">' + (m.photo_url ? '' : esc(t.abbr)) + '</div>' +
      '<div class="grow"><div class="row"><span class="t ellipsis grow">' + esc(m.code) + ' · ' + esc(m.title) + '</span></div>' +
      '<div class="meta">' + esc(sizeText(m, { area: false })) + ' · ' + esc(m.area || m.city || '') + '</div>' +
      '<div class="row" style="margin-top:5px">' + pill(m.status) + '<span class="meta ellipsis">' + sub + '</span>' +
      (m.open_issues ? '<span class="pill warn" title="Open problem reports">' + icon('alert') + m.open_issues + '</span>' : '') +
      (m.is_public ? '<span class="pill info" title="Listed on the public marketplace">' + icon('globe') + '</span>' : '') + '</div></div>' +
      (state.selectMode ? '<input type="checkbox" class="sel"' + (state.selected.has(m.id) ? ' checked' : '') + ' aria-label="Select">' : '') +
      '</div>';
  }
  let revealCard = () => {};
  function drawList() {
    const n = state.mediums.length;
    const booked = state.mediums.filter((m) => m.status === 'booked').length;
    $('[data-list-count]', view).textContent = 'List · ' + n;
    $('[data-count]', view).textContent = n + (n === 1 ? ' medium' : ' media') + ' · ' + booked + ' booked' +
      (state.filters.from ? ' (' + fdate(state.filters.from) + (state.filters.to && state.filters.to !== state.filters.from ? ' – ' + fdate(state.filters.to) : '') + ')' : '');
    // A very large inventory is sent in part: say so, and how to see the rest.
    if (state.capped) $('[data-count]', view).textContent = 'First ' + n + ' of ' + state.capped + ' media - filter by city, area or type to see the rest';
    revealCard = paged(listEl, state.mediums, cardHtml, {
      step: 150,
      empty: '<div class="empty">' + (Object.values(state.filters).some((v) => (Array.isArray(v) ? v.length : v))
        ? 'Nothing matches these filters.' : (can('manager') ? 'No media yet. Click <b>Add new</b> and pin your first hoarding on the map.' : 'No media yet.')) + '</div>',
    });
  }
  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('.mcard');
    if (!card) return;
    const id = Number(card.dataset.id);
    if (state.selectMode) { toggleSelect(id); return; }
    focus(id, { pan: true });
  });

  /* ------------------------------------------------------------- markers */

  function drawMarkers() {
    cluster.clearLayers();
    state.markers.clear();
    for (const m of state.mediums) {
      const mk = L.marker([m.lat, m.lng], {
        icon: pinIcon(m, { selected: state.selected.has(m.id), active: state.activeId === m.id, flag: m.open_issues > 0 }),
        title: m.code + ' · ' + m.title,
        riseOnHover: true,
      });
      mk.on('click', (ev) => {
        if (state.selectMode || ev.originalEvent?.shiftKey || ev.originalEvent?.ctrlKey || ev.originalEvent?.metaKey) toggleSelect(m.id);
        else focus(m.id);
      });
      mk.bindTooltip('<b>' + esc(m.code) + '</b> ' + esc(m.title) + '<br>' + esc(STATUS[m.status]?.label || m.status) +
        (m.booking ? ' · ' + esc(m.booking.client_name) + ' till ' + fdate(m.booking.end_date) : ''), { direction: 'top', offset: [0, -28] });
      state.markers.set(m.id, mk);
      cluster.addLayer(mk);
    }
  }
  function refreshMarker(id) {
    const m = state.mediums.find((x) => x.id === id);
    const mk = state.markers.get(id);
    if (m && mk) mk.setIcon(pinIcon(m, { selected: state.selected.has(id), active: state.activeId === id, flag: m.open_issues > 0 }));
  }

  /* ----------------------------------------------------------- selection */

  function toggleSelect(id) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    refreshMarker(id);
    const card = $('.mcard[data-id="' + id + '"]', listEl);
    if (card) card.outerHTML = cardHtml(state.mediums.find((m) => m.id === id));
    drawBar();
  }
  const barHost = $('[data-bar-host]', view);
  function drawBar() {
    barHost.innerHTML = '';
    if (!state.selected.size && !state.selectMode) return;
    const bar = el('<div class="selection-bar"><span><b>' + state.selected.size + '</b> selected</span>' +
      '<button class="btn sm" data-all>Select all shown</button>' +
      (can('manager') ? '<button class="btn sm primary" data-book' + (state.selected.size ? '' : ' disabled') + '>' + icon('calendar') + ' Book</button>' +
        '<button class="btn sm primary" data-share' + (state.selected.size ? '' : ' disabled') + '>' + icon('share') + ' Share</button>' +
        '<button class="btn sm" data-pub="1"' + (state.selected.size ? '' : ' disabled') + ' title="List on the public marketplace">' + icon('globe') + ' List</button>' +
        '<button class="btn sm" data-pub="0"' + (state.selected.size ? '' : ' disabled') + ' title="Remove from the public marketplace">Unlist</button>' : '') +
      '<button class="btn sm" data-done>' + (state.selected.size ? 'Clear' : 'Done') + '</button></div>');
    $('[data-all]', bar).addEventListener('click', () => { state.mediums.forEach((m) => state.selected.add(m.id)); drawList(); drawMarkers(); drawBar(); });
    $('[data-done]', bar).addEventListener('click', () => { setSelectMode(false); state.selected.clear(); drawList(); drawMarkers(); drawBar(); });
    $('[data-book]', bar)?.addEventListener('click', () => {
      openBookingModal({ mediums: state.mediums.filter((m) => state.selected.has(m.id)), range: state.filters, onSaved: () => { state.selected.clear(); setSelectMode(false); load(); } });
    });
    $('[data-share]', bar)?.addEventListener('click', () => openShareModal({ mode: 'selection', ids: [...state.selected] }));
    $$('[data-pub]', bar).forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.pub === '1';
      try {
        const r = await post('/mediums/publish', { ids: [...state.selected], is_public: on });
        toast(r.updated + (on ? ' listed on the public marketplace' : ' removed from the marketplace'), 'ok');
        load();
      } catch (err) { toastError(err); }
    }));
    barHost.append(bar);
  }
  function setSelectMode(on) {
    state.selectMode = on;
    $('[data-select-mode]', view).classList.toggle('primary', on);
    drawList();
    drawBar();
  }
  $('[data-select-mode]', view).addEventListener('click', () => setSelectMode(!state.selectMode));

  /* -------------------------------------------------------------- drawer */

  const drawerHost = $('[data-drawer-host]', view);
  let pick = null; // { marker, onMove }

  function closeDrawer() {
    drawerHost.innerHTML = '';
    stopPick();
    const prev = state.activeId;
    state.activeId = null;
    if (prev) { refreshMarker(prev); $('.mcard.active', listEl)?.classList.remove('active'); }
  }

  function focus(id, { pan = false } = {}) {
    foldPanel(); // on a phone, get the list out of the way of the map and the details sheet
    const prev = state.activeId;
    state.activeId = id;
    if (prev) refreshMarker(prev);
    refreshMarker(id);
    $$('.mcard.active', listEl).forEach((c) => c.classList.remove('active'));
    revealCard(state.mediums.findIndex((x) => x.id === id)); // a pin clicked far down a long list
    const card = $('.mcard[data-id="' + id + '"]', listEl);
    card?.classList.add('active');
    card?.scrollIntoView({ block: 'nearest' });
    const m = state.mediums.find((x) => x.id === id);
    if (m && pan) {
      const mk = state.markers.get(id);
      if (mk && cluster.zoomToShowLayer) cluster.zoomToShowLayer(mk, () => map.panTo([m.lat, m.lng]));
      else map.setView([m.lat, m.lng], Math.max(map.getZoom(), 16));
    }
    openDetail(ctx, id);
  }

  /** Drop / drag a pin to choose a location. onMove(lat, lng) fires on every change. */
  function startPick(latlng, onMove) {
    stopPick();
    const bannerEl = el('<div class="pick-banner">' + icon('map') + '<span>Click the map where it stands, or drag the pin. Switch to <b>Satellite</b> (top right) to spot the exact structure.</span></div>');
    $('.mapwrap', view).append(bannerEl);
    const marker = latlng ? L.marker(latlng, { draggable: true, icon: newPinIcon(), zIndexOffset: 1000 }).addTo(map) : null;
    pick = { marker, onMove, bannerEl };
    if (marker) marker.on('dragend', () => { const p = marker.getLatLng(); onMove(p.lat, p.lng); });
    map.getContainer().style.cursor = 'crosshair';
  }
  function setPick(lat, lng, { pan = true } = {}) {
    if (!pick) return;
    if (!pick.marker) {
      pick.marker = L.marker([lat, lng], { draggable: true, icon: newPinIcon(), zIndexOffset: 1000 }).addTo(map);
      pick.marker.on('dragend', () => { const p = pick.marker.getLatLng(); pick.onMove(p.lat, p.lng); });
    } else pick.marker.setLatLng([lat, lng]);
    if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 17));
  }
  function stopPick() {
    if (!pick) return;
    pick.marker?.remove();
    pick.bannerEl?.remove();
    pick = null;
    map.getContainer().style.cursor = '';
  }
  map.on('click', (e) => {
    if (!pick) return;
    setPick(e.latlng.lat, e.latlng.lng, { pan: false });
    pick.onMove(e.latlng.lat, e.latlng.lng);
  });

  const ctx = {
    map,
    drawerHost,
    closeDrawer,
    startPick,
    setPick,
    stopPick,
    focus,
    reload: (opts) => load(opts),
    medium: (id) => state.mediums.find((m) => m.id === id),
    center: () => map.getCenter(),
    zoom: () => map.getZoom(),
    range: () => state.filters,
    afterSave: async (id) => { await load(); if (id) focus(id, { pan: true }); },
  };

  /* --------------------------------------------------------------- tools */

  $('[data-add]', view)?.addEventListener('click', async () => {
    const type = await chooseType();
    if (!type) return;
    closeDrawer();
    openForm(ctx, { type });
  });
  $('[data-fit]', view).addEventListener('click', () => {
    if (!fitTo(map, state.mediums)) toast(state.mediums.length ? 'Nothing to fit' : 'No media match the current filters');
  });
  $('[data-locate]', view).addEventListener('click', () => {
    if (!navigator.geolocation) return toastError(new Error('This browser cannot share its location'));
    navigator.geolocation.getCurrentPosition(
      (p) => { map.setView([p.coords.latitude, p.coords.longitude], 17); if (pick) { setPick(p.coords.latitude, p.coords.longitude); pick.onMove(p.coords.latitude, p.coords.longitude); } },
      () => toastError(new Error('Location permission was denied')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
  $('[data-share-view]', view)?.addEventListener('click', () => openShareModal({ mode: 'filter', filters: state.filters }));

  await load();

  // Deep links: /map?open=12 opens a medium, /map?select=1,2,3 preselects,
  // ?add=1 starts "Add new". Used once: a refresh or Back must not redo them.
  if (query.open || query.select || query.add) history.replaceState({}, '', '/map');
  if (query.open) focus(Number(query.open), { pan: true });
  if (query.select) {
    const shown = new Set(state.mediums.map((m) => m.id));
    query.select.split(',').map(Number).filter((id) => shown.has(id)).forEach((id) => state.selected.add(id));
    setSelectMode(true);
    drawMarkers();
  }
  if (query.add && can('manager')) {
    const type = await chooseType();
    if (type) openForm(ctx, { type });
  }

  return () => { ro.disconnect(); destroyMap(map); };
}
