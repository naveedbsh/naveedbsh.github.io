// Create / edit a share link - either "these filters" (stays up to date as
// inventory changes) or "these exact media".
import { post, patch } from '../api.js';
import {
  store, $, $$, el, esc, modal, toast, busy, copyText, waLink, STATUS, todayISO,
} from '../ui.js';
import { icon } from '../icons.js';

function describeFilters(f = {}) {
  const parts = [];
  if (f.types?.length) parts.push(f.types.map((t) => store.meta.types.find((x) => x.key === t)?.label || t).join(', '));
  if (f.cities?.length) parts.push(f.cities.join(', '));
  if (f.areas?.length) parts.push(f.areas.join(', '));
  if (f.statuses?.length) parts.push(f.statuses.map((s) => STATUS[s]?.label || s).join(' / '));
  if (f.q) parts.push('"' + f.q + '"');
  return parts.length ? parts.join(' · ') : 'All media';
}

/** After creating: the link with copy / WhatsApp / open buttons. */
function showShareLink(share) {
  const text = share.title + '\n' + (share.message ? share.message + '\n' : '') + share.url;
  const box = modal({
    title: 'Link ready', size: 'narrow',
    body: `<p class="muted">Send this to your customer or vendor. They can see the media on a map, check availability${share.show_price ? ', see prices' : ''} and ${share.allow_requests ? 'request a booking' : 'browse'} without logging in.</p>
      <div class="row mt"><input type="text" readonly value="${esc(share.url)}" data-url></div>
      <div class="row wrap mt">
        <button class="btn primary" data-copy>${icon('copy')} Copy link</button>
        <a class="btn wa" href="${esc(waLink(text))}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
        <a class="btn" href="mailto:?subject=${encodeURIComponent(share.title)}&body=${encodeURIComponent(text)}">Email</a>
        <a class="btn" href="${esc(share.url)}" target="_blank" rel="noopener">${icon('external')} Open</a>
      </div>`,
    foot: '<button class="btn" data-close>Done</button>',
  });
  $('[data-copy]', box.el).addEventListener('click', () => copyText(share.url));
  $('[data-url]', box.el).addEventListener('focus', (e) => e.target.select());
}

/**
 * openShareModal({ mode, filters, ids, title, share, onSaved })
 *   share  existing link to edit
 */
export function openShareModal({ mode = 'filter', filters = {}, ids = [], title = '', share = null, onSaved } = {}) {
  const editing = !!share;
  const f = share ? share.filters : filters;
  const theMode = share ? share.mode : mode;
  const theIds = share ? share.medium_ids : ids;
  const flags = share || { show_price: true, show_booked: true, allow_requests: true, allow_reports: false };
  const statuses = f.statuses || [];

  const body = el(`
    <form novalidate>
      <label class="field"><span>Title *</span><input type="text" name="title" maxlength="160" value="${esc(share?.title || title || (theMode === 'selection' ? theIds.length + ' selected media' : describeFilters(f)))}"></label>
      <label class="field mt"><span>Message to the customer</span><textarea name="message" maxlength="3000" placeholder="e.g. Diwali availability for Hyderabad. Select the ones you like and send a request.">${esc(share?.message || '')}</textarea></label>
      <div class="card card-pad mt" style="box-shadow:none;background:var(--surface-2)">
        <div class="small muted">What they will see</div>
        <div style="margin-top:4px"><b>${theMode === 'selection' ? theIds.length + ' hand-picked media' : esc(describeFilters(f))}</b></div>
        <div class="small faint" style="margin-top:2px">${theMode === 'selection' ? 'Exactly these media, even if others are added later.' : 'Based on these filters, so new media that match appear automatically.'} Inactive media are never shown.</div>
        ${theMode === 'filter' ? `<div class="field-label mt">Status shown</div><div class="row wrap">
          <label class="check"><input type="radio" name="st" value="all" ${statuses.length ? '' : 'checked'}> Everything (with availability)</label>
          <label class="check"><input type="radio" name="st" value="available" ${statuses.length === 1 && statuses[0] === 'available' ? 'checked' : ''}> Only available today</label>
        </div>` : ''}
      </div>
      <div class="form-section">Options</div>
      <div class="stack">
        <label class="check"><input type="checkbox" name="show_price" ${flags.show_price ? 'checked' : ''}> Show monthly rates</label>
        <label class="check"><input type="checkbox" name="show_booked" ${flags.show_booked ? 'checked' : ''}> Show booked media too (with the date they become free)</label>
        <label class="check"><input type="checkbox" name="allow_requests" ${flags.allow_requests ? 'checked' : ''}> Let them select media and send a booking request</label>
        <label class="check"><input type="checkbox" name="allow_reports" ${flags.allow_reports ? 'checked' : ''}> Let them report problems (e.g. lights off) on a medium</label>
      </div>
      <div class="grid-2 mt">
        <label class="field"><span>Expires on</span><input type="date" name="expires_at" min="${todayISO()}" value="${esc(share?.expires_at || '')}"></label>
        ${editing ? '<label class="field"><span>Status</span><select name="active"><option value="1"' + (share.active ? ' selected' : '') + '>Active</option><option value="0"' + (share.active ? '' : ' selected') + '>Switched off</option></select></label>' : ''}
      </div>
      <div class="error-text mt hidden" data-err></div>
    </form>`);

  const m = modal({
    title: editing ? 'Edit share link' : 'Share with a customer', body,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>' + (editing ? 'Save' : 'Create link') + '</button>',
  });

  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const err = $('[data-err]', body);
    err.classList.add('hidden');
    const payload = {
      title: body.title.value,
      message: body.message.value,
      show_price: body.show_price.checked,
      show_booked: body.show_booked.checked,
      allow_requests: body.allow_requests.checked,
      allow_reports: body.allow_reports.checked,
      expires_at: body.expires_at.value,
    };
    if (editing) payload.active = body.active.value === '1';
    if (theMode === 'filter') {
      const st = $$('input[name=st]', body).find((r) => r.checked)?.value;
      payload.filters = { ...f, statuses: st === 'available' ? ['available'] : [] };
      // Date ranges are chosen by the customer on the shared page, not saved in the link.
      delete payload.filters.from; delete payload.filters.to;
    }
    if (!editing) { payload.mode = theMode; if (theMode === 'selection') payload.medium_ids = theIds; }
    try {
      if (editing) {
        await patch('/shares/' + share.id, payload);
        toast('Saved', 'ok');
        m.close();
      } else {
        const r = await post('/shares', payload);
        m.close();
        showShareLink(r.share);
      }
      onSaved?.();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  }));
}

export { describeFilters };
