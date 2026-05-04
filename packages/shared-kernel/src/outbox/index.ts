import { IEventPublisher } from '../interfaces';
import { DomainEvent } from '../events';

export interface OutboxRecord {
  id: string;
  eventType: string;
  tenantId: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  publishedAt: Date | null;
  retryCount: number;
  lastError?: string | null;
}

export class OutboxProcessor {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly eventPublisher: IEventPublisher,
    private readonly findUnpublished: () => Promise<OutboxRecord[]>,
    private readonly markPublished: (id: string) => Promise<void>,
    private readonly incrementRetry: (id: string, error?: string) => Promise<void>,
  ) {}

  async processNextBatch(): Promise<number> {
    const records = await this.findUnpublished();
    let published = 0;
    for (const record of records) {
      try {
        const event: DomainEvent = {
          type: record.eventType as any,
          tenantId: record.tenantId,
          payload: record.payload,
          occurredAt: new Date(),
          correlationId: record.correlationId ?? '',
        };
        await this.eventPublisher.publish(event);
        await this.markPublished(record.id);
        published++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Outbox publish failed for ${record.id}:`, err);
        await this.incrementRetry(record.id, message);
      }
    }
    return published;
  }

  /** @deprecated use processNextBatch */
  processOutbox(): Promise<number> {
    return this.processNextBatch();
  }

  startPolling(intervalMs: number = 5000): void {
    this.timer = setInterval(() => {
      this.processNextBatch().catch((err) =>
        console.error('Outbox polling error:', err),
      );
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
