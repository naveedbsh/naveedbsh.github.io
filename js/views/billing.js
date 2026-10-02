// The company's own plan: what it has and until when, the renewal the platform
// admin set for it, the other plans, and paying - Razorpay, Stripe or a bank
// transfer - with a coupon. Prices always come from the server.
import { get, post } from '../api.js';
import { $, $$, el, esc, fdate, modal, toast, toastError, busy } from '../ui.js';
import { icon } from '../icons.js';
import { refreshSession } from '../app.js';

/* ------------------------------------------------- shared with the console */

/** Money with paise when there are any (a 20% coupon leaves .80). */
export function amt(v, cur = 'INR') {
  const n = Number(v) || 0;
  const digits = Math.round(n * 100) % 100 ? 2 : 0; // ₹7,999.20, but ₹8,999
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch { return cur + ' ' + Number(v || 0).toFixed(2); }
}

export const per = (days) => ({ 30: 'month', 31: 'month', 90: 'quarter', 91: 'quarter', 180: 'half year', 365: 'year', 366: 'year' }[days] || days + ' days');

export function statePill(st) {
  if (!st || st.status === 'none') return '<span class="pill">No plan</span>';
  if (st.status === 'active') return '<span class="pill ok">Active</span>';
  if (st.status === 'expiring') return '<span class="pill warn">Ends ' + (st.days_left === 0 ? 'today' : 'in ' + st.days_left + ' day' + (st.days_left === 1 ? '' : 's')) + '</span>';
  if (st.status === 'grace') return '<span class="pill bad">Expired · grace until ' + fdate(st.grace_until) + '</span>';
  return '<span class="pill bad">Expired' + (st.readonly ? ' · read-only' : '') + '</span>';
}

export const GATEWAYS = { razorpay: 'Razorpay', stripe: 'Stripe', manual: 'Bank transfer / recorded' };
export const receiptNo = (id) => 'HH-' + String(id).padStart(6, '0');

export function payStatus(s) {
  return { paid: '<span class="pill ok">Paid</span>', pending: '<span class="pill warn">Waiting for payment</span>', failed: '<span class="pill bad">Failed</span>', cancelled: '<span class="pill">Cancelled</span>' }[s] || esc(s);
}

/* --------------------------------------------------------------- the page */

