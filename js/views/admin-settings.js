// Platform settings for the super admin: the email server (SMTP) and which
// emails go out, the WhatsApp provider, payment gateway keys, plan rules (reminders, grace period),
// and marketing emails. Saved secrets are never sent back to the browser.
import { get, put, post } from '../api.js';
import { store, $, $$, esc, fdate, ago, toast, toastError, busy, formData, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';

const TABS = [['email', 'Email (SMTP)'], ['whatsapp', 'WhatsApp'], ['payments', 'Payment gateways'], ['rules', 'Plan rules'], ['marketing', 'Marketing emails']];

const SEND_LABELS = {
  enquiry_company: ['New enquiries and booking requests', 'To the company\'s admins, when a customer enquires on the marketplace or a share link'],
  enquiry_customer: ['Enquiry received', 'To the customer, with their receipt link'],
  decision_customer: ['Request accepted or declined', 'To the customer, when the company decides on their boards'],
  password_reset: ['Forgot password', 'The reset link from the sign-in page'],
  plan_reminders: ['Plan renewal reminders', 'To company admins before the plan ends, and once after'],
  plan_receipts: ['Payment receipts', 'To company admins when a payment activates a plan'],
};

/** 'a.b' form names -> { a: { b } } */
function nest(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const keys = k.split('.');
    const last = keys.pop();
    keys.reduce((o, x) => (o[x] ||= {}), out)[last] = v;
  }
  return out;
}

/** A secret input: blank keeps the saved one; the saved one is never shown. */
function secret(name, label, isSet, placeholder = '') {
  return `<label class="field"><span>${label}</span><input type="password" name="${name}" autocomplete="new-password" placeholder="${isSet ? 'Saved. Leave blank to keep it' : esc(placeholder)}"></label>
    ${isSet ? '<label class="check small secret-state"><input type="checkbox" name="' + name + '_clear"> Remove the saved one</label>' : '<div class="secret-state faint">Not set</div>'}`;
}

export async function render(root, params, query = {}) {
  let tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'email';
  root.innerHTML = `
    <div class="page-head"><h1>Platform settings</h1><a class="btn" href="/admin/billing" data-link>${icon('wallet')} Plans &amp; billing</a></div>
    <div class="tabs wide" data-tabs>${TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (k === tab ? ' class="on"' : '') + '>' + l + '</button>').join('')}</div>
    <div data-body style="margin-top:16px"></div>`;
  $('[data-tabs]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tab) return;
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.classList.toggle('on', x === b));
    history.replaceState({}, '', '/admin/settings' + (tab === 'email' ? '' : '?tab=' + tab));
    draw();
  });
  async function draw() {
    const host = document.createElement('div');
    $('[data-body]', root).replaceChildren(host);
    host.innerHTML = '<div class="card"><div class="empty">Loading…</div></div>';
    try {
      if (tab === 'marketing') await marketing(host, draw);
      else {
        const all = await get('/admin/settings');
        await { email, whatsapp, payments, rules }[tab](host, all, draw);
      }
    } catch (err) { host.innerHTML = '<div class="card"><div class="empty">' + esc(err.message) + '</div></div>'; }
  }
  await draw();
  return undefined;
}

async function save(section, form, again, extra = (d) => d) {
  const d = extra(nest(formData(form)));
  await put('/admin/settings/' + section, d);
  toast('Settings saved', 'ok');
  again();
}

/* ----------------------------------------------------------------- email */

