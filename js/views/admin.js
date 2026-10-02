// Platform console for the super admin: every client company, and each one's
// full profile - account details, logins, media, bookings, profit & loss and
// activity - seen and managed from outside, without opening its workspace.
import { get, post, patch, del, scoped } from '../api.js';
import {
  $, $$, el, esc, ago, fdate, money, modal, toast, toastError, busy, formData, confirmDialog,
  pill, payPill, typeInfo, initials, STATUS, paged, todayISO, addDays,
} from '../ui.js';
import { icon } from '../icons.js';
import { navigate, openCompany } from '../app.js';
import { userModal } from './team.js';
import { showAccountHandover, passwordField, signinState, resetPassword } from './account-handover.js';
import { renderPnl, bindRecommendations, metricsHtml } from './pnl-report.js';
import { amt, per, statePill } from './billing.js';
import { planModal, paymentRows, settlePayment } from './admin-billing.js';

export async function render(root, params, query = {}) {
  if (params.id) return companyPage(root, Number(params.id), query);
  return companyList(root, query);
}

/* ------------------------------------------------------------- shared bits */

/** Plans that can be given to a company: the catalogue plus its own custom ones. */
async function plansFor(companyId = null) {
  const { plans } = await get('/admin/plans');
  return plans.filter((p) => p.is_active && (!p.company_id || p.company_id === companyId));
}
const planOption = (p, selected) => '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + ' · ' + amt(p.price, p.currency) + ' / ' + per(p.duration_days) +
  ' · ' + p.max_mediums.toLocaleString() + ' media, ' + p.max_users + ' logins</option>';

/** Only a plan that needs attention gets a badge in lists. */
const planBadge = (st) => (st && ['expiring', 'grace', 'lapsed'].includes(st.status) ? statePill(st) : '');

const FIELD_LABELS = {
  name: 'name', slug: 'web address', contact_name: 'contact person', contact_email: 'contact email', phone: 'phone',
  city: 'city', address: 'address', gstin: 'GSTIN', currency: 'currency', max_mediums: 'media limit',
  max_users: 'login limit', status: 'status', notes: 'internal notes', about: 'about text', public_phone: 'phone on public page',
};

const statusPill = (s) => (s === 'active' ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Suspended</span>');

/** The company's logo, or its initials on the dark tile. */
function logoBox(c, size = 52) {
  const img = c.logo ? ';background-image:url(/uploads/photos/' + encodeURIComponent(c.logo) + ')' : '';
  return '<span class="co-logo" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.36) + 'px' + img + '">' +
    (c.logo ? '' : esc(initials(c.name))) + '</span>';
}

/** Different currencies cannot be added up: one total per currency, largest first. */
function moneyByCurrency(list, key) {
  const sums = {};
  for (const c of list) sums[c.currency || 'INR'] = (sums[c.currency || 'INR'] || 0) + (c[key] || 0);
  const parts = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  return parts.length ? parts.map(([cur, v]) => money(v, cur)).join(' + ') : money(0);
}

/** Picking a plan fills in its limits and, on a new company, when it ends. */
function wirePlan(form, plans) {
  form.plan_id.addEventListener('change', () => {
    const p = plans.find((x) => x.id === Number(form.plan_id.value));
    if (!p) return;
    form.max_mediums.value = p.max_mediums;
    form.max_users.value = p.max_users;
    if (form.plan_expires_at) form.plan_expires_at.value = addDays(todayISO(), p.duration_days - 1);
  });
}

/* ------------------------------------------------------------ all companies */

const SORTS = {
  newest: ['Newest first', (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id],
  name: ['Name, A to Z', (a, b) => a.name.localeCompare(b.name)],
  revenue: ['Revenue, last 30 days', (a, b) => b.revenue_30d - a.revenue_30d],
  outstanding: ['Money outstanding', (a, b) => b.outstanding - a.outstanding],
  media: ['Most media', (a, b) => b.mediums - a.mediums],
  active: ['Recently active', (a, b) => String(b.last_active || '').localeCompare(String(a.last_active || ''))],
};

async function companyList(root, query) {
  const [stats, { companies }] = await Promise.all([get('/admin/stats'), get('/admin/companies')]);
  const planOf = (c) => c.plan_name || c.plan || '';
  const plans = [...new Set(companies.map(planOf).filter(Boolean))].sort();
  const f = {
    q: String(query.q || ''),
    status: ['active', 'suspended'].includes(query.status) ? query.status : '',
    plan: plans.includes(query.plan) ? query.plan : '',
    sort: SORTS[query.sort] ? query.sort : 'newest',
  };

  root.innerHTML = `
    <div class="page-head"><h1>Companies</h1>
      <a class="btn" href="/admin/access" data-link>${icon('shield')} Roles &amp; permissions</a>
      <button class="btn primary" data-new>${icon('plus')} New company</button></div>
    <div class="stats">
      <div class="card stat"><div class="label">Companies</div><div class="value">${stats.companies}</div><div class="sub">${stats.active_companies} active · ${stats.companies - stats.active_companies} suspended</div></div>
      <div class="card stat accent"><div class="label">Booked revenue, last 30 days</div><div class="value">${moneyByCurrency(companies, 'revenue_30d')}</div><div class="sub">all companies, earned day by day</div></div>
      <div class="card stat"><div class="label">Outstanding</div><div class="value">${moneyByCurrency(companies, 'outstanding')}</div><div class="sub">confirmed bookings not fully paid</div></div>
      <div class="card stat"><div class="label">Media on the platform</div><div class="value">${stats.mediums}</div><div class="sub">${companies.reduce((s, c) => s + c.listed, 0)} on the public marketplace</div></div>
      <div class="card stat"><div class="label">Company logins</div><div class="value">${stats.users}</div></div>
      <div class="card stat"><div class="label">Live bookings</div><div class="value">${stats.live_bookings}</div><div class="sub">${stats.open_requests} open customer requests</div></div>
      <div class="card stat"><a href="/admin/billing" data-link><div class="label">Plans ending within ${stats.warn_days} days</div><div class="value" style="color:${stats.plans_expiring ? 'var(--st-on_hold)' : 'inherit'}">${stats.plans_expiring}</div><div class="sub">${stats.plans_expired} expired · see renewals</div></a></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" data-q class="grow" style="max-width:340px" placeholder="Search name, city, contact, email or web address" value="${esc(f.q)}" aria-label="Search companies">
        <select data-f="status" style="max-width:160px" aria-label="Status">
          <option value="">All statuses</option><option value="active"${f.status === 'active' ? ' selected' : ''}>Active</option><option value="suspended"${f.status === 'suspended' ? ' selected' : ''}>Suspended</option>
        </select>
        <select data-f="plan" style="max-width:160px" aria-label="Plan"><option value="">All plans</option>${plans.map((p) => '<option value="' + esc(p) + '"' + (p === f.plan ? ' selected' : '') + '>' + esc(p) + '</option>').join('')}</select>
        <select data-f="sort" style="max-width:210px" aria-label="Sort">${Object.entries(SORTS).map(([k, [l]]) => '<option value="' + k + '"' + (k === f.sort ? ' selected' : '') + '>' + l + '</option>').join('')}</select>
        <span class="grow"></span><span class="small muted" data-count></span>
      </div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Company</th><th>Contact</th><th class="right">Media</th><th class="right">Logins</th><th class="right">Revenue, 30 days</th><th class="right">Outstanding</th><th class="right" title="Open customer requests and open problem reports">Open items</th><th>Status</th><th></th></tr></thead>
      <tbody data-rows></tbody></table></div>
    </div>`;

  // Clicking a row opens the company's page; "Open" steps into its workspace.
  const row = (c) => `
    <tr class="click" data-id="${c.id}" title="See and manage ${esc(c.name)}">
      <td style="min-width:210px"><div class="row" style="flex-wrap:nowrap;gap:10px">${logoBox(c, 34)}<div style="min-width:0"><b>${esc(c.name)}</b><div class="small faint">${esc([c.city, (planOf(c) || 'No') + ' plan'].filter(Boolean).join(' · '))}${c.plan_expires_at ? ' · until ' + fdate(c.plan_expires_at) : ''}</div></div></div></td>
      <td class="small">${esc(c.contact_name || '—')}<div class="faint">${esc(c.contact_email || c.phone || '')}</div></td>
      <td class="right num nowrap"><span class="${c.mediums >= c.max_mediums ? 'neg' : ''}">${c.mediums}</span> <span class="faint small">/ ${c.max_mediums}</span><div class="small faint">${c.listed} listed</div></td>
      <td class="right num nowrap"><span class="${c.users >= c.max_users ? 'neg' : ''}">${c.users}</span> <span class="faint small">/ ${c.max_users}</span></td>
      <td class="right num nowrap">${money(c.revenue_30d, c.currency)}<div class="small faint">${c.live_bookings} live booking${c.live_bookings === 1 ? '' : 's'}</div></td>
      <td class="right num nowrap">${c.outstanding ? money(c.outstanding, c.currency) : '<span class="faint">—</span>'}</td>
      <td class="right nowrap small"><span class="${c.open_requests ? '' : 'faint'}">${c.open_requests} request${c.open_requests === 1 ? '' : 's'}</span><div class="${c.open_issues ? '' : 'faint'}">${c.open_issues} problem${c.open_issues === 1 ? '' : 's'}</div></td>
      <td class="nowrap">${statusPill(c.status)} ${planBadge(c.plan_state)}<div class="small faint" title="Last time any of its logins used HoardHub">${c.last_active ? 'active ' + ago(c.last_active) : 'never signed in'}</div></td>
      <td class="nowrap"><button class="btn sm" data-open title="Work inside this company's workspace">${icon('external')} Open</button></td>
    </tr>`;

  const rows = $('[data-rows]', root);
  function paint() {
    const q = f.q.trim().toLowerCase();
    const list = companies
      .filter((c) => (!f.status || c.status === f.status) && (!f.plan || planOf(c) === f.plan) &&
        (!q || [c.name, c.city, c.contact_name, c.contact_email, c.phone, c.slug].some((v) => String(v || '').toLowerCase().includes(q))))
      .sort(SORTS[f.sort][1]);
    $('[data-count]', root).textContent = list.length === companies.length ? companies.length + ' compan' + (companies.length === 1 ? 'y' : 'ies') : list.length + ' of ' + companies.length;
    rows.innerHTML = list.length ? list.map(row).join('')
      : '<tr><td colspan="9" class="empty">' + (companies.length ? 'No company matches these filters.' : 'No companies yet. Create the first client account.') + '</td></tr>';
    // Keep the filters in the address, so Back and a reload return to the same list.
    const qs = new URLSearchParams(Object.entries({ q: f.q.trim(), status: f.status, plan: f.plan, sort: f.sort === 'newest' ? '' : f.sort }).filter(([, v]) => v)).toString();
    history.replaceState({}, '', '/admin' + (qs ? '?' + qs : ''));
  }
  paint();

  $('[data-q]', root).addEventListener('input', (e) => { f.q = e.target.value; paint(); });
  $$('[data-f]', root).forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; paint(); }));
  rows.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.target.closest('[data-open]')) openCompany(Number(tr.dataset.id));
    else navigate('/admin/companies/' + tr.dataset.id);
  });
  $('[data-new]', root).addEventListener('click', async () => newCompanyModal({
    plans: await plansFor(),
    onSave: async (d) => {
      const r = await post('/admin/companies', d);
      await navigate('/admin/companies/' + r.id);
      showAccountHandover(r.account, { phone: r.phone });
    },
  }));
  return undefined;
}

