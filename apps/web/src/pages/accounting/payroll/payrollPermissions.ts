// CE-13 RBAC gap-closure — UI-side permission reflection for the three
// Payroll pages (PayrollGovernance, PayrollBatchWorkbench,
// PayrollCommissionWorkbench). Mirrors the existing repo convention in
// pages/payroll/reports/EmployeeInfoReport.tsx (permission keys cached in
// localStorage's `userPermissions` array by the login flow, read
// synchronously per render). This is advisory only — hiding/disabling an
// action here is a UX convenience; payroll-service's
// attachPayrollRouteSecurity() server-side guard is the sole authoritative
// enforcement point, so a user who forges a request around this check is
// still denied with a 403 by the API.
import { PAYROLL_PERMISSIONS } from './payrollPermissionKeys';

export { PAYROLL_PERMISSIONS };

export function parsePayrollPermissions(): string[] {
  try {
    const raw = localStorage.getItem('userPermissions');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function hasPayrollPermission(perms: string[], key: string): boolean {
  return perms.includes(key);
}
