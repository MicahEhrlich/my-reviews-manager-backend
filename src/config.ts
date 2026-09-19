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
  AUTH_MODE: z.enum(['dev', 'google']).default('dev'),
  PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
  DEV_USER_EMAIL: z.string().email().default('admin@revu.local'),
  COOKIE_SECRET: z.string().min(32).default('local-cookie-secret-change-me-32-chars'),
  TOKEN_ENCRYPTION_KEYS: z.string().default('v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OIDC_REDIRECT_URI: z.string().url().default('http://localhost:3001/auth/google/callback'),
  GOOGLE_BUSINESS_REDIRECT_URI: z.string().url().default('http://localhost:3001/api/v1/google-business/callback'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  META_WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  META_WHATSAPP_TEMPLATE_NAME: z.string().default('revu_pending_review'),
  META_WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('he'),
  META_GRAPH_API_VERSION: z.string().default('v23.0'),
  MOCK_FAILURE_MODE: z.enum(['none', 'transient', 'permanent']).default('none'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
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
      ['ANTHROPIC_API_KEY', config.ANTHROPIC_API_KEY],
      ['META_WHATSAPP_ACCESS_TOKEN', config.META_WHATSAPP_ACCESS_TOKEN],
      ['META_WHATSAPP_PHONE_NUMBER_ID', config.META_WHATSAPP_PHONE_NUMBER_ID],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Live providers require: ${missing.join(', ')}`);
  }
  return config;
}
