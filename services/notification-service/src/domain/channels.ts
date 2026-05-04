import { INotificationChannel, TenantId } from '@amacc/shared-kernel';

export class WebhookChannel implements INotificationChannel {
  getChannelName(): string { return 'webhook'; }

  async send(tenantId: TenantId, message: string, metadata: Record<string, unknown>): Promise<void> {
    const webhookUrl = metadata['webhookUrl'] as string;
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, message, metadata, timestamp: new Date().toISOString() }),
      });
    } catch (err) {
      console.error(`Webhook delivery failed for tenant ${tenantId}:`, err);
    }
  }
}

export class ConsoleChannel implements INotificationChannel {
  getChannelName(): string { return 'console'; }

  async send(tenantId: TenantId, message: string, metadata: Record<string, unknown>): Promise<void> {
    console.log(`[NOTIFICATION] tenant=${tenantId} message="${message}"`, metadata);
  }
}
