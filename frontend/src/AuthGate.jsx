import { useState, useEffect } from 'react';
import App from '../ASCEND_Learning_Roadmap_Tracker.jsx';
import {
  authApi,
  dataApi,
  setAccessToken,
  setOnUnauthorized,
  setOnRateLimited,
} from './api.js';

function installApiStorage() {
  window.storage = {
    get: (key) => dataApi.get(key),
    set: (key, value) => dataApi.set(key, value),
    delete: (key) => dataApi.delete(key),
    list: (prefix) => dataApi.list(prefix),
  };
}

function clearAppLocalStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('ascend_') || k.startsWith('daily:') || k.startsWith('catchup:') || k.startsWith('extra-tasks:') || k === 'user-skills' || k === 'planner_events' || k === 'schedule_templates_v2' || k.startsWith('skill-steps:') || k === 'dashboard-prefs' || k === 'traject_token')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn('Failed to clear localStorage keys on logout:', e);
  }
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
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    // Listen for unauthorized events to automatically log out
    setOnUnauthorized(() => {
      handleLogout();
    });

    // Listen for rate-limited events
    setOnRateLimited((msg) => {
      setToastMessage(msg);
      setTimeout(() => setToastMessage(null), 4000);
    });

    // Check if user has an active session (via refresh token cookie)
    authApi
      .refresh()
      .then((refreshed) => {
        if (refreshed) {
          return authApi.me().then((meData) => {
            installApiStorage();
            setUser(meData.user);
            setStatus('authed');
          });
        } else {
          setStatus('guest');
        }
      })
      .catch(() => {
        setStatus('guest');
      });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      let data;
      if (mode === 'login') {
        data = await authApi.login(form.email, form.password);
      } else {
        data = await authApi.register(form.name, form.email, form.password);
      }

      installApiStorage();
      setUser(data.user);
      setStatus('authed');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await authApi.logout();
    delete window.storage;
    clearAppLocalStorage();
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
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (max 60 chars)" required maxLength={60} style={inputStyle} />
          )}
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" required maxLength={254} style={inputStyle} />
          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={mode === 'register' ? 'Password (6-10 characters)' : 'Password'}
            type="password"
            required
            minLength={mode === 'register' ? 6 : 1}
            maxLength={mode === 'register' ? 10 : 128}
            style={inputStyle}
          />

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
      {toastMessage && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, background: '#F59E0B', color: '#000', padding: '10px 16px', borderRadius: 8, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          ⚠️ {toastMessage}
        </div>
      )}
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
