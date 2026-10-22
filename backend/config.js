import 'dotenv/config';

function validateEnv() {
  const errors = [];
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = parseInt(process.env.PORT || '5000', 10);

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    errors.push('PORT must be a valid port number between 1 and 65535.');
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required.');
  } else if (jwtSecret.length < 32) {
    errors.push(`JWT_SECRET must be at least 32 characters long (received ${jwtSecret.length}).`);
  } else if (nodeEnv === 'production') {
    const weakPatterns = ['secret', 'change', 'example', 'test'];
    const lower = jwtSecret.toLowerCase();
    for (const pattern of weakPatterns) {
      if (lower.includes(pattern)) {
        errors.push(`JWT_SECRET must not contain placeholder words like '${pattern}' in production.`);
        break;
      }
    }
  }

  let dbHost = process.env.DB_HOST || '';
  let dbPort = parseInt(process.env.DB_PORT || '3306', 10);
  let dbUser = process.env.DB_USER || '';
  let dbPassword = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '';
  let dbName = process.env.DB_NAME || '';
  let dbSsl = process.env.DB_SSL === 'true' || dbHost.includes('tidbcloud.com') || dbHost.includes('aivencloud.com');

  if (process.env.DATABASE_URL) {
    try {
      const parsedUrl = new URL(process.env.DATABASE_URL);
      dbHost = parsedUrl.hostname;
      if (parsedUrl.port) {
        dbPort = parseInt(parsedUrl.port, 10);
      }
      dbUser = decodeURIComponent(parsedUrl.username || '');
      dbPassword = decodeURIComponent(parsedUrl.password || '');
      dbName = parsedUrl.pathname.replace(/^\//, '');
      const sslParam = parsedUrl.searchParams.get('ssl') || '';
      if (
        sslParam === 'true' ||
        sslParam.includes('rejectUnauthorized') ||
        parsedUrl.searchParams.get('sslmode') === 'require' ||
        parsedUrl.searchParams.get('ssl-mode') === 'REQUIRED' ||
        parsedUrl.hostname.includes('tidbcloud.com') ||
        parsedUrl.hostname.includes('aivencloud.com')
      ) {
        dbSsl = true;
      }
    } catch (e) {
      errors.push(`DATABASE_URL is not a valid URL: ${e.message}`);
    }
  } else {
    const dbClient = process.env.DB_CLIENT || '';
    if (!dbClient) {
      errors.push('DB_CLIENT is required (e.g. mysql).');
    }

    if (!dbHost) {
      errors.push('DB_HOST is required.');
    }

    if (Number.isNaN(dbPort) || dbPort <= 0 || dbPort > 65535) {
      errors.push('DB_PORT must be a valid port number.');
    }

    if (!dbUser) {
      errors.push('DB_USER is required.');
    }

    if (!dbName) {
      errors.push('DB_NAME is required.');
    }

    if (process.env.DB_PASSWORD === undefined) {
      errors.push('DB_PASSWORD must be defined (can be empty string if root has no password, but must be set).');
    }
  }

  const allowedOriginsRaw = process.env.ALLOWED_ORIGINS || '';
  let allowedOrigins = allowedOriginsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (nodeEnv === 'production') {
    if (allowedOrigins.length === 0) {
      errors.push('ALLOWED_ORIGINS (comma-separated URLs) is required when NODE_ENV=production.');
    }
  } else {
    // In development, ensure local frontend origins are included
    const devDefaults = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];
    allowedOrigins = Array.from(new Set([...allowedOrigins, ...devDefaults]));
  }

  if (errors.length > 0) {
    console.error('\n========================================');
    console.error('CONFIGURATION ERROR AT STARTUP:');
    errors.forEach((err) => console.error(` - ${err}`));
    console.error('========================================\n');
    process.exit(1);
  }

  const geminiModelsRaw = process.env.GEMINI_MODELS || 'gemini-3.1-flash-lite,gemini-3.8-flash';
  const disallowedModels = new Set(['gemini-1.5-flash', 'gemini-3.6-flash']);
  const geminiModels = geminiModelsRaw
    .split(',')
    .map((m) => m.trim())
    .filter((m) => Boolean(m) && !disallowedModels.has(m.toLowerCase()));

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    JWT_SECRET: jwtSecret,
    DATABASE_URL: process.env.DATABASE_URL || '',
    DB_CLIENT: process.env.DB_CLIENT || 'mysql',
    DB_HOST: dbHost,
    DB_PORT: dbPort,
    DB_USER: dbUser,
    DB_PASSWORD: dbPassword,
    DB_NAME: dbName,
    DB_SSL: dbSsl,
    ALLOWED_ORIGINS: allowedOrigins,
    GEMINI_MODELS: geminiModels,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    AI_GLOBAL_DAILY_LIMIT: parseInt(process.env.AI_GLOBAL_DAILY_LIMIT || '1000', 10),
    CRON_SECRET: process.env.CRON_SECRET || '',
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
    MIN_ANDROID_VERSION_CODE: parseInt(process.env.MIN_ANDROID_VERSION_CODE || '1', 10),
    MIN_IOS_BUILD: parseInt(process.env.MIN_IOS_BUILD || '1', 10),
    LATEST_ANDROID_VERSION_CODE: parseInt(process.env.LATEST_ANDROID_VERSION_CODE || '1', 10),
    LATEST_IOS_BUILD: parseInt(process.env.LATEST_IOS_BUILD || '1', 10),
    MAINTENANCE_ON: process.env.MAINTENANCE_ON === 'true',
    MAINTENANCE_MESSAGE: process.env.MAINTENANCE_MESSAGE || 'Traject is undergoing scheduled maintenance. Please check back shortly.',
    SENTRY_DSN: process.env.SENTRY_DSN || '',
  };
}

const config = validateEnv();
export default config;
