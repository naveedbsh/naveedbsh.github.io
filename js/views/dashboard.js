import { get } from '../api.js';
import { store, $, esc, money, fdate, ago, payPill, STATUS } from '../ui.js';
import { icon } from '../icons.js';
import { can } from '../app.js';
import { bindRecommendations, metricsHtml } from './pnl-report.js';

export async function render(root) {
  root.innerHTML = '<div class="empty">Loading…</div>';
  // Money and suggestions are for managers and admins; a viewer sees operations only.
  const [d, ins] = await Promise.all([
    get('/dashboard'),
    can('manager') ? get('/finance/insights').catch(() => null) : null,
  ]);
  const s = d.by_status;
  // On sale = not taken down and not under maintenance: the same base as the occupancy figure.
  const sellable = d.total - s.inactive - s.maintenance;
  const seg = (k) => (d.total ? (s[k] / d.total) * 100 : 0);

  root.innerHTML = `
    <div class="page-head">
      <h1>Dashboard</h1>
      <span class="muted">${esc(store.company.name)} · ${fdate(d.today)}</span>
      <a class="btn primary" href="/map" data-link>${icon('map')} Open map</a>
    </div>
    <div class="stats">
      <div class="card stat"><a href="/inventory" data-link><div class="label">Total media</div><div class="value">${d.total}</div><div class="sub">${sellable} on sale</div></a></div>
      <div class="card stat"><a href="/map" data-link><div class="label">Available now</div><div class="value" style="color:${STATUS.available.color}">${s.available}</div><div class="sub">${s.on_hold} on hold</div></a></div>
      <div class="card stat"><a href="/bookings?period=current" data-link><div class="label">Booked now</div><div class="value" style="color:${STATUS.booked.color}">${s.booked}</div><div class="sub">Occupancy ${d.occupancy}%</div></a></div>
      <div class="card stat accent"><a href="/bookings" data-link><div class="label">New bookings this month</div><div class="value">${money(d.money.booked_this_month)}</div><div class="sub" title="Full value of bookings that start this month. Revenue earned (spread day by day) is under Key numbers and Profit &amp; loss.">value of bookings starting this month</div></a></div>
      <div class="card stat"><a href="/bookings?payment=due" data-link><div class="label">Outstanding</div><div class="value">${money(d.money.outstanding)}</div><div class="sub">${money(d.money.overdue)} overdue</div></a></div>
      <div class="card stat"><a href="/requests" data-link><div class="label">Customer requests</div><div class="value">${d.counts.open_requests}</div><div class="sub">${d.counts.new_requests} new</div></a></div>
      <div class="card stat"><a href="/inventory" data-link><div class="label">On public marketplace</div><div class="value">${d.counts.listed}</div><div class="sub">${d.counts.market_enquiries_30d} enquir${d.counts.market_enquiries_30d === 1 ? 'y' : 'ies'} in 30 days</div></a></div>
      <div class="card stat"><a href="/issues" data-link><div class="label">Open problems</div><div class="value" style="color:${d.counts.open_issues ? STATUS.on_hold.color : 'inherit'}">${d.counts.open_issues}</div><div class="sub">${s.maintenance} under maintenance</div></a></div>
    </div>

    ${ins ? `<div class="dash-split" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>${icon('bulb')} What to do next</h3><span class="small muted">${ins.recommendations.length} suggestion${ins.recommendations.length === 1 ? '' : 's'}, most valuable first</span></div>
        <div data-recs></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${icon('trend')} Key numbers</h3><a href="/pnl" data-link class="small">Profit &amp; loss</a></div>
        ${metricsHtml(ins.metrics, { currency: store.company.currency })}
      </div>
    </div>` : ''}

    <div class="card card-pad" style="margin-bottom:16px">
      <div class="row spread"><h3>Inventory status</h3><span class="muted small">${d.occupancy}% of sellable media booked today</span></div>
      <div class="statusbar mt">${['booked', 'on_hold', 'available', 'maintenance', 'inactive'].map((k) => '<i style="width:' + seg(k) + '%;background:' + STATUS[k].color + '" title="' + STATUS[k].label + ': ' + s[k] + '"></i>').join('')}</div>
      <div class="legend">${['booked', 'on_hold', 'available', 'maintenance', 'inactive'].map((k) => '<span><i style="background:' + STATUS[k].color + '"></i>' + STATUS[k].label + ' <b>' + s[k] + '</b></span>').join('')}</div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-head"><h3>Ending in the next 7 days</h3><a href="/bookings?period=expiring" data-link class="small">All</a></div>
        <div class="list-rows">${d.expiring.length ? d.expiring.map((b) => `
          <div><div class="grow"><a href="/map?open=${b.medium_id}" data-link><b>${esc(b.code)}</b></a> <span class="muted small">${esc(b.title)}</span><div class="small">${esc(b.client_name)}</div></div>
          <div class="right small"><b>${b.days_left <= 0 ? 'Today' : b.days_left + ' d'}</b><div class="faint">${fdate(b.end_date)}</div></div>${payPill(b.payment_status)}</div>`).join('') : '<div class="empty">Nothing ends this week.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Starting soon</h3><a href="/bookings?period=upcoming" data-link class="small">All</a></div>
        <div class="list-rows">${d.starting.length ? d.starting.map((b) => `
          <div><div class="grow"><a href="/map?open=${b.medium_id}" data-link><b>${esc(b.code)}</b></a> <span class="muted small">${esc(b.title)}</span><div class="small">${esc(b.client_name)}${b.status === 'hold' ? ' <span class="pill warn">hold</span>' : ''}</div></div>
          <div class="small">${fdate(b.start_date)}</div></div>`).join('') : '<div class="empty">No bookings start in the next week.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Top dues by client</h3><a href="/bookings?payment=due" data-link class="small">All</a></div>
        <div class="list-rows">${d.dues.length ? d.dues.map((c) => `
          <div><div class="grow"><b>${esc(c.client_name)}</b><div class="small muted">${c.bookings} booking${c.bookings > 1 ? 's' : ''}</div></div><b class="num">${money(c.due)}</b></div>`).join('') : '<div class="empty">Everyone has paid.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>By media type</h3></div>
        <div class="card-pad stack">${d.by_type.map((t) => `
          <div><div class="row spread small"><span>${esc(t.label)}</span><span class="muted">${t.booked} / ${t.total} booked</span></div>
          <div class="bar" style="margin-top:4px"><i style="width:${t.total ? Math.round((t.booked / t.total) * 100) : 0}%"></i></div></div>`).join('') || '<div class="empty">No media yet.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Permits expiring (30 days)</h3></div>
        <div class="list-rows">${d.permits.length ? d.permits.map((p) => `
          <div><div class="grow"><a href="/map?open=${p.id}" data-link><b>${esc(p.code)}</b></a> <span class="small muted">${esc(p.title)}</span><div class="small faint">${esc(p.permit_no || '')}</div></div>
          <span class="pill ${p.permit_expiry < d.today ? 'bad' : 'warn'}">${p.permit_expiry < d.today ? 'Expired' : 'Expires'} ${fdate(p.permit_expiry)}</span></div>`).join('') : '<div class="empty">No permits due for renewal.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Recent activity</h3></div>
        <div class="list-rows">${d.activity.length ? d.activity.map((a) => `
          <div><div class="grow small">${a.medium_id ? '<a href="/map?open=' + a.medium_id + '" data-link>' + esc(a.summary) + '</a>' : esc(a.summary)}<div class="faint">${esc(a.user_name || 'System')} · ${ago(a.created_at)}</div></div></div>`).join('') : '<div class="empty">Nothing yet.</div>'}</div>
      </div>
    </div>`;

  if (ins) bindRecommendations($('[data-recs]', root), ins.recommendations, { currency: store.company.currency, limit: 5 });
}
