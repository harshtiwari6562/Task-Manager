import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import config from '../config.js';

// Fast in-memory user cache to avoid per-request SQL lookups under load (5s TTL)
const userCache = new Map(); // userId -> { user, expiry }

export function invalidateAuthUserCache(userId) {
  if (userId) userCache.delete(String(userId));
}

export function clearAuthUserCache() {
  userCache.clear();
}

export default async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const cached = userCache.get(String(payload.sub));
    let user;
    if (cached && Date.now() < cached.expiry) {
      user = cached.user;
    } else {
      user = await User.findById(payload.sub);
      if (user) {
        userCache.set(String(payload.sub), { user, expiry: Date.now() + 5000 });
      }
    }

    // Never return 500 for tokens of deleted users - return 401!
    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists' });
    }

    // Check token revocation via token_version
    if (user.token_version !== undefined && payload.token_version !== undefined) {
      if (user.token_version !== payload.token_version) {
        return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
      }
    }

    req.userId = user.id;
    req.user = user;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Database lookup error:', err.message);
    return res.status(401).json({ error: 'Authentication verification failed' });
  }
}

