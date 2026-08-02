import { inject, injectable } from 'tsyringe';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';

// ── Constants ────────────────────────────────────────────────────────────────

/** Approved customer-type values (matches the pre-existing S5-01 zod enum). */
export const CUSTOMER_TYPE_VALUES = ['Individual', 'Business', 'Government', 'Fleet'] as const;
export const CREDIT_TERMS_VALUES = ['COD', 'Net10', 'Net15', 'Net30', 'Net45', 'Net60'] as const;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CustomerFieldsDTO {
  customerName: string;
  customerType?: string;
  salespersonCode?: string;
  arAccountOverride?: string;
  companyNumber?: string;
  taxId?: string;
  taxExemptStatus?: boolean;
  taxExemptCertNumber?: string;
  taxExemptExpiration?: Date;
  creditLimit?: number;
  creditTerms?: string;
  preferredContactMethod?: string;
  doNotSolicit?: boolean;
  doNotMail?: boolean;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  phone2?: string;
  fax?: string;
  email?: string;
  secondaryStreet?: string;
  secondaryCity?: string;
  secondaryState?: string;
  secondaryZip?: string;
  secondaryCountry?: string;
  addressLabel?: string;
  flagAR?: boolean;
  flagVehicle?: boolean;
  flagParts?: boolean;
  flagService?: boolean;
  flagFI?: boolean;
  employeeFlag?: boolean;
  notes?: unknown;
}

export interface CreateCustomerDTO extends CustomerFieldsDTO {
  tenantId: string;
  customerNumber?: string;
  /** Present only when the caller has already been shown the duplicate
   * warning and chosen to proceed. Permission (AR_CUSTOMER_DUPLICATE_OVERRIDE)
   * is verified by the route layer BEFORE this is passed in. */
  override?: { reason: string };
}

export interface UpdateCustomerDTO extends Partial<CustomerFieldsDTO> {
  version: number;
}

export interface DuplicateCheckDTO {
  tenantId: string;
  customerName?: string;
  email?: string;
  phone?: string;
  zip?: string;
  /** Excluded from its own duplicate check (editing an existing customer). */
  excludeCustomerId?: string;
}

export interface InactivateCustomerDTO {
  version: number;
  reason: string;
}

export interface ReactivateCustomerDTO {
  version: number;
}

export interface DeleteCustomerDTO {
  version: number;
  reason?: string;
}

