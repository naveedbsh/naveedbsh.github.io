// Share links sent to customers and vendors.
import { get, patch, del } from '../api.js';
import {
  $, esc, fdate, ago, toast, toastError, copyText, waLink, confirmDialog, todayISO,
} from '../ui.js';
import { icon } from '../icons.js';
import { can } from '../app.js';
import { openShareModal, describeFilters } from './share-form.js';

export async function render(root) {
  root.innerHTML = `
    <div class="page-head"><h1>Share links</h1>
      ${can('manager') ? '<button class="btn primary" data-new>' + icon('plus') + ' New link</button>' : ''}
    </div>
    <p class="muted" style="margin:-8px 0 16px">Send a map of your media to a customer or vendor. They see size and availability, pick what they want on the map, and send the request back to you. Tip: filter the <a href="/map" data-link>map</a> first, or select media there, then press <b>Share</b>.</p>
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Link</th><th>Shows</th><th>Options</th><th class="right">Views</th><th class="right">Requests</th><th>Expires</th><th></th></tr></thead>
    <tbody data-body><tr><td colspan="7" class="empty">Loading…</td></tr></tbody></table></div></div>`;
  const body = $('[data-body]', root);
  let shares = [];

  async function load() {
    ({ shares } = await get('/shares'));
    body.innerHTML = shares.length ? shares.map((s) => {
      const expired = s.expires_at && s.expires_at < todayISO(); // local date: UTC is still "yesterday" until 05:30 IST
      const live = s.active && !expired;
      return `<tr data-id="${s.id}">
        <td><b>${esc(s.title)}</b> ${live ? '' : '<span class="pill bad">' + (expired ? 'Expired' : 'Off') + '</span>'}
          <div class="small faint">${esc(s.created_by_name || '')} · ${ago(s.created_at)}</div></td>
        <td class="small">${s.mode === 'selection' ? s.medium_ids.length + ' selected media' : esc(describeFilters(s.filters))}</td>
        <td class="small">${[s.show_price ? 'Prices' : '', s.show_booked ? 'Booked shown' : 'Available only', s.allow_requests ? 'Requests' : '', s.allow_reports ? 'Reports' : ''].filter(Boolean).join(' · ')}</td>
        <td class="right num">${s.views}${s.last_viewed_at ? '<div class="small faint">' + ago(s.last_viewed_at) + '</div>' : ''}</td>
        <td class="right num">${s.requests ? '<a href="/requests" data-link>' + s.requests + '</a>' : 0}</td>
        <td class="small nowrap">${s.expires_at ? fdate(s.expires_at) : 'Never'}</td>
        <td class="nowrap">
          <button class="btn sm icon" data-copy title="Copy link">${icon('copy')}</button>
          <a class="btn sm icon wa" href="${esc(waLink(s.title + '\n' + s.url))}" target="_blank" rel="noopener" title="Send on WhatsApp">${icon('whatsapp')}</a>
          <a class="btn sm icon" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open">${icon('external')}</a>
          ${can('manager') ? '<button class="btn sm icon" data-edit title="Edit">' + icon('edit') + '</button><button class="btn sm" data-toggle>' + (s.active ? 'Switch off' : 'Switch on') + '</button><button class="btn sm icon danger" data-del title="Delete">' + icon('trash') + '</button>' : ''}
        </td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">No links yet.</td></tr>';
  }

  body.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const s = shares.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-copy]')) copyText(s.url);
    else if (e.target.closest('[data-edit]')) openShareModal({ share: s, onSaved: load });
    else if (e.target.closest('[data-toggle]')) {
      try { await patch('/shares/' + s.id, { active: !s.active }); toast(s.active ? 'Link switched off' : 'Link is live again', 'ok'); load(); } catch (err) { toastError(err); }
    } else if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog('Delete "' + s.title + '"? Anyone with the link will see "no longer active". Requests already received are kept.', { ok: 'Delete', danger: true }))) return;
      try { await del('/shares/' + s.id); load(); } catch (err) { toastError(err); }
    }
  });
  $('[data-new]', root)?.addEventListener('click', () => openShareModal({ mode: 'filter', filters: {}, onSaved: load }));
  await load();
}
