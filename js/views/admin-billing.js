// Platform console: the plan catalogue (and custom plans), coupons, every
// payment, and which companies need to renew.
import { get, post, patch, del } from '../api.js';
import { $, $$, el, esc, fdate, ago, modal, toast, toastError, busy, formData, confirmDialog, todayISO } from '../ui.js';
import { icon } from '../icons.js';
import { navigate } from '../app.js';
import { amt, per, statePill, GATEWAYS, receiptNo, payStatus } from './billing.js';

const TABS = [['renewals', 'Renewals'], ['plans', 'Plans'], ['coupons', 'Coupons'], ['payments', 'Payments']];

export async function render(root, params, query = {}) {
  let tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'renewals';
  const ov = await get('/admin/billing/overview');
  root.innerHTML = `
    <div class="page-head"><h1>Plans &amp; billing</h1>
      <a class="btn" href="/admin/settings?tab=payments" data-link>${icon('settings')} Payment &amp; email settings</a></div>
    <div class="stats">
      <div class="card stat accent"><div class="label">Received, last 30 days</div><div class="value">${amt(ov.revenue.last_30)}</div><div class="sub">${amt(ov.revenue.this_month)} this month · ${amt(ov.revenue.all_time)} all time</div></div>
      <div class="card stat"><div class="label">Plans running</div><div class="value">${ov.counts.active}</div><div class="sub">${ov.counts.no_end} with no end date</div></div>
      <div class="card stat"><div class="label">Ending within ${ov.warn_days} days</div><div class="value" style="color:${ov.counts.expiring ? 'var(--st-on_hold)' : 'inherit'}">${ov.counts.expiring}</div><div class="sub">reminders go out by email</div></div>
      <div class="card stat"><div class="label">Expired</div><div class="value${ov.counts.expired ? ' neg' : ''}">${ov.counts.expired}</div><div class="sub">waiting to renew</div></div>
      <div class="card stat"><div class="label">Bank transfers to confirm</div><div class="value">${ov.counts.pending_manual}</div><div class="sub"><a href="/admin/billing?tab=payments" data-tab-link="payments">See payments</a></div></div>
    </div>
    <div class="tabs wide" data-tabs>${TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (k === tab ? ' class="on"' : '') + '>' + l + '</button>').join('')}</div>
    <div data-body style="margin-top:16px"></div>`;

  function setTab(k) {
    tab = k;
    $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    history.replaceState({}, '', '/admin/billing' + (k === 'renewals' ? '' : '?tab=' + k));
    draw();
  }
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]') || e.target.closest('[data-tab-link]');
    if (t) { e.preventDefault(); setTab(t.dataset.tab || t.dataset.tabLink); }
  });

  async function draw() {
    const host = document.createElement('div');
    $('[data-body]', root).replaceChildren(host);
    host.innerHTML = '<div class="card"><div class="empty">Loading…</div></div>';
    try { await { renewals, plans, coupons, payments }[tab](host, draw); } catch (err) {
      host.innerHTML = '<div class="card"><div class="empty">' + esc(err.message) + '</div></div>';
    }
  }
  await draw();
  return undefined;
}

/* -------------------------------------------------------------- renewals */

async function renewals(host) {
  const { companies } = await get('/admin/companies');
  const order = { lapsed: 0, grace: 1, expiring: 2, active: 3, none: 4 };
  const list = companies.filter((c) => c.plan_state).sort((a, b) => order[a.plan_state.status] - order[b.plan_state.status] ||
    String(a.plan_state.expires || '9999').localeCompare(String(b.plan_state.expires || '9999')));
  host.innerHTML = `<div class="card">
    <div class="card-head"><h3>Every company's plan</h3><span class="small muted">Soonest to end first. Open one to record a payment or decide its renewal.</span></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Company</th><th>Plan</th><th>Valid until</th><th>State</th><th>Last active</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr class="click" data-id="${c.id}">
      <td><b>${esc(c.name)}</b><div class="small faint">${esc(c.contact_email || c.city || '')}</div></td>
      <td>${esc(c.plan_name || c.plan || '—')}</td>
      <td class="nowrap">${c.plan_expires_at ? fdate(c.plan_expires_at) : '<span class="faint">No end date</span>'}</td>
      <td>${statePill(c.plan_state)}${c.status !== 'active' ? ' <span class="pill bad">Suspended</span>' : ''}</td>
      <td class="small">${c.last_active ? ago(c.last_active) : '<span class="faint">never</span>'}</td>
      <td><button class="btn sm">Plan &amp; billing</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No companies yet.</td></tr>'}
    </tbody></table></div></div>`;
  host.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) navigate('/admin/companies/' + tr.dataset.id + '?tab=billing');
  });
}

