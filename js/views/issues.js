// Technical problem reports from staff and (optionally) customers.
import { get, patch } from '../api.js';
import {
  $, $$, esc, ago, fdate, modal, toast, toastError, busy, typeInfo,
} from '../ui.js';
import { icon } from '../icons.js';
import { can, refreshBadges } from '../app.js';

export async function render(root) {
  let filter = 'unresolved';
  root.innerHTML = `
    <div class="page-head"><h1>Problem reports</h1>
      <div class="tabs" data-f><button data-v="unresolved" class="on">Unresolved</button><button data-v="resolved">Resolved</button><button data-v="">All</button></div>
    </div>
    <p class="muted" style="margin:-8px 0 16px">Anyone on the team can press <b>Report</b> on a medium. Lights out, torn flex, blank screens and damage all land here.</p>
    <div data-list><div class="empty">Loading…</div></div>`;
  const list = $('[data-list]', root);

  async function load() {
    const { issues, total = 0 } = await get('/issues', { status: filter });
    refreshBadges();
    list.innerHTML = issues.length ? '<div class="dash-grid">' + issues.map((i) => `
      <div class="issue-card" data-id="${i.id}">
        <div class="row">
          <span class="small sev-${i.severity}" title="Severity">● ${esc(i.severity)}</span>
          <b class="grow">${esc(i.category_label)}</b>
          <span class="pill ${i.status === 'resolved' ? 'ok' : i.status === 'in_progress' ? 'warn' : 'bad'}">${esc(i.status.replace('_', ' '))}</span>
        </div>
        <div class="small" style="margin-top:4px"><a href="/map?open=${i.medium_id}" data-link><b>${esc(i.code)}</b> ${esc(i.title)}</a></div>
        <div class="small muted">${esc(typeInfo(i.type).label)} · ${esc([i.area, i.city].filter(Boolean).join(', '))}</div>
        ${i.description ? '<div style="margin-top:8px;white-space:pre-wrap">' + esc(i.description) + '</div>' : ''}
        ${i.photo_url ? '<a href="' + esc(i.photo_url) + '" target="_blank" rel="noopener"><img src="' + esc(i.photo_url) + '" alt="Photo of the problem"></a>' : ''}
        <div class="small faint" style="margin-top:8px">Reported by ${esc(i.source === 'public' ? (i.reporter_name || 'a customer') + ' via share link' + (i.reporter_phone ? ' · ' + i.reporter_phone : '') : i.reporter_user || i.reporter_name || 'staff')} · ${ago(i.created_at)}</div>
        ${i.status === 'resolved' ? '<div class="small" style="margin-top:6px"><b>Resolved</b> ' + fdate(i.resolved_at, true) + (i.resolved_by_name ? ' by ' + esc(i.resolved_by_name) : '') + (i.resolution ? ': ' + esc(i.resolution) : '') + '</div>' : ''}
        ${can('manager') ? '<div class="row" style="margin-top:10px">' +
          (i.status === 'open' ? '<button class="btn sm" data-act="in_progress">Start work</button>' : '') +
          (i.status !== 'resolved' ? '<button class="btn sm primary" data-act="resolved">' + icon('check') + ' Resolve</button>' : '<button class="btn sm" data-act="open">Reopen</button>') +
          '</div>' : ''}
      </div>`).join('') + '</div>'
      : '<div class="card empty">' + (filter === 'unresolved' ? 'No open problems. Everything is lit and standing.' : 'Nothing here.') + '</div>';
    if (total > issues.length) list.insertAdjacentHTML('beforeend', '<p class="small muted mt" style="text-align:center">' + issues.length + ' of ' + total + ' reports shown (open ones first).</p>');
  }

  $('[data-f]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    filter = b.dataset.v;
    $$('[data-v]', root).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    if (btn.dataset.act === 'resolved') {
      const m = modal({
        title: 'Resolve problem', size: 'narrow',
        body: '<label class="field"><span>What was done?</span><textarea data-res maxlength="5000" placeholder="e.g. Replaced 4 tubes and the choke."></textarea></label>' +
          '<label class="check mt"><input type="checkbox" data-react checked> Put the medium back on sale if it was under maintenance</label>',
        foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Resolve</button>',
      });
      $('[data-ok]', m.el).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        try {
          const r = await patch('/issues/' + id, { status: 'resolved', resolution: $('[data-res]', m.el).value, reactivate: $('[data-react]', m.el).checked });
          toast(r.reactivated ? 'Resolved – the board is back on sale' : r.still_open ? 'Resolved – board stays off sale: ' + r.still_open + ' other problem' + (r.still_open > 1 ? 's are' : ' is') + ' still open' : 'Resolved', 'ok');
          m.close(); load();
        } catch (err) { toastError(err); }
      }));
      return;
    }
    await busy(btn, async () => {
      try { await patch('/issues/' + id, { status: btn.dataset.act }); load(); } catch (err) { toastError(err); }
    });
  });
  await load();
}
