// Company users and roles.
import { get, post, patch, del } from '../api.js';
import {
  store, $, el, esc, modal, toast, toastError, busy, formData, confirmDialog, initials,
} from '../ui.js';
import { icon } from '../icons.js';
import { can } from '../app.js';
import { showAccountHandover, passwordField, signinState, resetPassword } from './account-handover.js';

const ROLES = {
  admin: 'Admin – everything, including team and deletions',
  manager: 'Manager – add/edit media, bookings, share links, requests',
  viewer: 'Field viewer – see everything, add remarks and report problems',
};

/**
 * Add or edit a login. New logins get a temporary password (typed or
 * generated); existing ones change password through "Reset password".
 */
/** `editEmail`: the platform admin may also change an existing login's email. */
export function userModal({ user = null, onSave, editEmail = false }) {
  const body = el(`
    <form novalidate>
      <div class="grid-2">
        <label class="field"><span>Name *</span><input type="text" name="name" maxlength="120" value="${esc(user?.name || '')}"></label>
        <label class="field"><span>Mobile</span><input type="tel" name="phone" maxlength="40" value="${esc(user?.phone || '')}" placeholder="For sending the login on WhatsApp"></label>
      </div>
      ${user && !editEmail ? '<p class="small muted mt">Login email: <b>' + esc(user.email) + '</b></p>' : '<label class="field mt"><span>Email (login) *</span><input type="email" name="email" maxlength="190" autocomplete="off" value="' + esc(user?.email || '') + '"></label>'}
      <label class="field mt"><span>Role</span><select name="role">${Object.entries(ROLES).map(([k, v]) => '<option value="' + k + '"' + ((user?.role || 'manager') === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('')}</select></label>
      <div class="mt" data-pw></div>
      <div class="error-text mt hidden" data-err></div>
    </form>`);
  if (!user) {
    $('[data-pw]', body).append(passwordField({ name: 'password', label: 'Temporary password', hint: 'Leave blank to generate one. They must change it when they first sign in.' }));
  }
  const m = modal({
    title: user ? 'Edit ' + user.name : 'Add a login', body,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>' + (user ? 'Save' : 'Create login') + '</button>',
  });
  $('[data-save]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const box = $('[data-err]', m.el);
    box.classList.add('hidden');
    const d = formData(body);
    if (!d.name?.trim() || ((!user || editEmail) && !d.email?.trim())) {
      box.textContent = user && !editEmail ? 'Name is required.' : 'Name and email are required.';
      box.classList.remove('hidden');
      return;
    }
    if (!d.password) delete d.password;
    try { await onSave(d); m.close(); } catch (err) {
      box.textContent = err.message; box.classList.remove('hidden');
    }
  }));
}

export async function render(root) {
  root.innerHTML = `<div class="page-head"><h1>Team</h1>${can('admin') ? '<button class="btn primary" data-new>' + icon('plus') + ' Add member</button>' : ''}</div>
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last active</th><th></th></tr></thead><tbody data-body></tbody></table></div></div>
    <div class="card card-pad mt-lg small muted">${Object.entries(ROLES).map(([k, v]) => '<div><b>' + esc(k) + '</b>: ' + esc(v.split('– ')[1]) + '</div>').join('')}</div>`;
  const body = $('[data-body]', root);
  let users = [];
  async function load() {
    ({ users } = await get('/team'));
    body.innerHTML = users.map((u) => `
      <tr data-id="${u.id}">
        <td><div class="row"><div class="avatar" style="width:28px;height:28px;font-size:11px">${esc(initials(u.name))}</div><b>${esc(u.name)}</b>${u.id === store.user.id ? ' <span class="pill">you</span>' : ''}</div></td>
        <td class="small">${esc(u.email)}${u.phone ? '<div class="faint">' + esc(u.phone) + '</div>' : ''}</td>
        <td><span class="pill info">${esc(u.role)}</span></td>
        <td>${u.status === 'active' ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Suspended</span>'}</td>
        <td class="small">${signinState(u)}</td>
        <td class="nowrap">${can('admin') ? '<button class="btn sm icon" data-edit title="Edit">' + icon('edit') + '</button>' +
          (u.id !== store.user.id ? ' <button class="btn sm" data-reset>Reset password</button> <button class="btn sm" data-toggle>' + (u.status === 'active' ? 'Suspend' : 'Activate') + '</button> <button class="btn sm icon danger" data-del title="Remove">' + icon('trash') + '</button>' : '') : ''}</td>
      </tr>`).join('');
  }
  body.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const u = users.find((x) => x.id === Number(tr.dataset.id));
    try {
      if (e.target.closest('[data-edit]')) userModal({ user: u, onSave: async (d) => { await patch('/team/' + u.id, d); toast('Saved', 'ok'); load(); } });
      else if (e.target.closest('[data-reset]')) resetPassword(u, (d) => patch('/team/' + u.id, d), load);
      else if (e.target.closest('[data-toggle]')) { await patch('/team/' + u.id, { status: u.status === 'active' ? 'suspended' : 'active' }); load(); }
      else if (e.target.closest('[data-del]')) {
        if (!(await confirmDialog('Remove ' + u.name + '? They will no longer be able to sign in.', { ok: 'Remove', danger: true }))) return;
        await del('/team/' + u.id); load();
      }
    } catch (err) { toastError(err); }
  });
  $('[data-new]', root)?.addEventListener('click', () => userModal({
    onSave: async (d) => { const r = await post('/team', d); await load(); showAccountHandover(r.account, { phone: r.phone }); },
  }));
  await load();
}