const step = (n, title, sub) => `<div class="row" style="margin:22px 0 10px;gap:10px">
  <span style="width:26px;height:26px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none">${n}</span>
  <div><b>${esc(title)}</b>${sub ? '<div class="small muted">' + esc(sub) + '</div>' : ''}</div></div>`;

function newCompanyModal({ plans, onSave }) {
  const first = plans.find((p) => p.slug === 'standard') || plans[0];
  const body = el(`
    <form novalidate autocomplete="off">
      ${step(1, 'Company details', 'Who the account is for. Shown to the company and on its public page.').replace('margin:22px', 'margin:0')}
      <div class="grid-2">
        <label class="field"><span>Company name *</span><input type="text" name="name" maxlength="160"></label>
        <label class="field"><span>City</span><input type="text" name="city" maxlength="120"></label>
        <label class="field"><span>Contact person</span><input type="text" name="contact_name" maxlength="120"></label>
        <label class="field"><span>Phone</span><input type="tel" name="phone" maxlength="40"></label>
        <label class="field"><span>Contact email</span><input type="email" name="contact_email" maxlength="190"></label>
        <label class="field"><span>GSTIN</span><input type="text" name="gstin" maxlength="40"></label>
      </div>
      <label class="field mt"><span>Address</span><input type="text" name="address" maxlength="255"></label>

      ${step(2, 'Plan & limits', 'The plan fills the limits and its end date; adjust them for a trial or a deal. Payments are recorded later under Plan & billing.')}
      <label class="field"><span>Plan</span><select name="plan_id">${plans.map((p) => planOption(p, first && first.id)).join('')}</select></label>
      <div class="grid-4 mt">
        <label class="field"><span>Valid until</span><input type="date" name="plan_expires_at" value="${first ? addDays(todayISO(), first.duration_days - 1) : ''}"></label>
        <label class="field"><span>Max media</span><input type="number" name="max_mediums" min="1" value="${first ? first.max_mediums : 1000}"></label>
        <label class="field"><span>Max logins</span><input type="number" name="max_users" min="1" value="${first ? first.max_users : 10}"></label>
        <label class="field"><span>Currency</span><input type="text" name="currency" maxlength="3" value="INR"></label>
      </div>
      <label class="check small mt"><input type="checkbox" data-no-end> No end date (the plan never expires)</label>

      ${step(3, 'First admin login', 'This person manages the company account: boards, bookings and their team.')}
      <div class="row" style="margin:-4px 0 10px"><button type="button" class="btn sm" data-same>${icon('copy')} Same as contact person</button></div>
      <div class="grid-3">
        <label class="field"><span>Admin name *</span><input type="text" name="admin_name" maxlength="120"></label>
        <label class="field"><span>Admin email (login) *</span><input type="email" name="admin_email" maxlength="190" autocomplete="off"></label>
        <label class="field"><span>Admin mobile</span><input type="tel" name="admin_phone" maxlength="40" placeholder="For sending the login on WhatsApp"></label>
      </div>
      <div class="mt" data-pw></div>

      <label class="field mt"><span>Internal notes (only platform admins see these)</span><textarea name="notes" maxlength="5000"></textarea></label>
      <div class="error-text mt hidden" data-err></div>
    </form>`);
  body.querySelector('[data-pw]').append(passwordField({ name: 'admin_password', label: 'Temporary password', hint: 'Leave blank to generate a strong one. The admin must change it at first sign-in.' }));

  const m = modal({
    title: 'New client company', body, size: 'wide',
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Create company &amp; login</button>',
  });
  const f = body;
  wirePlan(f, plans);
  $('[data-no-end]', f).addEventListener('change', (e) => { f.plan_expires_at.disabled = e.target.checked; });
  $('[data-same]', f).addEventListener('click', () => {
    f.admin_name.value = f.contact_name.value;
    f.admin_email.value = f.contact_email.value;
    f.admin_phone.value = f.phone.value;
    if (!f.contact_name.value && !f.contact_email.value) toast('Fill in the contact person first', 'error');
  });

  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    const missing = [['name', 'Company name'], ['admin_name', 'Admin name'], ['admin_email', 'Admin email']].find(([k]) => !f[k].value.trim());
    if (missing) {
      box.textContent = missing[1] + ' is required.';
      box.classList.remove('hidden');
      f[missing[0]].focus();
      return;
    }
    const d = formData(f);
    if ($('[data-no-end]', f).checked) d.plan_expires_at = 'none';
    try { await onSave(d); m.close(); } catch (err) {
      box.textContent = err.message; box.classList.remove('hidden');
    }
  }));
}

