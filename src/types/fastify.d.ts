import type { User } from '@prisma/client';
declare module 'fastify' {
  interface FastifyRequest { currentUser: User; csrfToken: string }
}
