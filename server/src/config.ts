import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

// Load server/.env (Node built-in - no dotenv dependency). Existing process.env
// values always win, so container/CI env overrides the file.
const envFile = path.join(SERVER_ROOT, '.env');
try {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
} catch {
  /* non-fatal: fall back to process.env / defaults */
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const databaseFileRaw = str('DATABASE_FILE', './data/freshtrack.db');
const databaseFile = path.isAbsolute(databaseFileRaw)
  ? databaseFileRaw
  : path.resolve(SERVER_ROOT, databaseFileRaw);

const nodeEnv = str('NODE_ENV', 'development');
const jwtSecret = str('JWT_SECRET', 'dev-insecure-secret-change-me');
if (jwtSecret === 'dev-insecure-secret-change-me') {
  if (nodeEnv === 'production') {
    throw new Error('JWT_SECRET must be set to a strong secret in production (refusing to start with the insecure default).');
  }
  console.warn('[config] JWT_SECRET is not set - using an insecure dev default. Set JWT_SECRET before deploying.');
}

const geminiApiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim() || undefined;

export const config = {
  env: nodeEnv,
  port: int('PORT', 4000),
  corsOrigin: str('CORS_ORIGIN', '*'),
  jwtSecret,
  tokenTtl: str('TOKEN_TTL', '12h'),
  databaseFile,
  seed: {
    adminEmail: str('SEED_ADMIN_EMAIL', 'admin@freshtrack.io'),
    adminPassword: str('SEED_ADMIN_PASSWORD', 'Admin@12345'),
    hubPassword: str('SEED_HUB_PASSWORD', 'Hub@12345'),
  },
  ai: {
    provider: 'gemini' as const,
    apiKey: geminiApiKey,
    enabled: Boolean(geminiApiKey),
    mappingModel: str('AI_MAPPING_MODEL', 'gemini-2.5-flash'),
    assistantModel: str('AI_ASSISTANT_MODEL', 'gemini-2.5-flash'),
  },
} as const;

export type Config = typeof config;