/* ------------------------------------------------------------- one company */

const TABS = [
  ['overview', 'Overview'], ['profile', 'Profile & settings'], ['billing', 'Plan & billing'], ['logins', 'Logins'], ['media', 'Media'],
  ['bookings', 'Bookings'], ['pnl', 'Profit & loss'], ['activity', 'Activity'], ['danger', 'Danger zone'],
];

/** One line of the activity feed; platform admin and security entries are marked. */
const activityRow = (a) => `
  <div><div class="grow small" style="min-width:0">${a.medium_id ? '<a href="#" data-medium="' + a.medium_id + '">' + esc(a.summary) + '</a>' : esc(a.summary)}
    <div class="faint">${esc(a.user_name || 'System')}${a.user_role === 'superadmin' ? ' <span class="tag low">Platform admin</span>' : a.user_role ? ' · ' + esc(a.user_role) : ''} · <span title="${esc(fdate(a.created_at, true))}">${ago(a.created_at)}</span></div></div>
    ${String(a.action).startsWith('security.') ? '<span class="tag high">Security</span>' : ''}</div>`;

async function companyPage(root, id, query) {
  const api = scoped(id); // the company's own endpoints, called from outside it
  const state = { c: null, users: [], counts: {}, tab: TABS.some(([k]) => k === query.tab) ? query.tab : 'overview' };

  async function load() {
    const r = await get('/admin/companies/' + id);
    state.c = r.company;
    state.users = r.users;
    state.counts = r.counts;
  }
  try { await load(); } catch (err) {
    root.innerHTML = '<div class="page-head"><a class="btn ghost icon" href="/admin" data-link title="All companies">' + icon('back') + '</a><h1>Company</h1></div>' +
      '<div class="card"><div class="empty">' + esc(err.message) + '</div></div>';
    return undefined;
  }

  root.innerHTML = '<div data-head></div>' +
    '<div class="tabs wide" data-co-tabs>' + TABS.map(([k, l]) => '<button data-co-tab="' + k + '"' + (k === state.tab ? ' class="on"' : '') + '>' + esc(l) + '</button>').join('') + '</div>' +
    '<div data-co-body style="margin-top:16px"></div>';

  function paintHead() {
    const c = state.c;
    $('[data-head]', root).innerHTML = `
      <div class="co-head">
        <a class="btn ghost icon" href="/admin" data-link title="All companies">${icon('back')}</a>
        ${logoBox(c)}
        <div class="grow" style="min-width:0">
          <h1>${esc(c.name)}</h1>
          <div class="row small muted" style="gap:6px 10px;flex-wrap:wrap;margin-top:4px">${statusPill(c.status)}<span class="pill info">${esc(c.plan_name || c.plan || 'No plan')}</span>${planBadge(c.plan_state)}
            ${c.city ? '<span>' + esc(c.city) + '</span>' : ''}<span>client since ${fdate(c.created_at)}</span>
            <a href="/p/${esc(c.slug)}" target="_blank" rel="noopener">Public page /p/${esc(c.slug)}</a></div>
        </div>
        <button class="btn" data-head-status>${c.status === 'active' ? 'Suspend' : 'Re-activate'}</button>
        <button class="btn primary" data-head-open>${icon('external')} Open workspace</button>
      </div>
      ${c.status === 'active' ? '' : '<div class="note-box">' + icon('lock') + '<div><b>This account is suspended.</b> Its logins cannot sign in, its share links stop working and its boards are hidden from the public marketplace. You can still see and change everything here.</div></div>'}`;
    $('[data-head-status]', root).addEventListener('click', (e) => toggleStatus(e.currentTarget));
    $('[data-head-open]', root).addEventListener('click', () => openCompany(id));
  }

  function setTab(k) {
    state.tab = k;
    $$('[data-co-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.coTab === k));
    history.replaceState({}, '', '/admin/companies/' + id + (k === 'overview' ? '' : '?tab=' + k));
    drawTab();
  }
  $('[data-co-tabs]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-co-tab]');
    if (b && b.dataset.coTab !== state.tab) setTab(b.dataset.coTab);
  });

  // Each tab draws into a fresh element, so listeners it adds die with it and a
  // slow tab finishing late paints nowhere.
  async function drawTab() {
    const host = document.createElement('div');
    $('[data-co-body]', root).replaceChildren(host);
    host.innerHTML = '<div class="card"><div class="empty">Loading…</div></div>';
    host.addEventListener('click', (e) => {
      const go = e.target.closest('[data-goto]');
      if (go) { e.preventDefault(); setTab(go.dataset.goto); return; }
      const med = e.target.closest('[data-medium]');
      if (med) { e.preventDefault(); openCompany(id, '/map?open=' + med.dataset.medium); }
    });
    const draw = { overview, profile, billing, logins, media, bookings, pnl, activity, danger }[state.tab];
    try { await draw(host); } catch (err) {
      host.innerHTML = '<div class="card"><div class="empty">' + esc(err.message) + '</div></div>';
    }
  }

  async function refresh({ redraw = true } = {}) {
    await load();
    paintHead();
    if (redraw) await drawTab();
  }

  async function toggleStatus(btn) {
    const c = state.c;
    const suspend = c.status === 'active';
    if (suspend && !(await confirmDialog('Suspend ' + c.name + '? Its logins are blocked straight away, its share links stop working and its boards leave the public marketplace until you re-activate it. Nothing is deleted.', { ok: 'Suspend', danger: true }))) return;
    await busy(btn, async () => {
      try {
        await patch('/admin/companies/' + id, { status: suspend ? 'suspended' : 'active' });
        toast(suspend ? 'Account suspended' : 'Account re-activated', 'ok');
        await refresh();
      } catch (err) { toastError(err); }
    });
  }

  async function unlistAll(btn) {
    await busy(btn, async () => {
      try {
        await load();
        const n = state.counts.listed;
        if (!n) { toast('None of this company\'s boards are listed'); return; }
        if (!(await confirmDialog('Take all ' + n + ' listed boards of ' + state.c.name + ' off the public marketplace? The company can list them again later.', { ok: 'Unlist all', danger: true }))) return;
        const r = await post('/admin/companies/' + id + '/unlist-all');
        toast(r.unlisted + ' board' + (r.unlisted === 1 ? '' : 's') + ' taken off the marketplace', 'ok');
        await refresh();
      } catch (err) { toastError(err); }
    });
  }

  /* ---------------------------------------------------------- overview */
  async function overview(host) {
    const c = state.c;
    const cur = c.currency;
    const [d, ins, act] = await Promise.all([
      api.get('/dashboard'),
      api.get('/finance/insights').catch(() => null),
      get('/admin/companies/' + id + '/activity', { limit: 8 }).catch(() => ({ entries: [] })),
    ]);
    const s = d.by_status;
    const { counts, users } = state;
    const usage = (label, used, max, hint, warn = true) => {
      const p = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
      return `<div><div class="row spread small" style="align-items:flex-start;gap:8px"><b>${label}</b><span class="muted num nowrap">${used.toLocaleString()} / ${max.toLocaleString()}</span></div>
        <div class="bar${warn && used >= max ? ' full' : ''}" style="margin-top:6px"><i style="width:${p}%"></i></div><div class="small faint" style="margin-top:4px">${hint}</div></div>`;
    };
    const lastLogin = users.map((u) => u.last_seen_at || u.last_login).filter(Boolean).sort().pop();
    const admins = users.filter((u) => u.role === 'admin');
    const kv = (k, v) => '<dt>' + k + '</dt><dd>' + (v === null || v === undefined || v === '' ? '<span class="faint">—</span>' : v) + '</dd>';

    host.innerHTML = `
      <div class="stats">
        <div class="card stat"><div class="label">Total media</div><div class="value">${d.total}</div><div class="sub">${d.total - s.inactive - s.maintenance} on sale · ${s.available} available now</div></div>
        <div class="card stat"><div class="label">Booked now</div><div class="value" style="color:${STATUS.booked.color}">${s.booked}</div><div class="sub">Occupancy ${d.occupancy}% · ${s.on_hold} on hold</div></div>
        <div class="card stat accent"><div class="label">New bookings this month</div><div class="value">${money(d.money.booked_this_month, cur)}</div><div class="sub">value of bookings starting this month</div></div>
        <div class="card stat"><div class="label">Outstanding</div><div class="value">${money(d.money.outstanding, cur)}</div><div class="sub">${money(d.money.overdue, cur)} overdue</div></div>
        <div class="card stat"><div class="label">Customer requests</div><div class="value">${d.counts.open_requests}</div><div class="sub">${d.counts.new_requests} new · ${d.counts.market_enquiries_30d} from the marketplace in 30 days</div></div>
        <div class="card stat"><div class="label">Open problems</div><div class="value">${d.counts.open_issues}</div><div class="sub">${s.maintenance} under maintenance</div></div>
      </div>

      <div class="card card-pad" style="margin-bottom:16px">
        <div class="row spread"><h3>Plan usage</h3><button class="btn sm" data-goto="billing">Plan &amp; billing</button></div>
        <div class="usage mt">
          ${usage('Media', counts.mediums, c.max_mediums, counts.mediums >= c.max_mediums ? 'At the limit: they cannot add more boards.' : (c.max_mediums - counts.mediums).toLocaleString() + ' more can be added')}
          ${usage('Logins', users.length, c.max_users, users.length >= c.max_users ? 'At the limit: they cannot add team members.' : (c.max_users - users.length) + ' more can be added')}
          ${usage('On the public marketplace', d.counts.listed, Math.max(1, counts.mediums), 'Boards customers can find and enquire about', false)}
        </div>
      </div>

      ${ins ? `<div class="dash-split" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h3>${icon('bulb')} What this company should do next</h3><span class="small muted">${ins.recommendations.length} suggestion${ins.recommendations.length === 1 ? '' : 's'}</span></div>
          <div data-recs></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('trend')} Key numbers</h3><button class="btn sm" data-goto="pnl">Profit &amp; loss</button></div>
          ${metricsHtml(ins.metrics, { currency: cur })}
        </div>
      </div>` : ''}

      <div class="dash-split">
        <div class="card">
          <div class="card-head"><h3>Account details</h3><button class="btn sm" data-goto="profile">${icon('edit')} Edit</button></div>
          <div class="card-pad"><dl class="kv">
            ${kv('Company', esc(c.name))}
            ${kv('Public page', '<a href="/p/' + esc(c.slug) + '" target="_blank" rel="noopener">' + esc(location.host) + '/p/' + esc(c.slug) + '</a>')}
            ${kv('Contact person', esc(c.contact_name))}
            ${kv('Contact email', c.contact_email ? '<a href="mailto:' + esc(c.contact_email) + '">' + esc(c.contact_email) + '</a>' : '')}
            ${kv('Phone', esc(c.phone) + (c.phone ? ' <span class="faint">(' + (c.public_phone ? 'shown' : 'hidden') + ' on the public page)</span>' : ''))}
            ${kv('City', esc(c.city))}
            ${kv('Address', esc(c.address))}
            ${kv('GSTIN', esc(c.gstin))}
            ${kv('Currency', esc(c.currency))}
            ${kv('Plan', esc(c.plan_name || c.plan || 'No plan') + ' · ' + c.max_mediums.toLocaleString() + ' media, ' + c.max_users + ' logins' + (c.plan_expires_at ? ' · until ' + fdate(c.plan_expires_at) : '') + ' ' + planBadge(c.plan_state))}
            ${kv('Admins', admins.map((u) => esc(u.name) + ' <span class="faint">' + esc(u.email) + '</span>').join('<br>'))}
            ${kv('Last active', lastLogin ? ago(lastLogin) : 'Nobody has signed in yet')}
            ${kv('Client since', fdate(c.created_at))}
            ${kv('Records', counts.bookings + ' bookings · ' + counts.requests + ' customer requests · ' + counts.shares + ' share links · ' + counts.expenses + ' expenses')}
          </dl></div>
          ${c.notes ? '<div class="card-pad" style="border-top:1px solid var(--line)"><div class="small faint">Internal notes (only platform admins see these)</div><div style="white-space:pre-wrap;margin-top:4px">' + esc(c.notes) + '</div></div>' : ''}
        </div>
        <div class="card">
          <div class="card-head"><h3>Recent activity</h3><button class="btn sm" data-goto="activity">All</button></div>
          <div class="list-rows">${act.entries.length ? act.entries.map(activityRow).join('') : '<div class="empty">Nothing recorded yet.</div>'}</div>
        </div>
      </div>`;

    if (ins) {
      bindRecommendations($('[data-recs]', host), ins.recommendations, {
        currency: cur, limit: 5, links: false,
        // An action points inside the company's workspace: step into it there.
        onAction: (href) => openCompany(id, href),
      });
    }
  }

  /* ----------------------------------------------------------- profile */
  async function profile(host) {
    const c = state.c;
    host.innerHTML = `
      <form class="card card-pad" novalidate autocomplete="off" data-form style="max-width:940px">
        <div data-logo-row></div>

        <div class="form-section">Company details</div>
        <div class="grid-2">
          <label class="field"><span>Company name *</span><input type="text" name="name" maxlength="160" value="${esc(c.name)}"></label>
          <label class="field"><span>City</span><input type="text" name="city" maxlength="120" value="${esc(c.city || '')}"></label>
          <label class="field"><span>Contact person</span><input type="text" name="contact_name" maxlength="120" value="${esc(c.contact_name || '')}"></label>
          <label class="field"><span>Phone</span><input type="tel" name="phone" maxlength="40" value="${esc(c.phone || '')}"></label>
          <label class="field"><span>Contact email</span><input type="email" name="contact_email" maxlength="190" value="${esc(c.contact_email || '')}"></label>
          <label class="field"><span>GSTIN</span><input type="text" name="gstin" maxlength="40" value="${esc(c.gstin || '')}"></label>
        </div>
        <label class="field mt"><span>Address</span><input type="text" name="address" maxlength="255" value="${esc(c.address || '')}"></label>

        <div class="form-section">Public page on the marketplace</div>
        <label class="field"><span>Web address</span>
          <div class="row" style="gap:6px;flex-wrap:nowrap"><span class="small faint nowrap">${esc(location.host)}/p/</span><input type="text" name="slug" maxlength="60" value="${esc(c.slug)}" class="grow"></div></label>
        <div class="small faint" style="margin-top:4px">Changing it breaks links the company has already shared to its old public page.</div>
        <label class="field mt"><span>About the company</span><textarea name="about" maxlength="3000" rows="4" placeholder="Shown on the public provider page">${esc(c.about || '')}</textarea></label>
        <label class="check mt"><input type="checkbox" name="public_phone"${c.public_phone ? ' checked' : ''}> Show the phone number on the public page (otherwise customers can only enquire)</label>

        <div class="form-section">Limits</div>
        <div class="small muted" style="margin:-2px 0 8px">Paying for a plan sets these. Change them here for an exception; the plan, its end date and renewals are on the <a href="#" data-goto="billing">Plan &amp; billing</a> tab.</div>
        <div class="grid-3">
          <label class="field"><span>Max media</span><input type="number" name="max_mediums" min="1" value="${c.max_mediums}"></label>
          <label class="field"><span>Max logins</span><input type="number" name="max_users" min="1" value="${c.max_users}"></label>
          <label class="field"><span>Currency</span><input type="text" name="currency" maxlength="3" value="${esc(c.currency)}"></label>
        </div>
        <div class="small faint" style="margin-top:4px">In use now: ${state.counts.mediums} media and ${state.users.length} logins. A lower limit deletes nothing; it only stops new additions.</div>

        <div class="form-section">Account status</div>
        <select name="status" style="max-width:420px" aria-label="Account status">
          <option value="active"${c.status === 'active' ? ' selected' : ''}>Active: logins work normally</option>
          <option value="suspended"${c.status === 'suspended' ? ' selected' : ''}>Suspended: every login blocked, nothing deleted</option>
        </select>

        <div class="form-section">Internal notes</div>
        <label class="field"><span>Only platform admins see these</span><textarea name="notes" maxlength="5000" rows="4">${esc(c.notes || '')}</textarea></label>

        <div class="error-text mt hidden" data-err></div>
        <div class="row mt-lg" style="flex-wrap:wrap">
          <span class="grow small muted">Each change is written to the company's activity feed.</span>
          <button type="button" class="btn" data-undo>Undo changes</button>
          <button type="submit" class="btn primary" data-save>Save changes</button>
        </div>
      </form>`;
    const form = $('[data-form]', host);
    paintLogo();
    $('[data-undo]', host).addEventListener('click', () => drawTab());
    form.addEventListener('submit', (e) => { e.preventDefault(); save($('[data-save]', host)); });

    async function save(btn) {
      const box = $('[data-err]', host);
      box.classList.add('hidden');
      const d = formData(form);
      if (!d.name.trim()) {
        box.textContent = 'Company name is required.';
        box.classList.remove('hidden');
        form.name.focus();
        return;
      }
      if (d.status === 'suspended' && state.c.status === 'active' &&
        !(await confirmDialog('Suspend ' + state.c.name + '? Every login is blocked straight away until you re-activate it.', { ok: 'Save and suspend', danger: true }))) return;
      await busy(btn, async () => {
        try {
          const r = await patch('/admin/companies/' + id, d);
          if (!r.changed.length) { toast('Nothing changed'); return; }
          toast('Saved: ' + r.changed.map((k) => FIELD_LABELS[k] || k).join(', '), 'ok');
          if (r.changed.includes('slug') && r.slug !== d.slug.trim()) toast('That address was taken or reshaped; the public page is now /p/' + r.slug);
          await refresh();
        } catch (err) {
          box.textContent = err.message;
          box.classList.remove('hidden');
        }
      });
    }

    // The logo saves on its own, so unsaved form edits survive an upload.
    function paintLogo() {
      const row = $('[data-logo-row]', host);
      row.innerHTML = `<div class="row" style="gap:14px;flex-wrap:wrap">${logoBox(state.c, 64)}
        <div class="grow" style="min-width:200px"><b>Logo</b><div class="small muted">Shown on the public page, share links and in the company's workspace.</div>
          <div class="row mt" style="gap:8px"><label class="btn sm">${icon('upload')} ${state.c.logo ? 'Replace logo' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-logo-file></label>
          ${state.c.logo ? '<button type="button" class="btn sm" data-logo-remove>Remove logo</button>' : ''}</div></div></div>`;
      $('[data-logo-file]', row).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('logo', file);
        try {
          await api.upload('/company/logo', fd);
          toast('Logo updated', 'ok');
          await refresh({ redraw: false });
          paintLogo();
        } catch (err) { toastError(err); }
      });
      $('[data-logo-remove]', row)?.addEventListener('click', async () => {
        if (!(await confirmDialog('Remove the logo of ' + state.c.name + '?', { ok: 'Remove' }))) return;
        try {
          await api.del('/company/logo');
          toast('Logo removed');
          await refresh({ redraw: false });
          paintLogo();
        } catch (err) { toastError(err); }
      });
    }
  }

  /* ------------------------------------------------------ plan & billing */
  async function billing(host) {
    const [b, plans] = await Promise.all([get('/admin/companies/' + id + '/billing'), plansFor(id)]);
    const c = state.c;
    const st = b.state;
    const offer = b.renewal;
    // What they paid last time for the plan they are on: the "old price" a renewal can keep.
    const last = b.payments.find((p) => p.status === 'paid' && p.plan_id === b.plan_id);
    const lastPrice = last ? last.list_price : null;
    const options = (sel) => plans.map((p) => planOption(p, sel)).join('');
    host.innerHTML = `
      <div class="dash-split" style="margin-bottom:16px">
        <div class="card card-pad">
          <div class="small muted">Current plan</div>
          <h2 style="font-size:20px;margin-top:2px">${esc(b.plan ? b.plan.name : 'No plan')} ${statePill(st)}</h2>
          <div class="small muted" style="margin-top:4px">${b.plan_expires_at ? 'Valid until <b>' + fdate(b.plan_expires_at) + '</b>' + (st.days_left >= 0 ? ' · ' + st.days_left + ' day' + (st.days_left === 1 ? '' : 's') + ' left' : st.status === 'grace' ? ' · grace period until ' + fdate(st.grace_until) : '') : 'No end date'}${b.plan_started_at ? ' · on it since ' + fdate(b.plan_started_at) : ''}</div>
          ${b.plan ? '<div class="small faint" style="margin-top:2px">Catalogue price ' + amt(b.plan.price, b.plan.currency) + ' / ' + per(b.plan.duration_days) + ' · ' + c.max_mediums.toLocaleString() + ' media, ' + c.max_users + ' logins</div>' : ''}
          <div class="row mt-lg" style="flex-wrap:wrap;gap:8px">
            <button class="btn primary" data-b="record">${icon('rupee')} Record a payment</button>
            <button class="btn" data-b="plan">Change plan or end date</button>
            <button class="btn" data-b="custom">${icon('plus')} Custom plan</button>
          </div>
          <div class="small faint mt">A payment you record activates the plan at once and emails a receipt. "Change plan or end date" records no payment: for trials, goodwill extensions and corrections.</div>
        </div>
        <form class="card" data-renewal novalidate>
          <div class="card-head"><h3>${icon('calendar')} Renewal</h3></div>
          <div class="card-pad">
            <p class="small muted">What ${esc(c.name)} is offered when it renews, by you or by its admins from their Plan &amp; billing page.</p>
            <label class="field mt"><span>Renews as</span><select name="renew_plan_id"><option value="">The plan it is on${b.plan ? ' (' + esc(b.plan.name) + ')' : ''}</option>${options(b.renew_plan_id)}</select></label>
            <label class="field mt"><span>Price</span><input type="number" name="renew_price" min="0" step="0.01" value="${b.renew_price ?? ''}" placeholder="Blank = the plan's price at the time"></label>
            <div class="row wrap" style="gap:6px;margin-top:6px">
              ${lastPrice !== null ? '<button type="button" class="btn sm" data-price="' + lastPrice + '">Keep the price they paid last time (' + amt(lastPrice, last.currency) + ')</button>' : ''}
              <button type="button" class="btn sm ghost" data-price="">Use the plan's current price</button>
            </div>
            <label class="check mt"><input type="checkbox" name="renew_locked"${b.renew_locked ? ' checked' : ''}> Only this plan: the company cannot choose another one</label>
            <div class="note-box mt" style="margin-bottom:0">${icon('bulb')}<div>${offer ? 'Next renewal: <b>' + esc(offer.plan_name) + '</b> at <b>' + amt(offer.price, offer.currency) + '</b> for ' + offer.duration_days + ' days' + (offer.custom_price ? ' (catalogue price ' + amt(offer.list_price, offer.currency) + ')' : '') + (offer.locked ? ', no other choice.' : '.') : 'No plan yet, so no renewal.'}</div></div>
          </div>
          <div class="modal-foot"><button class="btn primary" type="submit">Save renewal</button></div>
        </form>
      </div>
      ${b.plans.some((p) => p.company_id) ? '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Custom plans for ' + esc(c.name) + '</h3></div><div class="list-rows">' +
        b.plans.filter((p) => p.company_id).map((p) => '<div><div class="grow"><b>' + esc(p.name) + '</b> <span class="small muted">' + amt(p.price, p.currency) + ' / ' + per(p.duration_days) + ' · ' + p.max_mediums.toLocaleString() + ' media, ' + p.max_users + ' logins</span>' + (p.is_active ? '' : ' <span class="pill">Retired</span>') + '</div><button class="btn sm" data-edit-plan="' + p.id + '">' + icon('edit') + ' Edit</button></div>').join('') + '</div></div>' : ''}
      <div class="card"><div class="card-head"><h3>Payments</h3><span class="small muted">${b.payments.filter((p) => p.status === 'paid').length} paid · ${amt(b.payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0))} in total</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Receipt</th><th>Plan</th><th>Covers</th><th>Method</th><th class="right">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${paymentRows(b.payments, { company: false }) || '<tr><td colspan="7" class="empty">No payments yet.</td></tr>'}</tbody></table></div></div>`;

    const renewal = $('[data-renewal]', host);
    renewal.addEventListener('click', (e) => {
      const p = e.target.closest('[data-price]');
      if (p) renewal.renew_price.value = p.dataset.price;
    });
    renewal.addEventListener('submit', (e) => {
      e.preventDefault();
      busy($('button[type=submit]', renewal), async () => {
        try {
          const d = formData(renewal);
          await patch('/admin/companies/' + id + '/renewal', { renew_plan_id: d.renew_plan_id || null, renew_price: d.renew_price === '' ? null : d.renew_price, renew_locked: d.renew_locked });
          toast('Renewal saved', 'ok');
          drawTab();
        } catch (err) { toastError(err); }
      });
    });
    const again = () => refresh();
    host.addEventListener('click', (e) => {
      const settle = e.target.closest('[data-settle]');
      if (settle) settlePayment({ ...b.payments.find((p) => p.id === Number(settle.closest('tr').dataset.pid)), company_name: c.name }, settle.dataset.settle, again);
      const ep = e.target.closest('[data-edit-plan]');
      if (ep) planModal({ plan: b.plans.find((p) => p.id === Number(ep.dataset.editPlan)), company: c, onSaved: () => drawTab() });
      const btn = e.target.closest('[data-b]');
      if (!btn) return;
      if (btn.dataset.b === 'custom') planModal({ company: c, onSaved: () => drawTab() });
      if (btn.dataset.b === 'record') recordPayment(b, plans, again);
      if (btn.dataset.b === 'plan') changePlan(b, plans, again);
    });
  }

  function recordPayment(b, plans, again) {
    const offer = b.renewal;
    const sel = (offer && offer.plan_id) || b.plan_id || (plans[0] && plans[0].id);
    const priceOf = (pid) => { const p = plans.find((x) => x.id === pid); return offer && offer.plan_id === pid ? offer.price : p ? p.price : 0; };
    const body = el(`<form novalidate autocomplete="off">
      <p class="muted">Money received outside the app (bank transfer, cheque, cash). The plan starts at once and ${esc(state.c.name)}'s admins get a receipt.</p>
      <label class="field"><span>Plan</span><select name="plan_id">${plans.map((p) => planOption(p, sel)).join('')}</select></label>
      <div class="grid-2 mt">
        <label class="field"><span>Amount received</span><input type="number" name="amount" min="0" step="0.01" data-amount></label>
        <label class="field"><span>Coupon (optional)</span><input type="text" name="coupon" maxlength="40" style="text-transform:uppercase"></label>
        <label class="field"><span>Reference (UTR, cheque no.)</span><input type="text" name="reference" maxlength="160"></label>
        <label class="field"><span>Valid until (optional)</span><input type="date" name="period_end"></label>
      </div>
      <div class="small faint" style="margin-top:4px" data-hint></div>
      <label class="field mt"><span>Notes</span><input type="text" name="notes" maxlength="500"></label>
      <div class="error-text mt hidden" data-err></div>
    </form>`);
    const m = modal({ title: 'Record a payment', body, foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Record and activate</button>' });
    const hint = () => {
      const pid = Number(body.plan_id.value);
      const p = plans.find((x) => x.id === pid);
      body.amount.placeholder = String(priceOf(pid));
      const extends_ = b.plan_id === pid && b.plan_expires_at && b.plan_expires_at >= todayISO();
      $('[data-hint]', body).textContent = 'Blank amount = ' + amt(priceOf(pid), p && p.currency) + (offer && offer.plan_id === pid && offer.custom_price ? ' (their renewal price)' : '') +
        '. Blank "valid until" = ' + (p ? p.duration_days : '') + ' days ' + (extends_ ? 'after the current end, ' + fdate(b.plan_expires_at) : 'from today') + '.';
    };
    body.plan_id.addEventListener('change', hint);
    hint();
    $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const box = $('[data-err]', m.el);
      box.classList.add('hidden');
      try {
        const r = await post('/admin/companies/' + id + '/payments', formData(body));
        m.close();
        toast('Payment recorded. ' + r.payment.plan_name + ' active until ' + fdate(r.payment.period_end), 'ok');
        again();
      } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
    }));
  }

  function changePlan(b, plans, again) {
    const body = el(`<form novalidate>
      <p class="muted">No payment is recorded. Use it for a trial, a goodwill extension or to correct a mistake.</p>
      <label class="field"><span>Plan</span><select name="plan_id">${plans.map((p) => planOption(p, b.plan_id)).join('')}</select></label>
      <label class="field mt"><span>Valid until</span><input type="date" name="plan_expires_at" value="${esc(b.plan_expires_at || '')}"></label>
      <label class="check small mt"><input type="checkbox" data-no-end${b.plan_expires_at ? '' : ' checked'}> No end date</label>
      <div class="small faint mt">A different plan also sets its media and login limits.</div>
      <div class="error-text mt hidden" data-err></div>
    </form>`);
    const m = modal({ title: 'Change plan or end date', body, size: 'narrow', foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>' });
    const noEnd = $('[data-no-end]', body);
    const sync = () => { body.plan_expires_at.disabled = noEnd.checked; };
    noEnd.addEventListener('change', sync);
    sync();
    $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const box = $('[data-err]', m.el);
      box.classList.add('hidden');
      try {
        await patch('/admin/companies/' + id + '/plan', { plan_id: Number(body.plan_id.value), plan_expires_at: noEnd.checked ? null : body.plan_expires_at.value });
        m.close();
        toast('Plan updated', 'ok');
        again();
      } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
    }));
  }

  /* ------------------------------------------------------------ logins */
  async function logins(host) {
    await load(); // sign-in times change while the page is open
    const { c, users } = state;
    host.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Logins <span class="small faint">${users.length} of ${c.max_users}</span></h3><button class="btn sm primary" data-add>${icon('plus')} Add login</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email (login)</th><th>Role</th><th>Status</th><th>Last active</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr data-uid="${u.id}">
          <td><div class="row" style="flex-wrap:nowrap"><div class="avatar" style="width:28px;height:28px;font-size:11px">${esc(initials(u.name))}</div><div><b>${esc(u.name)}</b>${u.phone ? '<div class="small faint">' + esc(u.phone) + '</div>' : ''}</div></div></td>
          <td class="small">${esc(u.email)}</td>
          <td><span class="pill info">${esc(u.role)}</span></td>
          <td>${u.status === 'active' ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Suspended</span>'}</td>
          <td class="small">${signinState(u)}</td>
          <td class="nowrap"><button class="btn sm icon" data-u="edit" title="Edit name, email, mobile or role">${icon('edit')}</button>
            <button class="btn sm" data-u="reset">Reset password</button>
            <button class="btn sm" data-u="logout" title="End this person's sessions on every device">Sign out</button>
            <button class="btn sm" data-u="toggle">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
            <button class="btn sm icon danger" data-u="del" title="Delete this login">${icon('trash')}</button></td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No logins.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="note-box mt-lg">${icon('lock')}<div><b>Passwords are never visible, not even to you.</b> They are stored one-way encrypted. "Reset password" issues a new temporary one that the person must change when they next sign in. "Sign out" ends their sessions on every device without changing the password.</div></div>`;

    const again = () => { if (state.tab === 'logins') drawTab(); };
    $('[data-add]', host).addEventListener('click', () => userModal({
      onSave: async (d) => { const r = await post('/admin/companies/' + id + '/users', d); again(); showAccountHandover(r.account, { phone: r.phone }); },
    }));
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-u]');
      const tr = e.target.closest('tr[data-uid]');
      if (!b || !tr) return;
      const u = state.users.find((x) => x.id === Number(tr.dataset.uid));
      try {
        switch (b.dataset.u) {
          case 'edit':
            userModal({
              user: u, editEmail: true,
              onSave: async (d) => {
                await patch('/admin/users/' + u.id, d);
                const email = String(d.email || '').trim().toLowerCase();
                toast(email && email !== u.email ? 'Saved. ' + u.name + ' now signs in with ' + email : 'Saved', 'ok');
                again();
              },
            });
            break;
          case 'reset':
            resetPassword(u, (d) => patch('/admin/users/' + u.id, d), again);
            break;
          case 'logout':
            if (!(await confirmDialog('Sign ' + u.name + ' out of every device? Their password stays the same; they just sign in again.', { ok: 'Sign out everywhere' }))) return;
            await post('/admin/users/' + u.id + '/logout-all');
            toast(u.name + ' was signed out everywhere', 'ok');
            break;
          case 'toggle':
            if (u.status === 'active' && !(await confirmDialog('Suspend ' + u.name + '? They cannot sign in until the login is activated again.', { ok: 'Suspend', danger: true }))) return;
            await patch('/admin/users/' + u.id, { status: u.status === 'active' ? 'suspended' : 'active' });
            again();
            break;
          case 'del':
            if (!(await confirmDialog('Delete the login ' + u.email + '? This cannot be undone.', { ok: 'Delete', danger: true }))) return;
            await del('/admin/users/' + u.id);
            toast('Login deleted');
            again();
            break;
          default: break;
        }
      } catch (err) { toastError(err); }
    });
  }

  /* ------------------------------------------------------------- media */
  async function media(host) {
    const { mediums } = await api.get('/mediums');
    const cur = state.c.currency;
    const f = { q: '', status: '', listed: '' };
    host.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="search" data-q class="grow" style="max-width:300px" placeholder="Search code, title, area or city" aria-label="Search media">
          <select data-mf="status" style="max-width:170px" aria-label="Status"><option value="">All statuses</option>${['available', 'on_hold', 'booked', 'maintenance', 'inactive'].map((k) => '<option value="' + k + '">' + STATUS[k].label + '</option>').join('')}</select>
          <select data-mf="listed" style="max-width:200px" aria-label="Marketplace"><option value="">Listed or not</option><option value="1">On the marketplace</option><option value="0">Not listed</option></select>
          <span class="grow small muted" data-count></span>
          <button class="btn sm" data-unlist>Unlist all</button>
          <button class="btn sm" data-ws>${icon('map')} Open on the map</button>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Board</th><th>Type</th><th>Location</th><th>Status</th><th>Current client</th><th class="right">Rate / month</th><th>Marketplace</th></tr></thead><tbody data-rows></tbody></table></div>
      </div>`;
    const rows = $('[data-rows]', host);
    function paint() {
      const q = f.q.trim().toLowerCase();
      const list = mediums.filter((m) => (!f.status || m.status === f.status) && (f.listed === '' || String(m.is_public ? 1 : 0) === f.listed) &&
        (!q || [m.code, m.title, m.area, m.city, m.address, m.landmark].some((v) => String(v || '').toLowerCase().includes(q))));
      $('[data-count]', host).textContent = list.length === mediums.length ? mediums.length + ' boards' : list.length + ' of ' + mediums.length + ' boards';
      paged(rows, list, (m) => `
        <tr class="click" data-mid="${m.id}">
          <td><b>${esc(m.code)}</b><div class="small muted ellipsis" style="max-width:260px">${esc(m.title)}</div></td>
          <td class="small">${esc(typeInfo(m.type).label)}</td>
          <td class="small">${esc([m.area, m.city].filter(Boolean).join(', '))}</td>
          <td>${pill(m.status)}${m.open_issues ? ' <span class="pill warn">' + m.open_issues + ' problem' + (m.open_issues > 1 ? 's' : '') + '</span>' : ''}</td>
          <td class="small">${m.booking ? esc(m.booking.client_name) + '<div class="faint">until ' + fdate(m.booking.end_date) + '</div>' : '<span class="faint">—</span>'}</td>
          <td class="right num">${m.rate_month ? money(m.rate_month, cur) : '—'}</td>
          <td><label class="check small" data-stop><input type="checkbox" data-pub${m.is_public ? ' checked' : ''}> Listed</label>${m.is_public && m.condition_status !== 'active' ? '<div class="small faint">hidden while ' + esc(m.condition_status) + '</div>' : ''}</td>
        </tr>`, { step: 200, colspan: 7, empty: '<tr><td colspan="7" class="empty">' + (mediums.length ? 'No board matches.' : 'This company has not added any media yet.') + '</td></tr>' });
    }
    paint();

    $('[data-q]', host).addEventListener('input', (e) => { f.q = e.target.value; paint(); });
    $$('[data-mf]', host).forEach((s) => s.addEventListener('change', () => { f[s.dataset.mf] = s.value; paint(); }));
    $('[data-unlist]', host).addEventListener('click', (e) => unlistAll(e.currentTarget));
    $('[data-ws]', host).addEventListener('click', () => openCompany(id, '/map'));
    rows.addEventListener('change', async (e) => {
      const cb = e.target.closest('[data-pub]');
      if (!cb) return;
      const m = mediums.find((x) => x.id === Number(cb.closest('tr').dataset.mid));
      cb.disabled = true;
      try {
        await api.post('/mediums/publish', { ids: [m.id], is_public: cb.checked });
        m.is_public = cb.checked ? 1 : 0;
        toast(m.code + (cb.checked ? ' is now on' : ' was taken off') + ' the marketplace', 'ok');
      } catch (err) {
        cb.checked = !cb.checked;
        toastError(err);
      } finally { cb.disabled = false; }
    });
    rows.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) return;
      const tr = e.target.closest('tr[data-mid]');
      if (tr) openCompany(id, '/map?open=' + tr.dataset.mid);
    });
  }

  /* ---------------------------------------------------------- bookings */
  async function bookings(host) {
    const cur = state.c.currency;
    const f = { q: '', period: '', payment: '', status: '' };
    host.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="search" data-q class="grow" style="max-width:280px" placeholder="Client, campaign, board or invoice" aria-label="Search bookings">
          <select data-bf="period" style="max-width:170px" aria-label="When"><option value="">Any time</option><option value="current">Running now</option><option value="upcoming">Upcoming</option><option value="expiring">Ending in 7 days</option><option value="past">Ended</option></select>
          <select data-bf="payment" style="max-width:170px" aria-label="Payment"><option value="">Any payment</option><option value="due">Not fully paid</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option></select>
          <select data-bf="status" style="max-width:200px" aria-label="Status"><option value="">Holds and confirmed</option><option value="confirmed">Confirmed</option><option value="hold">Holds</option><option value="cancelled">Cancelled</option></select>
        </div>
        <div class="small muted" data-totals style="padding:10px 14px;border-bottom:1px solid var(--line)"></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Board</th><th>Client</th><th>Dates</th><th>Status</th><th class="right">Amount</th><th class="right">Paid</th><th>Payment</th></tr></thead>
        <tbody data-rows><tr><td colspan="7" class="empty">Loading…</td></tr></tbody></table></div>
      </div>`;
    const PHASE = { current: 'running', upcoming: 'upcoming', past: 'ended' };
    const STAT = { confirmed: '<span class="pill ok">Confirmed</span>', hold: '<span class="pill warn">Hold</span>', cancelled: '<span class="pill">Cancelled</span>' };
    let seq = 0;
    async function fetchRows() {
      const mine = ++seq;
      let r;
      try { r = await api.get('/bookings', f); } catch (err) { toastError(err); return; }
      if (mine !== seq) return; // a newer search is on its way
      const t = r.totals;
      const n = r.bookings.length;
      $('[data-totals]', host).innerHTML = n + ' booking' + (n === 1 ? '' : 's') + (n >= 1000 ? ' (the latest 1000)' : '') +
        (f.status === 'cancelled' ? '' : ' · <b>' + money(t.amount, cur) + '</b> total · ' + money(t.paid, cur) + ' paid · <b class="' + (t.due > 0 ? 'neg' : '') + '">' + money(t.due, cur) + '</b> due');
      $('[data-rows]', host).innerHTML = n ? r.bookings.map((b) => `
        <tr class="click" data-mid="${b.medium_id}">
          <td><b>${esc(b.code)}</b><div class="small muted ellipsis" style="max-width:220px">${esc(b.title)}</div></td>
          <td><b>${esc(b.client_name)}</b>${b.campaign ? '<div class="small faint">' + esc(b.campaign) + '</div>' : ''}</td>
          <td class="small nowrap">${fdate(b.start_date)} – ${fdate(b.end_date)}<div class="faint">${b.days} days · ${PHASE[b.phase] || ''}</div></td>
          <td>${STAT[b.status] || esc(b.status)}</td>
          <td class="right num">${money(b.amount, cur)}</td>
          <td class="right num">${money(b.amount_paid, cur)}</td>
          <td>${payPill(b.payment_status)}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty">No bookings match.</td></tr>';
    }
    let timer = null;
    $('[data-q]', host).addEventListener('input', (e) => {
      f.q = e.target.value.trim();
      clearTimeout(timer);
      timer = setTimeout(fetchRows, 300);
    });
    $$('[data-bf]', host).forEach((s) => s.addEventListener('change', () => { f[s.dataset.bf] = s.value; fetchRows(); }));
    $('[data-rows]', host).addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-mid]');
      if (tr) openCompany(id, '/map?open=' + tr.dataset.mid);
    });
    await fetchRows();
  }

  /* --------------------------------------------------------------- p&l */
  async function pnl(host) {
    renderPnl(host, {
      api, currency: state.c.currency, links: false, canEdit: true,
      fileName: state.c.slug + '-profit-loss',
    });
  }

  /* ---------------------------------------------------------- activity */
  async function activity(host) {
    host.innerHTML = `<div class="card">
      <div class="card-head"><h3>Activity</h3><span class="small muted">Everything done in this company, newest first. Your own changes are marked "Platform admin".</span></div>
      <div class="list-rows" data-list></div>
      <div class="card-pad" data-more-wrap hidden><button class="btn sm" data-more>Load older</button></div>
    </div>`;
    let before = 0;
    async function page() {
      const r = await get('/admin/companies/' + id + '/activity', { limit: 50, before: before || undefined });
      const list = $('[data-list]', host);
      if (!before && !r.entries.length) list.innerHTML = '<div class="empty">Nothing recorded yet.</div>';
      list.insertAdjacentHTML('beforeend', r.entries.map(activityRow).join(''));
      if (r.entries.length) before = r.entries[r.entries.length - 1].id;
      $('[data-more-wrap]', host).hidden = !r.more;
    }
    $('[data-more]', host).addEventListener('click', (e) => busy(e.currentTarget, () => page().catch(toastError)));
    await page();
  }

  /* ------------------------------------------------------------ danger */
  async function danger(host) {
    await load();
    const { c, counts, users } = state;
    const active = c.status === 'active';
    host.innerHTML = `
      <div class="card danger-zone">
        <div class="card-head"><h3 style="color:var(--danger)">Danger zone</h3><span class="small muted">Each action is recorded in the company's activity feed.</span></div>
        <div class="list-rows">
          <div><div class="grow"><b>Take every board off the marketplace</b><div class="small muted">${counts.listed} of ${counts.mediums} boards are listed now. Use it after a complaint or a pricing dispute; the company can list them again.</div></div>
            <button class="btn" data-x="unlist">Unlist all</button></div>
          <div><div class="grow"><b>Sign out every login</b><div class="small muted">Ends all sessions of all ${users.length} logins on every device, for example after a leaked password. Passwords stay the same.</div></div>
            <button class="btn" data-x="logout">Sign everyone out</button></div>
          <div><div class="grow"><b>${active ? 'Suspend the account' : 'Re-activate the account'}</b><div class="small muted">${active ? 'Blocks every login, stops share links and hides the boards from the marketplace. Nothing is deleted.' : 'Logins, share links and listed boards work again straight away.'}</div></div>
            <button class="btn${active ? ' danger' : ''}" data-x="status">${active ? 'Suspend' : 'Re-activate'}</button></div>
          <div><div class="grow"><b>Delete the company</b><div class="small muted">Removes the company with all its logins, media, photos, bookings, expenses, share links and customer requests. This cannot be undone.</div></div>
            <button class="btn danger solid" data-x="delete">${icon('trash')} Delete company</button></div>
        </div>
      </div>`;
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'unlist') unlistAll(b);
      else if (b.dataset.x === 'status') toggleStatus(b);
      else if (b.dataset.x === 'logout') {
        if (!(await confirmDialog('Sign all ' + users.length + ' logins of ' + c.name + ' out of every device? They sign in again with their current passwords.', { ok: 'Sign everyone out', danger: true }))) return;
        busy(b, async () => {
          try {
            const r = await post('/admin/companies/' + id + '/logout-all');
            toast(r.users + ' login' + (r.users === 1 ? '' : 's') + ' signed out everywhere', 'ok');
          } catch (err) { toastError(err); }
        });
      } else if (b.dataset.x === 'delete') {
        const m = modal({
          title: 'Delete ' + c.name, size: 'narrow',
          body: '<p>This permanently removes the company and everything in it. Type <b>' + esc(c.name) + '</b> to confirm.</p><input type="text" data-confirm autocomplete="off" aria-label="Company name">',
          foot: '<button class="btn" data-close>Cancel</button><button class="btn danger solid" data-go>Delete forever</button>',
        });
        $('[data-go]', m.el).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
          try {
            await del('/admin/companies/' + id, { confirm: $('[data-confirm]', m.el).value });
            m.close();
            toast('Company deleted');
            navigate('/admin');
          } catch (err) { toastError(err); }
        }));
      }
    });
  }

  paintHead();
  await drawTab();
  return undefined;
}
