import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { DrawerService, ActiveDrawerConflictError, DrawerValidationError, DrawerNotFoundError } from '../src/application/cash-drawer-service';
import { makeFakePrisma, makeFakeEvents } from './support/fake-prisma';

function setup() {
  container.reset();
  const prisma = makeFakePrisma();
  const events = makeFakeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('DrawerService', { useClass: DrawerService });
  return { svc: container.resolve<DrawerService>('DrawerService'), prisma, events };
}

const baseDto = {
  tenantId: 't1', entityId: 'e1', storeId: 's1', storeCode: 'S01', terminalCode: 'TERM1',
  cashierId: 'cashier-1', cashierName: 'Alice', businessDate: '2026-07-29', openingFloat: 100, actor: 'cashier-1',
};

describe('DrawerService.open', () => {
  it('opens a valid drawer and writes the OPEN_FLOAT movement + audit + outbox', async () => {
    const { svc, prisma } = setup();
    const drawer = await svc.open(baseDto);
    expect(drawer.status).toBe('OPEN');
    expect(prisma.cashDrawerMovement._rows).toHaveLength(1);
    expect(prisma.cashDrawerMovement._rows[0]).toMatchObject({ movementType: 'OPEN_FLOAT', amount: 100 });
    expect(prisma.auditOutboxEvent._rows.some((a: any) => a.action === 'CASH_DRAWER_OPENED')).toBe(true);
    expect(prisma.cashOutboxEvent._rows.some((e: any) => e.eventType === 'cash.drawer.opened')).toBe(true);
  });

  it('rejects a second active drawer for the same cashier/location', async () => {
    const { svc } = setup();
    await svc.open(baseDto);
    await expect(svc.open({ ...baseDto, terminalCode: 'TERM2' })).rejects.toBeInstanceOf(ActiveDrawerConflictError);
  });

  it('rejects a second active drawer for the same terminal', async () => {
    const { svc } = setup();
    await svc.open(baseDto);
    await expect(svc.open({ ...baseDto, cashierId: 'cashier-2' })).rejects.toBeInstanceOf(ActiveDrawerConflictError);
  });

  it('allows opening a new drawer once the prior one is RECONCILED', async () => {
    const { svc, prisma } = setup();
    const first = await svc.open(baseDto);
    const row = prisma.cashDrawer._rows.find((r: any) => r.id === first.id);
    row.status = 'RECONCILED';
    await expect(svc.open(baseDto)).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('rejects a negative opening float', async () => {
    const { svc } = setup();
    await expect(svc.open({ ...baseDto, openingFloat: -1 })).rejects.toBeInstanceOf(DrawerValidationError);
  });

  it('rejects a missing terminalCode', async () => {
    const { svc } = setup();
    await expect(svc.open({ ...baseDto, terminalCode: null as any })).rejects.toBeInstanceOf(DrawerValidationError);
  });
});

describe('DrawerService.getActive / getById', () => {
  it('getActive returns null when the cashier has no active drawer', async () => {
    const { svc } = setup();
    expect(await svc.getActive('t1', 'nobody', 's1')).toBeNull();
  });

  it('getActive returns the open drawer for a cashier', async () => {
    const { svc } = setup();
    const opened = await svc.open(baseDto);
    const active = await svc.getActive('t1', 'cashier-1', 's1');
    expect(active?.id).toBe(opened.id);
  });

  it('getById throws DrawerNotFoundError for an unknown id', async () => {
    const { svc } = setup();
    await expect(svc.getById('t1', 'nope')).rejects.toBeInstanceOf(DrawerNotFoundError);
  });

  it('getById enforces tenant isolation', async () => {
    const { svc } = setup();
    const opened = await svc.open(baseDto);
    await expect(svc.getById('other-tenant', opened.id)).rejects.toBeInstanceOf(DrawerNotFoundError);
  });
});
