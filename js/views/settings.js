// Company profile and logo, and the signed-in person's own account: password,
// notifications, devices. Under /admin/account the platform admin gets only the latter.
import { get, post, patch, del, upload } from '../api.js';
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
}
