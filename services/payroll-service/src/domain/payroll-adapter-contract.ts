// CE-13 / S025 — Payroll Statutory Boundary contract.
//
// Mirrors CE-10's certified tax-engine adapter boundary
// (services/tax-service/src/domain/tax-adapter-contract.ts) verbatim in
// spirit: gross-to-net STATUTORY calculation (federal/state withholding,
// FICA/FUTA/SUTA, filing) is OWNED by a certified payroll source behind this
// adapter — an external payroll provider (file/API) or a future certified
// in-house engine. This service NEVER computes a statutory value: no rates,
// no withholding tables, no filing logic anywhere in payroll-service.
//
// Where no authoritative source is configured, the truthful default is
// NOT_CONFIGURED — every run blocks naming the affected employees rather
// than silently estimating. Two other paths are the only ways a payroll
// item's withholding lines are ever populated:
//   - ATTESTED_MANUAL_ENTRY: a human enters figures copied from the
//     provider's own register, with attestation (attestedBy/attestedAt/
//     sourceDocumentRef) — this is ENTERED EVIDENCE, never computed here.
//   - TEST_FIXTURE: deterministic, clearly-labeled fixture withholding used
//     ONLY for certification/local development. Fixture results are
//     rejected outright if ever presented as production-certified (see
//     PayrollWithholdingResult.productionCertified).

export type PayrollWithholdingStatus =
  | 'ATTESTED_MANUAL_ENTRY'
  | 'TEST_FIXTURE'
  | 'NOT_CONFIGURED';

/** Only these statuses allow a payroll item to proceed into batch validation/posting (S108 AC). */
export const WITHHOLDING_STATUSES_ALLOWING_PROCEED: ReadonlySet<PayrollWithholdingStatus> = new Set([
  'ATTESTED_MANUAL_ENTRY',
  'TEST_FIXTURE',
]);

export interface PayrollWithholdingLines {
  federalTax: number;
  stateTax: number;
  socialSecurity: number;
  medicare: number;
  employerFICA: number;
  employerMedicare: number;
  employerFUTA: number;
  employerSUTA: number;
}

export const ZERO_WITHHOLDING: PayrollWithholdingLines = {
  federalTax: 0, stateTax: 0, socialSecurity: 0, medicare: 0,
  employerFICA: 0, employerMedicare: 0, employerFUTA: 0, employerSUTA: 0,
};

export interface PayrollWithholdingRequest {
  tenantId: string;
  employeeId: string;
  grossPay: number;
  payFrequency: string;
  businessDate: string; // YYYY-MM-DD
}

export interface PayrollWithholdingResult {
  status: PayrollWithholdingStatus;
  /** Never present when status === 'NOT_CONFIGURED'. */
  lines: PayrollWithholdingLines;
  /** true only for ATTESTED_MANUAL_ENTRY sourced from a real provider register. Always false for TEST_FIXTURE. */
  productionCertified: boolean;
  source: string; // e.g. 'MANUAL_ATTESTED_REGISTER' | 'TEST_FIXTURE_ENGINE' | 'NOT_CONFIGURED'
  attestedBy?: string | null;
  attestedAt?: string | null;
  sourceDocumentRef?: string | null;
  rejectReason?: string | null;
}

export interface PayrollSourceAdapter {
  readonly sourceType: string;
  resolve(request: PayrollWithholdingRequest, entered?: Partial<PayrollWithholdingLines> & { attestedBy?: string; sourceDocumentRef?: string }): Promise<PayrollWithholdingResult>;
  getStatus(): Promise<{ sourceType: string; configured: boolean }>;
}
