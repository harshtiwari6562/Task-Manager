import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.join(__dirname, 'bcryptWorker.js');

class BcryptPool {
  constructor(size = Math.min(Math.max(os.cpus().length - 1, 2), 8)) {
    this.poolSize = size;
    this.workers = [];
    this.idleWorkers = [];
    this.queue = [];
    this.jobCounter = 0;
    this.pendingJobs = new Map();
    this.isInitialized = false;

    // In-memory cache for recent successful password comparisons (5 seconds TTL)
    // Helps absorb burst logins under extreme concurrency
    this.compareCache = new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.compareCache.entries()) {
        if (now > v.expiry) this.compareCache.delete(k);
      }
    }, 10000).unref();

    this.initWorkers();
  }

  initWorkers() {
    try {
      for (let i = 0; i < this.poolSize; i++) {
        const worker = new Worker(workerPath);
        worker.on('message', (msg) => this.onWorkerMessage(worker, msg));
        worker.on('error', (err) => {
          console.error('[BcryptPool] Worker error:', err.message);
          this.replaceWorker(worker);
        });
        worker.on('exit', (code) => {
          if (code !== 0) {
            console.warn(`[BcryptPool] Worker exited with code ${code}, replacing...`);
            this.replaceWorker(worker);
          }
        });
        this.workers.push(worker);
        this.idleWorkers.push(worker);
      }
      this.isInitialized = true;
    } catch (err) {
      console.warn('[BcryptPool] Worker initialization failed, will fallback to sync:', err.message);
      this.isInitialized = false;
    }
  }

  replaceWorker(deadWorker) {
    const idx = this.workers.indexOf(deadWorker);
    if (idx !== -1) this.workers.splice(idx, 1);
    const idleIdx = this.idleWorkers.indexOf(deadWorker);
    if (idleIdx !== -1) this.idleWorkers.splice(idleIdx, 1);

    try {
      const newWorker = new Worker(workerPath);
      newWorker.on('message', (msg) => this.onWorkerMessage(newWorker, msg));
      newWorker.on('error', (err) => this.replaceWorker(newWorker));
      this.workers.push(newWorker);
      this.idleWorkers.push(newWorker);
      this.processNext();
    } catch (e) {
      console.error('[BcryptPool] Failed to replace worker:', e.message);
    }
  }

  onWorkerMessage(worker, msg) {
    const { id, result, error } = msg;
    const pending = this.pendingJobs.get(id);
    if (pending) {
      this.pendingJobs.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
    this.idleWorkers.push(worker);
    this.processNext();
  }

  processNext() {
    if (this.queue.length === 0 || this.idleWorkers.length === 0) return;
    const worker = this.idleWorkers.pop();
    const job = this.queue.shift();
    this.pendingJobs.set(job.id, job);
    worker.postMessage({
      id: job.id,
      action: job.action,
      password: job.password,
      hash: job.hash,
      rounds: job.rounds,
    });
  }

  runJob(action, { password, hash, rounds }) {
    if (!this.isInitialized || this.workers.length === 0) {
      // Direct fallback
      if (action === 'hash') return bcrypt.hash(password, rounds || 12);
      if (action === 'compare') return bcrypt.compare(password, hash);
    }

    return new Promise((resolve, reject) => {
      const id = ++this.jobCounter;
      this.queue.push({ id, action, password, hash, rounds, resolve, reject });
      this.processNext();
    });
  }

  async hash(password, rounds = 12) {
    return this.runJob('hash', { password, rounds });
  }

  async compare(password, hash) {
    if (!password || !hash) return false;

    // Fast memory cache check for identical credentials within 5s
    const cacheKey = `${password.slice(0, 8)}:${hash}`;
    const cached = this.compareCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.result;
    }

    const result = await this.runJob('compare', { password, hash });
    this.compareCache.set(cacheKey, { result, expiry: Date.now() + 5000 });
    return result;
  }
}

const hasher = new BcryptPool();
export default hasher;
