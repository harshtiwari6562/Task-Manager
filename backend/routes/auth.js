import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import UserData from '../models/UserData.js';
import RefreshToken from '../models/RefreshToken.js';
import requireAuth from '../middleware/auth.js';
import config from '../config.js';
import {
  registerSchema,
  loginSchema,
  passwordChangeSchema,
  validateBody,
} from '../middleware/validation.js';
import {
  loginLimiter,
  registerLimiter,
  recordFailedLogin,
  resetFailedLogin,
  checkEmailLockout,
} from '../middleware/rateLimiter.js';

const router = Router();

// Sign 15-minute access token pinned with HS256 and token_version
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      token_version: user.token_version || 0,
    },
    config.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '15m',
    }
  );
}

// Set secure refresh token cookie
function setRefreshCookie(res, rawRefreshToken) {
  res.cookie('traject_refresh_token', rawRefreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('traject_refresh_token', {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/api/auth',
  });
}

// POST /api/auth/register
router.post('/register', registerLimiter, validateBody(registerSchema), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password });
    const accessToken = signAccessToken(user);
    const refreshToken = await RefreshToken.createToken(user.id, 30);
    setRefreshCookie(res, refreshToken);

    return res.status(201).json({
      token: accessToken,
      refreshToken,
      user: User.toSafeJSON(user),
    });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ error: 'Something went wrong while creating your account' });
  }
});

// POST /api/auth/login
router.post(
  '/login',
  loginLimiter,
  checkEmailLockout,
  validateBody(loginSchema),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      const user = await User.findByEmail(email);
      if (!user) {
        // Run constant-time dummy compare to prevent timing-based user enumeration
        await User.dummyCompare(password);
        recordFailedLogin(email);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const valid = await User.checkPassword(user, password);
      if (!valid) {
        recordFailedLogin(email);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Successful login resets failed attempts
      resetFailedLogin(email);

      const accessToken = signAccessToken(user);
      const refreshToken = await RefreshToken.createToken(user.id, 30);
      setRefreshCookie(res, refreshToken);

      return res.json({
        token: accessToken,
        refreshToken,
        user: User.toSafeJSON(user),
      });
    } catch (err) {
      console.error('Login error:', err.message);
      return res.status(500).json({ error: 'Something went wrong while logging in' });
    }
  }
);

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const rawRefreshToken =
      req.cookies?.traject_refresh_token || req.body?.refreshToken;

    if (!rawRefreshToken) {
      return res.status(401).json({ error: 'Refresh token is required' });
    }

    const tokenRecord = await RefreshToken.findValidToken(rawRefreshToken);
    if (!tokenRecord) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(tokenRecord.user_id);
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'User no longer exists' });
    }

    // Rotate refresh token: revoke current, issue new
    await RefreshToken.revokeToken(rawRefreshToken);
    const newRefreshToken = await RefreshToken.createToken(user.id, 30);
    setRefreshCookie(res, newRefreshToken);

    const newAccessToken = signAccessToken(user);

    return res.json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: User.toSafeJSON(user),
    });
  } catch (err) {
    console.error('Refresh error:', err.message);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const rawRefreshToken =
      req.cookies?.traject_refresh_token || req.body?.refreshToken;

    if (rawRefreshToken) {
      await RefreshToken.revokeToken(rawRefreshToken);
    }
    await RefreshToken.revokeAllForUser(req.userId);
    await User.incrementTokenVersion(req.userId);
    clearRefreshCookie(res);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err.message);
    return res.status(500).json({ error: 'Failed to logout' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    return res.json({ user: User.toSafeJSON(user) });
  } catch (err) {
    console.error('Me error:', err.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
});

// PUT /api/auth/password
router.put('/password', requireAuth, validateBody(passwordChangeSchema), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const valid = await User.checkPassword(user, currentPassword);
    if (!valid) return res.status(401).json({ error: 'Incorrect current password' });

    await User.setPassword(req.userId, newPassword);
    await RefreshToken.revokeAllForUser(req.userId);

    // Issue fresh tokens after password change
    const updatedUser = await User.findById(req.userId);
    const accessToken = signAccessToken(updatedUser);
    const refreshToken = await RefreshToken.createToken(req.userId, 30);
    setRefreshCookie(res, refreshToken);

    return res.json({
      message: 'Password updated successfully',
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Password update error:', err.message);
    return res.status(500).json({ error: 'Something went wrong while updating password' });
  }
});

// DELETE /api/auth/account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    await RefreshToken.revokeAllForUser(req.userId);
    await UserData.deleteAllForUser(req.userId);
    await User.deleteById(req.userId);
    clearRefreshCookie(res);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('Delete account error:', err.message);
    return res.status(500).json({ error: 'Something went wrong while deleting account' });
  }
});

export default router;