async function email(host, all, again) {
  const e = all.email;
  host.innerHTML = `<div class="dash-split">
    <form class="card" novalidate autocomplete="off" data-form>
      <div class="card-head"><h3>${icon('send')} Outgoing email server</h3><label class="check"><input type="checkbox" name="enabled"${e.enabled ? ' checked' : ''}> Send emails</label></div>
      <div class="card-pad">
        <div class="grid-3">
          <label class="field" style="grid-column:span 2"><span>SMTP host</span><input type="text" name="host" maxlength="190" value="${esc(e.host)}" placeholder="smtp.hostinger.com"></label>
          <label class="field"><span>Port</span><input type="number" name="port" min="1" max="65535" value="${e.port}"></label>
        </div>
        <label class="field mt"><span>Security</span><select name="security">
          <option value="ssl"${e.security === 'ssl' ? ' selected' : ''}>SSL/TLS (usually port 465)</option>
          <option value="starttls"${e.security === 'starttls' ? ' selected' : ''}>STARTTLS (usually port 587)</option>
          <option value="none"${e.security === 'none' ? ' selected' : ''}>None (port 25, for testing only)</option></select></label>
        <div class="grid-2 mt">
          <label class="field"><span>Username</span><input type="text" name="user" maxlength="190" value="${esc(e.user)}" autocomplete="off" placeholder="usually the full email address"></label>
          <div>${secret('pass', 'Password', e.pass_set, 'the mailbox or app password')}</div>
        </div>
        <div class="form-section">Sender</div>
        <div class="grid-2">
          <label class="field"><span>From name</span><input type="text" name="from_name" maxlength="80" value="${esc(e.from_name)}"></label>
          <label class="field"><span>From address</span><input type="email" name="from_email" maxlength="190" value="${esc(e.from_email)}" placeholder="no-reply@yourdomain.com"></label>
          <label class="field"><span>Reply-to (optional)</span><input type="email" name="reply_to" maxlength="190" value="${esc(e.reply_to)}" placeholder="support@yourdomain.com"></label>
          <label class="field"><span>Site address in email links</span><input type="url" name="site_url" maxlength="200" value="${esc(e.site_url)}" placeholder="${esc(location.origin)}"></label>
        </div>
        <div class="form-section">Which emails go out</div>
        <div style="display:grid;gap:8px">${Object.entries(SEND_LABELS).map(([k, [l, s]]) => `<label class="check" style="align-items:flex-start"><input type="checkbox" name="send.${k}"${e.send[k] ? ' checked' : ''} style="margin-top:3px"><span><b>${l}</b><div class="small muted">${s}</div></span></label>`).join('')}</div>
        <div class="small faint mt">Marketing emails are sent by hand from the Marketing emails tab, and only to people who have not unsubscribed.</div>
      </div>
      <div class="modal-foot"><button class="btn primary" type="submit">Save email settings</button></div>
    </form>
    <div>
      <div class="card card-pad">
        <h3>Send a test</h3>
        <p class="small muted mt">Uses the saved settings. Save first if you changed anything.</p>
        <div class="row mt" style="gap:8px"><input type="email" data-test-to value="${esc(store.user.email)}" class="grow" aria-label="Send the test to"><button class="btn" data-test>${icon('send')} Send</button></div>
      </div>
      <div class="card card-pad" style="margin-top:16px">
        <h3>Common settings</h3>
        <dl class="kv small mt">
          <dt>Hostinger email</dt><dd>smtp.hostinger.com · 465 · SSL/TLS</dd>
          <dt>Google Workspace / Gmail</dt><dd>smtp.gmail.com · 587 · STARTTLS, with an app password</dd>
          <dt>Zoho Mail (India)</dt><dd>smtp.zoho.in · 465 · SSL/TLS</dd>
          <dt>Brevo</dt><dd>smtp-relay.brevo.com · 587 · STARTTLS</dd>
          <dt>Amazon SES (Mumbai)</dt><dd>email-smtp.ap-south-1.amazonaws.com · 587 · STARTTLS</dd>
        </dl>
        <p class="small faint mt">Send from an address on your own domain, with SPF and DKIM set up at your DNS host, or mail lands in spam.</p>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h3>Recent emails</h3><span class="small muted">The last 200 attempts</span></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Kind</th><th>To</th><th>Subject</th><th>Result</th></tr></thead><tbody data-log><tr><td colspan="5" class="empty">Loading…</td></tr></tbody></table></div></div>`;

  const form = $('[data-form]', host);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy($('button[type=submit]', form), async () => {
      try { await save('email', form, again); } catch (err) { toastError(err); }
    });
  });
  // The usual port goes with the security choice.
  form.security.addEventListener('change', () => { form.port.value = { ssl: 465, starttls: 587, none: 25 }[form.security.value]; });
  $('[data-test]', host).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    try { await post('/admin/settings/email/test', { to: $('[data-test-to]', host).value }); toast('Test email sent. Check the inbox (and spam).', 'ok'); } catch (err) { toastError(err); }
    loadLog();
  }));
  const RESULT = { sent: '<span class="pill ok">Sent</span>', failed: '<span class="pill bad">Failed</span>', skipped: '<span class="pill">Skipped</span>' };
  async function loadLog() {
    const { entries } = await get('/admin/email-log');
    $('[data-log]', host).innerHTML = entries.map((x) => `<tr>
      <td class="small nowrap" title="${esc(fdate(x.created_at, true))}">${ago(x.created_at)}</td>
      <td class="small">${esc(x.kind)}</td>
      <td class="small">${esc(x.to_email)}${x.company_name ? '<div class="faint">' + esc(x.company_name) + '</div>' : ''}</td>
      <td class="small">${esc(x.subject)}</td>
      <td>${RESULT[x.status] || esc(x.status)}${x.error ? '<div class="small faint" style="max-width:280px">' + esc(x.error) + '</div>' : ''}</td></tr>`).join('') ||
      '<tr><td colspan="5" class="empty">No emails yet.</td></tr>';
  }
  loadLog().catch(toastError);
}