/* ----------------------------------------------------------------- plans */

const DURATIONS = [[30, 'Monthly (30 days)'], [90, 'Quarterly (90 days)'], [180, 'Half-yearly (180 days)'], [365, 'Yearly (365 days)']];

/**
 * Create or edit a plan. `company` set: a custom plan only that company can buy
 * (an agreed price or limits). Shared with the company page.
 */
export async function planModal({ plan = null, company = null, onSaved }) {
  const { companies } = company ? { companies: [] } : await get('/admin/companies');
  const p = plan || { currency: 'INR', duration_days: 30, is_public: true, is_active: true, features: [], sort: 0, company_id: company ? company.id : null };
  const custom = DURATIONS.every(([d]) => d !== p.duration_days);
  const body = el(`<form novalidate autocomplete="off">
    <div class="grid-2">
      <label class="field"><span>Plan name *</span><input type="text" name="name" maxlength="80" value="${esc(p.name || '')}" placeholder="e.g. Growth"></label>
      <label class="field"><span>For</span>${company
    ? '<input type="text" value="' + esc(company.name) + ' only (custom plan)" disabled><input type="hidden" name="company_id" value="' + company.id + '">'
    : '<select name="company_id"><option value="">Everyone (the plan catalogue)</option>' + companies.map((c) => '<option value="' + c.id + '"' + (c.id === p.company_id ? ' selected' : '') + '>' + esc(c.name) + ' only (custom)</option>').join('') + '</select>'}</label>
    </div>
    <label class="field mt"><span>Short description</span><input type="text" name="description" maxlength="500" value="${esc(p.description || '')}"></label>
    <div class="grid-4 mt">
      <label class="field"><span>Price *</span><input type="number" name="price" min="0" step="0.01" value="${p.price ?? ''}"></label>
      <label class="field"><span>Currency</span><input type="text" name="currency" maxlength="3" value="${esc(p.currency || 'INR')}"></label>
      <label class="field"><span>Billed</span><select data-dur>${DURATIONS.map(([d, l]) => '<option value="' + d + '"' + (d === p.duration_days ? ' selected' : '') + '>' + l + '</option>').join('')}<option value="custom"${custom ? ' selected' : ''}>Other length…</option></select></label>
      <label class="field"><span>Length in days *</span><input type="number" name="duration_days" min="1" max="3650" value="${p.duration_days}"${custom ? '' : ' readonly'}></label>
      <label class="field"><span>Media limit *</span><input type="number" name="max_mediums" min="1" value="${p.max_mediums ?? ''}"></label>
      <label class="field"><span>Login limit *</span><input type="number" name="max_users" min="1" value="${p.max_users ?? ''}"></label>
      <label class="field"><span>Order on the page</span><input type="number" name="sort" value="${p.sort || 0}"></label>
    </div>
    <label class="field mt"><span>What's included (one line each, shown on the plan card)</span><textarea name="features" rows="4" maxlength="1600">${esc((p.features || []).join('\n'))}</textarea></label>
    <div class="row mt" style="gap:20px;flex-wrap:wrap">
      <label class="check"${company || p.company_id ? ' hidden' : ''} data-public-wrap><input type="checkbox" name="is_public"${p.is_public ? ' checked' : ''}> Companies can choose it themselves</label>
      <label class="check"><input type="checkbox" name="is_active"${p.is_active ? ' checked' : ''}> Available (off = retired: kept for history, nobody can buy it)</label>
    </div>
    ${plan ? '<div class="small faint mt">A new price applies from the next payment. What companies already paid stays as it is.</div>' : ''}
    <div class="error-text mt hidden" data-err></div>
  </form>`);
  const m = modal({ title: plan ? 'Edit ' + plan.name : company ? 'Custom plan for ' + company.name : 'New plan', body, size: 'wide',
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>' + (plan ? 'Save plan' : 'Create plan') + '</button>' });
  $('[data-dur]', body).addEventListener('change', (e) => {
    const custom2 = e.target.value === 'custom';
    body.duration_days.readOnly = !custom2;
    if (!custom2) body.duration_days.value = e.target.value; else body.duration_days.focus();
  });
  body.company_id?.addEventListener?.('change', () => { $('[data-public-wrap]', body).hidden = !!body.company_id.value; });
  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    const d = formData(body);
    d.company_id = d.company_id ? Number(d.company_id) : null;
    try {
      const r = plan ? await patch('/admin/plans/' + plan.id, d) : await post('/admin/plans', d);
      m.close();
      toast(plan ? 'Plan saved' : 'Plan created', 'ok');
      onSaved?.(r.plan);
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  }));
}

