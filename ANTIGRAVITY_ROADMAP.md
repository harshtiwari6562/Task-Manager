# Roadmap: Isi App ko Multi-User Banane ke liye (Google Antigravity se khud banane ke liye)

Ye guide un exact steps ko todke deti hai jo maine abhi follow kiye — taaki aap Antigravity (ya koi bhi agentic coding tool) me inhe khud bhi try kar sako. Har step me **kya banega** aur **kyon** likha hai, plus ek **example prompt** jo aap Antigravity ko de sakte ho.

Isse aapke Full-Stack roadmap ka "Node.js + Express + MongoDB" module bhi directly practice ho jayega — ye asli production-style pattern hai.

---

## Phase 0 — Prerequisite (5 min, Antigravity se bahar)
MongoDB Atlas pe free account banao aur connection string le lo (README.md me exact steps hain). Isके bina backend connect nahi hoga.

**Kyon pehle:** Agentic tool code likh sakta hai, lekin database create nahi kar sakta — ye ek manual, one-time setup hai.

---

## Phase 1 — Backend ka skeleton
**Kya banega:** Express server jo start ho aur MongoDB se connect ho.

**Prompt to Antigravity:**
> "Create a Node.js + Express backend in a `/backend` folder. Use ES modules, `dotenv` for config, `mongoose` for MongoDB, and `cors`. Add a `server.js` that connects to MongoDB using `MONGODB_URI` from `.env` and starts the server on `PORT`. Add a `GET /api/health` route that returns `{ ok: true }`."

**Kyon:** Ye foundation hai — pehle confirm karo ki server chal raha hai aur database se connect ho raha hai, uske baad hi features add karo.

---

## Phase 2 — User accounts (signup/login)
**Kya banega:** `User` model (name, email, hashed password) + `/api/auth/register`, `/api/auth/login`, `/api/auth/me` routes using JWT.

**Prompt to Antigravity:**
> "Add a Mongoose `User` model with name, email (unique), and passwordHash. Use `bcryptjs` to hash passwords. Add `POST /api/auth/register`, `POST /api/auth/login` that return a JWT signed with `JWT_SECRET`, and `GET /api/auth/me` that returns the current user from a valid token."

**Kyon:** Har user ka apna alag account hona chahiye — JWT token isi ka proof hota hai ki request kis user ki taraf se aa rahi hai.

---

## Phase 3 — Per-user data storage (ye sabse important trick hai)
**Kya banega:** Ek generic `UserData` model: `{ userId, key, value }` — plus `GET/PUT/DELETE /api/data/:key` aur `GET /api/data?prefix=...`.

**Prompt to Antigravity:**
> "Add a generic Mongoose model `UserData` with fields `userId`, `key`, `value` (string), unique on `(userId, key)`. Add protected routes: `GET /api/data/:key`, `PUT /api/data/:key` (upsert), `DELETE /api/data/:key`, and `GET /api/data?prefix=xxx` that lists matching keys for the logged-in user."

**Kyon (sabse zaroori part):** Aapka frontend already `window.storage.get(key)`, `.set(key, value)`, `.delete(key)`, `.list(prefix)` use kar raha hai. Agar backend ka API exactly isi shape (`key`/`value`/`prefix`) ko follow kare, toh **aapko apni 2000-line App.jsx ek line bhi badalni nahi padegi** — sirf `window.storage` ko API se jod dena kaafi hai. Ye pattern "match the existing interface" kehlata hai — bahut time bachata hai.

---

## Phase 4 — Auth middleware
**Kya banega:** Middleware jo Bearer token verify kare aur `req.userId` set kare, taaki har data-route automatically sirf apne user ka data de.

**Prompt to Antigravity:**
> "Add an Express middleware that reads the `Authorization: Bearer <token>` header, verifies it with `JWT_SECRET`, and attaches `req.userId`. Apply it to all `/api/data` routes."

**Kyon:** Security ke liye — bina isके koi bhi user kisi aur ka data padh/badal sakta tha.

---

## Phase 5 — Frontend: Login screen + storage swap
**Kya banega:** Ek `AuthGate.jsx` component jo login/signup dikhaye, aur success ke baad `window.storage` ko fetch-based API client se replace kar de — phir purani `<App />` ko render kare.

**Prompt to Antigravity:**
> "Create an `AuthGate.jsx` component that shows a login/signup form. On success, store the JWT in `localStorage`, then set `window.storage` to an object whose `get/set/delete/list` methods call the backend `/api/data` endpoints with the JWT in the Authorization header. Render `<App />` only after login. Update `main.jsx` to render `<AuthGate />` instead of `<App />`."

**Kyon:** Isse existing app ka core code untouched rehta hai — sirf ek naya "gate" lagaya jo login ke bina app hi nahi khulne deta, aur login ke baad data backend se aane lagta hai.

---

## Phase 6 — Test karo
1. Do alag emails se signup karo (2 browser windows / 1 normal + 1 incognito).
2. Dono me alag-alag tasks check karo.
3. Confirm karo ki dono ka data bilkul alag save ho raha hai (MongoDB Atlas dashboard me `userdatas` collection dekh sakte ho).

**Kyon:** Ye multi-user hone ka asli proof hai — agar data mix ho raha hai, matlab auth middleware ya userId scoping me galti hai.

---

## Phase 7 — Deploy (optional, jab ready ho)
- Backend → Render ya Railway (free tier).
- Frontend → Vercel ya Netlify (free tier).
- Env vars set karna na bhoolo dono taraf (`MONGODB_URI`, `JWT_SECRET`, `VITE_API_URL`, `FRONTEND_URL`).

**Kyon:** Tabhi koi bhi (aap ke alawa) link kholke apna account bana payega.

---

### Quick recap of the core idea
Aapka frontend already ek "storage interface" (`get/set/delete/list`) use kar raha tha. Humne wahi interface backend pe bana diya, bas har call ko ek `userId` se tag kar diya. Yehi wo trick hai jisse **bina frontend ko dobara likhe**, wo pura multi-user ban gaya.
