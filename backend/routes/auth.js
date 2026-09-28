import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import UserData from '../models/UserData.js';
import requireAuth from '../middleware/auth.js';

const router = Router();

function signToken(user) {
  return jwt.sign({ sub: String(user.id) }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password });
    const token = signToken(user);
    res.status(201).json({ token, user: User.toSafeJSON(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Something went wrong while creating your account' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await User.checkPassword(user, password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({ token, user: User.toSafeJSON(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong while logging in' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: User.toSafeJSON(user) });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// PUT /api/auth/password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await User.checkPassword(user, currentPassword);
    if (!valid) return res.status(401).json({ error: 'Incorrect current password' });

    await User.setPassword(req.userId, newPassword);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Password update error:', err);
    res.status(500).json({ error: 'Something went wrong while updating password' });
  }
});

// DELETE /api/auth/account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    await UserData.deleteAllForUser(req.userId);
    await User.deleteById(req.userId);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Something went wrong while deleting account' });
  }
});

export default router;