async function plans(host, again) {
  const { plans: list } = await get('/admin/plans');
  host.innerHTML = `<div class="card">
    <div class="card-head"><h3>Plans</h3><span class="small muted">The catalogue companies choose from, and custom plans made for one company.</span><button class="btn sm primary" data-new>${icon('plus')} New plan</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Plan</th><th class="right">Price</th><th>Limits</th><th class="right">Companies on it</th><th>Who can buy</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr data-id="${p.id}">
      <td><b>${esc(p.name)}</b><div class="small faint">${esc(p.description || p.slug)}</div></td>
      <td class="right num nowrap"><b>${amt(p.price, p.currency)}</b><div class="small faint">per ${per(p.duration_days)}</div></td>
      <td class="small nowrap">${p.max_mediums.toLocaleString()} media<div class="faint">${p.max_users} logins</div></td>
      <td class="right num">${p.companies}</td>
      <td class="small">${p.company_id ? '<span class="pill info">Custom</span> ' + esc(p.company_name || '') : p.is_public ? 'Everyone' : '<span class="faint">Only you can assign it</span>'}</td>
      <td>${p.is_active ? '<span class="pill ok">Available</span>' : '<span class="pill">Retired</span>'}</td>
      <td class="nowrap"><button class="btn sm icon" data-edit title="Edit">${icon('edit')}</button> <button class="btn sm icon danger" data-del title="Delete or retire">${icon('trash')}</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No plans yet.</td></tr>'}
    </tbody></table></div></div>`;
  $('[data-new]', host).addEventListener('click', () => planModal({ onSaved: again }));
  host.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const p = list.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-edit]')) planModal({ plan: p, onSaved: again });
    if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog('Delete the ' + p.name + ' plan? If any company or payment uses it, it is retired instead (kept for the record, no longer sold).', { ok: 'Delete', danger: true }))) return;
      try { const r = await del('/admin/plans/' + p.id); toast(r.retired ? p.name + ' retired: it is still on record' : p.name + ' deleted', 'ok'); again(); } catch (err) { toastError(err); }
    }
  });
}

/* --------------------------------------------------------------- coupons */

async function couponModal({ coupon = null, onSaved }) {
  const { plans: list } = await get('/admin/plans');
  const c = coupon || { kind: 'percent', per_company: 1, is_active: true, plan_ids: null };
  const body = el(`<form novalidate autocomplete="off">
    <div class="grid-2">
      <label class="field"><span>Code *</span><input type="text" name="code" maxlength="40" value="${esc(c.code || '')}" style="text-transform:uppercase" placeholder="e.g. DIWALI25"></label>
      <label class="field"><span>Note (for you)</span><input type="text" name="description" maxlength="255" value="${esc(c.description || '')}"></label>
      <label class="field"><span>Discount</span><select name="kind"><option value="percent"${c.kind === 'percent' ? ' selected' : ''}>Percent off</option><option value="fixed"${c.kind === 'fixed' ? ' selected' : ''}>Amount off</option></select></label>
      <label class="field"><span>Value *</span><input type="number" name="value" min="0.01" step="0.01" value="${c.value ?? ''}"></label>
      <label class="field"><span>Valid from</span><input type="date" name="valid_from" value="${esc(c.valid_from || '')}"></label>
      <label class="field"><span>Valid until</span><input type="date" name="valid_until" value="${esc(c.valid_until || '')}"></label>
      <label class="field"><span>Total uses (blank = unlimited)</span><input type="number" name="max_uses" min="1" value="${c.max_uses ?? ''}"></label>
      <label class="field"><span>Uses per company</span><input type="number" name="per_company" min="1" max="100" value="${c.per_company || 1}"></label>
    </div>
    <div class="form-section">Works on</div>
    <div class="row wrap" style="gap:8px 18px">${list.filter((p) => p.is_active).map((p) => '<label class="check"><input type="checkbox" name="plan_ids" data-multi value="' + p.id + '"' + ((c.plan_ids || []).includes(p.id) ? ' checked' : '') + '> ' + esc(p.name) + '</label>').join('')}</div>
    <div class="small faint" style="margin-top:4px">None ticked = every plan.</div>
    <label class="check mt"><input type="checkbox" name="is_active"${c.is_active ? ' checked' : ''}> Active</label>
    <div class="error-text mt hidden" data-err></div>
  </form>`);
  const m = modal({ title: coupon ? 'Edit coupon ' + coupon.code : 'New coupon', body,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save coupon</button>' });
  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    const d = formData(body);
    d.plan_ids = d.plan_ids.map(Number);
    try {
      if (coupon) await patch('/admin/coupons/' + coupon.id, d); else await post('/admin/coupons', d);
      m.close();
      toast('Coupon saved', 'ok');
      onSaved?.();
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  }));
}

