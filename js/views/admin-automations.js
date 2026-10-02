// Platform console: automations ("when this happens, send that"), outgoing
// webhooks, and the log of every WhatsApp message, automation email and
// webhook call, with retries.
import { get, post, patch, del } from '../api.js';
import { store, $, $$, el, esc, fdate, ago, modal, toast, toastError, busy, confirmDialog, copyText } from '../ui.js';
import { icon } from '../icons.js';
import { deliveryPill } from './admin-settings.js';

const TABS = [['automations', 'Automations'], ['webhooks', 'Webhooks'], ['activity', 'Activity']];
const CHANNELS = { whatsapp: ['WhatsApp', 'whatsapp'], email: ['Email', 'send'], webhook: ['Webhook', 'external'] };

/** Same rule as the server: {{a.b}} -> the value, unknown -> ''. */
const fill = (t, ctx) => String(t || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
  const v = p.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), ctx);
  return v === null || v === undefined || typeof v === 'object' ? '' : String(v);
});

export async function render(root, params, query = {}) {
  let tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'automations';
  const cat = await get('/admin/automations/catalog');
  const ev = Object.fromEntries(cat.events.map((e) => [e.key, e]));
  root.innerHTML = `
    <div class="page-head"><h1>Automations</h1><a class="btn" href="/admin/settings?tab=whatsapp" data-link>${icon('settings')} WhatsApp &amp; email settings</a></div>
    <div class="row wrap" style="gap:8px;margin:-6px 0 14px">
      ${cat.channels.whatsapp ? '<span class="pill ok">' + icon('whatsapp') + ' WhatsApp on (' + esc({ meta: 'Meta', twilio: 'Twilio', custom: 'own provider' }[cat.channels.whatsapp]) + ')</span>' : '<a class="pill warn" href="/admin/settings?tab=whatsapp" data-link>WhatsApp is not set up: its steps are skipped</a>'}
      ${cat.channels.email ? '<span class="pill ok">Email on</span>' : '<a class="pill warn" href="/admin/settings" data-link>Email is not set up: its steps are skipped</a>'}
    </div>
    <div class="tabs wide" data-tabs>${TABS.map(([k, l]) => '<button data-tab="' + k + '"' + (k === tab ? ' class="on"' : '') + '>' + l + '</button>').join('')}</div>
    <div data-body style="margin-top:16px"></div>`;
  $('[data-tabs]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tab) return;
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.classList.toggle('on', x === b));
    history.replaceState({}, '', '/admin/automations' + (tab === 'automations' ? '' : '?tab=' + tab));
    draw();
  });
  async function draw() {
    const host = document.createElement('div');
    $('[data-body]', root).replaceChildren(host);
    host.innerHTML = '<div class="card"><div class="empty">Loading…</div></div>';
    try {
      cat.webhooks = (await get('/admin/webhooks')).webhooks; // fresh names for the steps
      await { automations, webhooks, activity }[tab](host, { cat, ev, again: draw });
    } catch (err) { host.innerHTML = '<div class="card"><div class="empty">' + esc(err.message) + '</div></div>'; }
  }
  await draw();
  return undefined;
}

/* ------------------------------------------------------------ automations */

function stepSummary(s, cat) {
  const [label, ic] = CHANNELS[s.channel] || [s.channel, 'send'];
  const to = s.channel === 'webhook' ? ((cat.webhooks.find((w) => w.id === s.webhook_id) || {}).name || 'deleted webhook') : (cat.recipients[s.to] || s.to);
  return '<span class="nowrap">' + icon(ic) + ' ' + label + ' → ' + esc(to) + '</span>';
}

