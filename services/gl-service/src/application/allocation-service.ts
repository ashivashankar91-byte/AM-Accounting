/**
 * S033 — Allocation Entries
 *
 * Allocation templates define how a source account's balance is distributed
 * across N target accounts. The allocation engine creates a BALANCED journal
 * entry that debit-clears the source and credits the targets.
 *
 * Allocation basis: PERCENTAGE (Σ lines = 100%) | FIXED_AMOUNT | STATISTICAL
 *
 * Every allocation posts through the standard posting door (S013/S020).
 * No direct GL write — the engine creates a draft JE that is then submitted
 * and approved through the normal workflow.
 */

import Decimal from 'decimal.js';
import crypto from 'crypto';
import { TenantId } from '@amacc/shared-kernel';

export interface AllocationTemplateDTO {
  name: string;
  description?: string;
  sourceAccountId: string;
  allocationBasis: 'PERCENTAGE' | 'FIXED_AMOUNT';
  journalSource?: string;
  lines: AllocationLineDTO[];
}

export interface AllocationLineDTO {
  targetAccountId: string;
  allocationPct?: number;
  fixedAmount?: number;
  departmentCode?: string;
  description?: string;
}

export interface AllocationRunResult {
  journalEntryId: string;
  templateId: string;
  sourceAccountId: string;
  allocatedAmount: Decimal;
  lineCount: number;
}

export class AllocationService {
  constructor(
    private readonly prisma: any,
    private readonly glService: { createJournalEntry: Function },
  ) {}

  async createTemplate(dto: AllocationTemplateDTO, tenantId: TenantId, createdBy: string): Promise<any> {
    // Validate percentage sum
    if (dto.allocationBasis === 'PERCENTAGE') {
      const total = dto.lines.reduce((s, l) => s + (l.allocationPct ?? 0), 0);
      if (Math.abs(total - 100) > 0.001) {
        throw new Error(`Allocation lines must sum to 100% — got ${total}%`);
      }
    }

    return this.prisma.allocationTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        sourceAccountId: dto.sourceAccountId,
        allocationBasis: dto.allocationBasis,
        journalSource: dto.journalSource ?? 'ALLOCATION',
        createdBy,
        lines: {
          create: dto.lines.map((l, i) => ({
            tenantId,
            targetAccountId: l.targetAccountId,
            allocationPct: l.allocationPct,
            fixedAmount: l.fixedAmount,
            departmentCode: l.departmentCode,
            description: l.description,
            lineOrder: i,
          })),
        },
      },
      include: { lines: true },
    });
  }

  async listTemplates(tenantId: TenantId): Promise<any[]> {
    return this.prisma.allocationTemplate.findMany({
      where: { tenantId, isActive: true },
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(id: string, tenantId: TenantId): Promise<any> {
    const template = await this.prisma.allocationTemplate.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
    });
    if (!template) throw new Error(`Allocation template ${id} not found`);
    return template;
  }

  /**
   * Run an allocation: given a template and a source amount, create a balanced
   * draft journal entry that clears the source and credits the targets.
   *
   * The draft JE is returned — caller submits it for posting via the normal
   * DRAFT → PENDING_REVIEW → POSTED workflow.
   */
  async runAllocation(
    templateId: string,
    tenantId: TenantId,
    sourceAmount: Decimal,
    entryDate: Date,
    allocatedBy: string,
    description?: string,
  ): Promise<AllocationRunResult> {
    const template = await this.getTemplate(templateId, tenantId);

    if (sourceAmount.isZero()) {
      throw new Error('Cannot allocate a zero amount');
    }

    // Build journal lines
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];

    // Credit (or debit for negative allocation) the source account
    if (sourceAmount.gt(0)) {
      lines.push({ accountId: template.sourceAccountId, debit: 0, credit: sourceAmount.toNumber(), description: `Allocation source: ${template.name}` });
    } else {
      lines.push({ accountId: template.sourceAccountId, debit: sourceAmount.abs().toNumber(), credit: 0, description: `Allocation source: ${template.name}` });
    }

    // Distribute to target accounts
    let remaining = sourceAmount.abs();
    for (let i = 0; i < template.lines.length; i++) {
      const line = template.lines[i];
      let lineAmount: Decimal;

      if (template.allocationBasis === 'PERCENTAGE') {
        if (i === template.lines.length - 1) {
          // Last line gets the remainder to avoid rounding gaps
          lineAmount = remaining;
        } else {
          lineAmount = sourceAmount.abs().mul(new Decimal(line.allocationPct).div(100)).toDecimalPlaces(2);
          remaining = remaining.minus(lineAmount);
        }
      } else {
        lineAmount = new Decimal(line.fixedAmount ?? 0);
      }

      if (sourceAmount.gt(0)) {
        lines.push({ accountId: line.targetAccountId, debit: lineAmount.toNumber(), credit: 0, description: line.description ?? `Allocation to ${line.targetAccountId}` });
      } else {
        lines.push({ accountId: line.targetAccountId, debit: 0, credit: lineAmount.toNumber(), description: line.description ?? `Allocation to ${line.targetAccountId}` });
      }
    }

    // Create draft JE via standard path
    const je = await this.glService.createJournalEntry(
      {
        description: description ?? `Allocation: ${template.name}`,
        entryDate,
        source: template.journalSource,
        idempotencyKey: `allocation:${templateId}:${entryDate.toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
        lines,
      },
      tenantId,
    );

    return {
      journalEntryId: je.id,
      templateId,
      sourceAccountId: template.sourceAccountId,
      allocatedAmount: sourceAmount,
      lineCount: lines.length,
    };
  }
}