async function coupons(host, again) {
  const [{ coupons: list }, { plans: plansList }] = await Promise.all([get('/admin/coupons'), get('/admin/plans')]);
  const planName = (id) => (plansList.find((p) => p.id === id) || {}).name || '#' + id;
  const today = todayISO();
  const state = (c) => (!c.is_active ? '<span class="pill">Off</span>'
    : c.valid_until && c.valid_until < today ? '<span class="pill">Expired</span>'
      : c.max_uses && c.used >= c.max_uses ? '<span class="pill">Used up</span>'
        : c.valid_from && c.valid_from > today ? '<span class="pill warn">Starts ' + fdate(c.valid_from) + '</span>' : '<span class="pill ok">Active</span>');
  host.innerHTML = `<div class="card">
    <div class="card-head"><h3>Coupons</h3><span class="small muted">Codes companies type at checkout. You can also apply one when recording a payment.</span><button class="btn sm primary" data-new>${icon('plus')} New coupon</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Works on</th><th>Valid</th><th class="right">Used</th><th class="right">Given away</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr data-id="${c.id}">
      <td><b class="mono">${esc(c.code)}</b>${c.description ? '<div class="small faint">' + esc(c.description) + '</div>' : ''}</td>
      <td class="nowrap">${c.kind === 'percent' ? c.value + '% off' : amt(c.value) + ' off'}</td>
      <td class="small">${c.plan_ids && c.plan_ids.length ? c.plan_ids.map(planName).map(esc).join(', ') : 'Every plan'}</td>
      <td class="small nowrap">${c.valid_from ? fdate(c.valid_from) : 'Now'} – ${c.valid_until ? fdate(c.valid_until) : 'no end'}</td>
      <td class="right num nowrap">${c.used}${c.max_uses ? ' / ' + c.max_uses : ''}<div class="small faint">${c.per_company} per company</div></td>
      <td class="right num">${amt(c.given)}</td>
      <td>${state(c)}</td>
      <td class="nowrap"><button class="btn sm icon" data-edit title="Edit">${icon('edit')}</button> <button class="btn sm icon danger" data-del title="Delete">${icon('trash')}</button></td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No coupons yet.</td></tr>'}
    </tbody></table></div></div>`;
  $('[data-new]', host).addEventListener('click', () => couponModal({ onSaved: again }));
  host.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const c = list.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-edit]')) couponModal({ coupon: c, onSaved: again });
    if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog('Delete coupon ' + c.code + '? If payments used it, it is switched off instead.', { ok: 'Delete', danger: true }))) return;
      try { const r = await del('/admin/coupons/' + c.id); toast(r.retired ? c.code + ' switched off (payments used it)' : c.code + ' deleted', 'ok'); again(); } catch (err) { toastError(err); }
    }
  });
}

/* -------------------------------------------------------------- payments */