/* -------------------------------------------------------------- whatsapp */

const PROVIDERS = [
  ['meta', 'WhatsApp Cloud API (Meta)', 'Meta\'s own API. Messages you start must use a template Meta has approved.'],
  ['twilio', 'Twilio', 'Twilio\'s WhatsApp API. Text, or a Content template (HX…).'],
  ['custom', 'Another provider', 'Interakt, AiSensy, Gupshup, WATI or any service with an HTTP API.'],
];

async function whatsapp(host, all, again) {
  const w = all.whatsapp;
  host.innerHTML = `<div class="dash-split">
    <form class="card" novalidate autocomplete="off" data-form>
      <div class="card-head"><h3>${icon('whatsapp')} WhatsApp</h3><label class="check"><input type="checkbox" name="enabled"${w.enabled ? ' checked' : ''}> Send WhatsApp messages</label></div>
      <div class="card-pad">
        <div class="pay-opts">${PROVIDERS.map(([k, l, d]) => `<label><input type="radio" name="provider" value="${k}"${w.provider === k ? ' checked' : ''}><span><b>${l}</b><div class="small muted">${d}</div></span></label>`).join('')}</div>
        <label class="field mt" style="max-width:220px"><span>Country code for 10-digit numbers</span><input type="text" name="country_code" maxlength="4" value="${esc(w.country_code)}" placeholder="91"></label>

        <div data-p="meta">
          <div class="form-section">WhatsApp Cloud API</div>
          <p class="small muted">In Meta for Developers, open your app, then <b>WhatsApp → API setup</b>. Use a permanent access token from a system user in Business settings; the temporary one stops working after a day.</p>
          <div class="grid-2">
            <label class="field"><span>Phone number ID</span><input type="text" name="meta.phone_number_id" maxlength="40" value="${esc(w.meta.phone_number_id)}" placeholder="e.g. 106540352242922"></label>
            <div>${secret('meta.access_token', 'Access token', w.meta.access_token_set, 'EAAG…')}</div>
            <label class="field"><span>Graph API version</span><input type="text" name="meta.api_version" maxlength="10" value="${esc(w.meta.api_version)}"></label>
          </div>
        </div>

        <div data-p="twilio">
          <div class="form-section">Twilio</div>
          <p class="small muted">Twilio Console → Account info. The sender is your WhatsApp-enabled Twilio number.</p>
          <div class="grid-2">
            <label class="field"><span>Account SID</span><input type="text" name="twilio.account_sid" maxlength="40" value="${esc(w.twilio.account_sid)}" placeholder="AC…"></label>
            <div>${secret('twilio.auth_token', 'Auth token', w.twilio.auth_token_set)}</div>
            <label class="field"><span>WhatsApp sender number</span><input type="text" name="twilio.from" maxlength="40" value="${esc(w.twilio.from)}" placeholder="+1 415 523 8886"></label>
          </div>
        </div>

        <div data-p="custom">
          <div class="form-section">Your provider's API</div>
          <p class="small muted">From your provider's API documentation. In the URL and the body, <code>{{to}}</code> is the number (e.g. 919848012345), <code>{{message}}</code> the text, <code>{{template}}</code> the template name and <code>{{params}}</code> the template values as a JSON list.</p>
          <label class="field"><span>API URL</span><input type="url" name="custom.url" maxlength="500" value="${esc(w.custom.url)}" placeholder="https://api.provider.com/v1/messages"></label>
          <div class="grid-2 mt">
            <label class="field"><span>Method</span><select name="custom.method">${['POST', 'PUT'].map((m) => '<option' + (w.custom.method === m ? ' selected' : '') + '>' + m + '</option>').join('')}</select></label>
            <label class="field"><span>Body format</span><select name="custom.content_type"><option value="json"${w.custom.content_type === 'json' ? ' selected' : ''}>JSON</option><option value="form"${w.custom.content_type === 'form' ? ' selected' : ''}>Form fields</option></select></label>
          </div>
          <label class="field mt"><span>Body</span><textarea name="custom.body" rows="5" maxlength="4000" class="mono">${esc(w.custom.body)}</textarea></label>
          <div class="mt">${secret('custom.headers', 'Headers, as JSON (usually your API key)', w.custom.headers_set, '{"Authorization": "Bearer your-api-key"}')}</div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn primary" type="submit">Save WhatsApp settings</button></div>
    </form>
    <div>
      <div class="card card-pad">
        <h3>Send a test</h3>
        <p class="small muted mt">Uses the saved settings. With Meta, a plain message only arrives if that number wrote to you in the last 24 hours. Otherwise test with an approved template such as <code>hello_world</code>.</p>
        <label class="field mt"><span>To</span><input type="tel" data-to value="${esc(store.user.phone || '')}" placeholder="98480 12345"></label>
        <label class="field mt"><span>Template (optional)</span><input type="text" data-template placeholder="hello_world"></label>
        <label class="field mt"><span>Template language</span><input type="text" data-lang value="en_US"></label>
        <button class="btn mt" data-test>${icon('send')} Send test</button>
      </div>
      <div class="card card-pad" style="margin-top:16px">
        <h3>What gets sent, to whom</h3>
        <p class="small muted mt">Your <a href="/admin/automations" data-link>Automations</a> decide every WhatsApp message: new enquiries, replies to customers, campaigns ending, problems, plan renewals. Each step names who it goes to.</p>
        <p class="small muted">Company logins get messages on the mobile number in their profile, and can switch them off in their own Settings. Customers get WhatsApp only if they ticked "Send me updates on WhatsApp" on the enquiry form.</p>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h3>Recent WhatsApp messages</h3><a class="btn sm" href="/admin/automations?tab=activity" data-link>All activity</a></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Event</th><th>To</th><th>Result</th></tr></thead><tbody data-log><tr><td colspan="4" class="empty">Loading…</td></tr></tbody></table></div></div>`;

  const form = $('[data-form]', host);
  const showProvider = () => {
    const p = ($('input[name=provider]:checked', form) || {}).value;
    $$('[data-p]', form).forEach((x) => { x.hidden = x.dataset.p !== p; });
  };
  $$('input[name=provider]', form).forEach((r) => r.addEventListener('change', showProvider));
  showProvider();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy($('button[type=submit]', form), async () => {
      try { await save('whatsapp', form, again); } catch (err) { toastError(err); }
    });
  });
  $('[data-test]', host).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    try {
      const t = $('[data-template]', host).value.trim();
      await post('/admin/settings/whatsapp/test', { to: $('[data-to]', host).value, template: t || undefined, language: $('[data-lang]', host).value });
      toast('Sent. Check the phone.', 'ok');
    } catch (err) { toastError(err); }
    loadLog();
  }));
  async function loadLog() {
    const { deliveries } = await get('/admin/deliveries', { channel: 'whatsapp', limit: 30 });
    $('[data-log]', host).innerHTML = deliveries.map((d) => `<tr>
      <td class="small nowrap" title="${esc(fdate(d.created_at, true))}">${ago(d.created_at)}</td>
      <td class="small">${esc(d.automation_name || d.event)}${d.company_name ? '<div class="faint">' + esc(d.company_name) + '</div>' : ''}${d.is_test ? ' <span class="tag">test</span>' : ''}</td>
      <td class="small mono">+${esc(d.target)}</td>
      <td>${deliveryPill(d)}${d.error ? '<div class="small faint" style="max-width:320px">' + esc(d.error) + '</div>' : ''}</td></tr>`).join('') ||
      '<tr><td colspan="4" class="empty">No WhatsApp messages yet.</td></tr>';
  }
  loadLog().catch(toastError);
}

