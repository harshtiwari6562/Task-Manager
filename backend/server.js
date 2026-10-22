import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import config from './config.js';
import pool, { initDB } from './db.js';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
import aiRoutes from './routes/ai.js';
import requireAuth from './middleware/auth.js';
import { generalLimiter } from './middleware/rateLimiter.js';

const app = express();

// 1. Trust proxy when behind reverse proxies / host proxies (e.g. Render, Cloudflare)
app.set('trust proxy', 1);

// 2. Hide Express signature
app.disable('x-powered-by');

// 3. Security headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: false, // API server; frontend serves its own CSP
    crossOriginEmbedderPolicy: false,
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

// 4. Response Compression (Gzip / Brotli for responses > 1 KB)
app.use(
  compression({
    threshold: 1024,
  })
);


// 4. Structured logging via pino-http (Redacts auth headers, bodies, passwords, cookies)
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.BENCHMARK ? 'warn' : 'info'),
});

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === '/api/health',
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);

// 5. Strict CORS allowlist
const allowedOriginsSet = new Set([
  ...config.ALLOWED_ORIGINS,
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without Origin header (mobile apps, server-to-server, curl) are allowed
      if (!origin) return callback(null, true);

      if (allowedOriginsSet.has(origin)) {
        return callback(null, true);
      }

      // Check regex for localhost or private LAN IP with arbitrary port in non-production
      if (
        config.NODE_ENV !== 'production' &&
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }

      const corsErr = new Error('Not allowed by CORS');
      corsErr.status = 403;
      return callback(corsErr);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// 6. Cookie parser (for httpOnly refresh tokens)
app.use(cookieParser());

// 7. JSON body parsing with 100 KB limit and malformed body detection
app.use(express.json({ limit: '100kb' }));

// 8. General rate limiter (300 req / 15 min per IP)
app.use(generalLimiter);

// 9. API Routes
// Fast health check (instant, does not touch DB, used by Render keep-alive & external pingers)
app.get(['/api/health', '/api/v1/health'], (req, res) => {
  return res.status(200).json({
    status: 'healthy',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Deep health check (verifies database connectivity)
app.get(['/api/health/db', '/api/v1/health/db'], async (req, res) => {
  try {
    const conn = await pool.getConnection();
    try {
      await conn.query('SELECT 1');
    } finally {
      conn.release();
    }
    return res.status(200).json({
      status: 'healthy',
      database: 'connected',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Mount routes on /api and /api/v1
app.use(['/api/auth', '/api/v1/auth'], authRoutes);
app.use(['/api/data', '/api/v1/data'], requireAuth, dataRoutes);
app.use(['/api/ai', '/api/v1/ai'], requireAuth, aiRoutes);

// 10. Central 404 Handler (JSON only)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 11. Central Error Handler (NEVER leak stack traces or file paths in any environment)
app.use((err, req, res, next) => {
  // Catch malformed JSON bodies from express.json
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }

  // Catch CORS errors
  if (err.message === 'Not allowed by CORS' || err.status === 403) {
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }

  // General server errors
  const status = err.status || 500;
  console.error(`[Error] ${req.method} ${req.url} failed:`, err.message);

  return res.status(status).json({
    error: err.userMessage || (status === 500 ? 'Internal server error' : err.message),
  });
});

let server = null;

// Graceful shutdown helper
function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
  if (server) {
    server.close(() => {
      console.log('[Server] HTTP server closed cleanly.');
      process.exit(0);
    });

    // Force exit if shutdown hangs beyond 10s
    setTimeout(() => {
      console.error('[Server] Forced shutdown after 10s timeout.');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err.message);
  process.exit(1);
});

// Start DB then HTTP server (skip auto-listen during automated testing)
if (config.NODE_ENV !== 'test') {
  initDB()
    .then(() => {
      server = app.listen(config.PORT, () => {
        console.log(`Traject backend running on http://localhost:${config.PORT} (${config.NODE_ENV})`);
      });

      // Request & Connection timeouts
      server.requestTimeout = 30000;
      server.headersTimeout = 35000;
      server.keepAliveTimeout = 65000;
    })
    .catch((err) => {
      console.error('[Fatal] Database startup failed:', err.message);
      process.exit(1);
    });
}

export default app;
