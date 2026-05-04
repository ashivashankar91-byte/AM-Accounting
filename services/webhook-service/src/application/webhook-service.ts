import { PrismaClient } from '.prisma/webhook-client';
import * as crypto from 'crypto';
import pino from 'pino';

const logger = pino({ name: 'webhook-service' });
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // Exponential backoff

export class WebhookService {
  constructor(private readonly prisma: PrismaClient) {}

  async register(data: {
    tenantId: string;
    name: string;
    targetUrl: string;
    events: string[];
    secret?: string;
  }) {
    const secret = data.secret ?? crypto.randomBytes(32).toString('hex');
    return this.prisma.webhookRegistration.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        targetUrl: data.targetUrl,
        events: data.events,
        secret,
      },
    });
  }

  async list(tenantId: string) {
    return this.prisma.webhookRegistration.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivate(id: string, tenantId: string) {
    return this.prisma.webhookRegistration.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getDeliveries(webhookId: string) {
    return this.prisma.webhookDelivery.findMany({
      where: { webhookRegistrationId: webhookId },
      orderBy: { deliveredAt: 'desc' },
      take: 100,
    });
  }

  async dispatchEvent(tenantId: string, eventType: string, payload: Record<string, unknown>) {
    const registrations = await this.prisma.webhookRegistration.findMany({
      where: {
        tenantId,
        isActive: true,
        events: { has: eventType },
      },
    });

    for (const reg of registrations) {
      await this.deliverWithRetry(reg, eventType, payload);
    }
  }

  private async deliverWithRetry(
    registration: { id: string; targetUrl: string; secret: string; failureCount: number },
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    const deliveryId = crypto.randomUUID();
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', registration.secret).update(body).digest('hex');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1] ?? 30000));
        }

        const response = await fetch(registration.targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AMACC-Event': eventType,
            'X-AMACC-Signature': `sha256=${signature}`,
            'X-AMACC-Delivery': deliveryId,
          },
          body,
          signal: AbortSignal.timeout(10000),
        });

        await this.prisma.webhookDelivery.create({
          data: {
            webhookRegistrationId: registration.id,
            eventType,
            payload: payload as any,
            responseStatus: response.status,
            responseBody: (await response.text()).slice(0, 1000),
            attemptCount: attempt + 1,
            deliveredAt: new Date(),
          },
        });

        await this.prisma.webhookRegistration.update({
          where: { id: registration.id },
          data: { lastCalledAt: new Date(), failureCount: 0 },
        });

        logger.info({ webhookId: registration.id, eventType, status: response.status }, 'Webhook delivered');
        return;
      } catch (err) {
        logger.warn({ webhookId: registration.id, attempt, err: (err as Error).message }, 'Webhook delivery failed');
      }
    }

    // All retries exhausted
    await this.prisma.webhookDelivery.create({
      data: {
        webhookRegistrationId: registration.id,
        eventType,
        payload: payload as any,
        attemptCount: MAX_RETRIES + 1,
        failedAt: new Date(),
      },
    });

    const newFailureCount = registration.failureCount + 1;
    if (newFailureCount >= 3) {
      await this.prisma.webhookRegistration.update({
        where: { id: registration.id },
        data: { isActive: false, failureCount: newFailureCount },
      });
      logger.error({ webhookId: registration.id }, 'Webhook deactivated after 3 consecutive failures');
    } else {
      await this.prisma.webhookRegistration.update({
        where: { id: registration.id },
        data: { failureCount: newFailureCount },
      });
    }
  }
}
