import cluster from 'node:cluster';
import os from 'node:os';

const numCPUs = Math.max(1, Math.min(os.cpus().length, parseInt(process.env.WEB_CONCURRENCY || '4', 10)));

if (cluster.isPrimary || cluster.isMaster) {
  console.log(`[Primary ${process.pid}] Spawning ${numCPUs} cluster workers...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('online', (worker) => {
    console.log(`[Worker ${worker.process.pid}] Online and ready to accept connections`);
  });

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[Worker ${worker.process.pid}] Worker exited (${signal || code}). Spawning replacement...`);
    cluster.fork();
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`[Primary ${process.pid}] Received ${signal}. Gracefully terminating workers...`);
    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill(signal);
    }
    setTimeout(() => {
      console.log(`[Primary ${process.pid}] Master shutdown complete.`);
      process.exit(0);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} else {
  // Worker imports and executes server.js
  await import('./server.js');
}
