/*
 * HoardHub demo mode, for static hosting such as GitHub Pages.
 *
 * There is no server behind the demo: this script answers the app's /api
 * calls in the browser from sample data captured from a real HoardHub by
 * demo/build.mjs. Browsing, filters, date availability, signing in as the demo
 * users and sending an enquiry all work; changes to data are not saved.
 * Loaded before the app's own scripts (see the <head> of each demo page).
 */
(() => {
  'use strict';
  const realFetch = window.fetch.bind(window);
  const SESSION = 'hh_demo_user';
  const READ_ONLY = 'This is a demo with sample data, so changes are not saved. Browsing, filters, sign-in and enquiries all work.';
  const RANK = { viewer: 1, manager: 2, admin: 3, superadmin: 9 };

  /* ------------------------------------------------------------- plumbing */
  const files = {};
  const load = (name) => (files[name] ||= realFetch('/demo/data/' + name + '.json').then((r) => {
    if (!r.ok) { const e = new Error('Not found'); e.status = 404; throw e; }
    return r.json();
  }));
  const tryLoad = (name) => load(name).catch(() => null);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ok = (body) => reply(200, body);
  const fail = (status, error, details) => reply(status, details ? { error, details } : { error });
  const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  const lc = (v) => String(v || '').toLowerCase();

  function parseBody(body) {
    if (!body) return {};
    if (typeof body === 'string') { try { return JSON.parse(body); } catch { return {}; } }
    if (body instanceof FormData) { const o = {}; for (const [k, v] of body.entries()) if (typeof v === 'string') o[k] = v; return o; }
    return {};
  }

  /* ---------------------------------------------------------------- dates */
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
  const byStart = (a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0);
  function firstFree(list, from) {
    let day = from;
    for (const b of list) { if (b.start_date > day) break; if (b.end_date >= day) day = addDays(b.end_date, 1); }
    return day;
  }
  const rangeOf = (q) => ({ from: q.from || null, to: q.to || q.from || null });

  /** A board's status for a date range, from its bookings (same rules as the server). */
  function ownerStatus(m, bookings, range, today) {
    const from = range.from || today;
    const to = range.to && range.to >= from ? range.to : from;
    const since = from < today ? from : today;
    const list = bookings.filter((b) => b.medium_id === m.id && (b.status === 'hold' || b.status === 'confirmed') && b.end_date >= since).sort(byStart);
    const inRange = list.filter((b) => b.start_date <= to && b.end_date >= from);
    const confirmed = inRange.find((b) => b.status === 'confirmed');
    const hold = inRange.find((b) => b.status === 'hold');
    let status = 'available';
    if (m.condition_status === 'inactive') status = 'inactive';
    else if (m.condition_status === 'maintenance') status = 'maintenance';
    else if (confirmed) status = 'booked';
    else if (hold) status = 'on_hold';
    const upcoming = list.find((b) => b.start_date > to);
    const cur = confirmed || hold;
    const out = { ...m, status, available_from: status === 'booked' || status === 'on_hold' ? firstFree(list, from) : null, next_booking_start: upcoming ? upcoming.start_date : null };
    if ('booking' in m) {
      out.booking = cur ? {
        id: cur.id, client_name: cur.client_name, campaign: cur.campaign, start_date: cur.start_date, end_date: cur.end_date,
        days: daysBetween(cur.start_date, cur.end_date), days_left: Math.max(0, daysBetween(today > cur.start_date ? today : cur.start_date, cur.end_date)),
        amount: cur.amount, amount_paid: cur.amount_paid, payment_status: cur.payment_status, status: cur.status,
      } : null;
      out.upcoming_count = list.filter((b) => b.start_date > to).length;
    }
    return out;
  }

  /** A public listing's status for a date range, from its busy ranges (no client details). */
  function publicStatus(m, busy, range) {
    if (!range.from) return m;
    const from = range.from;
    const to = range.to && range.to >= from ? range.to : from;
    const list = (busy || []).map((r) => ({ start_date: r.start, end_date: r.end })).filter((r) => r.end_date >= from);
    const taken = list.some((r) => r.start_date <= to && r.end_date >= from);
    const upcoming = list.find((r) => r.start_date > to);
    return { ...m, status: taken ? 'booked' : 'available', available_from: taken ? firstFree(list, from) : null, next_booking_start: upcoming ? upcoming.start_date : null };
  }

  /* -------------------------------------------------------------- session */
  const sessionEmail = () => { try { return localStorage.getItem(SESSION); } catch { return null; } };
  const setSession = (email) => { try { if (email) localStorage.setItem(SESSION, email); else localStorage.removeItem(SESSION); } catch { /* private window */ } };
  const currentUser = (common) => { const p = common.personas[sessionEmail() || '']; return p ? p.user : null; };

  /* ---------------------------------------------------------- marketplace */
  function km(aLat, aLng, bLat, bLng) {
    const r = Math.PI / 180;
    const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(x));
  }

  function marketSearch(common, q) {
    const types = listOf(q.types); const cities = listOf(q.cities); const illum = listOf(q.illumination);
    const text = lc(q.q).trim();
    const range = rangeOf(q);
    let rows = clone(common.market.list).filter((m) =>
      (!types.length || types.includes(m.type)) && (!cities.length || cities.includes(m.city)) && (!illum.length || illum.includes(m.illumination)) &&
      (!q.provider || m.provider.slug === q.provider) &&
      (!text || [m.title, m.area, m.city, m.landmark, m.address, m.provider.name].some((v) => lc(v).includes(text))) &&
      (!(Number(q.min_width) > 0) || m.width >= Number(q.min_width)) && (!(Number(q.min_height) > 0) || m.height >= Number(q.min_height)) &&
      (!(Number(q.max_rate) > 0) || (m.rate_month !== null && m.rate_month <= Number(q.max_rate))));
    const bbox = String(q.bbox || '').split(',').map(Number);
    if (bbox.length === 4 && bbox.every(Number.isFinite)) rows = rows.filter((m) => m.lat >= bbox[0] && m.lat <= bbox[2] && m.lng >= bbox[1] && m.lng <= bbox[3]);
    const [nLat, nLng] = String(q.near || '').split(',').map(Number);
    const near = Number.isFinite(nLat) && Number.isFinite(nLng);
    if (near) {
      const radius = Math.min(Math.max(Number(q.radius) || 10, 1), 200);
      for (const m of rows) m.distance_km = Math.round(km(nLat, nLng, m.lat, m.lng) * 10) / 10;
      rows = rows.filter((m) => m.distance_km <= radius);
    }
    rows = rows.map((m) => publicStatus(m, common.market.busy[m.id], range));
    if (q.available === '1' || q.available === 'true') rows = rows.filter((m) => m.status === 'available');
    const sort = String(q.sort || (near ? 'near' : 'newest'));
    const byRate = (m) => (m.rate_month === null ? Infinity : m.rate_month);
    if (sort === 'near' && near) rows.sort((a, b) => a.distance_km - b.distance_km);
    else if (sort === 'price_asc') rows.sort((a, b) => byRate(a) - byRate(b));
    else if (sort === 'price_desc') rows.sort((a, b) => (b.rate_month || 0) - (a.rate_month || 0));
    else if (sort === 'size') rows.sort((a, b) => (b.width * b.height || 0) - (a.width * a.height || 0));
    else rows.sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) || b.id - a.id);
    const limit = Math.min(2000, Math.max(1, parseInt(q.limit, 10) || 1000));
    return { total: rows.length, capped: false, range, mediums: rows.slice(0, limit) };
  }

  function geocode(common, raw) {
    const q = lc(raw).trim();
    if (q.length < 3) return [];
    return common.places.filter((p) => lc(p.name).includes(q)).slice(0, 6);
  }

  function reverse(common, q) {
    const lat = Number(q.lat); const lng = Number(q.lng);
    let best = null; let bestD = Infinity;
    for (const p of common.places) { const d = km(lat, lng, p.lat, p.lng); if (d < bestD) { bestD = d; best = p; } }
    return best ? { name: best.name, area: best.area, city: best.city, road: null, state: 'Telangana', postcode: null } : { name: null };
  }

  function enquire(common, body) {
    if (String(body.website || '').trim()) return reply(201, { requests: [] });
    const ids = listOf(body.medium_ids).map(Number);
    if (!ids.length) return fail(400, 'Choose at least one listing');
    if (!String(body.name || '').trim()) return fail(400, 'Your name is required');
    if (String(body.phone || '').trim().length < 6) return fail(400, 'Phone number is required');
    const byId = new Map(common.market.list.map((m) => [m.id, m]));
    const gone = ids.filter((id) => !byId.has(id));
    if (gone.length) return fail(400, gone.length + ' of these listings ' + (gone.length === 1 ? 'is' : 'are') + ' no longer on the marketplace.', { unavailable: gone });
    const groups = new Map();
    for (const id of ids) {
      const p = byId.get(id).provider;
      if (!groups.has(p.slug)) groups.set(p.slug, { name: p.name, items: 0 });
      groups.get(p.slug).items++;
    }
    // A sample receipt, so "Track request" opens a real-looking page.
    return reply(201, { requests: [...groups.values()].map((g, i) => ({ id: 9000 + i, provider: g.name, items: g.items, url: location.origin + '/r/' + common.demoReceipt })) });
  }

  /* -------------------------------------------------------- company lists */
  function ownerMediums(co, q, today) {
    const types = listOf(q.types); const cities = listOf(q.cities); const areas = listOf(q.areas); const illum = listOf(q.illumination);
    const statuses = listOf(q.statuses || q.status); const ids = q.ids ? listOf(q.ids).map(Number) : null;
    const text = lc(q.q).trim();
    const range = rangeOf(q);
    let rows = clone(co.mediums).filter((m) =>
      (!ids || ids.includes(m.id)) && (!types.length || types.includes(m.type)) && (!cities.length || cities.includes(m.city)) &&
      (!areas.length || areas.includes(m.area)) && (!illum.length || illum.includes(m.illumination)) &&
      (!text || [m.code, m.title, m.address, m.area, m.landmark, m.city].some((v) => lc(v).includes(text))) &&
      (!(Number(q.min_width) > 0) || m.width >= Number(q.min_width)) && (!(Number(q.min_height) > 0) || m.height >= Number(q.min_height)) &&
      (!(Number(q.max_rate) > 0) || m.rate_month === null || m.rate_month <= Number(q.max_rate)) &&
      (q.listing !== 'public' || m.is_public) && (q.listing !== 'private' || !m.is_public));
    if (range.from) rows = rows.map((m) => ownerStatus(m, co.bookings, range, today));
    if (statuses.length) rows = rows.filter((m) => statuses.includes(m.status));
    return { mediums: rows, facets: co.facets, range, capped: false, total: rows.length };
  }

  function bookingsList(co, q, today) {
    const text = lc(q.q).trim();
    let rows = co.bookings.filter((b) => {
      if (q.status ? b.status !== q.status : b.status === 'cancelled') return false;
      if (q.payment === 'due' ? b.payment_status === 'paid' : q.payment && b.payment_status !== q.payment) return false;
      if (q.period === 'current' && !(b.start_date <= today && b.end_date >= today)) return false;
      if (q.period === 'upcoming' && !(b.start_date > today)) return false;
      if (q.period === 'past' && !(b.end_date < today)) return false;
      if (q.period === 'expiring' && !(b.end_date >= today && b.end_date <= addDays(today, 7))) return false;
      if (q.medium_id && b.medium_id !== Number(q.medium_id)) return false;
      if (text && ![b.client_name, b.campaign, b.code, b.title, b.invoice_no].some((v) => lc(v).includes(text))) return false;
      return true;
    });
    rows = clone(rows).sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : b.id - a.id));
    const live = rows.filter((b) => b.status !== 'cancelled');
    const amount = live.reduce((s, b) => s + b.amount, 0);
    const paid = live.reduce((s, b) => s + b.amount_paid, 0);
    return { bookings: rows.slice(0, 1000), count: rows.length, totals: { amount, paid, due: amount - paid } };
  }

  function quote(co, body, today) {
    const ids = listOf(body.medium_ids).map(Number);
    const start = body.start_date; const end = body.end_date;
    if (!start || !end) return fail(400, 'Start date is required');
    if (end < start) return fail(400, 'End date is before the start date');
    const days = daysBetween(start, end);
    const ignore = Number(body.ignore_id) || 0;
    const items = co.mediums.filter((m) => ids.includes(m.id)).map((m) => ({
      medium_id: m.id, code: m.code, title: m.title, rate_month: m.rate_month,
      amount: m.rate_month ? Math.round((m.rate_month / 30) * days * 100) / 100 : 0,
      clashes: co.bookings.filter((b) => b.medium_id === m.id && b.id !== ignore && (b.status === 'hold' || b.status === 'confirmed') && b.start_date <= end && b.end_date >= start)
        .map((b) => ({ id: b.id, client_name: b.client_name, start_date: b.start_date, end_date: b.end_date, status: b.status })),
    }));
    return ok({ days, items });
  }

  /* --------------------------------------------------------------- router */
  async function route(url, init) {
    const method = String(init.method || 'GET').toUpperCase();
    const p = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '');
    const q = Object.fromEntries(url.searchParams);
    const headers = new Headers(init.headers || {});
    const body = parseBody(init.body);
    const common = await load('common');
    const today = common.today;
    let m;

    // ---- no sign-in needed
    if (p === '/meta') return ok(common.meta);
    if (p === '/auth/session') { const u = currentUser(common); return ok({ user: u ? { name: u.name, role: u.role, company_id: u.company_id } : null }); }
    if (p === '/auth/login' && method === 'POST') {
      const email = lc(body.email).trim();
      if (!common.personas[email] || body.password !== 'password123') return fail(401, 'Wrong email or password. In the demo every login uses password123.');
      setSession(email);
      return ok(clone(common.personas[email]));
    }
    if (p === '/auth/logout') { setSession(null); return ok({ ok: true }); }
    if (p === '/auth/forgot' && method === 'POST') return fail(400, 'In the demo every login uses the password password123. Reset by email works in the real app.');
    if (p === '/auth/reset' && method === 'POST') return fail(403, READ_ONLY);
    if (p === '/market/overview') return ok(common.market.overview);
    if (p === '/market/mediums') return ok(marketSearch(common, q));
    if ((m = p.match(/^\/market\/mediums\/(\d+)$/))) {
      const d = await tryLoad('m-' + m[1]);
      if (!d) return fail(404, 'This listing is not available any more');
      d.medium = publicStatus(d.medium, d.medium.busy, rangeOf(q));
      return ok(d);
    }
    if ((m = p.match(/^\/market\/providers\/([\w-]+)$/))) return common.market.providers[m[1]] ? ok(common.market.providers[m[1]]) : fail(404, 'This provider is not on the marketplace');
    if (p === '/market/geocode' || p === '/geocode/search') return ok({ results: geocode(common, q.q) });
    if (p === '/geocode/reverse') return ok(reverse(common, q));
    if (p === '/market/enquiries' && method === 'POST') return enquire(common, body);
    if ((m = p.match(/^\/public\/share\/([\w-]+)$/))) {
      const s = await tryLoad('share-' + m[1]);
      if (!s) return fail(404, 'This link is no longer active');
      const view = clone(s.view);
      if (q.from) {
        const co = await load('company-' + s.company_id);
        const rows = new Map(co.mediums.map((x) => [x.id, x]));
        view.range = rangeOf(q);
        view.mediums = view.mediums.map((v) => {
          const own = ownerStatus(rows.get(v.id), co.bookings, view.range, today);
          return { ...v, status: own.status === 'on_hold' ? 'booked' : own.status, available_from: own.available_from, next_booking_start: own.next_booking_start };
        }).filter((v) => s.show_booked || v.status === 'available');
      }
      return ok(view);
    }
    if ((m = p.match(/^\/public\/share\/([\w-]+)\/request$/)) && method === 'POST') {
      if (String(body.website || '').trim()) return reply(201, { id: 0, token: '', url: '' });
      if (!listOf(body.medium_ids).length) return fail(400, 'Select at least one location on the map');
      if (!String(body.name || '').trim()) return fail(400, 'Your name is required');
      if (String(body.phone || '').trim().length < 6) return fail(400, 'Phone number is required');
      return reply(201, { id: 9100, token: common.demoShareReceipt, url: location.origin + '/r/' + common.demoShareReceipt });
    }
    if (/^\/public\/share\/[\w-]+\/issue$/.test(p) && method === 'POST') return reply(201, { ok: true });
    if ((m = p.match(/^\/public\/request\/([a-f0-9]+)$/))) { const r = await tryLoad('receipt-' + m[1]); return r ? ok(r) : fail(404, 'Request not found'); }
    if (/^\/public\/request\/[a-f0-9]+\/files$/.test(p)) return fail(403, READ_ONLY);

    // ---- signed in
    const u = currentUser(common);
    if (!u) return fail(401, 'Not signed in');
    const cid = u.role === 'superadmin' ? Number(headers.get('X-Company-Id')) || null : u.company_id;
    if (p === '/auth/me') {
      const out = clone(common.personas[sessionEmail()]);
      if (u.role === 'superadmin') out.company = cid ? ((await tryLoad('company-' + cid)) || {}).company || null : null;
      return ok(out);
    }
    // Price quotes change nothing, so they work; every other change is refused.
    if (method !== 'GET' && p !== '/bookings/quote' && p !== '/billing/quote') return fail(403, READ_ONLY);

    if (p.startsWith('/admin/')) {
      if (u.role !== 'superadmin') return fail(403, 'Platform administrators only');
      const admin = await load('admin');
      if (p === '/admin/stats') return ok(admin.stats);
      if (p === '/admin/companies') return ok({ companies: admin.companies });
      if (p === '/admin/audit') return ok({ entries: admin.audit.slice(0, Math.min(200, Number(q.limit) || 50)) });
      if ((m = p.match(/^\/admin\/companies\/(\d+)$/))) return admin.company[m[1]] ? ok(admin.company[m[1]]) : fail(404, 'Company not found');
      if ((m = p.match(/^\/admin\/companies\/(\d+)\/activity$/))) {
        const all = admin.activity[m[1]] || [];
        const limit = Math.min(200, Number(q.limit) || 50);
        const rows = all.filter((a) => !Number(q.before) || a.id < Number(q.before));
        return ok({ entries: rows.slice(0, limit), more: rows.length > limit });
      }
      // Plans & billing, platform settings, automations
      if (p === '/admin/settings') return ok(admin.settings);
      if (p === '/admin/email-log') return ok({ entries: admin.emailLog });
      if (p === '/admin/plans') return ok({ plans: admin.plans });
      if (p === '/admin/coupons') return ok({ coupons: admin.coupons });
      if (p === '/admin/billing/overview') return ok(admin.overview);
      if (p === '/admin/payments') {
        const rows = admin.payments.filter((x) => (!q.status || x.status === q.status) && (!q.company_id || x.company_id === Number(q.company_id)));
        return ok({ payments: rows });
      }
      if ((m = p.match(/^\/admin\/companies\/(\d+)\/billing$/))) return admin.billing[m[1]] ? ok(admin.billing[m[1]]) : fail(404, 'Company not found');
      if (p === '/admin/campaigns') return ok(admin.campaigns);
      if (p === '/admin/automations/catalog') return ok(admin.catalog);
      if (p === '/admin/automations') return ok({ automations: admin.automations });
      if (p === '/admin/webhooks') return ok(admin.webhooks);
      if (p === '/admin/deliveries') {
        const rows = admin.deliveries.deliveries.filter((x) => (!q.channel || x.channel === q.channel) && (!q.status || x.status === q.status) &&
          (!q.automation_id || x.automation_id === Number(q.automation_id)) && (!q.webhook_id || x.webhook_id === Number(q.webhook_id)));
        return ok({ deliveries: rows, counts: admin.deliveries.counts });
      }
      return fail(404, 'Not part of the demo: ' + method + ' /api' + p);
    }

    if (!cid) return fail(400, 'Open a company first');
    const co = await load('company-' + cid);
    const rank = RANK[u.role] || 0;
    if (p === '/company') return ok({ company: co.company });
    if (p === '/team') return ok({ users: co.team });
    if (p === '/dashboard') return ok(co.dashboard);
    if (p === '/dashboard/badges') return ok(co.badges);
    if (p.startsWith('/finance/')) {
      if (rank < RANK.manager) return fail(403, 'This needs manager access');
      if (p === '/finance/insights') return ok(co.insights);
      if (p === '/finance/pnl') return ok(co.pnl[(q.from || '') + '|' + (q.to || '')] || co.pnl['|']);
      if (p === '/finance/expenses') {
        const text = lc(q.q).trim();
        const rows = co.expenses.filter((e) => (!q.from || e.expense_date >= q.from) && (!q.to || e.expense_date <= q.to) &&
          (!q.category || e.category === q.category) && (!q.medium_id || e.medium_id === Number(q.medium_id)) &&
          (!text || [e.vendor, e.note, e.code, e.title].some((v) => lc(v).includes(text))));
        return ok({ expenses: rows.slice(0, Number(q.limit) || 500), count: rows.length, total: rows.reduce((s, e) => s + e.amount, 0) });
      }
    }
    if (p === '/mediums') return ok(ownerMediums(co, q, today));
    if ((m = p.match(/^\/mediums\/(\d+)$/))) {
      const d = await tryLoad('c' + cid + '-medium-' + m[1]);
      if (!d) return fail(404, 'That medium does not exist or belongs to another company');
      if (u.role === 'viewer') delete d.medium.cost_month;
      return ok(d);
    }
    if (p === '/bookings') return ok(bookingsList(co, q, today));
    if (p === '/bookings/quote') return quote(co, body, today);
    if (p === '/requests') {
      const rows = co.requests.filter((r) => (!q.status || (q.status === 'open' ? ['new', 'reviewing'].includes(r.status) : r.status === q.status)) && (!q.source || r.source === q.source));
      return ok({ requests: rows, total: rows.length });
    }
    if ((m = p.match(/^\/requests\/(\d+)$/))) { const d = await tryLoad('c' + cid + '-request-' + m[1]); return d ? ok(d) : fail(404, 'Request not found'); }
    if (p === '/issues') {
      const rows = co.issues.filter((i) => (!q.status || (q.status === 'unresolved' ? i.status !== 'resolved' : i.status === q.status)) && (!q.medium_id || i.medium_id === Number(q.medium_id)));
      return ok({ issues: rows, total: rows.length });
    }
    if (p === '/shares') return ok({ shares: co.shares });
    if (p === '/billing') {
      const b = clone(co.billing);
      // Buying, and the money side, are for the company's admins (as on the server).
      return ok(rank >= RANK.admin ? b : { ...b, can_pay: false, plans: [], pay: null, payments: [] });
    }
    if (p === '/billing/quote') {
      if (rank < RANK.admin) return fail(403, 'This needs admin access');
      const hit = co.quotes[(Number(body.plan_id) || 0) + '|' + String(body.coupon || '').trim().toUpperCase()];
      if (hit) return reply(hit.status, hit.body);
      return fail(400, body.coupon ? 'That coupon code is not valid' : 'That plan is not available');
    }
    return fail(404, 'Not part of the demo: ' + method + ' /api' + p);
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    try {
      return await route(url, init);
    } catch (err) {
      console.error('[demo]', err);
      return fail(500, 'The demo could not answer that: ' + err.message);
    }
  };

  /*
   * A "demo" mark, so nobody mistakes the sample data for a live system. In the
   * app it is a pill beside the logo (part of the layout, so it covers nothing);
   * on pages without the sidebar (marketplace, sign-in, share links) a tag at
   * the bottom left, where those pages have nothing.
   */
  const TITLE = 'Sample data in your browser. Changes are not saved.';
  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('div');
    tag.className = 'demo-tag';
    tag.title = TITLE;
    tag.textContent = 'Demo · sample data';
    tag.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2900;background:#facc15;color:#1f2937;font:600 12px/1 Inter,system-ui,sans-serif;padding:7px 11px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:none';
    const css = document.createElement('style');
    css.textContent = '@media (max-width: 720px) { .demo-tag { display: none !important; } }';
    document.head.append(css);
    document.body.append(tag);
    let queued = false;
    const place = () => {
      queued = false;
      const brand = document.querySelector('.sidebar .brand');
      if (brand && !brand.querySelector('.demo-pill')) {
        const pill = document.createElement('span');
        pill.className = 'demo-pill';
        pill.title = TITLE;
        pill.textContent = 'DEMO';
        pill.style.cssText = 'margin-left:8px;background:#facc15;color:#1f2937;font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.04em;padding:4px 7px;border-radius:999px';
        brand.append(pill);
      }
      tag.style.display = brand ? 'none' : '';
    };
    // The app draws (and redraws) its shell after this script runs.
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(place); } }).observe(document.body, { childList: true, subtree: true });
    place();
  });
})();
