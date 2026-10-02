// Roles & permissions: exactly what the platform admin and each company role
// may do (mirrors the server's checks), the platform admin's hard limits, and
// a log of the platform admin's own recent actions.
import { get } from '../api.js';
import { esc, ago, fdate } from '../ui.js';
import { icon } from '../icons.js';

const Y = ['yes', 'Yes'];
const N = ['no', '—'];
const own = (text = 'Own company') => ['part', text];

// [what, platform admin, company admin, manager, viewer]
const MATRIX = [
  ['Companies on the platform'],
  ['See the list of all companies with their revenue, dues and usage', Y, N, N, N],
  ['Open any company\'s profile, numbers, logins, media, bookings, profit & loss and activity', Y, own(), own(), own('Own company, no money reports')],
  ['Work inside any company\'s workspace', Y, own(), own(), own()],
  ['Create a company and its first admin login', Y, N, N, N],
  ['Suspend, re-activate or delete a company', Y, N, N, N],
  ['Set plan, media and login limits', Y, N, N, N],
  ['Internal notes about a company', Y, N, N, N],
  ['Company profile'],
  ['Name, contact, address, GSTIN, currency, logo', Y, Y, N, N],
  ['Public page text and whether the phone is shown', Y, Y, N, N],
  ['Public web address (/p/…)', Y, N, N, N],
  ['Logins'],
  ['Add logins (within the plan\'s limit)', Y, Y, N, N],
  ['Change name, mobile, role; suspend or delete a login', Y, own('Yes, not their own role or status'), N, N],
  ['Change the email a person signs in with', Y, N, N, N],
  ['Reset a password (issues a temporary one)', Y, own('Yes, for others'), N, N],
  ['Sign a login, or the whole company, out of every device', Y, N, N, N],
  ['See anyone\'s password', ['no', 'Never'], ['no', 'Never'], ['no', 'Never'], ['no', 'Never']],
  ['Media'],
  ['See media, the map and availability', Y, Y, Y, Y],
  ['Add and edit media and photos', Y, Y, Y, N],
  ['List on or remove from the public marketplace', Y, Y, Y, N],
  ['Delete media', Y, Y, N, N],
  ['Add remarks and report problems', Y, Y, Y, Y],
  ['Resolve problem reports', Y, Y, Y, N],
  ['Bookings & customers'],
  ['See bookings and price quotes', Y, Y, Y, Y],
  ['Create and change bookings and holds', Y, Y, Y, N],
  ['Delete bookings', Y, Y, N, N],
  ['Accept or decline customer requests and marketplace enquiries', Y, Y, Y, N],
  ['Delete customer requests', Y, Y, N, N],
  ['Create and manage share links', Y, Y, Y, N],
  ['Money'],
  ['Dashboard figures: booked this month, outstanding, overdue', Y, Y, Y, Y],
  ['Profit & loss, recommendations and key numbers', Y, Y, Y, N],
  ['Record and change expenses', Y, Y, Y, N],
  ['Plans & billing'],
  ['See the plan, its end date and payment history', Y, Y, own('Plan and end date only'), own('Plan and end date only')],
  ['Pay for or renew the plan, with a coupon', Y, Y, N, N],
  ['Plans, prices, coupons, renewal terms; record or confirm payments', Y, N, N, N],
  ['Platform settings (email, WhatsApp, payment keys), automations, webhooks', Y, N, N, N],
];

const LIMITS = [
  ['lock', 'Cannot see passwords', 'Passwords are stored one-way encrypted. The platform admin can only issue a new temporary password, which the person must change at their next sign-in.'],
  ['shield', 'Cannot change or delete other platform admins', 'Each platform admin manages only their own account.'],
  ['users', 'Cannot suspend their own account', 'So the platform can never be left without a working admin login.'],
  ['users', 'Cannot remove a company\'s last active admin', 'Every company keeps at least one admin who can sign in and manage it.'],
  ['file', 'Every change is on the record', 'Each action is written to that company\'s own activity feed (marked "Platform admin") and to the log below, so the company can see what was changed and when.'],
  ['eye', 'Suspending deletes nothing', 'A suspended company keeps all its data. Only deleting a company removes it, and that needs its name typed out in full.'],
];

const cell = ([kind, text]) => '<td class="' + kind + '">' + (kind === 'yes' ? icon('check') + ' ' : '') + esc(text) + '</td>';

export async function render(root) {
  root.innerHTML = `
    <div class="page-head"><h1>Roles &amp; permissions</h1><a class="btn" href="/admin" data-link>${icon('building')} All companies</a></div>
    <p class="muted" style="margin:-6px 0 18px;max-width:760px">The platform admin has full control over every company: its profile, plan, logins, media, bookings and money, from the Companies page or by opening its workspace. Company roles only ever reach their own company. The server enforces each of these rules on every request.</p>

    <div class="card">
      <div class="table-wrap"><table class="tbl matrix"><thead><tr><th>What</th><th>Platform admin (you)</th><th>Company admin</th><th>Manager</th><th>Viewer</th></tr></thead><tbody>
      ${MATRIX.map((r) => (r.length === 1
    ? '<tr class="group"><td colspan="5">' + esc(r[0]) + '</td></tr>'
    : '<tr><td>' + esc(r[0]) + '</td>' + r.slice(1).map(cell).join('') + '</tr>')).join('')}
      </tbody></table></div>
    </div>

    <div class="section-title">Limits on the platform admin</div>
    <div class="card limits"><div class="list-rows">
      ${LIMITS.map(([ic, t, d]) => '<div><div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:12px">' + icon(ic) + '<div><b>' + esc(t) + '</b><div class="small muted">' + esc(d) + '</div></div></div></div>').join('')}
    </div></div>

    <div class="section-title">Recent platform admin actions</div>
    <div class="card"><div class="list-rows" data-audit><div class="empty">Loading…</div></div></div>`;

  const box = root.querySelector('[data-audit]');
  try {
    const { entries } = await get('/admin/audit', { limit: 50 });
    box.innerHTML = entries.length ? entries.map((a) => `
      <div><div class="grow small" style="min-width:0">${esc(a.summary)}
        <div class="faint">${esc(a.user_name || 'Platform admin')} · ${a.company_id && a.company_name ? '<a href="/admin/companies/' + a.company_id + '" data-link>' + esc(a.company_name) + '</a>' : a.company_id ? 'deleted company' : 'platform settings'} · <span title="${esc(fdate(a.created_at, true))}">${ago(a.created_at)}</span></div></div></div>`).join('')
      : '<div class="empty">No platform admin changes yet.</div>';
  } catch (err) {
    box.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
  }
}
