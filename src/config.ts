import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().default('postgresql://revu:revu@localhost:5432/revu?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  FRONTEND_URL: z.string().default('http://localhost:5173/#'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  AUTH_MODE: z.enum(['dev', 'google']).default('dev'),
  PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
  REPLY_PROVIDER_MODE: z.preprocess((value) => value === '' ? undefined : value, z.enum(['mock', 'anthropic']).optional()),
  DEV_USER_EMAIL: z.string().email().default('admin@revu.local'),
  COOKIE_SECRET: z.string().min(32).default('local-cookie-secret-change-me-32-chars'),
  TOKEN_ENCRYPTION_KEYS: z.string().default('v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OIDC_REDIRECT_URI: z.string().url().default('http://localhost:3001/auth/google/callback'),
  GOOGLE_BUSINESS_REDIRECT_URI: z.string().url().default('http://localhost:3001/api/v1/google-business/callback'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  STORAGE_MODE: z.enum(['local', 's3']).default('local'),
  LOCAL_UPLOAD_DIR: z.string().default('var/uploads'),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_PUBLIC_BASE_URL: z.string().default(''),
  META_WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  META_WHATSAPP_TEMPLATE_NAME: z.string().default('revu_pending_review'),
  META_WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('he'),
  META_GRAPH_API_VERSION: z.string().default('v23.0'),
  MOCK_FAILURE_MODE: z.enum(['none', 'transient', 'permanent']).default('none'),
});

type ParsedConfig = z.infer<typeof schema>;
export type Config = Omit<ParsedConfig, 'REPLY_PROVIDER_MODE'> & { REPLY_PROVIDER_MODE: 'mock' | 'anthropic' };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const config: Config = {
    ...parsed,
    REPLY_PROVIDER_MODE: parsed.REPLY_PROVIDER_MODE ?? (parsed.PROVIDER_MODE === 'live' ? 'anthropic' : 'mock'),
  };
  if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'dev') {
    throw new Error('AUTH_MODE=dev is forbidden in production');
  }
  if (config.AUTH_MODE === 'google' && (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET)) {
    throw new Error('Google OIDC requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  }
  if (config.PROVIDER_MODE === 'live') {
    const missing = [
      ['GOOGLE_CLIENT_ID', config.GOOGLE_CLIENT_ID],
      ['GOOGLE_CLIENT_SECRET', config.GOOGLE_CLIENT_SECRET],
      ['META_WHATSAPP_ACCESS_TOKEN', config.META_WHATSAPP_ACCESS_TOKEN],
      ['META_WHATSAPP_PHONE_NUMBER_ID', config.META_WHATSAPP_PHONE_NUMBER_ID],
      ['ANTHROPIC_API_KEY', config.ANTHROPIC_API_KEY],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Live providers require: ${missing.join(', ')}`);
  }
  if (config.STORAGE_MODE === 's3') {
    const missing = [
      ['S3_BUCKET', config.S3_BUCKET],
      ['S3_ACCESS_KEY_ID', config.S3_ACCESS_KEY_ID],
      ['S3_SECRET_ACCESS_KEY', config.S3_SECRET_ACCESS_KEY],
      ['S3_PUBLIC_BASE_URL', config.S3_PUBLIC_BASE_URL],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`S3 storage requires: ${missing.join(', ')}`);
    try { new URL(config.S3_PUBLIC_BASE_URL); } catch { throw new Error('S3_PUBLIC_BASE_URL must be a valid public URL'); }
  }
  if (config.REPLY_PROVIDER_MODE === 'anthropic' && !config.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic reply provider requires: ANTHROPIC_API_KEY');
  }
  return config;
}
