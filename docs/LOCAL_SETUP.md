# Local Development Setup & SSL / TLS Guide

This guide explains the development setup for Traject (ASCEND), resolves browser certificate warnings, and documents the production SSL architecture.

---

## 1. The "NET::ERR_CERT_AUTHORITY_INVALID" Error & Root Cause

When visiting `https://localhost:3000`, browsers like Chrome, Edge, and Brave display:
```
Your connection isn't private
NET::ERR_CERT_AUTHORITY_INVALID
```

### Why did this happen?
Previously, the Vite frontend configuration loaded `@vitejs/plugin-basic-ssl`. This plugin dynamically generates an untrusted, self-signed certificate on every dev server run. Because standard operating systems and browsers do not have this dynamic certificate in their Trusted Root Certification Authorities store, the browser correctly warns you that the connection is insecure.

### The Strict Security Principle:
- **Never click "Advanced -> Proceed to localhost (unsafe)"**.
- **Never disable certificate verification** in Node (`NODE_TLS_REJECT_UNAUTHORIZED=0`) or API clients (`rejectUnauthorized: false`).
- In local development, the standard, secure, and clean architecture is to **serve plain HTTP on `http://localhost:3000`**.

---

## 2. Browser Cache & HSTS Clearing

If your browser previously visited `https://localhost:3000`, it may have cached an HSTS policy (HTTP Strict Transport Security) or a permanent redirect that automatically forces `http://localhost:3000` back to `https://localhost:3000`.

### How to Clear HSTS in Google Chrome / Microsoft Edge / Brave:
1. Open a new tab and navigate to:
   ```
   chrome://net-internals/#hsts
   ```
   *(For Microsoft Edge, use `edge://net-internals/#hsts`)*
2. Scroll down to the section titled **"Delete domain security policies"**.
3. In the **Domain** text box, type:
   ```
   localhost
   ```
4. Click the **Delete** button.
5. Also clear cached redirects:
   - Press `Ctrl + Shift + Delete` (or `Cmd + Shift + Delete` on macOS).
   - Select "Cached images and files" for the last hour/all time and click **Clear data**.
6. Close the browser tab and open:
   ```
   http://localhost:3000
   ```
   The site will open cleanly over standard HTTP without any security warning.

### How to Clear in Mozilla Firefox:
1. Press `Ctrl + Shift + H` to open the Library window.
2. Search for `localhost`.
3. Right-click any entry for `localhost` and click **Forget About This Site**.
4. Open `http://localhost:3000`.

---

## 3. Development Configuration

### Frontend (`frontend/vite.config.js`)
The dev server serves plain HTTP on port 3000 and proxies `/api` calls directly to the Express backend on port 5000:
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
```

### Backend (`backend/server.js`)
In development (`NODE_ENV=development`), HSTS is disabled so that localhost is not permanently marked as HTTPS-only:
```js
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);
```

### Starting Local Development:
1. **Start Backend**:
   ```bash
   cd backend
   npm run dev
   ```
   Backend listens at `http://localhost:5000`.
2. **Start Frontend**:
   ```bash
   cd frontend
   npm run dev
   ```
   Frontend is available at `http://localhost:3000`.

---

## 4. Optional: If Local HTTPS is Strictly Required (via mkcert)

If you specifically require local HTTPS (e.g. testing mobile sensors, PWA install prompts, or external Web APIs that reject non-secure origins):

1. **Install `mkcert`**:
   - Windows (via Chocolatey or Scoop): `choco install mkcert` or `scoop install mkcert`
   - macOS: `brew install mkcert`
   - Linux: `sudo apt install libnss3-tools && brew install mkcert`
2. **Install the Local Root CA**:
   ```bash
   mkcert -install
   ```
3. **Generate Local Certificates**:
   ```bash
   cd frontend
   mkdir -p certs
   mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1
   ```
4. **Configure Vite**:
   ```js
   import fs from 'node:fs';
   // In vite.config.js:
   server: {
     https: {
       key: fs.readFileSync('./certs/localhost-key.pem'),
       cert: fs.readFileSync('./certs/localhost.pem'),
     },
     port: 3000,
     // ...
   }
   ```
5. **Security Warning**:
   All `*.pem`, `*.crt`, `*.key`, and `certs/` directories are explicitly listed in [.gitignore](file:///c:/Sidd%20Project/Task-Manager-main/.gitignore). **Never commit certificates or private keys to Git.**

---

## 5. Production SSL / TLS Architecture

In production, no self-signed certificates or in-process Node TLS certificates are used.

```
User Browser
    │  (Valid TLS 1.3 / Let's Encrypt certificate)
    ▼
Cloudflare / Vercel / Nginx Reverse Proxy (Terminates SSL)
    │  (HTTP over secure private network, trust proxy = 1)
    ▼
Node.js Express API (Port 5000)
```

1. **Edge TLS Termination**: Cloudflare, Vercel, or Nginx terminates TLS using automatically managed certificates from Let's Encrypt or DigiCert.
2. **Trust Proxy**: Express is configured with `app.set('trust proxy', 1)` to correctly inspect client IPs, protocols (`X-Forwarded-Proto`), and cookies forwarded from the proxy.
3. **Strict HSTS & HTTPS**:
   - In production (`NODE_ENV=production`), Helmet automatically injects `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
   - Cloudflare enforces "Always Use HTTPS" (automatic 308 redirect from HTTP to HTTPS).
