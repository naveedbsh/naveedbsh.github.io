import { post } from '../api.js';
import { store, $, $$, el, esc, busy, modal } from '../ui.js';
import { afterLogin } from '../app.js';

export function render(root, params, query) {
  const page = el(`
    <div class="auth-page">
      <div class="auth-art">
        <div class="brand" style="padding:0"><div class="brand-mark">H</div>HoardHub</div>
        <div>
          <h1>Every hoarding, pole board and screen you own, on one live map.</h1>
          <p>Pin your media, track who has each site and until when, collect payments, and send customers a link to book straight from the map.</p>
          <ul>
            <li>Pole boards, hoardings, unipoles, LED screens and 20+ other formats</li>
            <li>Live status: available, booked, on hold, under maintenance</li>
            <li>Share filtered maps with vendors and take bookings online</li>
            <li>Field problem reports with photos and dated remarks</li>
          </ul>
        </div>
        <div style="color:#8ea3d6;font-size:12.5px">Maps © OpenStreetMap contributors</div>
      </div>
      <div class="auth-form">
        <form novalidate>
          <h1 style="margin-bottom:6px">Sign in</h1>
          <p class="muted" style="margin-bottom:22px">Use the login your company administrator gave you.</p>
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
          <label class="field mt"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
          <div style="text-align:right;margin-top:6px"><a href="#" class="small" data-forgot>Forgot password?</a></div>
          <div class="error-text mt hidden" data-err></div>
          <button class="btn primary mt-lg" style="width:100%;height:42px" type="submit">Sign in</button>
          <p class="small muted mt" style="text-align:center">Looking for advertising sites? <a href="/">Browse the marketplace</a></p>
          <div class="demo-box">
            <b>Demo logins</b> (password <code>password123</code>)
            <button type="button" data-demo="admin@metro-outdoor.local">Company admin — admin@metro-outdoor.local</button>
            <button type="button" data-demo="manager@metro-outdoor.local">Manager — manager@metro-outdoor.local</button>
            <button type="button" data-demo="viewer@metro-outdoor.local">Field viewer — viewer@metro-outdoor.local</button>
            <button type="button" data-demo="super@hoardhub.local">Platform super admin — super@hoardhub.local</button>
          </div>
        </form>
      </div>
    </div>`);
  root.append(page);

  if (!store.meta?.demo) $('.demo-box', page).remove();
  const form = $('form', page);
  const err = $('[data-err]', page);
  $$('[data-demo]', page).forEach((b) => b.addEventListener('click', () => {
    form.email.value = b.dataset.demo;
    form.password.value = 'password123';
    form.requestSubmit();
  }));

  $('[data-forgot]', page).addEventListener('click', (e) => { e.preventDefault(); forgotModal(form.email.value); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    await busy($('button[type=submit]', form), async () => {
      try {
        await post('/auth/login', { email: form.email.value, password: form.password.value });
        await afterLogin(query.next);
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove('hidden');
      }
    });
  });
}

/** "Forgot password?": emails a one-time link, or explains who can reset it when email is not set up. */
function forgotModal(email) {
  const m = modal({
    title: 'Reset your password', size: 'narrow',
    body: '<form novalidate data-f><p class="muted">Enter the email you sign in with. We will send you a link to choose a new password.</p>' +
      '<label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" value="' + esc(email || '') + '"></label>' +
      '<div class="error-text mt hidden" data-err></div></form>',
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-send>Send reset link</button>',
  });
  const f = $('[data-f]', m.el);
  const send = $('[data-send]', m.el);
  const go = () => busy(send, async () => {
    const err = $('[data-err]', m.el);
    err.classList.add('hidden');
    const value = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { err.textContent = 'Enter a valid email address.'; err.classList.remove('hidden'); return; }
    try {
      const r = await post('/auth/forgot', { email: value });
      // The answer is the same whether or not the address has an account.
      m.body.innerHTML = r.email_available
        ? '<p>If <b>' + esc(value) + '</b> has a HoardHub login, a reset link is on its way. It works once, for 60 minutes.</p><p class="small muted">Nothing arrived? Check the spam folder, or ask your company admin to reset your password from the Team page.</p>'
        : '<p>Password reset by email is not available on this server yet.</p><p class="small muted">Ask your company admin to reset your password from the Team page. They will give you a temporary one to sign in with.</p>';
      m.foot.innerHTML = '<button class="btn primary" data-close>OK</button>';
    } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
  });
  send.addEventListener('click', go);
  f.addEventListener('submit', (e) => { e.preventDefault(); go(); });
}
