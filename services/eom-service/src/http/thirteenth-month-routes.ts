/**
 * @module ThirteenthMonthRoutes
 * @cobol-ancestry 13thmenu.cbl, addglto13th.cbl, syncglsched13th.cbl
 * @cobol-programs-replaced
 *   13THMENU — 13th month sub-menu (status, open, finalize)
 * @cobol-programs-eliminated
 *   ADDGLTO13TH    — Copies new GL accounts to snapshot file (not needed — periodMonth=13 filter)
 *   SYNCGLSCHED13TH — Syncs schedule snapshot consistency (not needed — FK constraints)
 *
 * @architecture
 *   13th month is NOT a snapshot copy of GL files. It is periodMonth=13 in the same Postgres tables.
 *   This eliminates the entire snapshot file management lifecycle from 13thmenu.cbl.
 *   The "finalize" step emits an event for downstream archiving (document-service, fs-service).
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '.prisma/eom-client';
import { asTenantId, authMiddleware, createEvent } from '@amacc/shared-kernel';
import { container } from 'tsyringe';

// ── Typed errors ──────────────────────────────────────────────────────────────

export class ThirteenthMonthAlreadyOpenError extends Error {
  readonly statusCode = 409;
  constructor(year: number) {
    super(`13th month for year ${year} is already open or in progress`);
    this.name = 'ThirteenthMonthAlreadyOpenError';
  }
}

export class TwelfthMonthNotClosedError extends Error {
  readonly statusCode = 422;
  constructor(year: number) {
    super(`Cannot open 13th month for year ${year}: the 12th fiscal month has not been closed`);
    this.name = 'TwelfthMonthNotClosedError';
  }
}

export class ThirteenthMonthNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(year: number) {
    super(`No 13th month record found for year ${year}`);
    this.name = 'ThirteenthMonthNotFoundError';
  }
}

export class ThirteenthMonthAlreadyFinalizedError extends Error {
  readonly statusCode = 409;
  constructor(year: number) {
    super(`13th month for year ${year} has already been finalized`);
    this.name = 'ThirteenthMonthAlreadyFinalizedError';
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

function requireTenantId(request: any, reply: any): string | null {
  const id = request.headers['x-tenant-id'] as string | undefined;
  if (!id || !id.trim()) {
    reply.status(401).send({ error: 'Missing required header: x-tenant-id' });
    return null;
  }
  return id.trim();
}

function toStatusDto(record: any) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    periodYear: record.periodYear,
    periodMonth: record.periodMonth,
    closeType: record.closeType,
    status: record.status,
    currentStep: record.currentStep ?? null,
    isOpen: record.status === 'IN_PROGRESS' || record.status === 'NOT_STARTED',
    isFinalized: record.status === 'COMPLETED' && record.completedAt !== null,
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? null,
    initiatedBy: record.initiatedBy ?? null,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function thirteenthMonthRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET is not set');
  }
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const prisma = container.resolve<PrismaClient>('PrismaClient');

  // ── GET /thirteenth-month/status ──────────────────────────────────────────
  // @cobol-origin 13thmenu.cbl GET-COMPNO — reads sys file, checks snapshot file existence
  // TypeScript: query EOMClose for closeType='13TH_MONTH', periodMonth=13

  app.get('/thirteenth-month/status', async (request, reply) => {
    const tenantId = requireTenantId(request, reply);
    if (!tenantId) return;

    const { year } = z.object({
      year: z.coerce.number().int().min(2000).max(2100),
    }).parse(request.query);

    const record = await prisma.eOMClose.findFirst({
      where: { tenantId, periodYear: year, periodMonth: 13, closeType: '13TH_MONTH' },
      include: { steps: { orderBy: { id: 'asc' } } },
    });

    if (!record) {
      // Check if 12th month is closed (prerequisite)
      const twelfthClose = await prisma.eOMClose.findFirst({
        where: { tenantId, periodYear: year, periodMonth: 12, closeType: 'MONTHLY', status: 'COMPLETED' },
      });

      return reply.send({
        year,
        tenantId,
        exists: false,
        isOpen: false,
        isFinalized: false,
        prerequisitesMet: twelfthClose !== null,
        status: null,
      });
    }

    return reply.send({
      year,
      exists: true,
      ...toStatusDto(record),
    });
  });

  // ── POST /thirteenth-month/open ───────────────────────────────────────────
  // @cobol-origin 13thmenu.cbl SET GLOBAL-13TH-IS-IN-PROGRESS TO TRUE
  // Opens the 13th period by creating an EOMClose record with periodMonth=13, closeType='13TH_MONTH'.
  // Validates that periodMonth=12 was successfully closed first.

  app.post('/thirteenth-month/open', async (request, reply) => {
    const tenantId = requireTenantId(request, reply);
    if (!tenantId) return;

    const body = z.object({
      year: z.number().int().min(2000).max(2100),
      initiatedBy: z.string().min(1),
      lastFiscalMonth: z.number().int().min(1).max(12).default(12),
    }).parse(request.body);

    // Check for existing 13th month record
    const existing = await prisma.eOMClose.findFirst({
      where: { tenantId, periodYear: body.year, periodMonth: 13, closeType: '13TH_MONTH' },
    });
    if (existing) {
      throw new ThirteenthMonthAlreadyOpenError(body.year);
    }

    // Validate that the 12th fiscal month is closed
    // @cobol-origin 13thmenu.cbl: checks ACSYS-LSTCLOS-YEAR = LAST-YEAR-CLOSED-ON-AM
    const twelfthClose = await prisma.eOMClose.findFirst({
      where: {
        tenantId,
        periodYear: body.year,
        periodMonth: body.lastFiscalMonth,
        closeType: 'MONTHLY',
        status: 'COMPLETED',
      },
    });
    if (!twelfthClose) {
      throw new TwelfthMonthNotClosedError(body.year);
    }

    const record = await prisma.eOMClose.create({
      data: {
        tenantId,
        periodYear: body.year,
        periodMonth: 13,
        closeType: '13TH_MONTH',
        status: 'IN_PROGRESS',
        currentStep: 'OPEN',
        initiatedBy: body.initiatedBy,
        startedAt: new Date(),
      },
    });

    app.log.info({ tenantId, year: body.year }, '13th month opened');
    return reply.status(201).send(toStatusDto(record));
  });

  // ── POST /thirteenth-month/close ──────────────────────────────────────────
  // @cobol-origin 13thmenu.cbl Option 8 partial — validates no unposted transactions remain
  // Marks the 13th period as ready for finalization.
  // Does NOT finalize — that's a separate step (post /finalize).

  app.post('/thirteenth-month/close', async (request, reply) => {
    const tenantId = requireTenantId(request, reply);
    if (!tenantId) return;

    const body = z.object({
      year: z.number().int().min(2000).max(2100),
      initiatedBy: z.string().min(1),
    }).parse(request.body);

    const record = await prisma.eOMClose.findFirst({
      where: { tenantId, periodYear: body.year, periodMonth: 13, closeType: '13TH_MONTH' },
    });
    if (!record) throw new ThirteenthMonthNotFoundError(body.year);

    if (record.status === 'COMPLETED') {
      throw new ThirteenthMonthAlreadyFinalizedError(body.year);
    }

    const updated = await prisma.eOMClose.update({
      where: { id: record.id },
      data: {
        status: 'IN_PROGRESS',
        currentStep: 'CLOSED_PENDING_FINALIZE',
        initiatedBy: body.initiatedBy,
      },
    });

    app.log.info({ tenantId, year: body.year }, '13th month closed (pending finalize)');
    return reply.send(toStatusDto(updated));
  });

  // ── POST /thirteenth-month/finalize ──────────────────────────────────────
  // @cobol-origin 13thmenu.cbl Option 8 (FINALIZE-13TH paragraph)
  // Archives reports, marks 13th month as finalized, emits THIRTEENTH_MONTH_FINALIZED event.
  //
  // COBOL behavior:
  //   - Archives reports (trial balance, GL, transaction journal, schedules, FS) to DocMate
  //   - Sets GLOBAL-13TH-FINAL-IS-IN-PROGRESS = TRUE during archive
  //   - SEL-ARCH-* default "Y" (always archive, ACC-3676)
  //
  // TypeScript:
  //   - Emits THIRTEENTH_MONTH_FINALIZED event (document-service subscribes to archive)
  //   - Sets EOMClose.status = 'COMPLETED', completedAt = now()

  app.post('/thirteenth-month/finalize', async (request, reply) => {
    const tenantId = requireTenantId(request, reply);
    if (!tenantId) return;

    const body = z.object({
      year: z.number().int().min(2000).max(2100),
      initiatedBy: z.string().min(1),
    }).parse(request.body);

    const record = await prisma.eOMClose.findFirst({
      where: { tenantId, periodYear: body.year, periodMonth: 13, closeType: '13TH_MONTH' },
    });
    if (!record) throw new ThirteenthMonthNotFoundError(body.year);

    if (record.status === 'COMPLETED') {
      throw new ThirteenthMonthAlreadyFinalizedError(body.year);
    }

    // Mark as completed in a transaction + write outbox event
    const updated = await prisma.$transaction(async (tx) => {
      const finalized = await tx.eOMClose.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          currentStep: 'FINALIZED',
          completedAt: new Date(),
          initiatedBy: body.initiatedBy,
        },
      });

      // Emit event for downstream archiving (document-service, fs-service)
      // @cobol-origin 13thmenu.cbl FINALIZE-13TH — triggers ftp.archam for DocMate archive
      await tx.outboxEvent.create({
        data: {
          eventType: 'THIRTEENTH_MONTH_FINALIZED',
          tenantId,
          payload: {
            year: body.year,
            periodMonth: 13,
            closeType: '13TH_MONTH',
            finalizedBy: body.initiatedBy,
            finalizedAt: new Date().toISOString(),
          },
          correlationId: record.id,
        },
      });

      return finalized;
    });

    app.log.info({ tenantId, year: body.year }, '13th month finalized');
    return reply.send({
      ...toStatusDto(updated),
      message: 'THIRTEENTH_MONTH_FINALIZED event emitted. Document-service will archive reports.',
    });
  });
}
