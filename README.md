# Traject (ASCEND) — Multi-User Setup

Your frontend is unchanged (still `ASCEND_Learning_Roadmap_Tracker.jsx`). What's new:

```
backend/     Express + MongoDB + JWT — accounts + per-user data storage
frontend/    Your existing app + a new login/signup screen (AuthGate.jsx)
```

## How it works
- Every user gets their own account (email + password).
- Everything your app already saves via `window.storage` (skills, daily checklist, schedule, catch-up) now saves to **MongoDB, scoped to that user's account** instead of the browser.
- Nothing inside `ASCEND_Learning_Roadmap_Tracker.jsx` was changed — `AuthGate.jsx` just swaps out `window.storage` after login.

## 1. Get a free MongoDB database
1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account.
2. Create a free "M0" cluster (any region).
3. Under **Database Access**, add a database user (username + password).
4. Under **Network Access**, add `0.0.0.0/0` (allow from anywhere) for now.
5. Click **Connect → Drivers**, copy the connection string. It looks like:
   `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/`
   Add `traject` as the database name at the end: `.../traject?retryWrites=true...`

## 2. Run the backend
```bash
cd backend
cp .env.example .env
# open .env and paste your MongoDB connection string into MONGODB_URI
# generate a random JWT_SECRET, e.g.:  openssl rand -hex 32
npm install
npm run dev
```
Backend runs at `http://localhost:5000`. Visit `http://localhost:5000/api/health` — you should see `{"ok":true}`.

## 3. Run the frontend
```bash
cd frontend
cp .env.example .env      # already points at http://localhost:5000/api
npm install
npm run dev
```
Open the printed URL (usually `http://localhost:3000`). You'll see a **Login / Sign up** screen first.

## 4. Try it
1. Sign up with two different emails in two different browser windows (or one normal + one incognito).
2. Check/uncheck different tasks in each — each account's progress stays completely separate.
3. Logout (top-right strip) and log back in — your data is still there (it's in MongoDB now, not the browser).

## 5. Going live (optional, when you're ready)
- **Backend** → deploy to [Render](https://render.com) or [Railway](https://railway.app) (both have free tiers). Set the same env vars (`MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL`) there.
- **Frontend** → deploy to [Vercel](https://vercel.com) or [Netlify](https://netlify.com). Set `VITE_API_URL` to your deployed backend's URL (e.g. `https://your-backend.onrender.com/api`).
- Update the backend's `FRONTEND_URL` env var to your deployed frontend URL so CORS allows it.

## Troubleshooting
- **"Failed to fetch" on login/signup** → backend isn't running, or `VITE_API_URL` doesn't match the backend's actual URL/port.
- **CORS error in browser console** → set `FRONTEND_URL` in `backend/.env` to match exactly where your frontend runs (including port).
- **"MongoDB connection failed"** → double-check the username/password and that you replaced `<username>`/`<password>` in the connection string, and that Network Access allows your IP (or `0.0.0.0/0`).
