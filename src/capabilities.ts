import type { Capability, PrismaClient } from '@prisma/client';
import { AppError } from './lib/errors.js';
import { ProviderError } from './lib/errors.js';

export async function agencyCapabilities(db: PrismaClient, agencyId: string): Promise<Capability[]> {
  return (await db.agency.findUnique({ where: { id: agencyId }, select: { capabilities: true } }))?.capabilities ?? [];
}

export async function requireCapability(db: PrismaClient, agencyId: string, capability: Capability) {
  const capabilities = await agencyCapabilities(db, agencyId);
  if (!capabilities.includes(capability)) throw new AppError(403, 'CAPABILITY_NOT_ENABLED', 'הפעולה עדיין אינה זמינה במצב קריאה בלבד');
}

export async function requireProviderCapability(db: PrismaClient, agencyId: string, capability: Capability) {
  const capabilities = await agencyCapabilities(db, agencyId);
  if (!capabilities.includes(capability)) throw new ProviderError('Capability is not enabled for this workspace', false, 'CAPABILITY_NOT_ENABLED');
}
