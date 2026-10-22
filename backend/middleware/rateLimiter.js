import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';

let redisClient = null;
let redisStore = undefined;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisClient
      .connect()
      .then(() => {
        console.log('[RateLimiter] Connected to Redis for shared cluster rate limiting');
      })
      .catch((err) => {
        console.warn('[RateLimiter] Redis connection warning, using memory store fallback:', err.message);
      });

    redisStore = new RedisStore({
      // @ts-expect-error - ioredis sendCommand compatibility
      sendCommand: (...args) => redisClient.call(...args),
    });
  } catch (err) {
    console.warn('[RateLimiter] Redis store setup failed, defaulting to memory:', err.message);
  }
}

// In-memory failed login tracking per email for account lockout (fallback when Redis not available)
const failedLoginAttempts = new Map(); // email -> { count: number, firstFailed: number, lockedUntil: number }

export async function recordFailedLogin(email) {
  if (!email) return;
  const key = email.toLowerCase().trim();
  const now = Date.now();

  if (redisClient && redisClient.status === 'ready') {
    try {
      const redisKey = `traject:failed_login:${key}`;
      const count = await redisClient.incr(redisKey);
      if (count === 1) {
        await redisClient.expire(redisKey, 15 * 60);
      }
      if (count >= 10) {
        await redisClient.set(`traject:lockout:${key}`, '1', 'EX', 15 * 60);
      }
      return;
    } catch (e) {
      // Fallback to local map
    }
  }

  const entry = failedLoginAttempts.get(key) || { count: 0, firstFailed: now, lockedUntil: 0 };
  if (now - entry.firstFailed > 15 * 60 * 1000 && entry.lockedUntil < now) {
    entry.count = 0;
    entry.firstFailed = now;
    entry.lockedUntil = 0;
  }
  entry.count += 1;
  if (entry.count >= 10) {
    entry.lockedUntil = now + 15 * 60 * 1000;
  }
  failedLoginAttempts.set(key, entry);
}

export async function resetFailedLogin(email) {
  if (!email) return;
  const key = email.toLowerCase().trim();
  if (redisClient && redisClient.status === 'ready') {
    try {
      await redisClient.del(`traject:failed_login:${key}`, `traject:lockout:${key}`);
    } catch {}
  }
  failedLoginAttempts.delete(key);
}

export async function checkEmailLockout(req, res, next) {
  const email = req.body?.email;
  if (!email) return next();

  const key = email.toLowerCase().trim();

  if (redisClient && redisClient.status === 'ready') {
    try {
      const isLocked = await redisClient.get(`traject:lockout:${key}`);
      if (isLocked) {
        const ttl = await redisClient.ttl(`traject:lockout:${key}`);
        res.setHeader('Retry-After', ttl > 0 ? ttl : 60);
        return res.status(429).json({
          error: `Too many failed login attempts for this account. Locked out. Please try again in ${Math.ceil(ttl / 60)} minutes.`,
        });
      }
      return next();
    } catch {}
  }

  const entry = failedLoginAttempts.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    const remainingSeconds = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    res.setHeader('Retry-After', remainingSeconds);
    return res.status(429).json({
      error: `Too many failed login attempts for this account. Locked out. Please try again in ${Math.ceil(remainingSeconds / 60)} minutes.`,
    });
  }
  next();
}

// 1. Login rate limit: 10 per 15 min per IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts from this IP, please try again in 15 minutes.' });
  },
});

// 2. Register rate limit: 5 per hour per IP
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many registrations from this IP, please try again in 1 hour.' });
  },
});

// 3. General rate limit: 300 per 15 min per IP
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please slow down.' });
  },
});

