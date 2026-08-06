// @wave S030 — Statements & Dunning. Fable §3-S030: generation is read-only
// (posts nothing, mutates nothing), retains evidence of every run, and
// (D-CE08-06 APPROVED) is print/PDF only for v1 — no e-delivery transport.
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { withSerializableRetry } from '../lib/serializable-retry';
import { ageDaysFrom } from '../domain/open-item';
import { SCHEDULE_OPEN_ITEM_REPO_TOKEN } from './open-item-service';
import type { IScheduleOpenItemRepository } from '../infrastructure/schedule-open-item-repository';
import type { ICustomerClient } from '../infrastructure/customer-client';

export const CUSTOMER_CLIENT_TOKEN = 'ICustomerClient';

export interface DunningLevelDef {
  level: number;
  afterDays: number;
  label: string;
  bodyTemplate: string;
}

// @trace-fable D-CE08-05 APPROVED_IN_PRINCIPLE — SAFE_CONFIGURATION default:
// neutral, generic escalation levels/labels (never a specific brand voice or
// collections legal copy, which the source does not specify).
export const DEFAULT_DUNNING_LEVELS: DunningLevelDef[] = [
  { level: 1, afterDays: 30, label: 'Friendly reminder', bodyTemplate: 'Your account has a past-due balance. Please remit payment at your earliest convenience.' },
  { level: 2, afterDays: 60, label: 'Second notice', bodyTemplate: 'Your account remains past due. Please contact us to arrange payment.' },
  { level: 3, afterDays: 90, label: 'Final notice', bodyTemplate: 'Your account is seriously past due. Immediate payment or contact is required.' },
];

@injectable()
export class StatementService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(SCHEDULE_OPEN_ITEM_REPO_TOKEN) private readonly openItemRepo: IScheduleOpenItemRepository,
    @inject(CUSTOMER_CLIENT_TOKEN) private readonly customerClient: ICustomerClient,
  ) {}

  async generateStatement(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
    asOfDate: Date,
    generatedBy: string,
  ): Promise<any> {
    const items = await this.openItemRepo.findBySchedule(tenantId, scheduleNumber, { controlNumber, asOfDate });
    const customer = await this.customerClient.findByCustomerNumber(tenantId, controlNumber);

    let totalAmount = new Prisma.Decimal(0);
    const lines = items.map((item: any) => {
      totalAmount = totalAmount.add(item.remainingBalance);
      return {
        itemNumber: item.itemNumber,
        transactionDate: item.transactionDate?.toISOString() ?? null,
        dueDate: item.dueDate?.toISOString() ?? null,
        description: item.description,
        originalAmount: item.originalAmount.toFixed(2),
        remainingBalance: item.remainingBalance.toFixed(2),
        status: item.status,
      };
    });

    const content = {
      recipient: customer
        ? { customerNumber: customer.customerNumber, name: customer.customerName, address1: customer.address1, address2: customer.address2, city: customer.city, state: customer.state, zip: customer.zip }
        : { customerNumber: controlNumber, name: null },
      lines,
      generatedAt: new Date().toISOString(),
    };

    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      return tx.scheduleStatementRun.create({
        data: {
          tenantId, scheduleNumber, controlNumber, asOfDate,
          generatedBy, totalAmount, itemCount: lines.length, content,
        },
      });
    });
  }

  async listStatements(tenantId: string, scheduleNumber?: string, controlNumber?: string) {
    return (this.prisma as any).scheduleStatementRun.findMany({
      where: { tenantId, ...(scheduleNumber && { scheduleNumber }), ...(controlNumber && { controlNumber }) },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async getStatement(tenantId: string, id: string) {
    return (this.prisma as any).scheduleStatementRun.findFirst({ where: { id, tenantId } });
  }

  async getDunningConfig(tenantId: string): Promise<DunningLevelDef[]> {
    const row = await (this.prisma as any).scheduleDunningConfig.findFirst({ where: { tenantId } });
    return row ? (row.levels as unknown as DunningLevelDef[]) : DEFAULT_DUNNING_LEVELS;
  }

  async setDunningConfig(tenantId: string, levels: DunningLevelDef[], updatedBy?: string): Promise<DunningLevelDef[]> {
    await (this.prisma as any).scheduleDunningConfig.upsert({
      where: { tenantId },
      create: { tenantId, levels: levels as any, updatedBy },
      update: { levels: levels as any, updatedBy },
    });
    return levels;
  }

  /**
   * Generates a dunning notice at the highest escalation level whose
   * afterDays threshold is met by the oldest open item's age for the given
   * control. Read-only, same as statement generation.
   */
  async generateDunning(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
    generatedBy: string,
  ): Promise<any> {
    const levels = await this.getDunningConfig(tenantId);
    const items = await this.openItemRepo.findBySchedule(tenantId, scheduleNumber, { controlNumber });
    const asOfDate = new Date();

    let maxAge = 0;
    for (const item of items as any[]) {
      const referenceDate = item.dueDate ?? item.transactionDate;
      maxAge = Math.max(maxAge, ageDaysFrom(referenceDate, asOfDate));
    }

    const applicable = [...levels].filter((l) => maxAge >= l.afterDays).sort((a, b) => b.level - a.level)[0];
    if (!applicable) {
      throw new Error('NO_DUNNING_LEVEL_APPLICABLE');
    }

    const customer = await this.customerClient.findByCustomerNumber(tenantId, controlNumber);
    const content = {
      level: applicable.level,
      label: applicable.label,
      body: applicable.bodyTemplate,
      recipient: customer ? { customerNumber: customer.customerNumber, name: customer.customerName } : { customerNumber: controlNumber, name: null },
      maxAgeDays: maxAge,
      generatedAt: new Date().toISOString(),
    };

    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      return tx.scheduleDunningRun.create({
        data: { tenantId, scheduleNumber, controlNumber, level: applicable.level, generatedBy, content },
      });
    });
  }

  async listDunningRuns(tenantId: string, scheduleNumber?: string, controlNumber?: string) {
    return (this.prisma as any).scheduleDunningRun.findMany({
      where: { tenantId, ...(scheduleNumber && { scheduleNumber }), ...(controlNumber && { controlNumber }) },
      orderBy: { generatedAt: 'desc' },
    });
  }
}
