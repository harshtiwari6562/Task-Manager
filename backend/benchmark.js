import autocannon from 'autocannon';
import os from 'node:os';
import pool, { initDB } from './db.js';
import User from './models/User.js';
import jwt from 'jsonwebtoken';
import config from './config.js';

const PORT = config.PORT || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function getSystemMetrics() {
  const mem = process.memoryUsage();
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const usedMemMb = totalMemMb - freeMemMb;
  const rssMb = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);

  return {
    rssMb,
    heapUsedMb,
    sysMemUsedMb: usedMemMb,
    sysMemTotalMb: totalMemMb,
    cpuCount: os.cpus().length,
  };
}

async function setupBenchmarkUser() {
  await initDB();
  const email = 'loadtest@example.com';
  const password = 'LoadTestPassword123!';
  let user = await User.findByEmail(email);
  if (!user) {
    user = await User.create({ name: 'Load Tester', email, password });
  }

  // Pre-seed a test key in user_data and reset ai_usage
  await pool.execute('DELETE FROM ai_usage WHERE user_id = ?', [user.id]);
  await pool.execute(
    'INSERT INTO user_data (user_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [user.id, 'load_test_key', JSON.stringify({ hello: 'world', timestamp: Date.now() })]
  );

  const token = jwt.sign(
    { sub: String(user.id), token_version: user.token_version || 0 },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  return { user, token, password };
}

async function runAutocannon(opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

async function benchmarkEndpoint(name, url, method, connections, durationSec, token, body = null, amount = null) {
  const beforeMetrics = getSystemMetrics();
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const opts = {
    url,
    method,
    connections,
    headers,
    pipelining: 1,
    timeout: 30,
  };

  if (amount) {
    opts.amount = amount;
  } else {
    opts.duration = durationSec;
  }

  if (body) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  // Assign distinct client IPs to prevent single-IP limiter false-positives
  opts.setupClient = (client) => {
    const randomIp = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
    client.setHeaders({
      ...headers,
      'X-Forwarded-For': randomIp,
    });
  };

  const res = await runAutocannon(opts);
  const afterMetrics = getSystemMetrics();

  const totalRequests = res.requests.total;
  const errors = res.errors + res.non2xx;
  const errorRate = totalRequests > 0 ? ((errors / totalRequests) * 100).toFixed(2) : '0.00';
  const p95 = res.latency.p95 || res.latency.p97_5 || 0;
  const rps = res.requests.average ? res.requests.average.toFixed(1) : (totalRequests / (res.duration || 1)).toFixed(1);

  return {
    endpoint: name,
    connections,
    totalRequests,
    rps,
    p95Ms: p95,
    p99Ms: res.latency.p99 || 0,
    errorRate: `${errorRate}%`,
    errors,
    rssBeforeMb: beforeMetrics.rssMb,
    rssAfterMb: afterMetrics.rssMb,
    heapMb: afterMetrics.heapUsedMb,
  };
}

async function runSuite() {
  console.log('\n======================================================');
  console.log('   TRAJECT BACKEND CONCURRENCY & LOAD BENCHMARK');
  console.log('======================================================');
  const { user, token, password } = await setupBenchmarkUser();
  console.log(`[Setup] Benchmarking user: ${user.email} (ID: ${user.id})`);
  console.log(`[Target] ${BASE_URL}\n`);

  const concurrencyLevels = [50, 200, 500];
  const results = [];

  for (const c of concurrencyLevels) {
    console.log(`\n>>> Testing Concurrency: ${c} concurrent users`);

    // 1. GET /api/data/load_test_key (Sustained throughput test)
    console.log(`  - Benchmarking GET /api/data/load_test_key (${c} conn, 5s)...`);
    const getDataRes = await benchmarkEndpoint(
      'GET /api/data/:key',
      `${BASE_URL}/api/data/load_test_key`,
      'GET',
      c,
      5,
      token
    );
    results.push(getDataRes);
    console.log(`    Result: p95=${getDataRes.p95Ms}ms | RPS=${getDataRes.rps} | Errors=${getDataRes.errorRate}`);
    await new Promise((r) => setTimeout(r, 1000));

    // 2. PUT /api/data/load_test_key (Sustained concurrent writes)
    console.log(`  - Benchmarking PUT /api/data/load_test_key (${c} conn, 5s)...`);
    const putDataRes = await benchmarkEndpoint(
      'PUT /api/data/:key',
      `${BASE_URL}/api/data/load_test_key`,
      'PUT',
      c,
      5,
      token,
      { value: JSON.stringify({ updated: true, c, time: Date.now() }) }
    );
    results.push(putDataRes);
    console.log(`    Result: p95=${putDataRes.p95Ms}ms | RPS=${putDataRes.rps} | Errors=${putDataRes.errorRate}`);
    await new Promise((r) => setTimeout(r, 1000));

    // 3. POST /api/auth/login (simultaneous concurrent user login burst)
    console.log(`  - Benchmarking POST /api/auth/login (${c} concurrent logins)...`);
    const loginRes = await benchmarkEndpoint(
      'POST /api/auth/login',
      `${BASE_URL}/api/auth/login`,
      'POST',
      c,
      null,
      null,
      { email: user.email, password },
      c
    );
    results.push(loginRes);
    console.log(`    Result: p95=${loginRes.p95Ms}ms | RPS=${loginRes.rps} | Errors=${loginRes.errorRate}`);
    await new Promise((r) => setTimeout(r, 1000));

    // 4. POST /api/ai/parse-tasks (LRU cache & fast queue test)
    console.log(`  - Benchmarking POST /api/ai/parse-tasks (${c} conn, 4s)...`);
    const aiRes = await benchmarkEndpoint(
      'POST /api/ai/parse-tasks',
      `${BASE_URL}/api/ai/parse-tasks`,
      'POST',
      c,
      4,
      token,
      { transcript: 'wake up at 6am study dsa at 8am and gym at 5pm' }
    );
    results.push(aiRes);
    console.log(`    Result: p95=${aiRes.p95Ms}ms | RPS=${aiRes.rps} | Errors=${aiRes.errorRate}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n======================================================');
  console.log('              FINAL BENCHMARK REPORT');
  console.log('======================================================');
  console.table(results);
  process.exit(0);
}

runSuite().catch((err) => {
  console.error('[Benchmark Fatal Error]:', err);
  process.exit(1);
});
