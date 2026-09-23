import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate.jsx';
import './index.css';

// Auth + storage are now handled inside AuthGate.jsx, which installs an
// API-backed window.storage after login instead of the old localStorage
// polyfill. This is what makes the app multi-user.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
