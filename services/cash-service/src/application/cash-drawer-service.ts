import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { validateOpenDrawer, OpenDrawerInput, Violation } from '../domain/cash-drawer';
import { toCents, centsToDollars } from '../domain/money';

export class DrawerValidationError extends Error {
  readonly status = 422;
  readonly code = 'DRAWER_VALIDATION_ERROR';
  constructor(readonly violations: Violation[]) {
    super('Drawer open rejected: ' + violations.map((v) => v.field ?? v.rule).join(', '));
    this.name = 'DrawerValidationError';
  }
}

export class ActiveDrawerConflictError extends Error {
  readonly status = 409;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ActiveDrawerConflictError';
  }
}

export class DrawerNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'DRAWER_NOT_FOUND';
  constructor(message = 'Drawer not found') {
    super(message);
    this.name = 'DrawerNotFoundError';
  }
}

export interface OpenDrawerDTO extends OpenDrawerInput {
  tenantId: string;
  entityId: string;
  cashierName?: string | null;
  currency?: string | null;
  actor: string;
}

@injectable()
export class DrawerService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  /**
   * BR: one active (non-RECONCILED) drawer per cashier/location and per
   * terminal. Pre-checked here for a fast, specific 409; the DB-level
   * partial unique indexes (constraints migration) are the real backstop
   * against a concurrent-open race — a P2002 from either index is caught
   * below and surfaced as the same conflict, never a raw 500.
   */
  async open(dto: OpenDrawerDTO) {
    const violations = validateOpenDrawer(dto);
    if (violations.length > 0) throw new DrawerValidationError(violations);

    const byCashier = await this.prisma.cashDrawer.findFirst({
      where: { tenantId: dto.tenantId, cashierId: dto.cashierId!, storeId: dto.storeId!, status: { not: 'RECONCILED' } },
    });
    if (byCashier) {
      throw new ActiveDrawerConflictError('ACTIVE_DRAWER_EXISTS_FOR_CASHIER', 'This cashier already has an active drawer at this location');
    }
    const byTerminal = await this.prisma.cashDrawer.findFirst({
      where: { tenantId: dto.tenantId, terminalCode: dto.terminalCode!, status: { not: 'RECONCILED' } },
    });
    if (byTerminal) {
      throw new ActiveDrawerConflictError('ACTIVE_DRAWER_EXISTS_FOR_TERMINAL', 'This terminal already has an active drawer');
    }

    const drawerId = crypto.randomUUID();
    const openingFloatCents = toCents(dto.openingFloat ?? 0);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await setTenantContextOnConnection(tx, dto.tenantId);

        const drawer = await tx.cashDrawer.create({
          data: {
            id: drawerId,
            tenantId: dto.tenantId,
            entityId: dto.entityId,
            storeId: dto.storeId!,
            storeCode: dto.storeCode!,
            terminalCode: dto.terminalCode!,
            cashierId: dto.cashierId!,
            cashierName: dto.cashierName ?? null,
            businessDate: new Date(dto.businessDate!),
            currency: dto.currency ?? 'USD',
            openingFloat: centsToDollars(openingFloatCents),
            floatLocked: false,
            status: 'OPEN',
            openedBy: dto.actor,
          },
        });

        await tx.cashDrawerMovement.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: dto.tenantId,
            drawerId,
            movementType: 'OPEN_FLOAT',
            amount: centsToDollars(openingFloatCents),
          },
        });

        const payload = {
          drawerId, storeId: dto.storeId, terminalCode: dto.terminalCode, cashierId: dto.cashierId,
          openingFloat: centsToDollars(openingFloatCents),
        };
        await tx.auditOutboxEvent.create({
          data: {
            id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_DRAWER', docId: drawerId,
            action: 'CASH_DRAWER_OPENED', before: null as any, after: payload as any, actor: dto.actor,
          },
        });
        await tx.cashOutboxEvent.create({
          data: { id: crypto.randomUUID(), tenantId: dto.tenantId, eventType: 'cash.drawer.opened', aggregateId: drawerId, payload: payload as any },
        });

        return drawer;
      });

      try {
        await this.events.publish({
          type: 'cash.drawer.opened', tenantId: dto.tenantId, payload: { drawerId },
          occurredAt: new Date().toISOString(), correlationId: drawerId,
        } as any);
      } catch {
        /* outbox row already durable */
      }

      return created;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ActiveDrawerConflictError('ACTIVE_DRAWER_CONFLICT', 'An active drawer already exists for this cashier/location or terminal');
      }
      throw err;
    }
  }

  async getActive(tenantId: string, cashierId: string, storeId?: string | null) {
    return this.prisma.cashDrawer.findFirst({
      where: { tenantId, cashierId, status: { not: 'RECONCILED' }, ...(storeId ? { storeId } : {}) },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getById(tenantId: string, drawerId: string) {
    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id: drawerId, tenantId } });
    if (!drawer) throw new DrawerNotFoundError();
    return drawer;
  }
}
