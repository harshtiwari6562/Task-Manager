import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Worker script logic
if (!isMainThread) {
  parentPort.on('message', async (msg) => {
    const { id, action, password, hash, rounds } = msg;
    try {
      if (action === 'hash') {
        const result = await bcrypt.hash(password, rounds || 12);
        parentPort.postMessage({ id, result });
      } else if (action === 'compare') {
        const result = await bcrypt.compare(password, hash);
        parentPort.postMessage({ id, result });
      } else {
        throw new Error(`Unknown action: ${action}`);
      }
    } catch (err) {
      parentPort.postMessage({ id, error: err.message });
    }
  });
}
