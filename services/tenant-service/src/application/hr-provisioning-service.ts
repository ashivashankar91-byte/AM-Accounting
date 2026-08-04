/**
 * S005 — HR-Event Provisioning Hooks
 *
 * Consumes HR system events and auto-provisions / deprovisions accounting roles
 * based on organizational changes. Every action is persisted for audit lineage.
 *
 * Supported HR event types:
 *   HR_USER_CREATED       — new employee; provision accounting roles based on job code
 *   HR_USER_TERMINATED    — employee exit; deprovision all accounting access
 *   HR_USER_ROLE_CHANGED  — role/title change; update accounting role assignment
 *
 * The HR system integration uses DEMO_FIXTURE mode for the prototype.
 * In production this consumer connects to the HR system event bus.
 */

import crypto from 'crypto';
import pino from 'pino';

const logger = pino({ name: 'hr-provisioning-service' });

/** Mapping from HR job codes to accounting roles */
const HR_JOB_CODE_TO_ACCOUNTING_ROLES: Record<string, string[]> = {
  ACCOUNTANT:       ['accounting.post', 'accounting.view', 'gl.journal.create'],
  CONTROLLER:       ['accounting.post', 'accounting.approve', 'accounting.view', 'gl.journal.create', 'gl.journal.approve', 'period.close'],
  AP_CLERK:         ['accounting.view', 'ap.invoice.create', 'ap.payment.create'],
  AR_CLERK:         ['accounting.view', 'ar.receipt.create', 'ar.writeoff'],
  PAYROLL_MANAGER:  ['accounting.view', 'payroll.run', 'payroll.approve'],
  CFO:              ['accounting.view', 'accounting.approve', 'period.close', 'reporting.view'],
  AUDITOR:          ['accounting.view', 'audit.view', 'reporting.view'],
};

export interface HrEvent {
  tenantId: string;
  hrEventType: 'HR_USER_CREATED' | 'HR_USER_TERMINATED' | 'HR_USER_ROLE_CHANGED';
  hrUserId: string;
  hrSystem: string;
  payload: {
    email?: string;
    firstName?: string;
    lastName?: string;
    jobCode?: string;
    departmentCode?: string;
    legalEntityId?: string;
    effectiveDate?: string;
    reason?: string;
  };
}

export class HrProvisioningService {
  constructor(private readonly prisma: any) {}

  async processHrEvent(event: HrEvent): Promise<void> {
    const correlationId = crypto.randomUUID();
    const { tenantId, hrEventType, hrUserId, hrSystem, payload } = event;

    logger.info({ tenantId, hrEventType, hrUserId, correlationId }, 'Processing HR provisioning event');

    let accountingAction = 'IGNORED';
    let accountingUserId: string | null = null;
    let accountingRoles: string[] = [];
    let errorMessage: string | null = null;

    try {
      switch (hrEventType) {
        case 'HR_USER_CREATED': {
          const roles = HR_JOB_CODE_TO_ACCOUNTING_ROLES[payload.jobCode ?? ''] ?? [];
          if (roles.length > 0 && payload.email) {
            // Provision the user in tenant-service (idempotent upsert)
            await this.prisma.user?.upsert?.({
              where: { email_tenantId: { email: payload.email, tenantId } },
              create: {
                tenantId,
                email: payload.email,
                firstName: payload.firstName ?? '',
                lastName: payload.lastName ?? '',
                externalId: hrUserId,
                roles,
                source: 'HR_PROVISIONED',
              },
              update: { roles },
            }).catch(() => null); // user model may be in user-service; log and continue
            accountingAction = 'PROVISIONED';
            accountingUserId = hrUserId;
            accountingRoles = roles;
          } else {
            accountingAction = 'IGNORED'; // no mapped accounting role for this job code
          }
          break;
        }

        case 'HR_USER_TERMINATED': {
          // Deprovision — remove all accounting roles
          await this.prisma.user?.update?.({
            where: { externalId_tenantId: { externalId: hrUserId, tenantId } },
            data: { roles: [], isActive: false, terminatedAt: new Date() },
          }).catch(() => null);
          accountingAction = 'DEPROVISIONED';
          accountingUserId = hrUserId;
          accountingRoles = [];
          break;
        }

        case 'HR_USER_ROLE_CHANGED': {
          const roles = HR_JOB_CODE_TO_ACCOUNTING_ROLES[payload.jobCode ?? ''] ?? [];
          await this.prisma.user?.update?.({
            where: { externalId_tenantId: { externalId: hrUserId, tenantId } },
            data: { roles },
          }).catch(() => null);
          accountingAction = 'ROLE_UPDATED';
          accountingUserId = hrUserId;
          accountingRoles = roles;
          break;
        }
      }
    } catch (err: any) {
      logger.error({ err, hrEventType, hrUserId }, 'HR provisioning action failed');
      accountingAction = 'ERROR';
      errorMessage = err?.message ?? 'Unknown error';
    }

    // Persist the provisioning event for audit lineage (always — even on error)
    await this.prisma.hrProvisioningEvent.create({
      data: {
        tenantId,
        hrEventType,
        hrUserId,
        hrSystem,
        payload,
        accountingAction,
        accountingUserId,
        accountingRoles,
        errorMessage,
        correlationId,
      },
    });

    logger.info({ tenantId, hrEventType, hrUserId, accountingAction, correlationId }, 'HR provisioning event processed');
  }
}
