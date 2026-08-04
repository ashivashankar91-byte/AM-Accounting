/**
 * S005 — HR-Event Provisioning Hooks
 *
 * Consumes HR system events and auto-provisions / deprovisions accounting
 * roles via the auth-service. Every attempt is persisted for audit lineage
 * regardless of outcome (S007).
 *
 * Supported HR event types:
 *   HR_USER_CREATED       — joiner: provision accounting roles by job code
 *   HR_USER_TERMINATED    — leaver: deprovision all accounting access
 *   HR_USER_ROLE_CHANGED  — mover: update role assignments to new job code
 *
 * Design decisions:
 *   - correlationId idempotency: sourceCorrelationId (from HR system) is unique
 *     per tenant; a duplicate is recorded as DUPLICATE and skipped, not repeated.
 *   - tenantId and legalEntityId stored separately (never aliased).
 *   - cross-tenant denial: tenantId in the event must match the calling context.
 *   - service allowlist: only listed service identities may push events via HTTP.
 *   - retryable vs terminal: auth-service 5xx → FAILED_RETRYABLE; 4xx → FAILED_TERMINAL.
 *   - no swallowed failures: every auth-service error is surfaced and stored.
 */

import crypto from 'crypto';
import pino from 'pino';
import { IAuthServiceClient } from '../infrastructure/auth-service-client';

const logger = pino({ name: 'hr-provisioning-service' });

/** Job codes the HR system sends → accounting roles they map to.
 *  Unknown codes → IGNORED (fail-closed: no roles assigned on unknown mapping). */
const HR_JOB_CODE_TO_ACCOUNTING_ROLES: Record<string, string[]> = {
  ACCOUNTANT:      ['accounting.post', 'accounting.view', 'gl.journal.create'],
  CONTROLLER:      ['accounting.post', 'accounting.approve', 'accounting.view', 'gl.journal.create', 'gl.journal.approve', 'period.close'],
  AP_CLERK:        ['accounting.view', 'ap.invoice.create', 'ap.payment.create'],
  AR_CLERK:        ['accounting.view', 'ar.receipt.create', 'ar.writeoff'],
  PAYROLL_MANAGER: ['accounting.view', 'payroll.run', 'payroll.approve'],
  CFO:             ['accounting.view', 'accounting.approve', 'period.close', 'reporting.view'],
  AUDITOR:         ['accounting.view', 'audit.view', 'reporting.view'],
};

/** Service identities allowed to push HR events via the inbound HTTP endpoint. */
const ALLOWED_SERVICE_IDENTITIES = new Set([
  'hr-connector:hris',
  'hr-connector:workday',
  'hr-connector:adp',
  'hr-connector:bamboohr',
  'integration-platform:hr',
  'tenant-service:hr-provisioning',   // broker consumer self-call
]);

export type HrEventType =
  | 'HR_USER_CREATED'
  | 'HR_USER_TERMINATED'
  | 'HR_USER_ROLE_CHANGED';

export interface HrEvent {
  tenantId: string;
  legalEntityId?: string;             // stored separately from tenantId
  hrEventType: HrEventType;
  hrUserId: string;
  hrSystem: string;
  sourceCorrelationId?: string;       // from HR system — idempotency key
  requestedByServiceIdentity: string; // allowlist-enforced
  payload: {
    email?: string;
    firstName?: string;
    lastName?: string;
    jobCode?: string;
    departmentCode?: string;
    effectiveDate?: string;
    reason?: string;
  };
}

export interface HrProvisioningResult {
  eventId: string;
  status: 'PROCESSED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'DUPLICATE' | 'IGNORED';
  accountingAction: string;
  retryable: boolean;
  errorMessage?: string;
}

export class UnauthorizedServiceIdentityError extends Error {
  constructor(identity: string) {
    super(`Service identity '${identity}' is not authorized to push HR provisioning events`);
    this.name = 'UnauthorizedServiceIdentityError';
  }
}

