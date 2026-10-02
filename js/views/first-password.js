// First sign-in (or after a reset): the user replaces the temporary password
// someone else gave them before they can use the app.
import { post } from '../api.js';
import { store, $, el, esc, busy, toast } from '../ui.js';
import { afterLogin } from '../app.js';

export function render(root) {
  const u = store.user;
  const page = el(`
    <div class="auth-page">
      <div class="auth-art">
        <div class="brand" style="padding:0"><div class="brand-mark">H</div>HoardHub</div>
        <div>
          <h1>Welcome${store.company ? ' to ' + esc(store.company.name) : ''}, ${esc(u.name.split(' ')[0])}.</h1>
          <p>Your account was set up with a temporary password. Choose your own now: it keeps your company's boards, bookings and payments private to you.</p>
        </div>
        <div style="color:#8ea3d6;font-size:12.5px">Signed in as ${esc(u.email)}</div>
      </div>
      <div class="auth-form">
        <form novalidate autocomplete="off">
          <h1 style="margin-bottom:6px">Set your password</h1>
          <p class="muted" style="margin-bottom:6px">One-time step. Use at least 8 characters, and not the temporary password.</p>
          <p class="small faint" style="margin-bottom:22px">Signed in as <b>${esc(u.email)}</b>${store.company ? ' · ' + esc(store.company.name) : ''}</p>
          <label class="field"><span>Temporary password</span><input type="password" name="current" autocomplete="current-password"></label>
          <label class="field mt"><span>New password</span><input type="password" name="next" minlength="8" autocomplete="new-password"></label>
          <label class="field mt"><span>Repeat new password</span><input type="password" name="again" minlength="8" autocomplete="new-password"></label>
          <div class="small mt" data-strength></div>
          <div class="error-text mt hidden" data-err></div>
          <button class="btn primary mt-lg" style="width:100%;height:42px" type="submit">Save and continue</button>
          <button class="btn ghost mt" style="width:100%" type="button" data-out>Sign out</button>
        </form>
      </div>
    </div>`);
  root.append(page);
  const form = $('form', page);
  const err = $('[data-err]', page);

  form.next.addEventListener('input', () => {
    const v = form.next.value;
    const score = [v.length >= 8, v.length >= 12, /[A-Z]/.test(v) && /[a-z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
    const [label, color] = !v ? ['', ''] : score <= 2 ? ['Weak', 'var(--st-booked)'] : score <= 3 ? ['Fair', 'var(--st-on_hold)'] : ['Strong', 'var(--st-available)'];
    $('[data-strength]', page).innerHTML = label ? 'Strength: <b style="color:' + color + '">' + label + '</b>' : '';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (form.next.value.length < 8) return fail('The new password needs at least 8 characters.');
    if (form.next.value !== form.again.value) return fail('The two new passwords do not match.');
    if (form.next.value === form.current.value) return fail('Choose a password different from the temporary one.');
    busy($('button[type=submit]', form), async () => {
      try {
        await post('/auth/password', { current: form.current.value, next: form.next.value });
        toast('Password saved. Welcome aboard!', 'ok');
        await afterLogin();
      } catch (ex) { fail(ex.message); }
    });
  });
  $('[data-out]', page).addEventListener('click', async () => {
    try { await post('/auth/logout'); } catch { /* signing out anyway */ }
    location.href = '/login';
  });
  setTimeout(() => form.current.focus(), 50);
}
