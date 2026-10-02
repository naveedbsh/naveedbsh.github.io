// /reset/<token>: the link from a "forgot password" email. Choosing a new
// password here signs every device out; the person then signs in again.
import { post } from '../api.js';
import { $, el, busy, toast } from '../ui.js';
import { navigate } from '../app.js';

export function render(root, params) {
  const page = el(`
    <div class="auth-page">
      <div class="auth-art">
        <div class="brand" style="padding:0"><div class="brand-mark">H</div>HoardHub</div>
        <div>
          <h1>Choose a new password.</h1>
          <p>This link works once. After you save, every device signed in with the old password is signed out.</p>
        </div>
        <div style="color:#8ea3d6;font-size:12.5px">Did not ask for this? Ignore the email; your password stays the same.</div>
      </div>
      <div class="auth-form">
        <form novalidate autocomplete="off">
          <h1 style="margin-bottom:6px">New password</h1>
          <p class="muted" style="margin-bottom:22px">Use at least 8 characters. Longer is stronger.</p>
          <label class="field"><span>New password</span><input type="password" name="next" minlength="8" autocomplete="new-password"></label>
          <label class="field mt"><span>Repeat new password</span><input type="password" name="again" minlength="8" autocomplete="new-password"></label>
          <div class="error-text mt hidden" data-err></div>
          <button class="btn primary mt-lg" style="width:100%;height:42px" type="submit">Save new password</button>
          <p class="small muted mt" style="text-align:center"><a href="/login" data-link>Back to sign in</a></p>
        </form>
      </div>
    </div>`);
  root.append(page);
  const form = $('form', page);
  const err = $('[data-err]', page);
  // The token leaves the address bar (and the browser history) straight away.
  history.replaceState({}, '', '/reset');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (form.next.value.length < 8) return fail('The new password needs at least 8 characters.');
    if (form.next.value !== form.again.value) return fail('The two passwords do not match.');
    busy($('button[type=submit]', form), async () => {
      try {
        await post('/auth/reset', { token: params.token, password: form.next.value });
        toast('Password changed. Sign in with your new password.', 'ok');
        navigate('/login', { replace: true });
      } catch (ex) { fail(ex.message); }
    });
  });
  setTimeout(() => form.next.focus(), 50);
}
