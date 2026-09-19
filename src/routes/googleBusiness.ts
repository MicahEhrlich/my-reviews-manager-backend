import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { OAuth2Client } from 'google-auth-library';
import type { Config } from '../config.js';
import { encryptToken, parseKeyRing } from '../lib/encryption.js';
import { AppError } from '../lib/errors.js';

export function registerGoogleBusinessRoutes(app: FastifyInstance, config: Config, db: PrismaClient, redis: Redis) {
  app.get('/api/v1/google-business/connect', async (request, reply) => {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'חיבור Google אינו מוגדר מקומית');
    const state = randomBytes(24).toString('base64url'); await redis.set(`gbp:${state}`, request.currentUser.agencyId, 'EX', 600);
    const client = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_BUSINESS_REDIRECT_URI);
    return reply.redirect(client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: ['https://www.googleapis.com/auth/business.manage'], state }));
  });
  app.get<{ Querystring: { code?: string; state?: string } }>('/api/v1/google-business/callback', async (request, reply) => {
    if (!request.query.code || !request.query.state) throw new AppError(400, 'OAUTH_INVALID', 'חסרים פרטי הרשאה');
    const agencyId = await redis.getdel(`gbp:${request.query.state}`); if (!agencyId || agencyId !== request.currentUser.agencyId) throw new AppError(400, 'OAUTH_STATE_INVALID', 'בקשת ההרשאה פגה');
    const client = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_BUSINESS_REDIRECT_URI);
    const { tokens } = await client.getToken(request.query.code); const ring = parseKeyRing(config.TOKEN_ENCRYPTION_KEYS);
    const account = await db.account.findFirst({ where: { agencyId } }); if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'לא נמצא חשבון Google מקומי');
    await db.account.update({ where: { id: account.id }, data: { encryptedRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token, ring) : account.encryptedRefreshToken, encryptedAccessToken: tokens.access_token ? encryptToken(tokens.access_token, ring) : account.encryptedAccessToken, tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null, status: 'CONNECTED' } });
    return reply.redirect(config.FRONTEND_URL);
  });
}
