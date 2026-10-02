// "Account created" / "Password reset" screen: everything the admin needs to
// pass the login on - sign-in link, email and temporary password - with one
// tap to copy, WhatsApp, email or print it. The password is only ever shown
// here, straight after it was set.
import { $, el, esc, modal, copyText, waLink, ago, busy } from '../ui.js';
import { icon } from '../icons.js';

const ROLE = { admin: 'Company admin', manager: 'Manager', viewer: 'Field viewer' };

function detailsText(a, { reset }) {
  return [
    (reset ? 'Your HoardHub password has been reset.' : 'Your HoardHub account is ready' + (a.company ? ' for ' + a.company : '') + '.'),
    '',
    'Sign in: ' + a.login_url,
    'Email: ' + a.email,
    'Temporary password: ' + a.password,
    '',
    'You will be asked to choose your own password when you sign in.',
  ].join('\n');
}

/** Password field with Generate and Show buttons. Returns the wrapper element. */
export function passwordField({ name = 'password', label = 'Password', hint = 'Leave blank and we will generate a strong one.' } = {}) {
  const wrap = el(`<label class="field"><span>${esc(label)}</span>
    <div class="row">
      <input type="password" name="${esc(name)}" minlength="8" maxlength="100" autocomplete="new-password" placeholder="Auto-generate" class="grow" style="font-family:ui-monospace,Consolas,monospace">
      <button type="button" class="btn sm" data-show title="Show / hide">${icon('eye')}</button>
      <button type="button" class="btn sm" data-gen>Generate</button>
    </div>
    <div class="hint">${esc(hint)}</div></label>`);
  const input = $('input', wrap);
  $('[data-show]', wrap).addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
  $('[data-gen]', wrap).addEventListener('click', () => {
    // Same look-alike-free alphabet as the server, so it can be typed from a phone.
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    input.value = [...buf].map((n, i) => alphabet[n % alphabet.length] + (i === 3 || i === 7 ? '-' : '')).join('');
    input.type = 'text';
  });
  return wrap;
}

/**
 * showAccountHandover(account, { phone, reset, onClose })
 *   account  { name, email, password, role, company, login_url }
 *   phone    the user's mobile, for the WhatsApp button
 */
export function showAccountHandover(account, { phone = null, reset = false, onClose } = {}) {
  const text = detailsText(account, { reset });
  const row = (label, value, { mono = false, copy = false } = {}) =>
    '<div class="row" style="padding:10px 14px;border-bottom:1px solid var(--line);gap:12px">' +
    '<span class="small faint" style="width:120px;flex:none">' + esc(label) + '</span>' +
    '<b class="grow" style="word-break:break-all;' + (mono ? 'font-family:ui-monospace,Consolas,monospace;font-size:15px' : '') + '">' + esc(value) + '</b>' +
    (copy ? '<button type="button" class="btn sm icon" data-copy-one="' + esc(value) + '" title="Copy">' + icon('copy') + '</button>' : '') + '</div>';

  const body = el(`<div>
    <div class="status-box st-available" style="margin-top:0">${icon('check')} <b>${reset ? 'Password reset for ' + esc(account.name) : 'Account created' + (account.company ? ' for ' + esc(account.company) : '')}</b>
      <div class="small mt">Send these sign-in details to <b>${esc(account.name)}</b>. They will be asked to choose their own password the first time they sign in.</div></div>
    <div class="card" style="box-shadow:none;margin-top:14px" data-print>
      ${account.company ? row('Company', account.company) : ''}
      ${row('Name', account.name)}
      ${row('Role', ROLE[account.role] || account.role)}
      ${row('Sign-in link', account.login_url, { copy: true })}
      ${row('Email', account.email, { copy: true })}
      ${row('Temporary password', account.password, { mono: true, copy: true })}
    </div>
    <p class="small" style="margin-top:12px;color:var(--st-on_hold)">${icon('alert')} This password is shown only now. If it is lost, use <b>Reset password</b> to issue a new one.</p>
    <div class="row wrap mt">
      <button type="button" class="btn primary" data-copy-all>${icon('copy')} Copy all details</button>
      <a class="btn wa" href="${esc(waLink(text, phone))}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp${phone ? '' : '…'}</a>
      <a class="btn" href="mailto:${esc(account.email)}?subject=${encodeURIComponent(reset ? 'Your HoardHub password was reset' : 'Your HoardHub account')}&body=${encodeURIComponent(text)}">Email</a>
      <button type="button" class="btn" data-print-btn>Print</button>
    </div>
  </div>`);

  const m = modal({
    title: reset ? 'New sign-in details' : 'Sign-in details',
    body,
    foot: '<button class="btn primary" data-close>Done – I have sent them</button>',
    onClose,
  });
  $('[data-copy-all]', body).addEventListener('click', () => copyText(text));
  body.addEventListener('click', (e) => { const b = e.target.closest('[data-copy-one]'); if (b) copyText(b.dataset.copyOne); });
  $('[data-print-btn]', body).addEventListener('click', () => {
    const w = window.open('', '_blank', 'width=600,height=700');
    if (!w) return;
    w.document.write('<title>Sign-in details</title><pre style="font:15px/1.6 system-ui;padding:24px;white-space:pre-wrap">' + esc(text) + '</pre>');
    w.document.close();
    w.focus();
    w.print();
  });
  return m;
}

/** Where a login stands: never used, still on its temporary password, or in use. */
export function signinState(u) {
  if (u.must_change_password && !u.last_login) return '<span class="pill warn">Not signed in yet</span>';
  if (u.must_change_password) return '<span class="pill warn">Must set password</span>';
  // Sessions renew themselves, so the last time it was used says more than the last sign-in.
  const last = u.last_seen_at || u.last_login;
  return last ? ago(last) : 'Never';
}

/** Ask for (or generate) a new temporary password, then show the handover. */
export function resetPassword(u, send, after) {
  const body = el('<form novalidate><p>Issue a new temporary password for <b>' + esc(u.name) + '</b> (' + esc(u.email) + '). Their current password stops working immediately, and they must choose a new one when they sign in.</p><div class="mt" data-pw></div><div class="error-text mt hidden" data-err></div></form>');
  body.querySelector('[data-pw]').append(passwordField({ name: 'password', label: 'New temporary password' }));
  const m = modal({ title: 'Reset password', body, size: 'narrow', foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Reset password</button>' });
  $('[data-go]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      const r = await send({ reset_password: true, password: body.password.value });
      m.close();
      await after?.();
      showAccountHandover(r.account, { phone: r.phone, reset: true });
    } catch (err) {
      const box = $('[data-err]', body); box.textContent = err.message; box.classList.remove('hidden');
    }
  }));
}