export interface CustomerListQuery {
  tenantId: string;
  search?: string;
  searchMode?: 'name' | 'number' | 'phone';
  /** ACTIVE | INACTIVE | undefined = ACTIVE+INACTIVE (excludes DELETED always) */
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface DuplicateCandidate {
  customerId: string;
  customerNumber: string;
  customerName: string;
  status: string;
  matchedSignals: string[];
}

export interface CreditHoldDTO {
  version: number;
  reason: string;
}

export interface CreditReleaseDTO {
  version: number;
}

export interface CreditProfileUpdateDTO {
  version: number;
  creditLimit?: number;
  creditTerms?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Customer not found: ${id}`);
    this.name = 'CustomerNotFoundError';
  }
}

export class CustomerConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CustomerConflictError';
  }
}

export class CustomerValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CustomerValidationError';
  }
}

export class CustomerHasReferencesError extends Error {
  constructor(public readonly references: Record<string, number>) {
    super('Customer is referenced by existing transactions and cannot be deleted');
    this.name = 'CustomerHasReferencesError';
  }
}

export class DuplicateCustomerAcknowledgementRequiredError extends Error {
  constructor(public readonly candidates: DuplicateCandidate[]) {
    super('Potential duplicate customer(s) found — acknowledgement with a reason is required to proceed');
    this.name = 'DuplicateCustomerAcknowledgementRequiredError';
  }
}

// ── Normalization helpers ────────────────────────────────────────────────────

function normalizeCustomerNumber(v: string): string {
  return v.trim().toUpperCase();
}
function normalizeCustomerName(v: string): string {
  return v.trim().toLowerCase();
}
function normalizeEmail(v?: string | null): string | null {
  const t = v?.trim().toLowerCase();
  return t ? t : null;
}
function normalizePhone(v?: string | null): string | null {
  const digits = v?.replace(/\D/g, '') ?? '';
  return digits ? digits : null;
}

/** Strips internal comparison columns from a raw Customer row before it is
 * ever sent in an API response. */
export function toSafeCustomer(c: any) {
  if (!c) return c;
  const { normalizedCustomerNumber, normalizedCustomerName, normalizedEmail, normalizedPhone, ...rest } = c;
  return rest;
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class CustomerService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(query: CustomerListQuery) {
    const { tenantId, search, searchMode, status, page = 1, pageSize = 50 } = query;

    const where: any = { tenantId };
    // Default APIs treat logically deleted customers as not found — never
    // included unless explicitly asked for via status=DELETED.
    if (status) {
      where.status = status;
    } else {
      where.status = { in: ['ACTIVE', 'INACTIVE'] };
    }
    if (search) {
      const q = search.trim();
      if (searchMode === 'number') {
        where.customerNumber = { contains: q, mode: 'insensitive' };
      } else if (searchMode === 'phone') {
        where.OR = [{ phone: { contains: q } }, { phone2: { contains: q } }];
      } else {
        where.customerName = { contains: q, mode: 'insensitive' };
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: [{ status: 'asc' }, { customerName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items: items.map(toSafeCustomer), total, page, pageSize };
  }

  async getById(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!customer) throw new CustomerNotFoundError(id);
    return toSafeCustomer(customer);
  }

  /** Pure query — no mutation, no permission beyond ar.customer.view/create. */
  async checkDuplicates(dto: DuplicateCheckDTO): Promise<DuplicateCandidate[]> {
    const { tenantId, excludeCustomerId } = dto;
    const normName = dto.customerName ? normalizeCustomerName(dto.customerName) : undefined;
    const normEmail = normalizeEmail(dto.email);
    const normPhone = normalizePhone(dto.phone);

    const or: any[] = [];
    if (normName && dto.zip) or.push({ normalizedCustomerName: normName, zip: dto.zip });
    if (normEmail) or.push({ normalizedEmail: normEmail });
    if (normPhone) or.push({ normalizedPhone: normPhone });
    if (or.length === 0) return [];

    const candidates = await this.prisma.customer.findMany({
      where: {
        tenantId, // never compares across tenants
        status: { not: 'DELETED' },
        ...(excludeCustomerId ? { NOT: { id: excludeCustomerId } } : {}),
        OR: or,
      },
      select: { id: true, customerNumber: true, customerName: true, status: true, normalizedCustomerName: true, normalizedEmail: true, normalizedPhone: true, zip: true },
    });

    return candidates.map((c: any) => {
      const matchedSignals: string[] = [];
      if (normName && dto.zip && c.normalizedCustomerName === normName && c.zip === dto.zip) matchedSignals.push('NAME_AND_POSTAL_CODE');
      if (normEmail && c.normalizedEmail === normEmail) matchedSignals.push('EMAIL');
      if (normPhone && c.normalizedPhone === normPhone) matchedSignals.push('PHONE');
      return {
        customerId: c.id,
        customerNumber: c.customerNumber,
        customerName: c.customerName,
        status: c.status,
        matchedSignals,
      };
    });
  }

  async create(dto: CreateCustomerDTO, actor = 'system', correlationId?: string) {
    if (dto.customerType && !(CUSTOMER_TYPE_VALUES as readonly string[]).includes(dto.customerType)) {
      throw new CustomerValidationError('VALIDATION_ERROR', `Unsupported customer type: ${dto.customerType}`);
    }
    if (dto.creditTerms && !(CREDIT_TERMS_VALUES as readonly string[]).includes(dto.creditTerms)) {
      throw new CustomerValidationError('VALIDATION_ERROR', `Unsupported credit terms: ${dto.creditTerms}`);
    }

    const normalizedCustomerName = normalizeCustomerName(dto.customerName);
    const normalizedEmail = normalizeEmail(dto.email);
    const normalizedPhone = normalizePhone(dto.phone);

    // Hard block: same tenant + same normalized customer number.
    if (dto.customerNumber) {
      const normNumber = normalizeCustomerNumber(dto.customerNumber);
      const exists = await this.prisma.customer.findFirst({
        where: { tenantId: dto.tenantId, normalizedCustomerNumber: normNumber },
      });
      if (exists) {
        throw new CustomerConflictError('CUSTOMER_NUMBER_ALREADY_EXISTS', `Customer number '${dto.customerNumber}' already exists`);
      }
    }

    // Candidate (warning-level) duplicate signals.
    const candidates = await this.checkDuplicates({
      tenantId: dto.tenantId,
      customerName: dto.customerName,
      email: dto.email,
      phone: dto.phone,
      zip: dto.zip,
    });

    if (candidates.length > 0 && !dto.override) {
      throw new DuplicateCustomerAcknowledgementRequiredError(candidates);
    }

    const customer = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      const customerNumber = dto.customerNumber
        ? normalizeCustomerNumber(dto.customerNumber)
        : await this._nextCustomerNumber(tx, dto.tenantId);

      const now = new Date();
      const c = await tx.customer.create({
        data: {
          tenantId: dto.tenantId,
          customerNumber,
          normalizedCustomerNumber: normalizeCustomerNumber(customerNumber),
          customerName: dto.customerName,
          normalizedCustomerName,
          customerType: dto.customerType ?? 'Individual',
          salespersonCode: dto.salespersonCode ?? null,
          arAccountOverride: dto.arAccountOverride ?? null,
          companyNumber: dto.companyNumber ?? null,
          taxId: dto.taxId ?? null,
          taxExemptStatus: dto.taxExemptStatus ?? false,
          taxExemptCertNumber: dto.taxExemptCertNumber ?? null,
          taxExemptExpiration: dto.taxExemptExpiration ?? null,
          creditLimit: dto.creditLimit !== undefined ? String(dto.creditLimit) : undefined,
          creditTerms: dto.creditTerms ?? 'Net30',
          creditProfileEffectiveDate: now,
          preferredContactMethod: dto.preferredContactMethod ?? 'Phone',
          doNotSolicit: dto.doNotSolicit ?? false,
          doNotMail: dto.doNotMail ?? false,
          address1: dto.address1 ?? null,
          address2: dto.address2 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          zip: dto.zip ?? null,
          country: dto.country ?? 'US',
          phone: dto.phone ?? null,
          normalizedPhone,
          phone2: dto.phone2 ?? null,
          fax: dto.fax ?? null,
          email: dto.email ?? null,
          normalizedEmail,
          secondaryStreet: dto.secondaryStreet ?? null,
          secondaryCity: dto.secondaryCity ?? null,
          secondaryState: dto.secondaryState ?? null,
          secondaryZip: dto.secondaryZip ?? null,
          secondaryCountry: dto.secondaryCountry ?? null,
          addressLabel: dto.addressLabel ?? null,
          flagAR: dto.flagAR ?? false,
          flagVehicle: dto.flagVehicle ?? false,
          flagParts: dto.flagParts ?? false,
          flagService: dto.flagService ?? false,
          flagFI: dto.flagFI ?? false,
          employeeFlag: dto.employeeFlag ?? false,
          notes: dto.notes as any ?? null,
          status: 'ACTIVE',
          isActive: true,
          version: 1,
        },
      });

      await this._audit(dto.tenantId, 'Customer', c.id, 'CREATED', null, c, actor, tx, correlationId);

      if (candidates.length > 0 && dto.override) {
        await tx.arCustomerDuplicateAcknowledgement.create({
          data: {
            tenantId: dto.tenantId,
            customerId: c.id,
            matchedSignals: candidates as any,
            reason: dto.override.reason,
            actor,
            correlationId: correlationId ?? null,
          },
        });
        await this._audit(dto.tenantId, 'Customer', c.id, 'DUPLICATE_WARNING_ACKNOWLEDGED', null, {
          candidateIds: candidates.map(cand => cand.customerId),
          reason: dto.override.reason,
        }, actor, tx, correlationId);
      }

      return c;
    });

    await this._writeOutbox(dto.tenantId, 'CUSTOMER_CREATED', customer.id, { customerNumber: customer.customerNumber, customerName: customer.customerName });

    return toSafeCustomer(customer);
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new CustomerNotFoundError(id);

    if (current.version !== dto.version) {
      throw new CustomerConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    if (current.status === 'INACTIVE') {
      throw new CustomerValidationError('CUSTOMER_INACTIVE', 'Cannot edit an inactive customer — reactivate it first');
    }
    if (dto.customerType && !(CUSTOMER_TYPE_VALUES as readonly string[]).includes(dto.customerType)) {
      throw new CustomerValidationError('VALIDATION_ERROR', `Unsupported customer type: ${dto.customerType}`);
    }
    if (dto.creditTerms && !(CREDIT_TERMS_VALUES as readonly string[]).includes(dto.creditTerms)) {
      throw new CustomerValidationError('VALIDATION_ERROR', `Unsupported credit terms: ${dto.creditTerms}`);
    }

    const data: any = { version: current.version + 1 };
    let creditProfileChanged = false;
    if (dto.customerName !== undefined) { data.customerName = dto.customerName; data.normalizedCustomerName = normalizeCustomerName(dto.customerName); }
    if (dto.customerType !== undefined) data.customerType = dto.customerType;
    if (dto.salespersonCode !== undefined) data.salespersonCode = dto.salespersonCode;
    if (dto.arAccountOverride !== undefined) data.arAccountOverride = dto.arAccountOverride;
    if (dto.companyNumber !== undefined) data.companyNumber = dto.companyNumber;
    if (dto.taxId !== undefined) data.taxId = dto.taxId;
    if (dto.taxExemptStatus !== undefined) data.taxExemptStatus = dto.taxExemptStatus;
    if (dto.taxExemptCertNumber !== undefined) data.taxExemptCertNumber = dto.taxExemptCertNumber;
    if (dto.taxExemptExpiration !== undefined) data.taxExemptExpiration = dto.taxExemptExpiration;
    if (dto.creditLimit !== undefined) { data.creditLimit = String(dto.creditLimit); creditProfileChanged = true; }
    if (dto.creditTerms !== undefined) { data.creditTerms = dto.creditTerms; creditProfileChanged = true; }
    if (dto.preferredContactMethod !== undefined) data.preferredContactMethod = dto.preferredContactMethod;
    if (dto.doNotSolicit !== undefined) data.doNotSolicit = dto.doNotSolicit;
    if (dto.doNotMail !== undefined) data.doNotMail = dto.doNotMail;
    if (dto.address1 !== undefined) data.address1 = dto.address1;
    if (dto.address2 !== undefined) data.address2 = dto.address2;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.zip !== undefined) data.zip = dto.zip;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.phone !== undefined) { data.phone = dto.phone; data.normalizedPhone = normalizePhone(dto.phone); }
    if (dto.phone2 !== undefined) data.phone2 = dto.phone2;
    if (dto.fax !== undefined) data.fax = dto.fax;
    if (dto.email !== undefined) { data.email = dto.email; data.normalizedEmail = normalizeEmail(dto.email); }
    if (dto.secondaryStreet !== undefined) data.secondaryStreet = dto.secondaryStreet;
    if (dto.secondaryCity !== undefined) data.secondaryCity = dto.secondaryCity;
    if (dto.secondaryState !== undefined) data.secondaryState = dto.secondaryState;
    if (dto.secondaryZip !== undefined) data.secondaryZip = dto.secondaryZip;
    if (dto.secondaryCountry !== undefined) data.secondaryCountry = dto.secondaryCountry;
    if (dto.addressLabel !== undefined) data.addressLabel = dto.addressLabel;
    if (dto.flagAR !== undefined) data.flagAR = dto.flagAR;
    if (dto.flagVehicle !== undefined) data.flagVehicle = dto.flagVehicle;
    if (dto.flagParts !== undefined) data.flagParts = dto.flagParts;
    if (dto.flagService !== undefined) data.flagService = dto.flagService;
    if (dto.flagFI !== undefined) data.flagFI = dto.flagFI;
    if (dto.employeeFlag !== undefined) data.employeeFlag = dto.employeeFlag;
    if (dto.notes !== undefined) data.notes = dto.notes as any;
    if (creditProfileChanged) data.creditProfileEffectiveDate = new Date();

    const customer = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const c = await tx.customer.update({ where: { id }, data });
      await this._audit(tenantId, 'Customer', id, 'UPDATED', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'CUSTOMER_UPDATED', id, { changes: Object.keys(data).filter(k => k !== 'version') });

    return toSafeCustomer(customer);
  }

  async inactivate(tenantId: string, id: string, dto: InactivateCustomerDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new CustomerNotFoundError(id);
    if (!dto.reason?.trim()) throw new CustomerValidationError('REASON_REQUIRED', 'A reason is required to inactivate a customer');
    if (current.status === 'INACTIVE') throw new CustomerValidationError('ALREADY_INACTIVE', 'Customer is already inactive');
    if (current.version !== dto.version) {
      throw new CustomerConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const customer = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const c = await tx.customer.update({
        where: { id },
        data: {
          status: 'INACTIVE',
          isActive: false,
          version: current.version + 1,
          inactiveReason: dto.reason,
          inactivatedAt: new Date(),
          inactivatedBy: actor,
        },
      });
      await this._audit(tenantId, 'Customer', id, 'INACTIVATED', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'CUSTOMER_INACTIVATED', id, { reason: dto.reason, actor });
    return toSafeCustomer(customer);
  }

  async reactivate(tenantId: string, id: string, dto: ReactivateCustomerDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new CustomerNotFoundError(id);
    if (current.status === 'ACTIVE') throw new CustomerValidationError('ALREADY_ACTIVE', 'Customer is already active');
    if (current.version !== dto.version) {
      throw new CustomerConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const customer = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const c = await tx.customer.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          isActive: true,
          version: current.version + 1,
          reactivatedAt: new Date(),
          reactivatedBy: actor,
        },
      });
      await this._audit(tenantId, 'Customer', id, 'REACTIVATED', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'CUSTOMER_REACTIVATED', id, { actor });
    return toSafeCustomer(customer);
  }

  /**
   * Guarded logical delete (never a physical row delete, mirrors BR-AP-001
   * as applied to the customer master). Reference guard is a placeholder for
   * now: no invoice/receipt/schedule table references a customer anywhere in
   * this repository yet (S047-S051 are not implemented) — always resolves
   * to zero references. Documented as a known limitation, not a claim that
   * customer references are comprehensively checked; a follow-up story must
   * extend this guard the moment S047+ introduces a real FK to Customer.
   */
  async delete(tenantId: string, id: string, dto: DeleteCustomerDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new CustomerNotFoundError(id);
    if (current.version !== dto.version) {
      throw new CustomerConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const customer = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const c = await tx.customer.update({
        where: { id },
        data: {
          status: 'DELETED',
          isActive: false,
          version: current.version + 1,
          deletedAt: new Date(),
          deletedBy: actor,
          deleteReason: dto.reason ?? null,
        },
      });
      await this._audit(tenantId, 'Customer', id, 'DELETED', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'CUSTOMER_DELETED', id, { reason: dto.reason ?? null, actor });
    return toSafeCustomer(customer);
  }

  /** New-charge eligibility: ACTIVE status AND not on credit hold. Denials
   * are audited (mirrors S036A's AP_VENDOR_ELIGIBILITY_DENIED pattern). */
  async eligibility(tenantId: string, id: string, actor = 'system', correlationId?: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!customer || customer.status === 'DELETED') throw new CustomerNotFoundError(id);

    if (customer.status === 'ACTIVE' && !customer.creditHold) {
      return { eligible: true, status: customer.status, creditHold: false, reason: null };
    }

    const reason = customer.status !== 'ACTIVE'
      ? (customer.status === 'INACTIVE'
        ? 'Customer is inactive — new charges are not permitted'
        : 'Customer is deleted — new charges are not permitted')
      : (customer.creditHoldReason ?? 'Customer is on credit hold — new charges are not permitted');
    await this._audit(tenantId, 'Customer', id, 'ELIGIBILITY_DENIED', null, { status: customer.status, creditHold: customer.creditHold, reason }, actor, this.prisma, correlationId);
    return { eligible: false, status: customer.status, creditHold: !!customer.creditHold, reason };
  }

  // ── Credit profile ─────────────────────────────────────────────────────────

  /** Sets a credit hold. Requires a reason and current version. A distinct
   * permission (ar.customer.credit_hold) gates this — separate from general
   * edit — because a credit hold blocks new-charge eligibility platform-wide. */
  async setCreditHold(tenantId: string, id: string, dto: CreditHoldDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new CustomerNotFoundError(id);
    if (!dto.reason?.trim()) throw new CustomerValidationError('REASON_REQUIRED', 'A reason is required to place a credit hold');
    if (current.creditHold) throw new CustomerValidationError('ALREADY_ON_HOLD', 'Customer is already on credit hold');
    if (current.version !== dto.version) {
      throw new CustomerConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const customer = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const c = await tx.customer.update({
        where: { id },
        data: {
          creditHold: true,
          creditHoldReason: dto.reason,
          creditHoldSetAt: new Date(),
          creditHoldSetBy: actor,
          creditHoldClearedAt: null,
          creditHoldClearedBy: null,
          creditProfileEffectiveDate: new Date(),
          version: current.version + 1,
        },
      });
      await this._audit(tenantId, 'Customer', id, 'CREDIT_HOLD_SET', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'CUSTOMER_CREDIT_HOLD_SET', id, { reason: dto.reason, actor });
    return toSafeCustomer(customer);
  }

  /** Releases a credit hold. Requires current version; a reason is not
   * mandatory to release (mirrors reactivate — mandatory reason is required
   * only going ON hold/inactive, matching the inactivate/reactivate
   * asymmetry already established for the vendor master). */
  async releaseCreditHold(tenantId: string, id: string, dto: CreditReleaseDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.customer.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new CustomerNotFoundError(id);
    if (!current.creditHold) throw new CustomerValidationError('NOT_ON_HOLD', 'Customer is not on credit hold');
    if (current.version !== dto.version) {
      throw new CustomerConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const customer = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const c = await tx.customer.update({
        where: { id },
        data: {
          creditHold: false,
          creditHoldClearedAt: new Date(),
          creditHoldClearedBy: actor,
          creditProfileEffectiveDate: new Date(),
          version: current.version + 1,
        },
      });
      await this._audit(tenantId, 'Customer', id, 'CREDIT_HOLD_RELEASED', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'CUSTOMER_CREDIT_HOLD_RELEASED', id, { actor });
    return toSafeCustomer(customer);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _nextCustomerNumber(tx: any, tenantId: string): Promise<string> {
    await tx.arCustomerNumberCounter.upsert({
      where: { tenantId },
      create: { tenantId, nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
    });
    // Read-after-write within the same transaction: Postgres row-lock on the
    // upsert above serializes concurrent callers, so this read always sees
    // the value this call just reserved.
    const row = await tx.arCustomerNumberCounter.findUnique({ where: { tenantId } });
    const assigned = row.nextNumber - 1;
    return String(assigned).padStart(6, '0');
  }

  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor: string,
    tx: any = this.prisma,
    correlationId?: string,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        tenantId, docType, docId, action,
        before: (before ?? undefined) as any, after: (after ?? undefined) as any,
        actor: actor ?? 'system',
        correlationId: correlationId ?? null,
      },
    });
  }

  private async _writeOutbox(tenantId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.outboxEvent.create({
        data: { tenantId, eventType, payload: { aggregateId, ...payload } },
      });
    } catch {
      // Non-fatal: log but don't fail the business operation
    }
  }
}