async function automations(host, { cat, ev, again }) {
  const { automations: list } = await get('/admin/automations');
  host.innerHTML = `<div class="card">
    <div class="card-head"><h3>When something happens, send a message</h3><span class="small muted">WhatsApp, email or a webhook, to the company, its customer, or you.</span><button class="btn sm primary" data-new>${icon('plus')} New automation</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Automation</th><th>When</th><th>Sends</th><th>For</th><th class="right">Last 30 days</th><th>On</th><th></th></tr></thead><tbody>
    ${list.map((a) => {
    const e = ev[a.trigger_event] || { label: a.trigger_event };
    return `<tr data-id="${a.id}">
      <td><b>${esc(a.name)}</b><div class="small faint">${a.last_run_at ? 'ran ' + a.runs + ' time' + (a.runs === 1 ? '' : 's') + ', last ' + ago(a.last_run_at) : 'not run yet'}</div></td>
      <td class="small">${esc(e.label)}${e.scheduled ? '<div class="faint">' + a.days + ' ' + esc(e.daysLabel) + '</div>' : ''}${a.filters.source ? '<div class="faint">' + (a.filters.source === 'share' ? 'share links only' : 'marketplace only') + '</div>' : ''}${a.filters.severity ? '<div class="faint">high severity only</div>' : ''}</td>
      <td class="small">${a.steps.map((s) => stepSummary(s, cat)).join('<br>')}</td>
      <td class="small">${a.company_id ? esc(a.company_name) : 'All companies'}</td>
      <td class="right small nowrap">${a.sent_30d} sent${a.failed_30d ? '<div class="neg">' + a.failed_30d + ' failed</div>' : ''}</td>
      <td><label class="check"><input type="checkbox" data-toggle${a.is_active ? ' checked' : ''} aria-label="Switch on or off"></label></td>
      <td class="nowrap"><button class="btn sm" data-test>Test</button> <button class="btn sm icon" data-edit title="Edit">${icon('edit')}</button> <button class="btn sm icon danger" data-del title="Delete">${icon('trash')}</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty">No automations yet.</td></tr>'}
    </tbody></table></div></div>`;

  $('[data-new]', host).addEventListener('click', () => editor({ cat, ev, onSaved: again }));
  host.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const a = list.find((x) => x.id === Number(t.closest('tr').dataset.id));
    try { await patch('/admin/automations/' + a.id, { is_active: t.checked }); toast(a.name + (t.checked ? ' is on' : ' is off'), 'ok'); } catch (err) { t.checked = !t.checked; toastError(err); }
  });
  host.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const a = list.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-edit]')) editor({ cat, ev, automation: a, onSaved: again });
    if (e.target.closest('[data-test]')) testModal(a);
    if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog('Delete the automation "' + a.name + '"? Messages already sent stay in the activity log.', { ok: 'Delete', danger: true }))) return;
      try { await del('/admin/automations/' + a.id); toast('Deleted'); again(); } catch (err) { toastError(err); }
    }
  });
}

function editor({ cat, ev, automation = null, onSaved }) {
  const a = automation || { name: '', trigger_event: 'enquiry.received', days: null, filters: {}, steps: [{ channel: 'whatsapp', to: 'company_admins', message: '' }], company_id: null, is_active: true };
  const steps = JSON.parse(JSON.stringify(a.steps));
  const groups = [...new Set(cat.events.map((e) => e.group))];
  const body = el(`<form novalidate autocomplete="off">
    <div class="grid-2">
      <label class="field"><span>Name</span><input type="text" name="name" maxlength="120" value="${esc(a.name)}" placeholder="e.g. New enquiry: WhatsApp the company"></label>
      <label class="field"><span>For</span><select name="company_id"><option value="">All companies</option>${cat.companies.map((c) => '<option value="' + c.id + '"' + (c.id === a.company_id ? ' selected' : '') + '>' + esc(c.name) + ' only</option>').join('')}</select></label>
    </div>
    <label class="field mt"><span>When</span><select name="trigger_event">${groups.map((g) => '<optgroup label="' + esc(g) + '">' + cat.events.filter((e) => e.group === g).map((e) => '<option value="' + e.key + '"' + (e.key === a.trigger_event ? ' selected' : '') + '>' + esc(e.label) + (e.scheduled ? ' (scheduled)' : '') + '</option>').join('') + '</optgroup>').join('')}</select></label>
    <div class="small muted" style="margin-top:4px" data-help></div>
    <div class="row wrap mt" style="gap:12px" data-extra>
      <label class="field" data-days style="max-width:320px"><span data-days-label></span><input type="number" name="days" min="0" max="365"></label>
      <label class="field" data-source style="max-width:260px"><span>Which requests</span><select name="source"><option value="">From anywhere</option><option value="marketplace">Marketplace enquiries only</option><option value="share">Share-link requests only</option></select></label>
      <label class="field" data-severity style="max-width:260px"><span>Which problems</span><select name="severity"><option value="">Any severity</option><option value="high">High severity only</option></select></label>
    </div>
    <div class="form-section">Then send</div>
    <div data-steps style="display:grid;gap:12px"></div>
    <div class="row wrap mt" style="gap:8px"><button type="button" class="btn sm" data-add="whatsapp">${icon('plus')} WhatsApp</button><button type="button" class="btn sm" data-add="email">${icon('plus')} Email</button><button type="button" class="btn sm" data-add="webhook">${icon('plus')} Webhook</button></div>
    <div class="form-section">Variables <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500">(click to insert into the last field you typed in)</span></div>
    <div class="row wrap" style="gap:6px" data-vars></div>
    <label class="check mt"><input type="checkbox" name="is_active"${a.is_active ? ' checked' : ''}> On</label>
    <div class="error-text mt hidden" data-err></div>
  </form>`);
  const m = modal({ title: automation ? 'Edit automation' : 'New automation', body, size: 'wide', foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save automation</button>' });
  body.days.value = a.days ?? '';
  body.source.value = (a.filters && a.filters.source) || '';
  body.severity.value = (a.filters && a.filters.severity) || '';
  let lastField = null;
  body.addEventListener('focusin', (e) => { if (e.target.matches('[data-k="message"], [data-k="subject"], [data-k="params"], [data-k="custom"]')) lastField = e.target; });

  const trig = () => ev[body.trigger_event.value];
  function paintTrigger() {
    const e = trig();
    $('[data-help]', body).textContent = e.help || '';
    $('[data-days]', body).hidden = !e.scheduled;
    $('[data-days-label]', body).textContent = 'How many ' + (e.daysLabel || 'days');
    if (e.scheduled && body.days.value === '') body.days.value = e.defaultDays;
    $('[data-source]', body).hidden = !(e.filters || []).includes('source');
    $('[data-severity]', body).hidden = !(e.filters || []).includes('severity');
    $('[data-vars]', body).innerHTML = e.vars.map((v) => '<button type="button" class="tag" data-var="' + v + '" title="' + esc(fill('{{' + v + '}}', cat.sample)) + '">' + v + '</button>').join('');
    paintSteps();
  }
  function paintSteps() {
    const e = trig();
    const box = $('[data-steps]', body);
    box.innerHTML = steps.map((s, i) => {
      const [label, ic] = CHANNELS[s.channel];
      const to = Object.entries(cat.recipients).filter(([k]) => k !== 'customer' || e.customer)
        .map(([k, l]) => '<option value="' + k + '"' + (s.to === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
      const tpl = s.template || {};
      return `<div class="card card-pad" data-i="${i}" style="box-shadow:none">
        <div class="row spread"><b>${icon(ic)} ${i + 1}. ${label}</b><button type="button" class="btn sm icon ghost" data-remove title="Remove this step">${icon('x')}</button></div>
        ${s.channel === 'webhook' ? `<label class="field mt"><span>Webhook</span><select data-k="webhook_id"><option value="">Choose…</option>${cat.webhooks.map((w) => '<option value="' + w.id + '"' + (w.id === s.webhook_id ? ' selected' : '') + '>' + esc(w.name) + (w.is_active ? '' : ' (off)') + '</option>').join('')}</select></label>
          <div class="small faint" style="margin-top:4px">${cat.webhooks.length ? 'Posts the event to that webhook (signed, retried), even for scheduled triggers.' : 'Add a webhook on the Webhooks tab first.'}</div>` : `
        <div class="grid-2 mt">
          <label class="field"><span>Send to</span><select data-k="to">${to}</select></label>
          <label class="field" ${s.to === 'custom' ? '' : 'hidden'} data-custom-wrap><span>${s.channel === 'email' ? 'Email addresses' : 'Phone numbers'} (comma separated)</span><input type="text" data-k="custom" maxlength="1000" value="${esc(s.custom || '')}"></label>
        </div>
        ${s.channel === 'email' ? '<label class="field mt"><span>Subject</span><input type="text" data-k="subject" maxlength="200" value="' + esc(s.subject || '') + '"></label>' : ''}
        <label class="field mt"><span>Message</span><textarea data-k="message" rows="3" maxlength="3000">${esc(s.message || '')}</textarea></label>
        ${s.channel === 'whatsapp' ? `<details class="mt"${tpl.name ? ' open' : ''}><summary class="small"><b>Approved template</b> <span class="muted">(needed with Meta for messages you start; a Twilio content SID also works)</span></summary>
          <div class="grid-2 mt">
            <label class="field"><span>Template name</span><input type="text" data-k="tpl_name" maxlength="512" value="${esc(tpl.name || '')}" placeholder="new_enquiry"></label>
            <label class="field"><span>Language</span><input type="text" data-k="tpl_language" maxlength="10" value="${esc(tpl.language || 'en')}"></label>
          </div>
          <label class="field mt"><span>Values for {{1}}, {{2}}… in the template, one per line</span><textarea data-k="params" rows="3">${esc((tpl.params || []).join('\n'))}</textarea></label>
        </details>` : ''}
        <div class="small muted mt" data-preview></div>`}
      </div>`;
    }).join('') || '<div class="muted small">No steps yet.</div>';
    previews();
  }
  function read() {
    $$('[data-i]', body).forEach((card) => {
      const s = steps[Number(card.dataset.i)];
      $$('[data-k]', card).forEach((f) => {
        const k = f.dataset.k;
        if (k === 'webhook_id') s.webhook_id = Number(f.value) || null;
        else if (k === 'tpl_name' || k === 'tpl_language' || k === 'params') {
          s.template = s.template || {};
          if (k === 'tpl_name') s.template.name = f.value.trim();
          if (k === 'tpl_language') s.template.language = f.value.trim();
          if (k === 'params') s.template.params = f.value.split('\n').map((x) => x.trim()).filter(Boolean);
        } else s[k] = f.value;
      });
      if (s.template && !s.template.name) delete s.template;
    });
  }
  function previews() {
    $$('[data-i]', body).forEach((card) => {
      const s = steps[Number(card.dataset.i)];
      const p = $('[data-preview]', card);
      if (!p) return;
      const msg = fill(s.message, cat.sample);
      const t = s.template && s.template.name ? ' · template ' + s.template.name + '(' + (s.template.params || []).map((x) => '"' + fill(x, cat.sample) + '"').join(', ') + ')' : '';
      // A variable this trigger does not have would quietly print as nothing.
      const used = [s.message, s.subject, ...((s.template && s.template.params) || [])].join(' ').match(/\{\{\s*[\w.]+\s*\}\}/g) || [];
      const unknown = [...new Set(used.map((v) => v.replace(/[{}\s]/g, '')))].filter((v) => !trig().vars.includes(v));
      p.innerHTML = (msg || t ? '<b>Preview:</b> ' + esc((s.channel === 'email' && s.subject ? fill(s.subject, cat.sample) + ' — ' : '') + msg + t) : '') +
        (unknown.length ? '<div class="neg">Not available for this trigger, will be left empty: ' + unknown.map((v) => esc('{{' + v + '}}')).join(', ') + '</div>' : '');
    });
  }
  body.addEventListener('input', () => { read(); previews(); });
  body.addEventListener('change', (e) => {
    if (e.target === body.trigger_event) { read(); body.days.value = ''; paintTrigger(); return; }
    if (e.target.dataset.k === 'to') {
      read();
      const wrap = $('[data-custom-wrap]', e.target.closest('[data-i]'));
      if (wrap) wrap.hidden = e.target.value !== 'custom';
    }
  });
  body.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      read();
      const ch = add.dataset.add;
      steps.push(ch === 'webhook' ? { channel: ch, webhook_id: (cat.webhooks[0] || {}).id || null } : { channel: ch, to: 'company_admins', message: '', subject: ch === 'email' ? '' : undefined });
      paintSteps();
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { read(); steps.splice(Number(rm.closest('[data-i]').dataset.i), 1); paintSteps(); }
    const v = e.target.closest('[data-var]');
    if (v) {
      const f = lastField && body.contains(lastField) ? lastField : $('[data-k="message"]', body);
      if (!f) return;
      const ins = '{{' + v.dataset.var + '}}';
      const at = f.selectionStart ?? f.value.length;
      f.value = f.value.slice(0, at) + ins + f.value.slice(f.selectionEnd ?? at);
      f.focus();
      f.selectionStart = f.selectionEnd = at + ins.length;
      read(); previews();
    }
  });
  paintTrigger();

  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    read();
    const data = {
      name: body.name.value, trigger_event: body.trigger_event.value, days: body.days.value, company_id: body.company_id.value || null,
      filters: { source: body.source.value, severity: body.severity.value }, is_active: body.is_active.checked,
      steps: steps.map((s) => Object.fromEntries(Object.entries(s).filter(([, x]) => x !== undefined))),
    };
    try {
      if (automation) await patch('/admin/automations/' + automation.id, data); else await post('/admin/automations', data);
      m.close();
      toast('Automation saved', 'ok');
      onSaved();
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  }));
}

function testModal(a) {
  const m = modal({
    title: 'Test "' + a.name + '"', size: 'narrow',
    body: `<p class="muted">Each step is sent once, with example data, to these instead of the real people.</p>
      <label class="field"><span>WhatsApp number</span><input type="tel" data-phone value="${esc(store.user.phone || '')}"></label>
      <label class="field mt"><span>Email</span><input type="email" data-email value="${esc(store.user.email)}"></label>
      <div data-out class="mt"></div>`,
    foot: '<button class="btn" data-close>Close</button><button class="btn primary" data-go>' + icon('send') + ' Send test</button>',
  });
  $('[data-go]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const out = $('[data-out]', m.el);
    try {
      const r = await post('/admin/automations/' + a.id + '/test', { phone: $('[data-phone]', m.el).value, email: $('[data-email]', m.el).value });
      out.innerHTML = r.results.map((d) => '<div class="row" style="gap:8px;margin-bottom:6px">' + deliveryPill(d) + '<span class="small">' + esc(CHANNELS[d.channel][0]) + ' → ' + esc(d.target) + (d.error ? '<div class="faint">' + esc(d.error) + '</div>' : '') + '</span></div>').join('') +
        r.skipped.map((s) => '<div class="small faint">Skipped: ' + esc(s) + '</div>').join('') || '<div class="muted small">Nothing to send.</div>';
    } catch (err) { out.innerHTML = '<div class="error-text">' + esc(err.message) + '</div>'; }
  }));
}

/* --------------------------------------------------------------- webhooks */

function secretModal(w, secret) {
  const m = modal({
    title: 'Signing secret: ' + w.name, size: 'narrow',
    body: `<p class="muted">Your receiver uses it to check that a call really came from HoardHub. Keep it private.</p>
      <div class="mono" style="word-break:break-all;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2)" data-s>${esc(secret)}</div>
      <p class="small muted mt">Each call carries <span class="mono">X-HoardHub-Signature: t=&lt;time&gt;,v1=&lt;signature&gt;</span>, where the signature is HMAC-SHA256 of <span class="mono">time + "." + body</span> with this secret, in hex. Refuse calls older than 5 minutes.</p>`,
    foot: '<button class="btn" data-rotate>Make a new secret</button><button class="btn" data-copy>' + icon('copy') + ' Copy</button><button class="btn primary" data-close>Done</button>',
  });
  $('[data-copy]', m.el).addEventListener('click', () => copyText($('[data-s]', m.el).textContent));
  $('[data-rotate]', m.el).addEventListener('click', async (e) => {
    if (!(await confirmDialog('Make a new secret for "' + w.name + '"? The old one stops working at once; update your receiver.', { ok: 'Make a new one', danger: true }))) return;
    busy(e.currentTarget, async () => {
      try { const r = await post('/admin/webhooks/' + w.id + '/rotate'); $('[data-s]', m.el).textContent = r.secret; toast('New secret made', 'ok'); } catch (err) { toastError(err); }
    });
  });
}

function webhookEditor({ cat, ev, hook = null, events: allowed, onSaved }) {
  const w = hook || { name: '', url: '', events: ['enquiry.received'], company_id: null, is_active: true };
  const all = w.events.includes('*');
  const groups = [...new Set(allowed.map((k) => ev[k].group))];
  const body = el(`<form novalidate autocomplete="off">
    <div class="grid-2">
      <label class="field"><span>Name</span><input type="text" name="name" maxlength="120" value="${esc(w.name)}" placeholder="e.g. Zapier: new enquiries"></label>
      <label class="field"><span>For</span><select name="company_id"><option value="">All companies</option>${cat.companies.map((c) => '<option value="' + c.id + '"' + (c.id === w.company_id ? ' selected' : '') + '>' + esc(c.name) + ' only</option>').join('')}</select></label>
    </div>
    <label class="field mt"><span>URL that receives the events</span><input type="url" name="url" maxlength="500" value="${esc(w.url)}" placeholder="https://hooks.zapier.com/hooks/catch/…"></label>
    <div class="form-section">Events</div>
    <label class="check"><input type="checkbox" data-all${all ? ' checked' : ''}> Every event, including ones added later</label>
    <div data-list class="mt" style="display:grid;gap:10px">${groups.map((g) => '<div><div class="small faint" style="margin-bottom:4px">' + esc(g) + '</div><div class="row wrap" style="gap:6px 18px">' +
      allowed.filter((k) => ev[k].group === g).map((k) => '<label class="check small"><input type="checkbox" data-ev value="' + k + '"' + (all || w.events.includes(k) ? ' checked' : '') + '> ' + esc(ev[k].label) + ' <span class="faint mono">' + k + '</span></label>').join('') + '</div></div>').join('')}</div>
    <label class="check mt"><input type="checkbox" name="is_active"${w.is_active ? ' checked' : ''}> On</label>
    <div class="error-text mt hidden" data-err></div>
  </form>`);
  const m = modal({ title: hook ? 'Edit webhook' : 'New webhook', body, size: 'wide', foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save webhook</button>' });
  const sync = () => $$('[data-ev]', body).forEach((c) => { c.disabled = $('[data-all]', body).checked; });
  $('[data-all]', body).addEventListener('change', sync);
  sync();
  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    const data = {
      name: body.name.value, url: body.url.value, company_id: body.company_id.value || null, is_active: body.is_active.checked,
      events: $('[data-all]', body).checked ? ['*'] : $$('[data-ev]:checked', body).map((c) => c.value),
    };
    try {
      if (hook) { await patch('/admin/webhooks/' + hook.id, data); m.close(); toast('Webhook saved', 'ok'); } else {
        const r = await post('/admin/webhooks', data);
        m.close();
        secretModal(r.webhook, r.secret);
      }
      onSaved();
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  }));
}

async function webhooks(host, { cat, ev, again }) {
  const { webhooks: list, events: allowed } = await get('/admin/webhooks');
  const state = (w) => (w.is_active ? (w.failures ? '<span class="pill warn">On, failing</span>' : '<span class="pill ok">On</span>')
    : w.failures >= 20 ? '<span class="pill bad">Paused after failures</span>' : '<span class="pill">Off</span>');
  host.innerHTML = `<div class="card">
    <div class="card-head"><h3>Webhooks</h3><span class="small muted">Send events to Zapier, Make, n8n, a CRM or your own server: a signed JSON POST, retried for up to 8 hours.</span><button class="btn sm primary" data-new>${icon('plus')} New webhook</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Webhook</th><th>Events</th><th>For</th><th>Status</th><th class="right">Last 30 days</th><th></th></tr></thead><tbody>
    ${list.map((w) => `<tr data-id="${w.id}">
      <td><b>${esc(w.name)}</b><div class="small faint mono ellipsis" style="max-width:320px">${esc(w.url)}</div></td>
      <td class="small">${w.events.includes('*') ? 'Every event' : w.events.map((k) => esc((ev[k] || { label: k }).label)).join('<br>')}</td>
      <td class="small">${w.company_id ? esc(w.company_name) : 'All companies'}</td>
      <td>${state(w)}${w.last_status ? '<div class="small faint" style="max-width:220px">' + esc(w.last_status) + (w.last_delivery_at ? ', ' + ago(w.last_delivery_at) : '') + '</div>' : ''}</td>
      <td class="right small nowrap">${w.sent_30d} delivered${w.failed_30d ? '<div class="neg">' + w.failed_30d + ' failed</div>' : ''}</td>
      <td class="nowrap"><button class="btn sm" data-ping>Send test</button> <button class="btn sm" data-secret>Secret</button> <button class="btn sm icon" data-edit title="Edit">${icon('edit')}</button> <button class="btn sm icon danger" data-del title="Delete">${icon('trash')}</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No webhooks yet.</td></tr>'}
    </tbody></table></div></div>
    <div class="card card-pad" style="margin-top:16px">
      <h3>What a webhook receives</h3>
      <pre class="mono small" style="white-space:pre-wrap;margin:10px 0 0;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:12px">POST your URL
Content-Type: application/json
X-HoardHub-Event: enquiry.received
X-HoardHub-Delivery: 1234
X-HoardHub-Signature: t=1760000000,v1=&lt;HMAC-SHA256(secret, t + "." + body), hex&gt;

${esc(JSON.stringify({ id: 'evt_…', event: 'enquiry.received', created_at: '2026-10-02T09:30:00.000Z', company: { id: 1, name: cat.sample.company.name, slug: cat.sample.company.slug }, data: { request: { customer_name: cat.sample.request.customer_name, phone: cat.sample.request.phone, items: cat.sample.request.items, url: cat.sample.request.url } } }, null, 2))}</pre>
      <p class="small muted mt">Answer with any 2xx status within 10 seconds. Anything else is retried after 1, 5, 30, 120 and 360 minutes. A webhook that fails 20 times in a row is switched off; switch it on again once the receiver is fixed. Answering 410 stops the retries.</p>
    </div>`;
  $('[data-new]', host).addEventListener('click', () => webhookEditor({ cat, ev, events: allowed, onSaved: again }));
  host.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const w = list.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-edit]')) webhookEditor({ cat, ev, hook: w, events: allowed, onSaved: again });
    if (e.target.closest('[data-secret]')) { try { secretModal(w, (await get('/admin/webhooks/' + w.id + '/secret')).secret); } catch (err) { toastError(err); } }
    const ping = e.target.closest('[data-ping]');
    if (ping) {
      busy(ping, async () => {
        try {
          const { result: r } = await post('/admin/webhooks/' + w.id + '/ping');
          if (r.status === 'sent') toast('Delivered (HTTP ' + r.http_status + ')', 'ok'); else toast('Not delivered: ' + (r.error || r.status), 'error');
        } catch (err) { toastError(err); }
      });
    }
    if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog('Delete the webhook "' + w.name + '"? Calls still waiting are dropped.', { ok: 'Delete', danger: true }))) return;
      try { await del('/admin/webhooks/' + w.id); toast('Deleted'); again(); } catch (err) { toastError(err); }
    }
  });
}

