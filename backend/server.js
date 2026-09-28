import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDB } from './db.js';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
import aiRoutes from './routes/ai.js';
import requireAuth from './middleware/auth.js';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/data', requireAuth, dataRoutes);
app.use('/api/ai', requireAuth, aiRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 5000;

initDB()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`Traject backend running on http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error('MySQL connection / table init failed:', err.message);
    process.exit(1);
  });
