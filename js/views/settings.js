// Company profile and logo, and the signed-in person's own account: password,
// notifications, devices. Under /admin/account the platform admin gets only the latter.
// Managers and admins also see the invoice details (billing address, bank, UPI, numbering).
import { get, post, put, patch, del, upload } from '../api.js';
import { store, $, esc, toast, toastError, busy, formData } from '../ui.js';
import { can } from '../app.js';
import { icon } from '../icons.js';

export async function render(root) {
  const personal = location.pathname.startsWith('/admin');
  const c = personal ? null : (await get('/company')).company;
  const ro = can('admin') ? '' : ' disabled';
  root.innerHTML = `
    <div class="page-head"><h1>${personal ? 'My account' : 'Settings'}</h1></div>
    <div class="dash-grid">
      ${personal ? '' : `<form class="card" data-company novalidate>
        <div class="card-head"><h3>Company profile</h3></div>
        <div class="card-pad">
          <div class="row" style="gap:14px;margin-bottom:14px">
            <div class="avatar" style="width:56px;height:56px;border-radius:12px;font-size:18px;background:#0f1b33 center/cover no-repeat${c.logo ? ';background-image:url(/uploads/photos/' + esc(c.logo) + ')' : ''}" data-logo>${c.logo ? '' : esc(c.name[0] || '?')}</div>
            <div><div class="small muted">Shown on the maps you share with customers.</div>${can('admin') ? '<div class="row mt" style="gap:8px"><label class="btn sm">Upload logo<input type="file" accept="image/*" hidden data-logo-file></label><button type="button" class="btn sm" data-logo-remove' + (c.logo ? '' : ' hidden') + '>Remove</button></div>' : ''}</div>
          </div>
          <label class="field"><span>Company name</span><input type="text" name="name" value="${esc(c.name)}" maxlength="160"${ro}></label>
          <div class="grid-2 mt">
            <label class="field"><span>Contact person</span><input type="text" name="contact_name" value="${esc(c.contact_name || '')}" maxlength="120"${ro}></label>
            <label class="field"><span>Phone (shown to customers)</span><input type="tel" name="phone" value="${esc(c.phone || '')}" maxlength="40"${ro}></label>
            <label class="field"><span>Email (shown to customers)</span><input type="email" name="contact_email" value="${esc(c.contact_email || '')}" maxlength="190"${ro}></label>
            <label class="field"><span>City</span><input type="text" name="city" value="${esc(c.city || '')}" maxlength="120"${ro}></label>
            <label class="field"><span>GSTIN / tax id</span><input type="text" name="gstin" value="${esc(c.gstin || '')}" maxlength="40"${ro}></label>
            <label class="field"><span>Currency</span><input type="text" name="currency" value="${esc(c.currency)}" maxlength="3"${ro}></label>
          </div>
          <label class="field mt"><span>Address</span><input type="text" name="address" value="${esc(c.address || '')}" maxlength="255"${ro}></label>
          <div class="form-section">Public marketplace profile</div>
          <label class="field"><span>About your company (shown on your public page)</span><textarea name="about" maxlength="3000" placeholder="Where you operate, what formats you own, printing and mounting services…"${ro}>${esc(c.about || '')}</textarea></label>
          <label class="check mt"><input type="checkbox" name="public_phone" ${c.public_phone ? 'checked' : ''}${ro}> Show our phone number on public listings (otherwise customers reach you through enquiries only)</label>
          <div class="row mt"><a class="btn sm" href="/p/${esc(c.slug)}" target="_blank" rel="noopener">${icon('external')} View our public page</a><span class="small faint">Only media you mark “List on the marketplace” appear there.</span></div>
          <div class="small faint mt">Plan: <b>${esc(store.company.plan_name || c.plan)}</b> · up to ${c.max_mediums} media and ${c.max_users} users.${can('admin') ? ' <a href="/billing" data-link>Plan &amp; billing</a>' : ''}</div>
        </div>
        ${can('admin') ? '<div class="modal-foot"><button class="btn primary" type="submit">Save profile</button></div>' : ''}
      </form>`}
      <form class="card" data-password novalidate>
        <div class="card-head"><h3>Your password</h3></div>
        <div class="card-pad">
          <p class="muted small">Signed in as <b>${esc(store.user.email)}</b></p>
          <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password"></label>
          <label class="field mt"><span>New password</span><input type="password" name="next" minlength="8" autocomplete="new-password"></label>
        </div>
        <div class="modal-foot"><button class="btn primary" type="submit">Change password</button></div>
      </form>
      <form class="card" data-prefs novalidate>
        <div class="card-head"><h3>Notifications</h3></div>
        <div class="card-pad">
          <label class="field"><span>My mobile number, for WhatsApp</span><input type="tel" name="phone" maxlength="40" value="${esc(store.user.phone || '')}" placeholder="98480 12345"></label>
          <label class="check mt" style="align-items:flex-start"><input type="checkbox" name="notify_whatsapp"${store.user.notify_whatsapp === 0 ? '' : ' checked'} style="margin-top:3px"><span>Send me WhatsApp messages<div class="small muted">${personal ? 'Automations sent to platform admins, such as bank transfers to confirm.' : 'New enquiries, problem reports, campaigns ending and plan renewals, when your platform has them switched on.'}</div></span></label>
          ${personal ? '' : '<label class="check mt"><input type="checkbox" name="news"' + (store.user.marketing_opt_out ? '' : ' checked') + '> Email me HoardHub news and offers</label>'}
        </div>
        <div class="modal-foot"><button class="btn primary" type="submit">Save</button></div>
      </form>
      <div class="card">
        <div class="card-head"><h3>Signed-in devices</h3></div>
        <div class="card-pad">
          <p class="muted small">Lost a phone, or signed in on a shared computer? This signs you out everywhere except this device. Changing your password does the same.</p>
          <button class="btn danger mt" data-logout-all>Sign out of all other devices</button>
        </div>
      </div>
    </div>`;

  $('[data-company]', root)?.addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('button[type=submit]', e.currentTarget), async () => {
      try {
        const r = await patch('/company', formData(e.target));
        Object.assign(store.company, formData(e.target));
        toast(r.changed?.length ? 'Saved' : 'Nothing changed', r.changed?.length ? 'ok' : '');
      } catch (err) { toastError(err); }
    });
  });
  $('[data-logo-file]', root)?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('logo', f);
    try {
      const r = await upload('/company/logo', fd);
      paintLogo(r.logo);
      toast('Logo updated', 'ok');
    } catch (err) { toastError(err); }
    e.target.value = '';
  });
  $('[data-logo-remove]', root)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      await del('/company/logo');
      paintLogo(null);
      toast('Logo removed', 'ok');
    } catch (err) { toastError(err); }
  }));
  function paintLogo(logo) {
    const box = $('[data-logo]', root);
    box.style.backgroundImage = logo ? 'url(/uploads/photos/' + logo + ')' : '';
    box.textContent = logo ? '' : (c.name[0] || '?');
    $('[data-logo-remove]', root).hidden = !logo;
  }
  $('[data-prefs]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy($('button[type=submit]', f), async () => {
      try {
        const r = await patch('/auth/preferences', { phone: f.phone.value, notify_whatsapp: f.notify_whatsapp.checked, ...(f.news ? { marketing_opt_out: !f.news.checked } : {}) });
        Object.assign(store.user, { phone: r.phone ?? store.user.phone, notify_whatsapp: r.notify_whatsapp, marketing_opt_out: r.marketing_opt_out });
        toast('Saved', 'ok');
      } catch (err) { toastError(err); }
    });
  });
  $('[data-logout-all]', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try { await post('/auth/logout-all'); toast('Signed out of all other devices', 'ok'); } catch (err) { toastError(err); }
  }));
  $('[data-password]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy($('button[type=submit]', f), async () => {
      try { await post('/auth/password', formData(f)); f.reset(); toast('Password changed', 'ok'); } catch (err) { toastError(err); }
    });
  });
  if (!personal && can('manager')) invoiceDetails(root).catch(toastError);
}

