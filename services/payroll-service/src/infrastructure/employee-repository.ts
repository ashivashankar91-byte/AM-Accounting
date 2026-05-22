import { PrismaClient } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';

export interface CreateEmployeeDto {
  employeeCode: string;
  firstName: string;
  lastName: string;
  department: string;
  payType: string;
  payRate?: number | null;
  commissionRate?: number | null;
  payFrequency?: string;
  federalFilingStatus?: string;
  stateCode?: string | null;
  federalAllowances?: number;
  stateAllowances?: number;
  hireDate: Date;
  defaultGlDept?: string | null;
  createdBy?: string;
}

export interface UpdateEmployeeDto {
  firstName?: string;
  lastName?: string;
  department?: string;
  payType?: string;
  payRate?: number | null;
  commissionRate?: number | null;
  payFrequency?: string;
  federalFilingStatus?: string;
  stateCode?: string | null;
  federalAllowances?: number;
  stateAllowances?: number;
  defaultGlDept?: string | null;
}

export interface IEmployeeRepository {
  findById(tenantId: TenantId, id: string): Promise<any | null>;
  findByCode(tenantId: TenantId, code: string): Promise<any | null>;
  findAll(tenantId: TenantId, filters?: { department?: string; isActive?: boolean }): Promise<any[]>;
  create(tenantId: TenantId, dto: CreateEmployeeDto): Promise<any>;
  update(tenantId: TenantId, id: string, dto: UpdateEmployeeDto): Promise<any>;
  terminate(tenantId: TenantId, id: string, terminationDate: Date): Promise<any>;
}

@injectable()
export class PrismaEmployeeRepository implements IEmployeeRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findById(tenantId: TenantId, id: string) {
    return this.prisma.employee.findFirst({ where: { id, tenantId } });
  }

  findByCode(tenantId: TenantId, code: string) {
    return this.prisma.employee.findUnique({ where: { tenantId_employeeCode: { tenantId, employeeCode: code } } });
  }

  findAll(tenantId: TenantId, filters?: { department?: string; isActive?: boolean }) {
    return this.prisma.employee.findMany({
      where: { tenantId, ...(filters?.department && { department: filters.department }), ...(filters?.isActive !== undefined && { isActive: filters.isActive }) },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  create(tenantId: TenantId, dto: CreateEmployeeDto) {
    return this.prisma.employee.create({
      data: {
        tenantId,
        employeeCode: dto.employeeCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        department: dto.department,
        payType: dto.payType,
        payRate: dto.payRate != null ? dto.payRate : undefined,
        commissionRate: dto.commissionRate != null ? dto.commissionRate : undefined,
        payFrequency: dto.payFrequency ?? 'BI_WEEKLY',
        federalFilingStatus: dto.federalFilingStatus ?? 'SINGLE',
        stateCode: dto.stateCode ?? null,
        federalAllowances: dto.federalAllowances ?? 0,
        stateAllowances: dto.stateAllowances ?? 0,
        hireDate: dto.hireDate,
        defaultGlDept: dto.defaultGlDept ?? null,
      },
    });
  }

  update(tenantId: TenantId, id: string, dto: UpdateEmployeeDto) {
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.department !== undefined && { department: dto.department }),
        ...(dto.payType !== undefined && { payType: dto.payType }),
        ...(dto.payRate !== undefined && { payRate: dto.payRate != null ? dto.payRate : null }),
        ...(dto.commissionRate !== undefined && { commissionRate: dto.commissionRate != null ? dto.commissionRate : null }),
        ...(dto.payFrequency !== undefined && { payFrequency: dto.payFrequency }),
        ...(dto.federalFilingStatus !== undefined && { federalFilingStatus: dto.federalFilingStatus }),
        ...(dto.stateCode !== undefined && { stateCode: dto.stateCode }),
        ...(dto.federalAllowances !== undefined && { federalAllowances: dto.federalAllowances }),
        ...(dto.stateAllowances !== undefined && { stateAllowances: dto.stateAllowances }),
        ...(dto.defaultGlDept !== undefined && { defaultGlDept: dto.defaultGlDept }),
      },
    });
  }

  terminate(tenantId: TenantId, id: string, terminationDate: Date) {
    return this.prisma.employee.update({
      where: { id },
      data: { isActive: false, terminationDate },
    });
  }
}
