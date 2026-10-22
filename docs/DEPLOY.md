# Traject (ASCEND) — Production Deployment & Hardening Guide

This document outlines the operational security guidelines and deployment checklist for hosting Traject (ASCEND) safely on a custom domain and sharing the public link (e.g. WhatsApp, web).

---

## 1. Environment & Architecture Overview
In production, traffic flows through five defensive layers:
```
Client (Browser / Capacitor App)
   ↓
Cloudflare (Free Tier WAF, DDoS mitigation, SSL termination)
   ↓
Express API (Helmet, Strict CORS allowlist, Rate Limiters)
   ↓
Input Validation & Auth (Zod schemas, HS256 JWT, revocable token_version)
   ↓
MySQL (utf8mb4, non-root user, automated migrations, daily backups) & AI (Gemini / Groq)
```

---

## 2. HTTPS & Environment Variables
- **Strict HTTPS Only**: Always enforce HTTPS in Cloudflare / host reverse proxy (set "Always Use HTTPS" and HSTS).
- **NODE_ENV**: Set `NODE_ENV=production`. This activates:
  - Strict placeholder checks on `JWT_SECRET`
  - Strict `ALLOWED_ORIGINS` requirement
  - Secure, SameSite `strict` cookies for refresh tokens
  - Hidden detailed server errors

### Required Host Environment Variables
Store all secrets securely in your hosting provider's dashboard (e.g., Render, Railway, AWS ECS, VPS Systemd). **Never commit `.env` to Git.**

| Variable | Description | Example / Format |
|---|---|---|
| `PORT` | API Server listening port | `5000` |
| `NODE_ENV` | Environment mode | `production` |
| `ALLOWED_ORIGINS` | Comma-separated allowed frontend domains | `https://traject.yourdomain.com` |
| `JWT_SECRET` | 32+ character random hexadecimal secret | (Generated via `openssl rand -hex 32`) |
| `DB_CLIENT` | Database engine type | `mysql` |
| `DB_HOST` | MySQL hostname or managed host endpoint | `db.production.internal` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | Dedicated non-root MySQL username | `traject_app` |
| `DB_PASSWORD` | Strong dedicated database password | `...` |
| `DB_NAME` | Database schema name | `traject` |
| `GEMINI_API_KEY` | Google AI Studio Gemini API key | `AIzaSy...` |
| `GEMINI_MODELS` | Comma-separated model fallback priority | `gemini-2.5-flash,gemini-2.0-flash` |
| `GROQ_API_KEY` | Optional backup provider API key | `gsk_...` |
| `AI_GLOBAL_DAILY_LIMIT` | Server-wide daily AI request limit | `1000` |

---

## 3. Dedicated Non-Root MySQL User
**Never use `root` in production!** Create a dedicated user with access restricted strictly to the `traject` database:

```sql
-- Connect to MySQL as root:
CREATE USER 'traject_app'@'%' IDENTIFIED BY 'STRONG_RANDOMLY_GENERATED_PASSWORD';

-- Grant only required table-level privileges on 'traject' database:
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES ON traject.* TO 'traject_app'@'%';

FLUSH PRIVILEGES;
```

---

## 4. Health Checks & Uptime Monitoring
- **Health Check Endpoint**: `GET /api/health`
  - Returns `{"ok":true,"timestamp":"..."}` with status 200.
  - Pino request logger automatically excludes this endpoint from spamming access logs.
- **Uptime Monitoring**: Configure a free uptime monitor (e.g., [UptimeRobot](https://uptimerobot.com), [Better Stack](https://betterstack.com), or Cloudflare Health Checks) pinging `https://api.yourdomain.com/api/health` every 1 to 5 minutes with email/webhook alerts on failures.

---

## 5. Cloudflare WAF & Edge Security (Free Plan)
Place Cloudflare in front of your custom domain:
1. **SSL/TLS**: Set encryption mode to **Full (Strict)**.
2. **Web Application Firewall (WAF)**:
   - Enable Cloudflare Bot Fight Mode (free) to block automated scrapers.
   - Set up an Edge Rate Limiting rule (e.g., max 100 requests per 10 seconds per IP on `/api/*`).
3. **HTTP Security Headers**: Cloudflare automatically adds HSTS and protects against L3/L4/L7 DDoS attacks.

---

## 6. Daily Database Backups (mysqldump)
Automate daily backups using cron on Linux or Task Scheduler on Windows:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/mysql"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="$BACKUP_DIR/traject_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
mysqldump -u traject_app -p"$DB_PASSWORD" traject --single-transaction --quick | gzip > "$FILENAME"

# Retain only last 14 days of backups
find "$BACKUP_DIR" -type f -name "traject_*.sql.gz" -mtime +14 -exec rm {} \;
```

---

## 7. How to Rotate JWT_SECRET Safely
When rotating `JWT_SECRET`:
1. Generate a new 256-bit secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update `JWT_SECRET` in host environment variables and redeploy the backend.
3. Because access tokens expire in 15 minutes, active users will seamlessly exchange their valid refresh tokens at `/api/auth/refresh` without being abruptly kicked out (unless you also increment `token_version` in the database to force full logout).
