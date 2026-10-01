import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { OAuth2Client } from 'google-auth-library';
import type { Config } from '../config.js';
import { encryptToken, parseKeyRing } from '../lib/encryption.js';
import { AppError } from '../lib/errors.js';
import type { Queues } from '../queues.js';
import { discoverGoogleBusinesses } from '../google/discovery.js';
import { requireCapability } from '../capabilities.js';

type OAuthState = { agencyId: string; userId: string };
const CAPABILITY_ORDER = ['READ_REVIEWS', 'REPLY_TO_REVIEWS', 'PUBLISH_POSTS', 'AUTO_REPLY'] as const;

function frontendRoute(config: Config, path: string, params?: Record<string, string>) {
  const base = config.FRONTEND_URL.replace(/\/?$/, '/');
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return `${base}${path.replace(/^\//, '')}${query}`;
}

export function registerGoogleBusinessRoutes(app: FastifyInstance, config: Config, db: PrismaClient, redis: Redis, queues: Queues) {
  app.get('/api/v1/onboarding', async (request) => onboardingState(db, config, request.currentUser.agencyId));

  app.get('/api/v1/google-business/connect', async (request, reply) => {
    await requireCapability(db, request.currentUser.agencyId, 'READ_REVIEWS');
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'חיבור Google אינו מוגדר בסביבה זו');
    const state = randomBytes(24).toString('base64url');
    await redis.set(`gbp:${state}`, JSON.stringify({ agencyId: request.currentUser.agencyId, userId: request.currentUser.id } satisfies OAuthState), 'EX', 600);
    const client = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_BUSINESS_REDIRECT_URI);
    return reply.redirect(client.generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: true, scope: ['openid', 'email', 'https://www.googleapis.com/auth/business.manage'], state }));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/v1/google-business/callback', async (request, reply) => {
    if (!request.query.state) throw new AppError(400, 'OAUTH_INVALID', 'חסרים פרטי הרשאה');
    const rawState = await redis.getdel(`gbp:${request.query.state}`);
    let state: OAuthState | null = null;
    try { state = rawState ? JSON.parse(rawState) as OAuthState : null; } catch { state = null; }
    if (!state || state.agencyId !== request.currentUser.agencyId || state.userId !== request.currentUser.id) throw new AppError(400, 'OAUTH_STATE_INVALID', 'בקשת ההרשאה פגה. התחילו את החיבור מחדש');
    await requireCapability(db, request.currentUser.agencyId, 'READ_REVIEWS');
    if (request.query.error) return reply.redirect(frontendRoute(config, '/onboarding', { google: 'denied' }));
    if (!request.query.code) throw new AppError(400, 'OAUTH_INVALID', 'חסרים פרטי הרשאה');

    const oauth = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_BUSINESS_REDIRECT_URI);
    const { tokens } = await oauth.getToken(request.query.code);
    const ticket = tokens.id_token ? await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID }) : null;
    const identity = ticket?.getPayload();
    if (!identity?.sub || !identity.email) throw new AppError(400, 'GOOGLE_IDENTITY_MISSING', 'Google לא החזיר זהות תקינה לחשבון');
    const ring = parseKeyRing(config.TOKEN_ENCRYPTION_KEYS);
    const existing = await db.googleConnection.findUnique({ where: { agencyId_googleSubject: { agencyId: state.agencyId, googleSubject: identity.sub } } });
    const connection = await db.googleConnection.upsert({
      where: { agencyId_googleSubject: { agencyId: state.agencyId, googleSubject: identity.sub } },
      update: {
        googleEmail: identity.email,
        encryptedRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token, ring) : existing?.encryptedRefreshToken,
        encryptedAccessToken: tokens.access_token ? encryptToken(tokens.access_token, ring) : existing?.encryptedAccessToken,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : existing?.tokenExpiresAt,
        grantedScopes: tokens.scope?.split(' ').filter(Boolean) ?? existing?.grantedScopes ?? [],
        status: 'DISCOVERING', lastError: null,
      },
      create: {
        agencyId: state.agencyId, googleSubject: identity.sub, googleEmail: identity.email,
        encryptedRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token, ring) : null,
        encryptedAccessToken: tokens.access_token ? encryptToken(tokens.access_token, ring) : null,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        grantedScopes: tokens.scope?.split(' ').filter(Boolean) ?? [], status: 'DISCOVERING',
      },
    });

    try {
      const discovered = await discoverGoogleBusinesses(config, tokens);
      await db.$transaction(async (tx) => {
        for (const googleAccount of discovered) {
          const account = await tx.account.upsert({
            where: { agencyId_googleAccountId: { agencyId: state!.agencyId, googleAccountId: googleAccount.accountId } },
            update: { googleConnectionId: connection.id, displayName: googleAccount.displayName, status: 'CONNECTED', isDemo: false },
            create: { agencyId: state!.agencyId, googleConnectionId: connection.id, googleAccountId: googleAccount.accountId, displayName: googleAccount.displayName, status: 'CONNECTED' },
          });
          for (const location of googleAccount.locations) await tx.location.upsert({
            where: { accountId_googleLocationId: { accountId: account.id, googleLocationId: location.locationId } },
            update: { googleResourceName: location.resourceName, displayName: location.displayName, businessCategory: location.category, isVerified: location.verified, isActive: true },
            create: { accountId: account.id, googleLocationId: location.locationId, googleResourceName: location.resourceName, displayName: location.displayName, businessCategory: location.category, isVerified: location.verified, isSelected: false, autoReplyEnabled: false },
          });
        }
        await tx.googleConnection.update({ where: { id: connection.id }, data: { status: 'CONNECTED', discoveryCompletedAt: new Date(), lastError: null } });
      });
      return reply.redirect(frontendRoute(config, '/onboarding', { google: discovered.some((account) => account.locations.length) ? 'connected' : 'empty' }));
    } catch (error) {
      await db.googleConnection.update({ where: { id: connection.id }, data: { status: 'ERROR', lastError: String(error) } });
      return reply.redirect(frontendRoute(config, '/onboarding', { google: 'discovery_failed' }));
    }
  });

  app.get('/api/v1/google-business/candidates', async (request) => {
    await requireCapability(db, request.currentUser.agencyId, 'READ_REVIEWS');
    const connections = await db.googleConnection.findMany({
      where: { agencyId: request.currentUser.agencyId, status: { not: 'DISCONNECTED' } },
      include: { accounts: { include: { locations: { orderBy: { displayName: 'asc' } } }, orderBy: { displayName: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    return { connections: connections.map((connection) => ({ id: connection.id, email: connection.googleEmail, status: connection.status, accounts: connection.accounts.map((account) => ({ id: account.id, name: account.displayName, resourceName: `accounts/${account.googleAccountId}`, locations: account.locations.map((location) => ({ id: location.id, resourceName: location.googleResourceName, name: location.displayName, category: location.businessCategory, verified: location.isVerified, selected: location.isSelected })) })) })) };
  });

  app.post<{ Body: { resourceNames: string[] } }>('/api/v1/google-business/locations/select', async (request) => {
    await requireCapability(db, request.currentUser.agencyId, 'READ_REVIEWS');
    const resourceNames = [...new Set(request.body?.resourceNames ?? [])];
    if (!resourceNames.length || resourceNames.some((name) => typeof name !== 'string')) throw new AppError(400, 'LOCATION_SELECTION_REQUIRED', 'יש לבחור לפחות עסק אחד');
    const candidates = await db.location.findMany({ where: { googleResourceName: { in: resourceNames }, account: { agencyId: request.currentUser.agencyId, isDemo: false, googleConnection: { status: 'CONNECTED' } } }, select: { id: true, googleResourceName: true } });
    if (candidates.length !== resourceNames.length) throw new AppError(400, 'INVALID_LOCATION_SELECTION', 'אחד העסקים שנבחרו אינו זמין בחשבון');
    await db.$transaction([
      db.location.updateMany({ where: { account: { agencyId: request.currentUser.agencyId, isDemo: false } }, data: { isSelected: false } }),
      db.location.updateMany({ where: { id: { in: candidates.map(({ id }) => id) } }, data: { isSelected: true, isActive: true, autoReplyEnabled: false, syncStatus: 'PENDING', syncFailureMessage: null } }),
    ]);
    await queues.maintenance.add('manual-review-sync', { task: 'sync-reviews' }, { jobId: `onboarding-sync-${request.currentUser.agencyId}-${Date.now()}`, attempts: 3 });
    return onboardingState(db, config, request.currentUser.agencyId);
  });

  app.post('/api/v1/google-business/sync', async (request, reply) => {
    await requireCapability(db, request.currentUser.agencyId, 'READ_REVIEWS');
    const selected = await db.location.count({ where: { isSelected: true, isActive: true, account: { agencyId: request.currentUser.agencyId, googleConnection: { status: 'CONNECTED' } } } });
    if (!selected) throw new AppError(409, 'NO_SELECTED_LOCATIONS', 'לא נבחרו עסקים לסנכרון');
    await db.location.updateMany({ where: { isSelected: true, account: { agencyId: request.currentUser.agencyId } }, data: { syncStatus: 'PENDING', syncFailureMessage: null } });
    await queues.maintenance.add('manual-review-sync', { task: 'sync-reviews' }, { jobId: `manual-sync-${request.currentUser.agencyId}-${Date.now()}`, attempts: 3 });
    return reply.code(202).send(await onboardingState(db, config, request.currentUser.agencyId));
  });

  app.post('/api/v1/google-business/disconnect', async (request, reply) => {
    const connections = await db.googleConnection.findMany({ where: { agencyId: request.currentUser.agencyId }, select: { id: true } });
    await db.$transaction([
      db.googleConnection.updateMany({ where: { agencyId: request.currentUser.agencyId }, data: { status: 'DISCONNECTED', encryptedAccessToken: null, encryptedRefreshToken: null, tokenExpiresAt: null } }),
      db.location.updateMany({ where: { account: { agencyId: request.currentUser.agencyId, googleConnectionId: { in: connections.map(({ id }) => id) } } }, data: { isSelected: false, isActive: false } }),
    ]);
    return reply.code(204).send();
  });
}

async function onboardingState(db: PrismaClient, config: Config, agencyId: string) {
  const [agency, connections, locations] = await Promise.all([
    db.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { capabilities: true } }),
    db.googleConnection.findMany({ where: { agencyId }, orderBy: { updatedAt: 'desc' }, select: { id: true, googleEmail: true, status: true, lastError: true } }),
    db.location.findMany({ where: { account: { agencyId }, isSelected: true }, select: { syncStatus: true, lastReviewSyncAt: true } }),
  ]);
  const demoMode = config.GOOGLE_PROVIDER_MODE === 'mock';
  const activeConnection = connections.find((item) => item.status !== 'DISCONNECTED');
  const syncing = locations.some((item) => item.syncStatus === 'PENDING' || item.syncStatus === 'SYNCING');
  const failed = locations.some((item) => item.syncStatus === 'FAILED');
  const step = demoMode ? 'COMPLETE' : !activeConnection ? 'WELCOME' : activeConnection.status === 'DISCOVERING' ? 'CONNECT' : !locations.length ? 'SELECT_LOCATIONS' : syncing ? 'SYNCING' : failed ? 'SYNC_FAILED' : 'COMPLETE';
  return {
    step,
    readOnly: !agency.capabilities.includes('REPLY_TO_REVIEWS') && !agency.capabilities.includes('PUBLISH_POSTS'),
    capabilities: CAPABILITY_ORDER.filter((value) => agency.capabilities.includes(value)),
    connection: activeConnection ? { id: activeConnection.id, email: activeConnection.googleEmail, status: activeConnection.status, lastError: activeConnection.lastError } : null,
    selectedLocationCount: locations.length,
    syncedLocationCount: locations.filter((item) => item.syncStatus === 'COMPLETE').length,
    lastSyncAt: locations.map((item) => item.lastReviewSyncAt?.getTime() ?? 0).reduce((max, value) => Math.max(max, value), 0) || null,
  };
}
