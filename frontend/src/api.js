// Centralized API client for Traject (ASCEND)
// Single place that knows API_BASE, manages in-memory access tokens, handles 401 & 429

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});
const rawApiUrl = env.VITE_API_URL;

// In production build, fail fast if VITE_API_URL is missing
if (env.PROD && !rawApiUrl) {
  throw new Error('FATAL: VITE_API_URL is missing. Production builds require VITE_API_URL to be set.');
}

function getApiBase() {
  if (rawApiUrl) {
    if (typeof window !== 'undefined' && window.location && window.location.hostname && rawApiUrl.includes('localhost') && window.location.hostname !== 'localhost') {
      return rawApiUrl.replace('localhost', window.location.hostname);
    }
    return rawApiUrl;
  }
  if (typeof window !== 'undefined' && window.location) {
    // When served over HTTPS or standard port 3000, use relative '/api'
    // This allows Vite's reverse proxy to route calls securely to backend without Mixed Content errors
    if (window.location.protocol === 'https:' || window.location.port === '3000') {
      return '/api';
    }
    if (window.location.hostname) {
      return `http://${window.location.hostname}:5000/api`;
    }
  }
  return 'http://localhost:5000/api';
}

export const API_BASE = getApiBase();

let inMemoryToken = null;
let onUnauthorizedCallback = null;
let onRateLimitedCallback = null;

export function setAccessToken(token) {
  inMemoryToken = token;
}

export function getAccessToken() {
  return inMemoryToken;
}

export function setOnUnauthorized(cb) {
  onUnauthorizedCallback = cb;
}

export function setOnRateLimited(cb) {
  onRateLimitedCallback = cb;
}

/**
 * Core fetch wrapper with in-memory token, credentials, and central 401/429 handling.
 */
export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (inMemoryToken) {
    headers['Authorization'] = `Bearer ${inMemoryToken}`;
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include', // sends httpOnly refresh token cookie
  };

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (netErr) {
    throw new Error(netErr.message || 'Network connection failed');
  }

  if (res.status === 401) {
    // If not calling /auth/login or /auth/refresh, try refreshing token once
    if (!endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/register')) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        // Retry original request with fresh token
        headers['Authorization'] = `Bearer ${inMemoryToken}`;
        res = await fetch(url, { ...fetchOptions, headers });
      } else {
        if (onUnauthorizedCallback) onUnauthorizedCallback();
        throw new Error('Session expired. Please log in again.');
      }
    }
  }

  let body = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }

  if (res.status === 429) {
    const errorMsg = body?.error || 'Rate limit reached. Please wait a moment and try again.';
    if (onRateLimitedCallback) onRateLimitedCallback(errorMsg);
    throw new Error(errorMsg);
  }

  if (!res.ok) {
    throw new Error(body?.error || `Request failed with status ${res.status}`);
  }

  return body;
}

/**
 * Attempts to rotate refresh token and get a new access token
 */
let isRefreshing = false;
let refreshPromise = null;

export async function tryRefreshToken() {
  if (isRefreshing) return refreshPromise;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.token) {
        setAccessToken(data.token);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Authentication API
export const authApi = {
  async register(name, email, password) {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    if (data?.token) setAccessToken(data.token);
    return data;
  },
  async login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data?.token) setAccessToken(data.token);
    return data;
  },
  async me() {
    return apiFetch('/auth/me');
  },
  async refresh() {
    return tryRefreshToken();
  },
  async logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      setAccessToken(null);
    }
  },
  async changePassword(currentPassword, newPassword) {
    const data = await apiFetch('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (data?.token) setAccessToken(data.token);
    return data;
  },
  async deleteAccount() {
    const data = await apiFetch('/auth/account', { method: 'DELETE' });
    setAccessToken(null);
    return data;
  },
};

// Data Storage API (matches window.storage contract exactly)
export const dataApi = {
  async get(key) {
    const url = `${API_BASE}/data/${encodeURIComponent(key)}`;
    const headers = inMemoryToken ? { Authorization: `Bearer ${inMemoryToken}` } : {};
    const res = await fetch(url, { headers, credentials: 'include' });
    if (res.status === 404) return null;
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        const retryRes = await fetch(url, {
          headers: { Authorization: `Bearer ${inMemoryToken}` },
          credentials: 'include',
        });
        if (retryRes.status === 404) return null;
        if (!retryRes.ok) throw new Error('Failed to read key');
        return retryRes.json();
      }
      if (onUnauthorizedCallback) onUnauthorizedCallback();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Read failed (${res.status})`);
    }
    return res.json();
  },
  async set(key, value) {
    return apiFetch(`/data/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },
  async delete(key) {
    return apiFetch(`/data/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  },
  async list(prefix = '') {
    return apiFetch(`/data?prefix=${encodeURIComponent(prefix)}`);
  },
};

// AI Services API
export const aiApi = {
  async generateSkill(prompt, options = {}) {
    const t0 = performance.now();
    try {
      const data = await apiFetch('/ai/generate-skill', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        ...options,
      });
      const dur = Math.round(performance.now() - t0);
      console.log(`[AI Timing] /api/ai/generate-skill duration: ${dur}ms`);
      return data;
    } catch (err) {
      const dur = Math.round(performance.now() - t0);
      console.log(`[AI Timing] /api/ai/generate-skill failed after: ${dur}ms:`, err.message);
      throw err;
    }
  },
  async parseTasks(transcript, options = {}) {
    const t0 = performance.now();
    try {
      const data = await apiFetch('/ai/parse-tasks', {
        method: 'POST',
        body: JSON.stringify({ transcript }),
        ...options,
      });
      const dur = Math.round(performance.now() - t0);
      console.log(`[AI Timing] /api/ai/parse-tasks duration: ${dur}ms`);
      return data;
    } catch (err) {
      const dur = Math.round(performance.now() - t0);
      console.log(`[AI Timing] /api/ai/parse-tasks failed after: ${dur}ms:`, err.message);
      throw err;
    }
  },
};
