# Traject (ASCEND) — Multi-User Task & Learning Roadmap Tracker

Traject (ASCEND) is a full-stack, multi-user task management and skill roadmap application.

## Tech Stack
- **Backend**: Node.js, Express (ES modules), MySQL (`mysql2/promise` with `utf8mb4`), JWT authentication, Zod input validation, Helmet, CORS allowlisting, and Pino structured logging.
- **Frontend**: React 18, Vite, Tailwind CSS, Lucide icons, and Recharts.
- **AI Engine**: Google Gemini API via `@google/genai` (with secondary Groq API fallback & built-in offline NLP dictionary).

## Architecture & Security Highlights
- **Strict User Scoping**: Every query filters on authenticated `user_id`. One user cannot read, mutate, list, or delete another user's data.
- **Database Migrations**: Automated sequential SQL migrations in `backend/migrations/` using `utf8mb4_unicode_ci` collation for multi-language and emoji support.
- **Token Security**: HS256 JWT tokens with revocable `token_version` check on every protected request.
- **API Hardening**: Strict rate limiting (login, register, AI, and data endpoints), payload size limits (256 KB max value, 5 MB total quota), and helmet security headers.
- **Stored XSS Prevention**: All user-provided fields in PDF/printable statements are escaped.

## Local Setup

### 1. Database Setup (MySQL)
Ensure MySQL is running on `localhost:3306`. Create a database or let the backend auto-create it:
```sql
CREATE DATABASE IF NOT EXISTS traject CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit backend/.env to configure DB credentials and JWT_SECRET:
# DB_CLIENT=mysql
# DB_HOST=localhost
# DB_PORT=3306
# DB_USER=root
# DB_PASSWORD=your_mysql_password
# DB_NAME=traject
# JWT_SECRET=<generate with: openssl rand -hex 32>
npm install
npm run dev
```
The backend starts on `http://localhost:5000`. Health check: `http://localhost:5000/api/health`.

### 3. Frontend Setup
```bash
cd frontend
cp .env.example .env
# Ensure VITE_API_URL=http://localhost:5000/api
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.

## Database Backups
To take a daily backup of the MySQL database:
```bash
mysqldump -u root -p traject > traject_backup_$(date +%F).sql
```
To restore from a backup:
```bash
mysql -u root -p traject < traject_backup_YYYY-MM-DD.sql
```
