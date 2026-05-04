import { injectable, inject } from 'tsyringe';
import { IEOMCloseRepository, EOMClose, TenantId, EOMCloseStatus, EOMCloseType, EOMStepStatus } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/eom-client';
import type { EOMClose as PrismaEOMClose, EOMStep as PrismaEOMStep } from '.prisma/eom-client';

type EOMCloseWithSteps = PrismaEOMClose & { steps?: PrismaEOMStep[] };

@injectable()
export class PrismaEOMCloseRepository implements IEOMCloseRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: TenantId): Promise<EOMClose | null> {
    const row = await this.prisma.eOMClose.findFirst({
      where: { id, tenantId },
      include: { steps: { orderBy: { stepCode: 'asc' } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findAll(tenantId: TenantId): Promise<EOMClose[]> {
    const rows = await this.prisma.eOMClose.findMany({
      where: { tenantId },
      include: { steps: { orderBy: { stepCode: 'asc' } } },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(this.toDomain);
  }

  async create(data: Omit<EOMClose, 'id' | 'steps'>, tenantId: TenantId): Promise<EOMClose> {
    // Step definitions per close type.
    // MONTHLY = Service Module close (Parts/Service department EOM).
    // ACCOUNTING_EOM = Accounting EOM from purge.cbl (ACSYS-TRACK-EOM sequence).
    //   Uses ACCT_ prefix to avoid code collision with Service Module steps
    //   (both systems have steps numbered 062, 065, 068, 070, 200, 300 but with different semantics).
    // YEAR_END / 13TH_MONTH = atomic operations — no individual steps needed.
    const closeType = data.closeType ?? 'MONTHLY';

    const stepsToCreate: Array<{ stepCode: string; stepName: string }> =
      closeType === 'ACCOUNTING_EOM'
        ? [
            { stepCode: 'ACCT_010', stepName: 'Backup' },
            { stepCode: 'ACCT_020', stepName: 'Schedprn Detailed Report' },
            { stepCode: 'ACCT_025', stepName: 'Schedprn Summary Report' },
            { stepCode: 'ACCT_062', stepName: 'Java EOM Reports' },
            { stepCode: 'ACCT_065', stepName: 'Archive Reports' },
            { stepCode: 'ACCT_068', stepName: 'Financial Statements' },
            { stepCode: 'ACCT_070', stepName: 'Orphan Detail Cleanup' },
            { stepCode: 'ACCT_100', stepName: 'Schedule Detail Purge' },
            { stepCode: 'ACCT_200', stepName: 'GL and Journal Purge' },
            { stepCode: 'ACCT_300', stepName: 'Missing Document Purge' },
          ]
        : closeType === 'MONTHLY'
          ? [
              { stepCode: '062', stepName: 'Parts Close' },
              { stepCode: '065', stepName: 'Parts Reconciliation' },
              { stepCode: '068', stepName: 'Service Close' },
              { stepCode: '071', stepName: 'Variable Operations Close' },
              { stepCode: '074', stepName: 'Fixed Operations Close' },
              { stepCode: '077', stepName: 'Master Close' },
            ]
          : []; // YEAR_END, 13TH_MONTH — atomic, no step-by-step orchestration

    const row = await this.prisma.eOMClose.create({
      data: {
        tenantId,
        periodYear: data.periodYear,
        periodMonth: data.periodMonth,
        closeType,
        status: data.status,
        currentStep: data.currentStep,
        steps: stepsToCreate.length > 0 ? { create: stepsToCreate } : undefined,
      },
      include: { steps: { orderBy: { stepCode: 'asc' } } },
    });
    return this.toDomain(row);
  }

  async updateStatus(id: string, status: string, tenantId: TenantId): Promise<void> {
    await this.prisma.eOMClose.update({
      where: { id },
      data: {
        status,
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(status === 'BLOCKED' ? { blockedReason: 'Step blocked' } : {}),
      },
    });
  }

  private toDomain(row: EOMCloseWithSteps): EOMClose {
    return {
      id: row.id,
      tenantId: row.tenantId as TenantId,
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
      closeType: (row.closeType as EOMCloseType) ?? 'MONTHLY',
      status: row.status as EOMCloseStatus,
      currentStep: row.currentStep,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      blockedReason: row.blockedReason,
      steps: (row.steps ?? []).map((s) => ({
        id: s.id,
        eomCloseId: s.eomCloseId,
        stepCode: s.stepCode,
        stepName: s.stepName,
        status: s.status as EOMStepStatus,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        errorMessage: s.errorMessage,
        retryCount: s.retryCount,
      })),
    };
  }
}
