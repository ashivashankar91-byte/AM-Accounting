import type { JWTPayload } from '@amacc/shared-kernel';

// authMiddleware (packages/shared-kernel/src/middleware/auth.ts) assigns
// request.user = <JWTPayload> after successful authentication (or the
// dev-mode bypass). shared-kernel is intentionally framework-agnostic and
// does not depend on fastify, so the augmentation lives here, at the point
// where a Fastify-typed request actually reads request.user. Mirrors
// services/coa-service/src/types/fastify.d.ts.
declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}
