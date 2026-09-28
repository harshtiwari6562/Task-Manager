import { Router } from 'express';
import UserData from '../models/UserData.js';

const router = Router();

// GET /api/data?prefix=some:prefix  ->  { keys: [...] }
router.get('/', async (req, res) => {
  try {
    const prefix = req.query.prefix || '';
    const keys = await UserData.listKeys(req.userId, prefix);
    res.json({ keys });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Failed to list keys' });
  }
});

// GET /api/data/:key  ->  { key, value }
router.get('/:key', async (req, res) => {
  try {
    const doc = await UserData.get(req.userId, req.params.key);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ key: doc.key, value: doc.value });
  } catch (err) {
    console.error('Get error:', err);
    res.status(500).json({ error: 'Failed to read key' });
  }
});

// PUT /api/data/:key  body: { value }  ->  { key, value }
router.put('/:key', async (req, res) => {
  try {
    const { value } = req.body || {};
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'value must be a string' });
    }
    const doc = await UserData.set(req.userId, req.params.key, value);
    res.json(doc);
  } catch (err) {
    console.error('Set error:', err);
    res.status(500).json({ error: 'Failed to save key' });
  }
});

// DELETE /api/data/:key  ->  { key, deleted: true }
router.delete('/:key', async (req, res) => {
  try {
    await UserData.delete(req.userId, req.params.key);
    res.json({ key: req.params.key, deleted: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

export default router;