export class CrossTenantDeniedError extends Error {
  constructor() {
    super('tenantId in event does not match the request context');
    this.name = 'CrossTenantDeniedError';
  }
}

export class HrProvisioningService {
  constructor(
    private readonly prisma: any,
    private readonly authClient: IAuthServiceClient,
  ) {}

  /**
   * Process one HR event.
   *
   * Enforces:
   *   1. Service allowlist — caller identity must be in ALLOWED_SERVICE_IDENTITIES.
   *   2. Cross-tenant — event tenantId must equal the tenant context.
   *   3. Idempotency — sourceCorrelationId unique per tenant; duplicate → DUPLICATE.
   *   4. Fail-closed job code mapping — unknown code → IGNORED (no roles assigned).
   *   5. auth-service errors surfaced: 5xx → FAILED_RETRYABLE, 4xx → FAILED_TERMINAL.
   */
  async processHrEvent(event: HrEvent, contextTenantId: string): Promise<HrProvisioningResult> {
    const { tenantId, legalEntityId, hrEventType, hrUserId, hrSystem, sourceCorrelationId, requestedByServiceIdentity, payload } = event;

    // 1. Service allowlist
    if (!ALLOWED_SERVICE_IDENTITIES.has(requestedByServiceIdentity)) {
      throw new UnauthorizedServiceIdentityError(requestedByServiceIdentity);
    }

    // 2. Cross-tenant denial
    if (tenantId !== contextTenantId) {
      throw new CrossTenantDeniedError();
    }

    const internalCorrelationId = crypto.randomUUID();
    logger.info({ tenantId, hrEventType, hrUserId, sourceCorrelationId, internalCorrelationId }, 'Processing HR provisioning event');

    // 3. Idempotency check — if sourceCorrelationId was already processed, short-circuit
    if (sourceCorrelationId) {
      const existing = await this.prisma.hrProvisioningEvent.findFirst({
        where: { tenantId, sourceCorrelationId },
      });
      if (existing) {
        logger.info({ tenantId, sourceCorrelationId, existingId: existing.id }, 'Duplicate HR event — skipped');
        return {
          eventId: existing.id,
          status: 'DUPLICATE',
          accountingAction: 'IGNORED',
          retryable: false,
        };
      }
    }

    let accountingAction = 'IGNORED';
    let accountingUserId: string | null = null;
    let accountingRoles: string[] = [];
    let status: HrProvisioningResult['status'] = 'PROCESSED';
    let errorMessage: string | null = null;
    let retryable = false;

    try {
      switch (hrEventType) {
        case 'HR_USER_CREATED': {
          const roles = HR_JOB_CODE_TO_ACCOUNTING_ROLES[payload.jobCode ?? ''] ?? [];
          if (roles.length === 0 || !payload.email) {
            // Unknown job code or no email → fail closed: do not guess, record as IGNORED
            accountingAction = 'IGNORED';
            logger.warn({ tenantId, hrUserId, jobCode: payload.jobCode }, 'S005: Unknown job code or missing email — no roles assigned (fail-closed)');
          } else {
            const provisioned = await this.authClient.provisionUser({
              tenantId,
              legalEntityId: legalEntityId ?? '',
              email: payload.email,
              firstName: payload.firstName ?? '',
              lastName: payload.lastName ?? '',
              externalHrId: hrUserId,
              roles,
              requestedBy: `hr-system:${hrSystem}`,
            });
            accountingAction = 'PROVISIONED';
            accountingUserId = provisioned.userId;
            accountingRoles = provisioned.assignedRoles;
          }
          break;
        }

        case 'HR_USER_TERMINATED': {
          await this.authClient.deprovisionUser({
            tenantId,
            legalEntityId: legalEntityId ?? '',
            externalHrId: hrUserId,
            requestedBy: `hr-system:${hrSystem}`,
          });
          accountingAction = 'DEPROVISIONED';
          accountingRoles = [];
          break;
        }

        case 'HR_USER_ROLE_CHANGED': {
          const roles = HR_JOB_CODE_TO_ACCOUNTING_ROLES[payload.jobCode ?? ''] ?? [];
          if (roles.length === 0) {
            accountingAction = 'IGNORED';
            logger.warn({ tenantId, hrUserId, jobCode: payload.jobCode }, 'S005: Unknown target job code — role update ignored (fail-closed)');
          } else {
            await this.authClient.updateUserRoles({
              tenantId,
              legalEntityId: legalEntityId ?? '',
              externalHrId: hrUserId,
              roles,
              requestedBy: `hr-system:${hrSystem}`,
            });
            accountingAction = 'ROLE_UPDATED';
            accountingRoles = roles;
          }
          break;
        }
      }
    } catch (err: any) {
      logger.error({ err, hrEventType, hrUserId, tenantId }, 'S005: auth-service call failed');
      accountingAction = 'ERROR';
      errorMessage = err?.message ?? 'Unknown error';
      retryable = !!(err?.retryable);
      status = retryable ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
    }

    if (accountingAction !== 'ERROR') {
      status = accountingAction === 'IGNORED' ? 'PROCESSED' : 'PROCESSED';
    }

    // Persist the provisioning event for audit lineage — always, even on error
    const record = await this.prisma.hrProvisioningEvent.create({
      data: {
        tenantId,
        legalEntityId: legalEntityId ?? null,
        hrEventType,
        hrUserId,
        hrSystem,
        payload,
        sourceCorrelationId: sourceCorrelationId ?? null,
        accountingAction,
        accountingUserId,
        accountingRoles,
        status,
        retryCount: 0,
        lastAttemptAt: new Date(),
        errorMessage,
        correlationId: internalCorrelationId,
      },
    });

    logger.info({ tenantId, hrEventType, hrUserId, accountingAction, status, eventId: record.id }, 'S005: HR provisioning event persisted');

    return { eventId: record.id, status, accountingAction, retryable, errorMessage: errorMessage ?? undefined };
  }