export function deliveryPill(d) {
  return { sent: '<span class="pill ok">Sent</span>', failed: '<span class="pill bad">Failed</span>', pending: '<span class="pill warn">' + (d.attempts ? 'Retrying' : 'Queued') + '</span>', sending: '<span class="pill warn">Sending</span>' }[d.status] || esc(d.status);
}

/* -------------------------------------------------------------- payments */

async function payments(host, all, again) {
  const p = all.payments;
  const hook = (g) => location.origin + '/api/billing/webhook/' + g;
  host.innerHTML = `<form novalidate autocomplete="off" data-form>
    <div class="note-box">${icon('lock')}<div>Secret keys are stored encrypted and never shown again, not even here. To change one, type the new key; leave it blank to keep the saved one.</div></div>
    <div class="card card-pad" style="margin-bottom:16px;max-width:520px">
      <label class="field"><span>Business name on payment pages and receipts</span><input type="text" name="business_name" maxlength="80" value="${esc(p.business_name)}"></label>
    </div>
    <div class="dash-grid">
      <div class="card">
        <div class="card-head"><h3>Razorpay</h3><label class="check"><input type="checkbox" name="razorpay.enabled"${p.razorpay.enabled ? ' checked' : ''}> Accept payments</label></div>
        <div class="card-pad">
          <p class="small muted">UPI, cards, net banking and wallets in India. Keys: Razorpay Dashboard → Account &amp; Settings → API keys.</p>
          <label class="field mt"><span>Key id</span><input type="text" name="razorpay.key_id" maxlength="80" value="${esc(p.razorpay.key_id)}" placeholder="rzp_live_..."></label>
          <div class="mt">${secret('razorpay.key_secret', 'Key secret', p.razorpay.key_secret_set)}</div>
          <div class="mt">${secret('razorpay.webhook_secret', 'Webhook secret (recommended)', p.razorpay.webhook_secret_set, 'the secret you typed when adding the webhook')}</div>
          <div class="small mt"><b>Webhook URL</b> <span class="faint">(Dashboard → Webhooks; events <span class="mono">payment.captured</span> and <span class="mono">order.paid</span>)</span><div class="mono" style="word-break:break-all;margin-top:2px">${esc(hook('razorpay'))}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Stripe</h3><label class="check"><input type="checkbox" name="stripe.enabled"${p.stripe.enabled ? ' checked' : ''}> Accept payments</label></div>
        <div class="card-pad">
          <p class="small muted">International cards. Keys: Stripe Dashboard → Developers → API keys.</p>
          <div class="mt">${secret('stripe.secret_key', 'Secret key', p.stripe.secret_key_set, 'sk_live_...')}</div>
          <div class="mt">${secret('stripe.webhook_secret', 'Webhook signing secret (recommended)', p.stripe.webhook_secret_set, 'whsec_...')}</div>
          <div class="small mt"><b>Webhook URL</b> <span class="faint">(Developers → Webhooks; event <span class="mono">checkout.session.completed</span>)</span><div class="mono" style="word-break:break-all;margin-top:2px">${esc(hook('stripe'))}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Bank transfer / UPI</h3><label class="check"><input type="checkbox" name="manual.enabled"${p.manual.enabled ? ' checked' : ''}> Offer it</label></div>
        <div class="card-pad">
          <p class="small muted">The company sees these details, pays, and you confirm the payment under Plans &amp; billing → Payments. The plan starts when you confirm.</p>
          <label class="field mt"><span>What customers see</span><textarea name="manual.instructions" rows="6" maxlength="1000" placeholder="Account name, number, IFSC, UPI id...">${esc(p.manual.instructions)}</textarea></label>
        </div>
      </div>
    </div>
    <div class="row mt-lg"><span class="grow"></span><button class="btn primary" type="submit">Save payment settings</button></div>
  </form>`;
  const form = $('[data-form]', host);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy($('button[type=submit]', form), async () => {
      try { await save('payments', form, again); } catch (err) { toastError(err); }
    });
  });
}