export async function render(root, params, query = {}) {
  // Back from Stripe's payment page.
  if (query.stripe_session) {
    history.replaceState({}, '', '/billing');
    try {
      const r = await post('/billing/stripe/confirm', { session_id: query.stripe_session });
      if (r.ok) { toast('Payment received. Your plan is active until ' + fdate(r.payment.period_end) + '.', 'ok'); await refreshSession(); return undefined; }
      toast('Stripe has not confirmed the payment yet (' + r.status + '). It is activated as soon as they do.');
    } catch (err) { toastError(err); }
  } else if (query.cancelled) {
    history.replaceState({}, '', '/billing');
    toast('Payment cancelled. Nothing was charged.');
  }

  const d = await get('/billing');
  const { company: c, state: st, renewal, usage } = d;
  const usageBar = (label, used, max) => {
    const p = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    return `<div><div class="row spread small"><b>${label}</b><span class="muted num">${used.toLocaleString()} / ${max.toLocaleString()}</span></div>
      <div class="bar${used >= max ? ' full' : ''}" style="margin-top:6px"><i style="width:${p}%"></i></div></div>`;
  };

  const endLine = !st.expires ? 'No end date'
    : st.days_left >= 0 ? 'Valid until <b>' + fdate(st.expires) + '</b> · ' + (st.days_left === 0 ? 'last day today' : st.days_left + ' day' + (st.days_left === 1 ? '' : 's') + ' left')
      : 'Ended on <b>' + fdate(st.expires) + '</b>' + (st.status === 'grace' ? ' · renew by ' + fdate(st.grace_until) + (st.locks ? ' to avoid read-only mode' : '') : '');

  root.innerHTML = `
    <div class="page-head"><h1>Plan &amp; billing</h1></div>
    <div class="dash-split" style="margin-bottom:16px">
      <div class="card card-pad">
        <div class="row spread" style="flex-wrap:wrap;gap:10px">
          <div><div class="small muted">Current plan</div><h2 style="font-size:22px;margin-top:2px">${esc(d.plan ? d.plan.name : 'No plan')} ${statePill(st)}</h2>
            <div class="small muted" style="margin-top:4px">${endLine}</div></div>
          ${d.can_pay && renewal ? '<button class="btn primary" data-renew>' + icon('wallet') + ' Renew now</button>' : ''}
        </div>
        <div class="usage mt-lg">${usageBar('Media', usage.mediums, c.max_mediums)}${usageBar('Logins', usage.users, c.max_users)}</div>
      </div>
      <div class="card card-pad">
        <div class="small muted">Next renewal</div>
        ${renewal ? `<div style="font-size:18px;font-weight:700;margin-top:2px">${esc(renewal.plan_name)} · ${amt(renewal.price, renewal.currency)} <span class="small muted" style="font-weight:500">/ ${per(renewal.duration_days)}</span></div>
          ${renewal.custom_price ? '<div class="small mt"><span class="pill info">Your price</span> agreed for your company' + (renewal.price < renewal.list_price ? ' (list price ' + amt(renewal.list_price, renewal.currency) + ')' : '') + '</div>' : ''}
          ${renewal.locked ? '<div class="small muted mt">' + icon('lock') + ' Your plan renews as ' + esc(renewal.plan_name) + '. To change it, contact the platform admin.</div>' : ''}
          ${st.expires && st.days_left >= 0 && renewal.plan_id === (d.plan && d.plan.id) ? '<div class="small faint mt">Renewing now adds ' + renewal.duration_days + ' days after ' + fdate(st.expires) + ', so no day is lost.</div>' : ''}`
    : '<div class="muted mt">No plan has been chosen yet.' + (d.can_pay ? ' Pick one below.' : '') + '</div>'}
      </div>
    </div>
    ${d.can_pay ? '<h2 style="margin:22px 0 12px">Plans</h2><div class="plan-cards" data-plans></div>' : '<div class="note-box">' + icon('lock') + '<div>Only your company\'s admins can renew or change the plan.</div></div>'}
    ${d.can_pay ? `<div class="card" style="margin-top:22px"><div class="card-head"><h3>Payments</h3><span class="small muted">Receipts are also emailed to your admins.</span></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Receipt</th><th>Plan</th><th>Covers</th><th>Method</th><th class="right">Amount</th><th>Status</th><th></th></tr></thead><tbody data-pays></tbody></table></div></div>` : ''}`;

  if (!d.can_pay) return undefined;

  const offerFor = (p) => (renewal && renewal.plan_id === p.id ? renewal.price : p.price);
  $('[data-plans]', root).innerHTML = d.plans.map((p) => {
    const current = d.plan && d.plan.id === p.id;
    const blocked = renewal && renewal.locked && renewal.plan_id !== p.id;
    const price = offerFor(p);
    return `<div class="plan-card${current ? ' current' : ''}${blocked ? ' off' : ''}">
      ${current ? '<span class="pill info ribbon">Your plan</span>' : p.company_id ? '<span class="pill ok ribbon">Made for you</span>' : ''}
      <b style="font-size:16px">${esc(p.name)}</b>
      <div class="price">${amt(price, p.currency)} <small>/ ${per(p.duration_days)}</small></div>
      ${price !== p.price ? '<div class="small faint"><s>' + amt(p.price, p.currency) + '</s> list price</div>' : ''}
      ${p.description ? '<div class="small muted">' + esc(p.description) + '</div>' : ''}
      <ul>${(p.features || []).map((f) => '<li>' + esc(f) + '</li>').join('')}</ul>
      <button class="btn${current ? ' primary' : ''}" data-plan="${p.id}"${blocked ? ' disabled title="Your plan renews as ' + esc(renewal.plan_name) + '"' : ''}>${current ? 'Renew' : 'Choose ' + esc(p.name)}</button>
    </div>`;
  }).join('') || '<div class="muted">No plans are on offer right now. Contact the platform admin.</div>';

  $('[data-pays]', root).innerHTML = d.payments.map((p) => `<tr data-pid="${p.id}">
      <td class="nowrap"><b class="mono">${receiptNo(p.id)}</b><div class="small faint">${fdate(p.paid_at || p.created_at)}</div></td>
      <td>${esc(p.plan_name)}${p.coupon_code ? '<div class="small faint">coupon ' + esc(p.coupon_code) + '</div>' : ''}</td>
      <td class="small nowrap">${fdate(p.period_start)} – ${fdate(p.period_end)}</td>
      <td class="small">${esc(GATEWAYS[p.gateway] || p.gateway)}${p.reference ? '<div class="faint">' + esc(p.reference) + '</div>' : ''}</td>
      <td class="right num nowrap"><b>${amt(p.amount, p.currency)}</b>${p.discount ? '<div class="small faint">' + amt(p.discount, p.currency) + ' off</div>' : ''}</td>
      <td>${payStatus(p.status)}</td>
      <td>${p.status === 'pending' ? '<button class="btn sm" data-cancel>Cancel</button>' : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No payments yet.</td></tr>';

  root.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-plan]');
    if (pick) checkout(d.plans.find((p) => p.id === Number(pick.dataset.plan)), d);
    if (e.target.closest('[data-renew]')) checkout(d.plans.find((p) => p.id === renewal.plan_id) || { id: renewal.plan_id, name: renewal.plan_name }, d);
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      busy(cancel, async () => {
        try { await post('/billing/payments/' + cancel.closest('tr').dataset.pid + '/cancel'); toast('Payment cancelled'); await refreshSession(); } catch (err) { toastError(err); }
      });
    }
  });
  if (query.renew) history.replaceState({}, '', '/billing'); // a reload must not reopen the checkout
  if (query.renew && renewal) checkout(d.plans.find((p) => p.id === renewal.plan_id) || { id: renewal.plan_id, name: renewal.plan_name }, d);
  return undefined;
}

/* -------------------------------------------------------------- checkout */

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = ok;
    s.onerror = () => { s.remove(); fail(new Error('Razorpay could not be loaded. Check the connection and try again.')); };
    document.head.append(s);
  });
}

function checkout(plan, d) {
  const pay = d.pay || {};
  const methods = [
    pay.razorpay && ['razorpay', 'Pay online', 'UPI, cards, net banking and wallets, through Razorpay'],
    pay.stripe && ['stripe', 'Pay by card', 'Visa, Mastercard, Amex and more, through Stripe'],
    pay.manual && ['manual', 'Bank transfer / UPI', 'Pay us directly; the plan starts once we confirm the money arrived'],
  ].filter(Boolean);
  const body = el(`<div>
    <div class="sum-rows" data-sum><div class="muted">Working out the price…</div></div>
    <form class="row mt" style="gap:8px" data-coupon-form novalidate>
      <input type="text" name="coupon" placeholder="Coupon code" maxlength="40" style="text-transform:uppercase;max-width:200px" aria-label="Coupon code">
      <button class="btn sm" type="submit">Apply</button><button class="btn sm ghost" type="button" data-clear hidden>Remove</button>
    </form>
    <div class="error-text mt hidden" data-err></div>
    <div class="form-section">How to pay</div>
    <div class="pay-opts">${methods.map(([k, l, s], i) => `<label><input type="radio" name="gateway" value="${k}"${i === 0 ? ' checked' : ''}><span><b>${l}</b><div class="small muted">${s}</div></span></label>`).join('') ||
      '<div class="muted">No way to pay is set up yet. Contact the platform admin.</div>'}</div>
    <div data-manual hidden class="mt">
      <div class="note-box" style="white-space:pre-wrap">${esc(pay.manual ? pay.manual.instructions : '')}</div>
      <label class="field"><span>Payment reference (UTR / transaction id), if you have paid already</span><input type="text" name="reference" maxlength="160"></label>
    </div>
  </div>`);
  let changed = false; // a payment was submitted: the page behind needs a reload when this closes
  const m = modal({
    title: plan.name + ' plan', body, size: 'narrow',
    onClose: () => { if (changed) refreshSession(); },
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-pay disabled>Pay</button>',
  });
  let coupon = '';
  let q = null;
  const err = $('[data-err]', body);
  const payBtn = $('[data-pay]', m.el);
  const showErr = (msg) => { err.textContent = msg; err.classList.toggle('hidden', !msg); };
  const method = () => ($('input[name=gateway]:checked', body) || {}).value;

  async function price(keepError = false) {
    if (!keepError) showErr('');
    try {
      q = await post('/billing/quote', { plan_id: plan.id, coupon });
    } catch (ex) {
      showErr(ex.message);
      if (coupon) { coupon = ''; $('[name=coupon]', body).value = ''; $('[data-clear]', body).hidden = true; return price(true); }
      return undefined;
    }
    $('[data-sum]', body).innerHTML = `
      <div><span>${esc(q.plan_name)}, ${q.duration_days} days</span><span class="num">${amt(q.list_price, q.currency)}</span></div>
      ${q.discount ? '<div style="color:var(--st-available)"><span>Coupon ' + esc(q.coupon_code) + '</span><span class="num">− ' + amt(q.discount, q.currency) + '</span></div>' : ''}
      <div class="total"><span>To pay</span><span class="num">${amt(q.amount, q.currency)}</span></div>
      <div class="small muted">Covers ${fdate(q.period_start)} to ${fdate(q.period_end)}${q.extends ? ' (added after your current plan ends)' : ''}.</div>`;
    payBtn.disabled = !(q.amount <= 0 || methods.length);
    payBtn.textContent = q.amount <= 0 ? 'Activate plan' : method() === 'manual' ? 'I will pay ' + amt(q.amount, q.currency) : 'Pay ' + amt(q.amount, q.currency);
    return undefined;
  }
  price();

  $('[data-coupon-form]', body).addEventListener('submit', (e) => {
    e.preventDefault();
    coupon = e.target.coupon.value.trim().toUpperCase();
    $('[data-clear]', body).hidden = !coupon;
    price();
  });
  $('[data-clear]', body).addEventListener('click', (e) => { coupon = ''; $('[name=coupon]', body).value = ''; e.target.hidden = true; price(); });
  $$('input[name=gateway]', body).forEach((r) => r.addEventListener('change', () => {
    $('[data-manual]', body).hidden = method() !== 'manual';
    if (q) price();
  }));
  $('[data-manual]', body).hidden = method() !== 'manual';

  payBtn.addEventListener('click', () => busy(payBtn, async () => {
    showErr('');
    try {
      const gateway = q && q.amount <= 0 ? 'manual' : method();
      const r = await post('/billing/checkout', { plan_id: plan.id, coupon, gateway, reference: $('[name=reference]', body).value });
      if (r.done) { m.close(); toast('Plan active until ' + fdate(r.payment.period_end), 'ok'); await refreshSession(); return; }
      if (r.redirect) { location.href = r.redirect; return; }
      if (r.pending) {
        m.body.innerHTML = '<p><b>Thank you.</b> Your ' + esc(plan.name) + ' plan starts as soon as we confirm the payment of <b>' + amt(r.amount, r.currency) + '</b>.</p>' +
          '<div class="note-box" style="white-space:pre-wrap">' + esc(r.instructions) + '</div><p class="small muted">Quote receipt number <b class="mono">' + receiptNo(r.payment_id) + '</b> with your transfer.</p>';
        m.foot.innerHTML = '<button class="btn primary" data-close>Done</button>';
        changed = true;
        return;
      }
      if (r.gateway === 'razorpay') await razorpay(r, m, plan);
    } catch (ex) { showErr(ex.message); }
  }));
}

async function razorpay(order, m, plan) {
  await loadRazorpay();
  await new Promise((resolve) => {
    const rz = new window.Razorpay({
      key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
      name: order.name, description: order.description, prefill: order.prefill,
      theme: { color: '#2f5bea' },
      handler: async (resp) => {
        try {
          const r = await post('/billing/razorpay/verify', { payment_id: order.payment_id, ...resp });
          m.close();
          toast('Payment received. ' + plan.name + ' is active until ' + fdate(r.payment.period_end) + '.', 'ok');
          await refreshSession();
        } catch (err) { toastError(err); }
        resolve();
      },
      modal: { ondismiss: () => { toast('Payment window closed. Nothing was charged.'); resolve(); } },
    });
    rz.on('payment.failed', (resp) => { toast((resp.error && resp.error.description) || 'The payment failed', 'error'); });
    rz.open();
  });
}

