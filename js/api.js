// Fetch wrapper. The session lives in an httpOnly cookie; the super admin's
// "open company" choice rides along as X-Company-Id.

const COMPANY_KEY = 'hh_company';

export const actingCompany = {
  get() { try { return parseInt(localStorage.getItem(COMPANY_KEY), 10) || null; } catch { return null; } },
  set(id) { try { id ? localStorage.setItem(COMPANY_KEY, String(id)) : localStorage.removeItem(COMPANY_KEY); } catch { /* blocked */ } },
};

class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload || {};
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
let onPasswordRequired = () => {};
export const setPasswordRequiredHandler = (fn) => { onPasswordRequired = fn; };

// The server stamps every answer with the front-end's version. When it changes
// while this tab is open, a new release went live: the app offers a reload.
let knownVersion = null;
let onNewVersion = () => {};
export const setNewVersionHandler = (fn) => { onNewVersion = fn; };
function checkVersion(res) {
  const v = res.headers.get('x-app-version');
  if (!v) return;
  if (!knownVersion) knownVersion = v;
  else if (v !== knownVersion) { knownVersion = v; onNewVersion(); }
}

export async function api(path, { method = 'GET', body, form, query, silent401 = false, company: forCompany } = {}) {
  let url = '/api' + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : v);
    }
    const s = qs.toString();
    if (s) url += '?' + s;
  }
  const headers = {};
  const company = forCompany || actingCompany.get();
  if (company) headers['X-Company-Id'] = company;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  checkVersion(res);
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && !silent401) onUnauthorized();
    // Password was reset by an admin mid-session. app.js decides what to do
    // (it must not reload while the "set your password" screen is already up).
    if (res.status === 403 && data.details?.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordRequired();
    throw new ApiError(res.status, data.error || 'Request failed (' + res.status + ')', data);
  }
  return data;
}

export const get = (p, query) => api(p, { query });
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p, body) => api(p, { method: 'DELETE', body });
export const upload = (p, form) => api(p, { method: 'POST', form });

/** The calls above, as one object: what shared views take, so they can run in any company. */
export const client = { get, post, patch, del, upload };

/**
 * The same calls aimed at one company without "opening" it - the platform
 * admin's company page reads and manages a company from outside. The server
 * accepts this only from a super admin.
 */
export function scoped(companyId) {
  const company = Number(companyId);
  return {
    get: (p, query) => api(p, { query, company }),
    post: (p, body) => api(p, { method: 'POST', body, company }),
    patch: (p, body) => api(p, { method: 'PATCH', body, company }),
    del: (p, body) => api(p, { method: 'DELETE', body, company }),
    upload: (p, form) => api(p, { method: 'POST', form, company }),
  };
}