/** What prints on every invoice: billing address, GST, bank, UPI, numbering. Admins edit it. */
async function invoiceDetails(root) {
  const r = await get('/invoices/settings');
  const s = r.settings;
  const sel = r.seller;
  const ro = can('admin') ? '' : ' disabled';
  const v = (x) => esc(x || '');
  const card = document.createElement('form');
  card.className = 'card';
  card.id = 'invoice-details';
  card.noValidate = true;
  card.style.gridColumn = '1 / -1';
  card.innerHTML = `
    <div class="card-head"><h3>${icon('file')} Invoice details</h3><span class="small muted">Printed on every invoice you raise. ${can('admin') ? '' : 'Only admins can change them.'}</span></div>
    <div class="card-pad">
      <div class="grid-2">
        <label class="field"><span>Legal name on invoices</span><input type="text" name="legal_name" maxlength="160" value="${v(s.legal_name)}" placeholder="${v(sel.name)}"${ro}></label>
        <label class="field"><span>State (for GST place of supply)</span><select name="state"${ro}><option value="">—</option>${r.states.map(([c, n]) => '<option value="' + c + '"' + (c === s.state ? ' selected' : '') + '>' + c + ' · ' + esc(n) + '</option>').join('')}</select></label>
      </div>
      <label class="field mt"><span>Billing address</span><textarea name="address" rows="2" maxlength="500" placeholder="${v(sel.address)}"${ro}>${v(s.address)}</textarea></label>
      <div class="grid-4 mt">
        <label class="field"><span>PAN</span><input type="text" name="pan" maxlength="10" value="${v(s.pan)}" style="text-transform:uppercase"${ro}></label>
        <label class="field"><span>Email on invoices</span><input type="email" name="email" maxlength="190" value="${v(s.email)}" placeholder="${v(sel.email)}"${ro}></label>
        <label class="field"><span>Phone on invoices</span><input type="tel" name="phone" maxlength="40" value="${v(s.phone)}" placeholder="${v(sel.phone)}"${ro}></label>
        <div class="field"><span>GSTIN</span><div class="small" style="padding-top:8px">${sel.gstin ? '<b>' + esc(sel.gstin) + '</b> <span class="faint">(company profile)</span>' : '<span class="faint">Not set. Add it to the company profile above to charge GST.</span>'}</div></div>
      </div>
      <div class="form-section">Numbers, GST and terms</div>
      <div class="grid-4">
        <label class="field"><span>Number prefix</span><input type="text" name="prefix" maxlength="5" value="${v(s.prefix)}" style="text-transform:uppercase"${ro}></label>
        <label class="field"><span>Next number (${esc(r.series)})</span><input type="number" name="next_number" min="1" value="${r.next_number}"${ro}></label>
        <label class="field"><span>Default GST rate</span><select name="gst_rate"${ro}>${[0, 5, 12, 18, 28].map((x) => '<option value="' + x + '"' + (x === Number(s.gst_rate) ? ' selected' : '') + '>' + x + '%</option>').join('')}</select></label>
        <label class="field"><span>SAC code</span><input type="text" name="sac" maxlength="8" value="${v(s.sac)}" placeholder="998366"${ro}></label>
        <label class="field"><span>Payment terms (days)</span><input type="number" name="terms_days" min="0" max="365" value="${s.terms_days}"${ro}></label>
        <label class="field" style="grid-column:span 3"><span>Signed by</span><input type="text" name="signatory" maxlength="120" value="${v(s.signatory)}" placeholder="e.g. Arjun Reddy, Director"${ro}></label>
      </div>
      <div class="small faint" style="margin-top:4px">Numbers look like <b>${esc((s.prefix || 'INV') + '/' + r.series + '/' + String(r.next_number).padStart(4, '0'))}</b> and restart each financial year (April). SAC 998366 is the GST code for selling outdoor advertising space.</div>
      <div class="form-section">Payment details</div>
      <div class="grid-4">
        <label class="field"><span>Account name</span><input type="text" name="bank.account_name" maxlength="120" value="${v(s.bank.account_name)}"${ro}></label>
        <label class="field"><span>Bank</span><input type="text" name="bank.bank_name" maxlength="120" value="${v(s.bank.bank_name)}"${ro}></label>
        <label class="field"><span>Account number</span><input type="text" name="bank.account_number" maxlength="20" inputmode="numeric" value="${v(s.bank.account_number)}"${ro}></label>
        <label class="field"><span>IFSC</span><input type="text" name="bank.ifsc" maxlength="11" value="${v(s.bank.ifsc)}" style="text-transform:uppercase"${ro}></label>
        <label class="field"><span>Branch</span><input type="text" name="bank.branch" maxlength="120" value="${v(s.bank.branch)}"${ro}></label>
        <label class="field"><span>UPI ID</span><input type="text" name="upi.vpa" maxlength="100" value="${v(s.upi.vpa)}" placeholder="yourname@okhdfcbank"${ro}></label>
        <label class="field" style="grid-column:span 2"><span>Name shown in UPI apps</span><input type="text" name="upi.name" maxlength="50" value="${v(s.upi.name)}" placeholder="${v(sel.legal_name)}"${ro}></label>
      </div>
      <div class="small faint" style="margin-top:4px">With a UPI ID, every invoice carries a QR code for the exact amount still due: the client scans it with any UPI app.</div>
      <label class="field mt"><span>Terms and notes printed on every invoice</span><textarea name="notes" rows="2" maxlength="2000"${ro}>${v(s.notes)}</textarea></label>
    </div>
    ${can('admin') ? '<div class="modal-foot"><button class="btn primary" type="submit">Save invoice details</button></div>' : ''}`;
  $('.dash-grid', root).append(card);
  if (location.hash === '#invoice-details') card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(card);
    const body = { bank: {}, upi: {} };
    for (const [k, x] of Object.entries(d)) { const [a, b] = k.split('.'); if (b) body[a][b] = x; else body[a] = x; }
    busy($('button[type=submit]', card), async () => {
      try { await put('/invoices/settings', body); toast('Invoice details saved', 'ok'); } catch (err) { toastError(err); }
    });
  });
}
