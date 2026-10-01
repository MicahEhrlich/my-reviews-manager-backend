import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import { AppError } from './lib/errors.js';

const SESSION_COOKIE = 'revu_session';
const CSRF_COOKIE = 'revu_csrf';
const publicPaths = new Set(['/health/live', '/health/ready', '/docs', '/docs/json', '/auth/google/start', '/auth/google/callback']);
const verifier = () => randomBytes(32).toString('base64url');
const challenge = (value: string) => createHash('sha256').update(value).digest('base64url');

export function registerAuth(app: FastifyInstance, config: Config, db: PrismaClient, redis: Redis) {
  app.decorateRequest('currentUser');
  app.decorateRequest('csrfToken', '');
  app.addHook('preHandler', async (request, reply) => {
    const routeUrl = request.routeOptions.url ?? request.url;
    if (publicPaths.has(routeUrl) || routeUrl.startsWith('/docs/') || routeUrl === '/api/v1/post-images/:key') return;
    let user;
    if (config.AUTH_MODE === 'dev') {
      if (config.NODE_ENV === 'production') throw new AppError(500, 'INVALID_AUTH_MODE', 'מצב פיתוח אינו זמין בסביבת ייצור');
      const email = String(request.headers['x-dev-user-email'] ?? config.DEV_USER_EMAIL);
      user = await db.user.findFirst({ where: { email, isActive: true } });
    } else {
      const signed = request.cookies[SESSION_COOKIE];
      const unsigned = signed ? request.unsignCookie(signed) : undefined;
      const userId = unsigned?.valid ? await redis.get(`session:${unsigned.value}`) : null;
      user = userId ? await db.user.findFirst({ where: { id: userId, isActive: true } }) : null;
    }
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'נדרשת התחברות');
    request.currentUser = user;
    let csrf = request.cookies[CSRF_COOKIE];
    if (!csrf) {
      csrf = randomBytes(24).toString('base64url');
      reply.setCookie(CSRF_COOKIE, csrf, { path: '/', sameSite: 'strict', secure: config.NODE_ENV === 'production' });
    }
    request.csrfToken = csrf;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers['x-csrf-token'] !== csrf) throw new AppError(403, 'CSRF_INVALID', 'אסימון האבטחה חסר או אינו תקין');
  });

  app.get('/auth/google/start', async (_request, reply) => {
    if (config.AUTH_MODE !== 'google') throw new AppError(404, 'NOT_FOUND', 'המסלול אינו פעיל');
    const state = randomBytes(24).toString('base64url'); const codeVerifier = verifier();
    await redis.set(`oidc:${state}`, codeVerifier, 'EX', 600);
    const client = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_OIDC_REDIRECT_URI);
    return reply.redirect(client.generateAuthUrl({ access_type: 'offline', scope: ['openid', 'email', 'profile'], state, code_challenge: challenge(codeVerifier), code_challenge_method: CodeChallengeMethod.S256, prompt: 'select_account' }));
  });
  app.get<{ Querystring: { code?: string; state?: string } }>('/auth/google/callback', async (request, reply) => {
    if (!request.query.code || !request.query.state) throw new AppError(400, 'OAUTH_INVALID', 'חסרים פרטי התחברות');
    const codeVerifier = await redis.getdel(`oidc:${request.query.state}`); if (!codeVerifier) throw new AppError(400, 'OAUTH_STATE_INVALID', 'בקשת ההתחברות פגה');
    const client = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_OIDC_REDIRECT_URI);
    const { tokens } = await client.getToken({ code: request.query.code, codeVerifier });
    const ticket = tokens.id_token ? await client.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID }) : null;
    const payload = ticket?.getPayload();
    if (!payload?.sub || !payload.email) throw new AppError(400, 'GOOGLE_IDENTITY_MISSING', 'Google לא החזיר זהות תקינה');
    const existing = await db.user.findFirst({ where: { OR: [{ googleSubject: payload.sub }, { email: payload.email }], isActive: true } });
    if (existing?.googleSubject && existing.googleSubject !== payload.sub) throw new AppError(403, 'IDENTITY_CONFLICT', 'כתובת האימייל כבר משויכת לחשבון אחר');
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data: { googleSubject: payload.sub, displayName: payload.name || existing.displayName } })
      : await db.$transaction(async (tx) => {
        const agency = await tx.agency.create({ data: { name: payload.name ? `${payload.name} — סביבת עבודה` : 'סביבת העבודה שלי' } });
        return tx.user.create({ data: { agencyId: agency.id, googleSubject: payload.sub, email: payload.email!, displayName: payload.name || payload.email!, role: 'ADMIN', isActive: true } });
      });
    const session = randomBytes(32).toString('base64url'); await redis.set(`session:${session}`, user.id, 'EX', 60 * 60 * 12);
    reply.setCookie(SESSION_COOKIE, session, { path: '/', httpOnly: true, signed: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', maxAge: 60 * 60 * 12 });
    return reply.redirect(config.FRONTEND_URL);
  });
  app.get('/api/v1/session', async (request) => {
    const [agency, connection] = await Promise.all([
      db.agency.findUniqueOrThrow({ where: { id: request.currentUser.agencyId }, select: { capabilities: true } }),
      db.googleConnection.findFirst({ where: { agencyId: request.currentUser.agencyId, status: { not: 'DISCONNECTED' } }, orderBy: { updatedAt: 'desc' }, select: { status: true, googleEmail: true } }),
    ]);
    return { user: { id: request.currentUser.id, email: request.currentUser.email, displayName: request.currentUser.displayName, role: request.currentUser.role }, csrfToken: request.csrfToken, capabilities: agency.capabilities, connection };
  });
  app.post('/api/v1/logout', async (request, reply) => {
    const signed = request.cookies[SESSION_COOKIE]; const unsigned = signed ? request.unsignCookie(signed) : undefined;
    if (unsigned?.valid) await redis.del(`session:${unsigned.value}`);
    reply.clearCookie(SESSION_COOKIE, { path: '/' }); return reply.code(204).send();
  });
}

export function tenantLocation(db: PrismaClient, request: FastifyRequest, locationId: string) {
  return db.location.findFirst({ where: { id: locationId, isSelected: true, isActive: true, account: { agencyId: request.currentUser.agencyId } }, include: { account: true } });
}