/* ----------------------------------------------------------------- rules */

async function rules(host, all, again) {
  const b = all.billing;
  host.innerHTML = `<form class="card" style="max-width:760px" novalidate data-form>
    <div class="card-head"><h3>${icon('calendar')} When a plan ends</h3></div>
    <div class="card-pad">
      <label class="field"><span>Remind company admins this many days before the end</span><input type="text" name="reminder_days" value="${esc(b.reminder_days.join(', '))}" placeholder="15, 7, 3, 1"></label>
      <div class="small faint" style="margin-top:4px">Comma separated. The first number is also when the "renew soon" banner appears in their workspace. One more email goes out the day after it ends.</div>
      <div class="grid-2 mt">
        <label class="field"><span>Grace period after the end (days)</span><input type="number" name="grace_days" min="0" max="90" value="${b.grace_days}"></label>
        <label class="field"><span>After the grace period</span><select name="after_grace">
          <option value="readonly"${b.after_grace === 'readonly' ? ' selected' : ''}>Read-only: they can look but not change anything; boards leave the marketplace</option>
          <option value="none"${b.after_grace === 'none' ? ' selected' : ''}>Nothing: keep working, with a reminder banner</option></select></label>
      </div>
      <div class="note-box mt">${icon('bulb')}<div>Renewals follow your decision for each company (company page → Plan &amp; billing): the same plan at today's price, its old price, or a different plan. Paying early never loses days: the new period starts when the current one ends.</div></div>
    </div>
    <div class="modal-foot"><button class="btn primary" type="submit">Save plan rules</button></div>
  </form>`;
  const form = $('[data-form]', host);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy($('button[type=submit]', form), async () => {
      try { await save('billing', form, again); } catch (err) { toastError(err); }
    });
  });
}