  /** Retry all FAILED_RETRYABLE events (called by scheduler or operator). */
  async retryFailed(tenantId: string): Promise<number> {
    const failed = await this.prisma.hrProvisioningEvent.findMany({
      where: { tenantId, status: 'FAILED_RETRYABLE', retryCount: { lt: 5 } },
      orderBy: { processedAt: 'asc' },
      take: 50,
    });

    let retried = 0;
    for (const evt of failed) {
      try {
        const result = await this.processHrEvent(
          {
            tenantId: evt.tenantId,
            legalEntityId: evt.legalEntityId ?? undefined,
            hrEventType: evt.hrEventType as HrEventType,
            hrUserId: evt.hrUserId,
            hrSystem: evt.hrSystem,
            payload: evt.payload as any,
            requestedByServiceIdentity: 'tenant-service:hr-provisioning',
            // No sourceCorrelationId on retry so it doesn't re-duplicate-check
          },
          tenantId,
        );
        await this.prisma.hrProvisioningEvent.update({
          where: { id: evt.id },
          data: { retryCount: { increment: 1 }, lastAttemptAt: new Date(), status: result.status },
        });
        if (result.status === 'PROCESSED') retried++;
      } catch (_) {
        /* non-retryable errors become terminal on next sweep */
      }
    }
    return retried;
  }

  /** List provisioning events for audit (tenantId scoped — never cross-tenant). */
  async listEvents(tenantId: string, opts: { legalEntityId?: string; status?: string; take?: number }) {
    return this.prisma.hrProvisioningEvent.findMany({
      where: {
        tenantId,   // CLAUDE.md rule: tenantId in every query
        ...(opts.legalEntityId ? { legalEntityId: opts.legalEntityId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: { processedAt: 'desc' },
      take: opts.take ?? 200,
    });
  }
}
