// Company app + super admin console: boot, session, router and shell.
import {
  api, get, post, actingCompany, setUnauthorizedHandler, setPasswordRequiredHandler, setNewVersionHandler,
} from './api.js';
import { store, $, el, esc, initials, toastError, fdate } from './ui.js';
import { icon } from './icons.js';

const VIEWS = {
  '/login': () => import('./views/login.js'),
  '/reset/:token': () => import('./views/reset-password.js'),
  '/dashboard': () => import('./views/dashboard.js'),
  '/map': () => import('./views/mapview.js'),
  '/inventory': () => import('./views/inventory.js'),
  '/bookings': () => import('./views/bookings.js'),
  '/pnl': () => import('./views/pnl.js'),
  '/requests': () => import('./views/requests.js'),
  '/requests/:id': () => import('./views/requests.js'),
  '/issues': () => import('./views/issues.js'),
  '/shares': () => import('./views/shares.js'),
  '/team': () => import('./views/team.js'),
  '/settings': () => import('./views/settings.js'),
  '/billing': () => import('./views/billing.js'),
  '/reports': () => import('./views/reports.js'),
  '/reports/print': () => import('./views/reports-print.js'),
  '/invoices': () => import('./views/invoices.js'),
  '/invoices/:id': () => import('./views/invoices.js'),
  '/admin': () => import('./views/admin.js'),
  '/admin/companies/:id': () => import('./views/admin.js'),
  '/admin/access': () => import('./views/admin-access.js'),
  '/admin/billing': () => import('./views/admin-billing.js'),
  '/admin/settings': () => import('./views/admin-settings.js'),
  '/admin/automations': () => import('./views/admin-automations.js'),
  '/admin/account': () => import('./views/settings.js'),
};

// Sign-in pages: no shell, open without a session.
const AUTH_PAGES = new Set(['/login', '/reset/:token']);
// Signed-in pages drawn without the app's sidebar: documents for printing.
const BARE = new Set(['/reports/print']);

// Views that fill the screen edge to edge (no page padding).
const FULL = new Set(['/map']);

let cleanup = null;
// Each render gets a number; a slower, older one that finishes late must not
// install its cleanup over the newer view's (the newer map would never be torn down).
let renderSeq = 0;