/* ------------------------------------------------------------- marketing */

async function marketing(host, again) {
  const r = await get('/admin/campaigns');
  host.innerHTML = `${r.email_ready ? '' : '<div class="note-box">' + icon('alert') + '<div>Email is not set up yet. Fill in and switch on the <a href="/admin/settings" data-link>Email (SMTP)</a> settings first.</div></div>'}
    <div class="dash-split">
      <form class="card" novalidate data-form>
        <div class="card-head"><h3>${icon('send')} New email</h3></div>
        <div class="card-pad">
          <label class="field"><span>Send to</span><select name="audience">${r.audiences.map((a) => '<option value="' + esc(a.key) + '">' + esc(a.label) + ' (' + a.count + ')</option>').join('')}</select></label>
          <label class="field mt"><span>Subject</span><input type="text" name="subject" maxlength="200" placeholder="e.g. New: LED screen listings on the marketplace"></label>
          <label class="field mt"><span>Message</span><textarea name="body" rows="10" maxlength="20000" placeholder="Plain text. Leave a blank line between paragraphs. Web addresses become links."></textarea></label>
          <div class="small faint mt">Each email starts with "Hi &lt;name&gt;," and ends with an unsubscribe link. People who unsubscribed are left out automatically.</div>
        </div>
        <div class="modal-foot"><button class="btn" type="button" data-test>Send a test to me</button><button class="btn primary" type="submit"${r.email_ready ? '' : ' disabled'}>Send</button></div>
      </form>
      <div class="card"><div class="card-head"><h3>Sent</h3></div>
        <div class="list-rows">${r.campaigns.map((c) => `<div><div class="grow small" style="min-width:0"><b>${esc(c.subject)}</b>
          <div class="faint">${esc((r.audiences.find((a) => a.key === c.audience) || {}).label || c.audience)} · ${ago(c.created_at)}${c.created_by_name ? ' · ' + esc(c.created_by_name) : ''}</div>
          <div class="faint">${c.status === 'sending' ? 'Sending… ' + c.sent + ' of ' + c.recipients : c.sent + ' sent' + (c.failed ? ', ' + c.failed + ' failed' : '') + ' of ' + c.recipients}</div></div></div>`).join('') || '<div class="empty">Nothing sent yet.</div>'}</div></div>
    </div>`;
  const form = $('[data-form]', host);
  const check = () => {
    const d = formData(form);
    if (!d.subject.trim() || !d.body.trim()) { toast('Write a subject and a message first', 'error'); return null; }
    return d;
  };
  $('[data-test]', host).addEventListener('click', (ev) => {
    const d = check();
    if (d) busy(ev.currentTarget, async () => { try { await post('/admin/campaigns', { ...d, test_to: store.user.email }); toast('Test sent to ' + store.user.email, 'ok'); } catch (err) { toastError(err); } });
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = check();
    if (!d) return;
    const a = r.audiences.find((x) => x.key === d.audience);
    if (!(await confirmDialog('Send "' + d.subject + '" to ' + a.count + ' ' + (a.count === 1 ? 'person' : 'people') + ' (' + a.label.toLowerCase() + ')? This cannot be undone.', { ok: 'Send now' }))) return;
    busy($('button[type=submit]', form), async () => {
      try { const x = await post('/admin/campaigns', d); toast('Sending to ' + x.recipients + ' people in the background', 'ok'); again(); } catch (err) { toastError(err); }
    });
  });
}