/** Confirm a bank transfer (the plan starts) or cancel it. Shared with the company page. */
export async function settlePayment(p, action, onDone) {
  if (action === 'cancel') {
    if (!(await confirmDialog('Cancel payment ' + receiptNo(p.id) + ' (' + amt(p.amount, p.currency) + ')? The plan is not changed.', { ok: 'Cancel payment', danger: true }))) return;
    try { await patch('/admin/payments/' + p.id, { action: 'cancel' }); toast('Payment cancelled'); onDone?.(); } catch (err) { toastError(err); }
    return;
  }
  const m = modal({
    title: 'Confirm ' + receiptNo(p.id), size: 'narrow',
    body: '<p>Did <b>' + amt(p.amount, p.currency) + '</b> from <b>' + esc(p.company_name || 'the company') + '</b> arrive? Confirming starts the ' + esc(p.plan_name) + ' plan straight away and emails a receipt.</p>' +
      '<label class="field"><span>Bank reference (UTR)</span><input type="text" data-ref maxlength="160" value="' + esc(p.reference || '') + '"></label>',
    foot: '<button class="btn" data-close>Not yet</button><button class="btn primary" data-ok>Money received, activate</button>',
  });
  $('[data-ok]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      const r = await patch('/admin/payments/' + p.id, { action: 'confirm', reference: $('[data-ref]', m.el).value });
      m.close();
      toast(p.plan_name + ' active until ' + fdate(r.payment.period_end), 'ok');
      onDone?.();
    } catch (err) { toastError(err); }
  }));
}

export function paymentRows(list, { company = true } = {}) {
  return list.map((p) => `<tr data-pid="${p.id}">
    <td class="nowrap"><b class="mono">${receiptNo(p.id)}</b><div class="small faint">${fdate(p.paid_at || p.created_at, true)}</div></td>
    ${company ? '<td><a href="/admin/companies/' + p.company_id + '?tab=billing" data-link>' + esc(p.company_name) + '</a></td>' : ''}
    <td>${esc(p.plan_name)}${p.coupon_code ? '<div class="small faint">coupon ' + esc(p.coupon_code) + '</div>' : ''}</td>
    <td class="small nowrap">${fdate(p.period_start)} – ${fdate(p.period_end)}</td>
    <td class="small">${esc(GATEWAYS[p.gateway] || p.gateway)}<div class="faint ellipsis" style="max-width:200px">${esc(p.gateway_payment_id || p.reference || '')}</div>${p.created_by_name ? '<div class="faint">by ' + esc(p.created_by_name) + '</div>' : ''}${p.notes ? '<div class="faint" style="max-width:220px">' + esc(p.notes) + '</div>' : ''}</td>
    <td class="right num nowrap"><b>${amt(p.amount, p.currency)}</b>${p.discount ? '<div class="small faint">' + amt(p.list_price, p.currency) + ' − ' + amt(p.discount, p.currency) + '</div>' : ''}</td>
    <td>${payStatus(p.status)}</td>
    <td class="nowrap">${p.status === 'pending' ? '<button class="btn sm primary" data-settle="confirm">Confirm</button> <button class="btn sm" data-settle="cancel">Cancel</button>' : ''}</td>
  </tr>`).join('');
}

async function payments(host, again) {
  let status = '';
  host.innerHTML = `<div class="card">
    <div class="toolbar"><select data-status style="max-width:200px" aria-label="Status">
      <option value="">Every payment</option><option value="pending">Waiting for payment</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option><option value="failed">Failed</option></select>
      <span class="grow small muted" data-count></span></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Receipt</th><th>Company</th><th>Plan</th><th>Covers</th><th>Method</th><th class="right">Amount</th><th>Status</th><th></th></tr></thead><tbody data-rows></tbody></table></div></div>`;
  let list = [];
  async function load() {
    list = (await get('/admin/payments', { status })).payments;
    $('[data-count]', host).textContent = list.length + ' payment' + (list.length === 1 ? '' : 's') + (status ? '' : ' · ' + amt(list.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)) + ' received');
    $('[data-rows]', host).innerHTML = paymentRows(list) || '<tr><td colspan="8" class="empty">No payments.</td></tr>';
  }
  $('[data-status]', host).addEventListener('change', (e) => { status = e.target.value; load().catch(toastError); });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-settle]');
    if (b) settlePayment(list.find((p) => p.id === Number(b.closest('tr').dataset.pid)), b.dataset.settle, again);
  });
  await load();
}
