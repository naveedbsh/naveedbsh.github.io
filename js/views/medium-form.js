// Add / edit a medium. Location is chosen by dropping a pin on the main map
// (or searching an address, or GPS), and the address fields are filled in
// from OpenStreetMap when they are still empty.
import { get, post, patch, upload } from '../api.js';
import {
  store, $, $$, el, esc, modal, options, typeInfo, formData, toast, toastError, busy,
} from '../ui.js';
import { icon } from '../icons.js';

/** Modal grid of every medium type, grouped. Resolves to a type key or null. */
export function chooseType() {
  return new Promise((resolve) => {
    let chosen = null;
    const groups = {};
    for (const t of store.meta.types) (groups[t.group] ||= []).push(t);
    const body = '<div class="type-picker">' + Object.entries(groups).map(([g, list]) =>
      '<div class="grp">' + esc(g) + '</div><div class="type-grid">' + list.map((t) =>
        '<button type="button" class="type-opt" data-type="' + t.key + '"><span class="ab">' + esc(t.abbr) + '</span><span><b>' + esc(t.label) + '</b><small>' + esc(t.hint || '') + '</small></span></button>'
      ).join('') + '</div>').join('') + '</div>';
    const m = modal({ title: 'What are you adding?', body, foot: null, size: 'wide', onClose: () => resolve(chosen) });
    m.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      chosen = b.dataset.type;
      m.close();
    });
  });
}

const num = (v) => (v === null || v === undefined ? '' : v);

/** Sends photos 8 at a time (the server's limit per request), so picking a dozen just works. */
export async function uploadPhotos(mediumId, files) {
  for (let i = 0; i < files.length; i += 8) {
    const fd = new FormData();
    files.slice(i, i + 8).forEach((f) => fd.append('photos', f));
    await upload('/mediums/' + mediumId + '/photos', fd);
  }
}