/* --------------------------------------------------------------- activity */

async function activity(host, { ev }) {
  const f = { channel: '', status: '' };
  host.innerHTML = `<div class="stats" data-stats></div>
    <div class="card">
      <div class="toolbar">
        <select data-f="channel" style="max-width:170px" aria-label="Channel"><option value="">Every channel</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="webhook">Webhooks</option></select>
        <select data-f="status" style="max-width:170px" aria-label="Result"><option value="">Every result</option><option value="failed">Failed</option><option value="pending">Waiting</option><option value="sent">Sent</option></select>
        <span class="grow"></span><button class="btn sm" data-reload>Refresh</button>
      </div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>From</th><th>To</th><th>Result</th><th></th></tr></thead><tbody data-rows><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table></div>
    </div>`;
  let list = [];
  async function load() {
    const r = await get('/admin/deliveries', { ...f, limit: 300 });
    list = r.deliveries;
    $('[data-stats]', host).innerHTML = `
      <div class="card stat"><div class="label">Sent, last 24 hours</div><div class="value">${r.counts.sent_24h}</div></div>
      <div class="card stat"><div class="label">Failed, last 24 hours</div><div class="value${r.counts.failed_24h ? ' neg' : ''}">${r.counts.failed_24h}</div></div>
      <div class="card stat"><div class="label">Waiting or retrying</div><div class="value">${r.counts.waiting}</div></div>`;
    $('[data-rows]', host).innerHTML = list.map((d) => `<tr data-id="${d.id}">
      <td class="small nowrap" title="${esc(fdate(d.created_at, true))}">${ago(d.created_at)}</td>
      <td class="small">${icon(CHANNELS[d.channel][1])} ${esc(CHANNELS[d.channel][0])}<div class="faint">${esc((ev[d.event] || { label: d.event }).label)}</div></td>
      <td class="small">${esc(d.automation_name || d.webhook_name || '—')}${d.is_test ? ' <span class="tag">test</span>' : ''}${d.company_name ? '<div class="faint">' + esc(d.company_name) + '</div>' : ''}</td>
      <td class="small mono ellipsis" style="max-width:240px">${d.channel === 'whatsapp' ? '+' : ''}${esc(d.target)}</td>
      <td>${deliveryPill(d)}${d.attempts > 1 ? ' <span class="small faint">' + d.attempts + ' tries</span>' : ''}${d.error ? '<div class="small faint" style="max-width:320px">' + esc(d.error) + '</div>' : ''}</td>
      <td class="nowrap"><button class="btn sm" data-view>View</button>${d.status === 'failed' ? ' <button class="btn sm" data-retry>Send again</button>' : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing sent yet.</td></tr>';
  }
  $$('[data-f]', host).forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; load().catch(toastError); }));
  $('[data-reload]', host).addEventListener('click', (e) => busy(e.currentTarget, () => load().catch(toastError)));
  host.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.target.closest('[data-view]')) {
      try {
        const { delivery: d } = await get('/admin/deliveries/' + tr.dataset.id);
        const p = d.payload;
        const shown = d.channel === 'email' ? { to: p.to, subject: p.subject, text: p.text } : p;
        modal({ title: CHANNELS[d.channel][0] + ' #' + d.id, size: 'wide', body: '<pre class="mono small" style="white-space:pre-wrap;margin:0">' + esc(JSON.stringify(shown, null, 2)) + '</pre>', foot: '<button class="btn primary" data-close>Close</button>' });
      } catch (err) { toastError(err); }
    }
    const retry = e.target.closest('[data-retry]');
    if (retry) {
      busy(retry, async () => {
        try { const { result } = await post('/admin/deliveries/' + tr.dataset.id + '/retry'); toast(result.status === 'sent' ? 'Sent' : 'Still failing: ' + (result.error || result.status), result.status === 'sent' ? 'ok' : 'error'); await load(); } catch (err) { toastError(err); }
      });
    }
  });
  await load();
}
