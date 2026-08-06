import { FastifyInstance } from 'fastify';
import { capabilityRoutes } from './capability-routes';
import { policyRoutes } from './policy-routes';
import { queueRoutes } from './queue-routes';
import { storyRoutesA } from './story-routes-a';
import { storyRoutesB } from './story-routes-b';

/**
 * Every route module attaches its own auth hook, because Fastify scopes hooks
 * to the plugin that registered them. Registering them as sibling plugins
 * keeps that guarantee explicit rather than depending on encapsulation order.
 */
export async function automationRoutes(app: FastifyInstance) {
  await app.register(capabilityRoutes);
  await app.register(policyRoutes);
  await app.register(queueRoutes);
  await app.register(storyRoutesA);
  await app.register(storyRoutesB);
}