export function openForm(ctx, { medium = null, type = null }) {
  const editing = !!medium;
  const m = medium || { type, unit: 'ft', faces: 1, quantity: 1, illumination: typeInfo(type).digital ? 'digital' : 'non_lit', condition_status: 'active' };
  const t = () => typeInfo(form.type.value);

  const drawer = el(`
    <div class="drawer">
      <div class="drawer-head">
        <div class="grow"><div class="small faint">${editing ? 'Edit ' + esc(m.code) : 'New medium'}</div><h2 data-title>${esc(editing ? m.title : typeInfo(m.type).label)}</h2></div>
        <button class="btn ghost icon" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <form class="drawer-body" novalidate autocomplete="off">
        <div class="form-section" style="margin-top:0">Location</div>
        <div class="search" style="position:relative">
          <input type="search" placeholder="Search an address or place to jump there…" data-geo-q>
          <div class="card hidden" data-geo-results style="position:absolute;left:0;right:0;top:42px;z-index:10;max-height:240px;overflow:auto"></div>
        </div>
        <div class="grid-2 mt">
          <label class="field"><span>Latitude *</span><input type="number" step="any" name="lat" value="${num(m.lat)}" required></label>
          <label class="field"><span>Longitude *</span><input type="number" step="any" name="lng" value="${num(m.lng)}" required></label>
        </div>
        <div class="hint">Click the map to drop the pin, then drag it to the exact spot. Satellite view helps for building hoardings.</div>
        <div class="row mt"><button type="button" class="btn sm" data-gps>${icon('locate')} Use my current location</button><span class="grow"></span><span class="small faint" data-geo-status></span></div>

        <div class="form-section">Details</div>
        <label class="field"><span>Type *</span><select name="type">${options(store.meta.types, m.type)}</select></label>
        <label class="field mt"><span>Title *</span><input type="text" name="title" maxlength="160" value="${esc(m.title || '')}" placeholder="e.g. Unipole at Punjagutta flyover" required></label>
        <div class="grid-2 mt">
          <label class="field"><span>Code</span><input type="text" name="code" maxlength="40" value="${esc(m.code || '')}" placeholder="Auto: ${esc(typeInfo(m.type).abbr)}-0001"></label>
          <label class="field"><span>Condition</span><select name="condition_status">${options(store.meta.conditions, m.condition_status)}</select></label>
        </div>
        <label class="check mt card card-pad" style="box-shadow:none;align-items:flex-start;display:flex;background:var(--brand-soft);border-color:#c9d4ff">
          <input type="checkbox" name="is_public" ${m.is_public ? 'checked' : ''} style="margin-top:2px">
          <span><b>List on the public marketplace</b><br><span class="small muted">Anyone can find it on the HoardHub website, see size, rate and whether it is free, and send you an enquiry with their artwork. Client names and payments are never shown.</span></span>
        </label>
        <label class="field mt"><span>Address</span><input type="text" name="address" maxlength="255" value="${esc(m.address || '')}"></label>
        <div class="grid-3 mt">
          <label class="field"><span>Area</span><input type="text" name="area" maxlength="120" value="${esc(m.area || '')}"></label>
          <label class="field"><span>City</span><input type="text" name="city" maxlength="120" value="${esc(m.city || '')}"></label>
          <label class="field"><span>Landmark</span><input type="text" name="landmark" maxlength="160" value="${esc(m.landmark || '')}"></label>
        </div>

        <div class="form-section">Measurements</div>
        <div class="grid-3">
          <label class="field"><span>Width</span><input type="number" step="0.01" min="0" name="width" value="${num(m.width)}"></label>
          <label class="field"><span>Height</span><input type="number" step="0.01" min="0" name="height" value="${num(m.height)}"></label>
          <label class="field"><span>Unit</span><select name="unit">${options(store.meta.units, m.unit)}</select></label>
        </div>
        <div class="grid-3 mt">
          <label class="field"><span>Faces / sides</span><input type="number" min="1" max="20" name="faces" value="${num(m.faces)}"></label>
          <label class="field"><span data-qty-label>Units</span><input type="number" min="1" max="10000" name="quantity" value="${num(m.quantity)}"></label>
          <label class="field"><span>Height from ground (ft)</span><input type="number" step="0.1" min="0" name="elevation_ft" value="${num(m.elevation_ft)}"></label>
        </div>
        <div class="hint" data-area-hint></div>
        <div class="grid-2 mt">
          <label class="field"><span>Illumination</span><select name="illumination">${options(store.meta.illumination, m.illumination)}</select></label>
          <label class="field"><span>Facing / traffic direction</span><input type="text" name="facing" maxlength="80" value="${esc(m.facing || '')}" placeholder="e.g. Towards airport"></label>
        </div>
        <div data-digital>
          <div class="form-section">Screen</div>
          <div class="grid-3">
            <label class="field"><span>Resolution</span><input type="text" name="resolution" maxlength="40" value="${esc(m.resolution || '')}" placeholder="1920x1080"></label>
            <label class="field"><span>Slot length (s)</span><input type="number" min="1" name="slot_seconds" value="${num(m.slot_seconds)}"></label>
            <label class="field"><span>Slots per loop</span><input type="number" min="1" name="loop_slots" value="${num(m.loop_slots)}"></label>
          </div>
          <label class="field mt"><span>Operating hours</span><input type="text" name="operating_hours" maxlength="60" value="${esc(m.operating_hours || '')}" placeholder="6 AM – 11 PM"></label>
        </div>

        <div class="form-section">Pricing</div>
        <div class="grid-2">
          <label class="field"><span>Rate per month</span><input type="number" step="0.01" min="0" name="rate_month" value="${num(m.rate_month)}"></label>
          <label class="field"><span>Minimum booking (days)</span><input type="number" min="1" name="min_days" value="${num(m.min_days)}"></label>
          <label class="field"><span>Printing cost</span><input type="number" step="0.01" min="0" name="printing_cost" value="${num(m.printing_cost)}"></label>
          <label class="field"><span>Mounting cost</span><input type="number" step="0.01" min="0" name="mounting_cost" value="${num(m.mounting_cost)}"></label>
          <label class="field"><span>Running cost per month <span class="faint">(internal)</span></span><input type="number" step="0.01" min="0" name="cost_month" value="${num(m.cost_month)}" placeholder="Site rent + power + tax"></label>
        </div>
        <div class="hint">The running cost is never shown to customers. It feeds Profit &amp; loss, so you can see what each site really earns.</div>

        <div class="form-section">More</div>
        <label class="field"><span>Traffic / visibility note</span><input type="text" name="traffic_note" maxlength="255" value="${esc(m.traffic_note || '')}" placeholder="e.g. 90-second signal halt, 1 lakh vehicles/day"></label>
        <div class="grid-2 mt">
          <label class="field"><span>Permit / licence no.</span><input type="text" name="permit_no" maxlength="80" value="${esc(m.permit_no || '')}"></label>
          <label class="field"><span>Permit expiry</span><input type="date" name="permit_expiry" value="${esc(m.permit_expiry || '')}"></label>
        </div>
        <label class="field mt"><span>Description</span><textarea name="description" maxlength="5000">${esc(m.description || '')}</textarea></label>
        ${editing ? '' : '<label class="field mt"><span>Photos</span><input type="file" name="photos" accept="image/*" multiple></label><div class="hint">You can add more photos later from the details panel.</div>'}
        <div class="error-text mt hidden" data-err></div>
      </form>
      <div class="drawer-foot">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" data-save>${editing ? 'Save changes' : 'Save medium'}</button>
      </div>
    </div>`);

  const form = $('form', drawer);
  ctx.drawerHost.innerHTML = '';
  ctx.drawerHost.append(drawer);

  /* ------------------------------------------------ type-dependent bits */
  function syncType() {
    const info = t();
    $('[data-digital]', drawer).classList.toggle('hidden', !info.digital);
    $('[data-qty-label]', drawer).textContent = form.type.value === 'pole_board' ? 'Poles in this set' : 'Units';
    $('[data-title]', drawer).textContent = form.title.value || info.label;
    form.code.placeholder = 'Auto: ' + info.abbr + '-0001';
    if (info.digital && !editing && form.illumination.value === 'non_lit') form.illumination.value = 'digital';
  }
  function syncArea() {
    const w = parseFloat(form.width.value); const h = parseFloat(form.height.value);
    const f = parseInt(form.faces.value, 10) || 1; const q = parseInt(form.quantity.value, 10) || 1;
    $('[data-area-hint]', drawer).textContent = w && h
      ? 'Area: ' + +(w * h).toFixed(2) + ' sq ' + form.unit.value + ' per face' + (f * q > 1 ? ' · ' + +(w * h * f * q).toFixed(2) + ' sq ' + form.unit.value + ' in total' : '')
      : '';
  }
  form.type.addEventListener('change', syncType);
  form.title.addEventListener('input', () => { $('[data-title]', drawer).textContent = form.title.value || t().label; });
  ['width', 'height', 'faces', 'quantity', 'unit'].forEach((k) => form[k].addEventListener('input', syncArea));
  syncType(); syncArea();

  /* ----------------------------------------------------------- location */
  const status = $('[data-geo-status]', drawer);
  let reverseTimer;
  function onMove(lat, lng, { fromInputs = false } = {}) {
    if (!fromInputs) { form.lat.value = lat.toFixed(7); form.lng.value = lng.toFixed(7); }
    clearTimeout(reverseTimer);
    // Only fill what is empty - never overwrite what the user typed.
    if (form.area.value && form.city.value && form.address.value) return;
    reverseTimer = setTimeout(async () => {
      status.textContent = 'Looking up address…';
      try {
        const a = await get('/geocode/reverse', { lat, lng });
        if (!form.address.value && a.name) form.address.value = a.name.split(',').slice(0, 3).join(',').trim();
        if (!form.area.value && a.area) form.area.value = a.area;
        if (!form.city.value && a.city) form.city.value = a.city;
        status.textContent = '';
      } catch { status.textContent = ''; }
    }, 600);
  }
  const hasLoc = Number.isFinite(parseFloat(m.lat));
  ctx.startPick(hasLoc ? [m.lat, m.lng] : null, (lat, lng) => onMove(lat, lng));
  if (hasLoc) ctx.map.setView([m.lat, m.lng], Math.max(ctx.zoom(), 17));

  const fromInputs = () => {
    const lat = parseFloat(form.lat.value); const lng = parseFloat(form.lng.value);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      ctx.setPick(lat, lng);
      onMove(lat, lng, { fromInputs: true });
    }
  };
  form.lat.addEventListener('change', fromInputs);
  form.lng.addEventListener('change', fromInputs);

  $('[data-gps]', drawer).addEventListener('click', () => {
    if (!navigator.geolocation) return toastError(new Error('This browser cannot share its location'));
    status.textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition((p) => {
      status.textContent = 'Accuracy ±' + Math.round(p.coords.accuracy) + ' m';
      ctx.setPick(p.coords.latitude, p.coords.longitude);
      onMove(p.coords.latitude, p.coords.longitude);
    }, () => { status.textContent = ''; toastError(new Error('Location permission was denied')); }, { enableHighAccuracy: true, timeout: 15000 });
  });

  const geoQ = $('[data-geo-q]', drawer);
  const geoBox = $('[data-geo-results]', drawer);
  let geoTimer;
  geoQ.addEventListener('input', () => {
    clearTimeout(geoTimer);
    const q = geoQ.value.trim();
    if (q.length < 3) { geoBox.classList.add('hidden'); return; }
    geoTimer = setTimeout(async () => {
      try {
        const c = ctx.center();
        const { results } = await get('/geocode/search', { q, near: c.lat + ',' + c.lng });
        geoBox.innerHTML = results.length ? results.map((r, i) => '<div class="list-rows"><div style="cursor:pointer" data-geo="' + i + '"><span class="small">' + esc(r.name) + '</span></div></div>').join('')
          : '<div class="empty small">No matches</div>';
        geoBox.classList.remove('hidden');
        $$('[data-geo]', geoBox).forEach((row) => row.addEventListener('click', () => {
          const r = results[Number(row.dataset.geo)];
          ctx.setPick(r.lat, r.lng);
          onMove(r.lat, r.lng);
          if (!form.area.value && r.area) form.area.value = r.area;
          if (!form.city.value && r.city) form.city.value = r.city;
          geoBox.classList.add('hidden');
          geoQ.value = '';
        }));
      } catch (err) { toastError(err); }
    }, 450);
  });

  /* --------------------------------------------------------------- save */
  const close = () => { ctx.stopPick(); ctx.drawerHost.innerHTML = ''; };
  $$('[data-close]', drawer).forEach((b) => b.addEventListener('click', () => {
    close();
    if (editing) ctx.focus(m.id);
  }));

  $('[data-save]', drawer).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const err = $('[data-err]', drawer);
    err.classList.add('hidden');
    const data = formData(form);
    if (!data.lat || !data.lng) {
      err.textContent = 'Drop a pin on the map to set the location.';
      err.classList.remove('hidden');
      return;
    }
    if (!data.title) {
      err.textContent = 'Give it a title.';
      err.classList.remove('hidden');
      form.title.focus();
      return;
    }
    if (!t().digital) { data.resolution = ''; data.slot_seconds = ''; data.loop_slots = ''; data.operating_hours = ''; }
    try {
      let id = m.id;
      if (editing) {
        await patch('/mediums/' + m.id, data);
      } else {
        const r = await post('/mediums', data);
        id = r.id;
        const files = form.photos?.files ? [...form.photos.files] : [];
        if (files.length) {
          try { await uploadPhotos(id, files); } catch (upErr) { toastError(upErr); }
        }
      }
      toast(editing ? 'Saved' : 'Added to the map', 'ok');
      close();
      ctx.afterSave(id);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  }));
}