function match(path) {
  for (const pattern of Object.keys(VIEWS)) {
    const names = [];
    const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
    const m = path.match(rx);
    if (m) return { pattern, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', href); else history.pushState({}, '', href);
  render();
}

const isSuper = () => store.user?.role === 'superadmin';
const inCompany = () => !!store.company;
export const can = (min) => {
  const rank = { viewer: 1, manager: 2, admin: 3, superadmin: 9 };
  return (rank[store.user?.role] || 0) >= rank[min];
};

async function loadSession() {
  try {
    // Ask the quiet endpoint first, so a signed-out visitor never logs a 401.
    const quick = await api('/auth/session', { silent401: true });
    if (!quick.user) throw new Error('signed out');
    const s = await api('/auth/me', { silent401: true });
    store.user = s.user;
    store.company = s.company;
    // A super admin with a stale "open company" that no longer exists.
    if (isSuper() && actingCompany.get() && !s.company) actingCompany.set(null);
  } catch {
    store.user = null;
    store.company = null;
  }
}

function homeFor() {
  if (!store.user) return '/login';
  if (isSuper() && !inCompany()) return '/admin';
  return '/map';
}

function navHtml(path) {
  const b = store.badges;
  const link = (href, ic, label, badge, on = path === href || path.startsWith(href + '/')) =>
    '<a href="' + href + '" data-link class="' + (on ? 'active' : '') + '">' +
    icon(ic) + '<span>' + label + '</span>' + (badge ? '<span class="badge">' + badge + '</span>' : '') + '</a>';

  let html = '';
  if (inCompany()) {
    html += link('/map', 'map', 'Map') + link('/dashboard', 'dashboard', 'Dashboard') + link('/inventory', 'list', 'Inventory') +
      link('/bookings', 'calendar', 'Bookings') + (can('manager') ? link('/pnl', 'chart', 'Profit & loss') + link('/reports', 'trend', 'Reports') + link('/invoices', 'file', 'Invoices') : '') +
      link('/requests', 'inbox', 'Customer requests', b.requests) +
      link('/issues', 'alert', 'Problem reports', b.issues) + link('/shares', 'share', 'Share links') +
      '<a href="/p/' + esc(store.company.slug) + '" target="_blank" rel="noopener">' + icon('globe') + '<span>Our public page</span></a>' +
      '<div class="nav-sep"></div>' + link('/team', 'users', 'Team') + link('/settings', 'settings', 'Settings') +
      (can('admin') ? link('/billing', 'wallet', 'Plan & billing') : '');
  }
  if (isSuper()) {
    html += (inCompany() ? '<div class="nav-sep"></div>' : '') + '<div class="nav-label">Platform</div>' +
      link('/admin', 'building', 'Companies', 0, path === '/admin' || path.startsWith('/admin/companies')) +
      link('/admin/billing', 'wallet', 'Plans & billing') + link('/admin/automations', 'sparkle', 'Automations') + link('/admin/settings', 'settings', 'Platform settings') +
      link('/admin/access', 'shield', 'Roles & permissions') + link('/admin/account', 'users', 'My account');
  }
  return html;
}

function shell(path) {
  const u = store.user;
  const c = store.company;
  const root = el('<div class="shell">' +
    '<aside class="sidebar">' +
      '<div class="brand"><div class="brand-mark">H</div>HoardHub</div>' +
      (c ? '<div class="company-chip"><span class="faint">Workspace</span><b>' + esc(c.name) + '</b></div>' : '') +
      '<nav class="nav">' + navHtml(path) + '</nav>' +
      '<div class="me"><div class="avatar">' + esc(initials(u.name)) + '</div><div class="grow"><b class="ellipsis">' + esc(u.name) + '</b>' +
      '<span class="ellipsis" style="display:block;color:#8494b0">' + esc(u.role === 'superadmin' ? 'Platform admin' : u.role) + '</span></div>' +
      '<button class="btn ghost icon sm" data-logout title="Sign out">' + icon('logout') + '</button></div>' +
    '</aside>' +
    '<div class="nav-backdrop" data-menu-close></div>' +
    '<div class="main">' +
      '<div class="mobile-top"><button class="btn ghost icon" data-menu aria-label="Menu">' + icon('menu') + '</button><b>' + esc(c ? c.name : 'HoardHub') + '</b></div>' +
      (isSuper() && c ? '<div class="as-banner">' + icon('eye') + '<span class="grow">You are working inside <b>' + esc(c.name) + '</b> as platform admin.</span><button class="btn sm" data-exit-company>Back to all companies</button></div>' : '') +
      '<div data-plan-banner></div>' +
      '<div class="view"></div>' +
    '</div></div>');

  $('[data-logout]', root).addEventListener('click', async () => {
    try { await post('/auth/logout'); } catch { /* signing out anyway */ }
    actingCompany.set(null);
    store.user = null; store.company = null;
    navigate('/login', { replace: true });
  });
  $('[data-menu]', root).addEventListener('click', () => root.classList.toggle('nav-open'));
  $('[data-menu-close]', root).addEventListener('click', () => root.classList.remove('nav-open'));
  $('[data-exit-company]', root)?.addEventListener('click', async () => {
    actingCompany.set(null);
    await loadSession();
    navigate('/admin');
  });
  return root;
}

/**
 * The plan is ending soon, in its grace period, or has lapsed: a strip above
 * every page of the workspace. Admins get a "Renew" button; the "ends soon"
 * notice can be put away for the rest of the browser session.
 */
function paintPlanBanner(sh) {
  const box = $('[data-plan-banner]', sh);
  if (!box) return;
  const st = store.company?.plan_state;
  const key = 'hh_plan_banner_' + (store.company?.id || '') + '_' + (st?.expires || '');
  let hidden = false;
  try { hidden = sessionStorage.getItem(key) === '1'; } catch { /* storage blocked */ }
  if (!st || !['expiring', 'grace', 'lapsed'].includes(st.status) || (st.status === 'expiring' && hidden)) { box.innerHTML = ''; return; }
  const plan = esc(store.company.plan_name || 'Your') + ' plan';
  const days = st.days_left === 0 ? 'today' : 'in ' + st.days_left + ' day' + (st.days_left === 1 ? '' : 's');
  const msg = {
    expiring: 'The ' + plan + ' ends <b>' + days + '</b> (' + fdate(st.expires) + '). Renew to keep everything running.',
    grace: 'The ' + plan + ' ended on ' + fdate(st.expires) + '. Renew by <b>' + fdate(st.grace_until) + '</b>' + (st.locks ? ', or the workspace becomes read-only.' : '.'),
    lapsed: 'The ' + plan + ' ended on ' + fdate(st.expires) + '. ' + (st.readonly ? '<b>The workspace is read-only</b> and its boards are off the marketplace until it is renewed.' : 'Renew it to continue.'),
  }[st.status];
  const action = can('admin') ? '<a class="btn sm primary" href="/billing?renew=1" data-link>Renew now</a>' : '<span class="small">Ask your company admin to renew.</span>';
  box.innerHTML = '<div class="plan-banner ' + (st.status === 'expiring' ? 'warn' : 'bad') + '" role="status">' + icon(st.status === 'expiring' ? 'calendar' : 'lock') +
    '<span class="grow">' + msg + '</span>' + action + (st.status === 'expiring' ? '<button class="btn ghost icon sm" data-plan-hide title="Hide until next time" aria-label="Hide">' + icon('x') + '</button>' : '') + '</div>';
  $('[data-plan-hide]', box)?.addEventListener('click', () => {
    try { sessionStorage.setItem(key, '1'); } catch { /* storage blocked */ }
    box.innerHTML = '';
  });
}

/** Re-reads the session (plan, limits) after something changed it - a payment, say. */
export async function refreshSession() {
  await loadSession();
  await render();
}

export async function refreshBadges() {
  // Nothing to count until a temporary password is replaced (the server would refuse anyway).
  if (!inCompany() || store.user?.must_change_password) return;
  try {
    store.badges = await get('/dashboard/badges');
    for (const [key, href] of [['requests', '/requests'], ['issues', '/issues']]) {
      const a = $('.nav a[href="' + href + '"]');
      if (!a) continue;
      $('.badge', a)?.remove();
      if (store.badges[key]) a.append(el('<span class="badge">' + store.badges[key] + '</span>'));
    }
  } catch { /* badges are cosmetic */ }
}

/** Keeps a view's cleanup only if no newer render has started meanwhile. */
function adopt(seq, fn) {
  if (seq === renderSeq) { cleanup = fn || null; return; }
  try { fn?.(); } catch { /* view already gone */ }
}

async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const seq = ++renderSeq;
  if (cleanup) { try { cleanup(); } catch { /* view already gone */ } cleanup = null; }

  const authPage = path === '/login' || /^\/reset\/[^/]+$/.test(path);
  if (!store.user && !authPage) return navigate('/login?next=' + encodeURIComponent(location.pathname + location.search), { replace: true });
  if (store.user && (path === '/' || path === '/login')) return navigate(homeFor(), { replace: true });

  // A temporary password (new account or reset) must be replaced before anything else.
  // The server enforces the same rule, so this is the friendly face of it.
  if (store.user?.must_change_password && !authPage) {
    const app = $('#app');
    app.innerHTML = '';
    const mod = await import('./views/first-password.js');
    adopt(seq, await mod.render(app, {}, {}));
    return;
  }

  const found = match(path);
  if (!found) return navigate(homeFor(), { replace: true });
  if (found.pattern.startsWith('/admin') && !isSuper()) return navigate(homeFor(), { replace: true });
  if (!found.pattern.startsWith('/admin') && !AUTH_PAGES.has(found.pattern) && !inCompany()) return navigate(homeFor(), { replace: true });

  const app = $('#app');
  let target;
  if (AUTH_PAGES.has(found.pattern) || BARE.has(found.pattern)) {
    app.innerHTML = '';
    target = app;
  } else {
    // Keep the shell across navigations; only swap the view.
    let sh = $('.shell', app);
    if (!sh || sh.dataset.company !== String(store.company?.id || '')) {
      app.innerHTML = '';
      sh = shell(path);
      sh.dataset.company = String(store.company?.id || '');
      app.append(sh);
    } else {
      $('.nav', sh).innerHTML = navHtml(path);
      sh.classList.remove('nav-open');
    }
    paintPlanBanner(sh);
    // A fresh container each time, so listeners a view put on it die with it.
    const view = document.createElement('div');
    view.className = 'view ' + (FULL.has(found.pattern) ? 'mapview-host' : 'page');
    if (FULL.has(found.pattern)) view.style.cssText = 'flex:1;display:flex;min-height:0';
    $('.view', sh).replaceWith(view);
    target = view;
  }

  try {
    const mod = await VIEWS[found.pattern]();
    const query = Object.fromEntries(new URLSearchParams(location.search));
    adopt(seq, await mod.render(target, found.params, query));
  } catch (err) {
    console.error(err);
    target.innerHTML = '<div class="empty">Could not load this page: ' + esc(err.message) + '</div>';
  }
}

/* ---------------------------------------------------------------- boot */

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

// An admin reset this user's password while they were signed in: show the
// "set your password" screen. Never while it is already showing - every
// refused request would reload the page again.
// A new release went live while this tab was open: its scripts are out of date.
// Offer a reload rather than forcing one (there may be a form half filled in).
setNewVersionHandler(() => {
  if ($('.update-bar')) return;
  const bar = el('<div class="update-bar" role="status">' + icon('sparkle') + '<span>HoardHub has been updated.</span>' +
    '<button class="btn sm primary" data-reload>Reload</button><button class="btn sm ghost" data-later>Later</button></div>');
  $('[data-reload]', bar).addEventListener('click', () => location.reload());
  $('[data-later]', bar).addEventListener('click', () => bar.remove());
  document.body.append(bar);
});

setPasswordRequiredHandler(() => {
  if (store.user && !store.user.must_change_password) {
    store.user.must_change_password = 1;
    render();
  }
});

setUnauthorizedHandler(() => {
  if (store.user) {
    store.user = null;
    store.company = null;
    navigate('/login', { replace: true });
  }
});

export async function afterLogin(next) {
  await loadSession();
  // Only same-site paths: "//x" and "/\x" are read by browsers as other hosts.
  const safe = typeof next === 'string' && /^\/(?![/\\])[^\s]*$/.test(next);
  navigate(safe ? next : homeFor(), { replace: true });
}

/** The platform admin steps into a company's workspace, optionally at a given page. */
export async function openCompany(id, href = '/map') {
  actingCompany.set(id);
  await loadSession();
  navigate(/^\/(?![/\\])/.test(href) && !href.startsWith('/admin') ? href : '/map');
}

/**
 * On a phone, tables are drawn as one card per row (see app.css). Each cell
 * needs its column's name to stay readable, so copy the header text into
 * data-label whenever table rows are (re)rendered - by any view.
 */
function labelTables() {
  for (const table of document.querySelectorAll('table.tbl')) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of table.querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, i) => {
        if (td.hasAttribute('data-label')) return;
        td.setAttribute('data-label', td.hasAttribute('colspan') ? '' : heads[i] || '');
        // A phone card lays each cell out as "label ... value". A value made of
        // several parts (a title and a sub-line) must stay one block, or the parts
        // spread out across the row.
        const parts = [...td.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim());
        if (parts.length > 1) {
          const box = document.createElement('div');
          box.className = 'cell';
          box.append(...td.childNodes);
          td.append(box);
        }
      });
    }
  }
}
let labelQueued = false;
new MutationObserver(() => {
  if (labelQueued) return;
  labelQueued = true;
  requestAnimationFrame(() => { labelQueued = false; labelTables(); });
}).observe(document.body, { childList: true, subtree: true });

(async function boot() {
  try { store.meta = await get('/meta'); } catch (err) { toastError(err); }
  await loadSession();
  await render();
  refreshBadges();
  setInterval(refreshBadges, 60000);
})();
