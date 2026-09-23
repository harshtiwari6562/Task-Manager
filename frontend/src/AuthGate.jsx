import { useState, useEffect } from 'react';
import App from '../ASCEND_Learning_Roadmap_Tracker.jsx';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'traject_token';

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseOrThrow(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

/**
 * Replaces window.storage with a version backed by our Express + MongoDB API.
 * The existing App.jsx already calls window.storage.get/set/delete/list, so
 * once this is installed, every read/write is automatically scoped to the
 * logged-in user — no changes needed inside App.jsx itself.
 */
function installApiStorage() {
  window.storage = {
    async get(key) {
      const res = await fetch(`${API_BASE}/data/${encodeURIComponent(key)}`, { headers: authHeaders() });
      if (res.status === 404) return null;
      return parseOrThrow(res);
    },
    async set(key, value) {
      const res = await fetch(`${API_BASE}/data/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ value }),
      });
      return parseOrThrow(res);
    },
    async delete(key) {
      const res = await fetch(`${API_BASE}/data/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      return parseOrThrow(res);
    },
    async list(prefix) {
      const res = await fetch(`${API_BASE}/data?prefix=${encodeURIComponent(prefix || '')}`, { headers: authHeaders() });
      return parseOrThrow(res);
    },
  };
}

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #E4E1D6',
  marginBottom: 12,
  fontSize: 14,
  outline: 'none',
  fontFamily: 'Inter, sans-serif',
  boxSizing: 'border-box',
};

export default function AuthGate() {
  const [status, setStatus] = useState('checking'); // checking | guest | authed
  const [mode, setMode] = useState('login'); // login | register
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // On first load, if we already have a token, verify it and skip straight to the app
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus('guest');
      return;
    }
    installApiStorage();
    fetch(`${API_BASE}/auth/me`, { headers: authHeaders() })
      .then(parseOrThrow)
      .then((data) => {
        setUser(data.user);
        setStatus('authed');
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setStatus('guest');
      });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const endpoint = mode === 'login' ? 'login' : 'register';
      const payload =
        mode === 'login'
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password };
      const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseOrThrow(res);
      localStorage.setItem(TOKEN_KEY, data.token);
      installApiStorage();
      setUser(data.user);
      setStatus('authed');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    delete window.storage;
    setUser(null);
    setForm({ name: '', email: '', password: '' });
    setStatus('guest');
  }

  if (status === 'checking') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F3EE', fontFamily: 'Inter, sans-serif', color: '#6E7570' }}>
        Loading…
      </div>
    );
  }

  if (status === 'guest') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F3EE', padding: 16, fontFamily: 'Inter, sans-serif' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');`}</style>
        <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 380, background: '#FFFFFF', border: '1px solid #E4E1D6', borderRadius: 20, padding: 32 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 600, color: '#123936', marginBottom: 4 }}>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </div>
          <div style={{ fontSize: 13, color: '#6E7570', marginBottom: 20 }}>
            {mode === 'login' ? 'Login to see your roadmap and progress.' : 'Your own private schedule and skill roadmap.'}
          </div>

          {mode === 'register' && (
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" required style={inputStyle} />
          )}
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" required style={inputStyle} />
          <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" type="password" required style={inputStyle} />

          {error && <div style={{ color: '#B0453A', fontSize: 13, marginBottom: 12 }}>{error}</div>}

          <button type="submit" disabled={busy} style={{ width: '100%', padding: '12px 0', borderRadius: 999, background: '#C79A3E', color: '#123936', fontWeight: 600, border: 'none', cursor: 'pointer', marginTop: 4 }}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create Account'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 13, color: '#6E7570', marginTop: 16 }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
              style={{ color: '#1F6F68', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {mode === 'login' ? 'Sign up' : 'Login'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: '#0D2725', color: '#D9D5C7', fontSize: 12, padding: '6px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Inter, sans-serif' }}>
        <span>
          Logged in as <strong style={{ color: '#E3C077' }}>{user?.name}</strong>
        </span>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#D9D5C7', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>
          Logout
        </button>
      </div>
      <App />
    </div>
  );
}
