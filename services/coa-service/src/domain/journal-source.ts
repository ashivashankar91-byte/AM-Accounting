// S212 — Journal Source Registry domain. Pure types + validators + the reserved
// source set (adopted from GlSource evidence; UQ-13 SPIKE-05 decides the final
// code scheme — mnemonic codes ship interim with a numericAlias column reserved).

export type SourceClass = 'MANUAL' | 'SYSTEM';
export type SourceStatus = 'ACTIVE' | 'INACTIVE';

export const SOURCE_CLASSES: SourceClass[] = ['MANUAL', 'SYSTEM'];

export interface SourceFlags {
  autoPost: boolean;
  yearEndOnly: boolean;
  thirteenthOnly: boolean;
}

export interface ReservedSource {
  code: string;
  numericAlias: number;
  name: string;
  sourceClass: SourceClass;
  flags: SourceFlags;
}

const noFlags: SourceFlags = { autoPost: false, yearEndOnly: false, thirteenthOnly: false };

// Reserved, immutable, system-defined sources. Manual reserved codes remain
// usable by the manual JE path; SYSTEM reserved codes are fed by subsystems.
export const RESERVED_SOURCES: ReservedSource[] = [
  { code: 'GJ', numericAlias: 88, name: 'Standard General Journal', sourceClass: 'MANUAL', flags: { ...noFlags } },
  { code: 'ADJ', numericAlias: 3, name: 'Prior Month / Adjusting Entries', sourceClass: 'MANUAL', flags: { ...noFlags } },
  { code: 'YE', numericAlias: 90, name: 'Year-End Entries', sourceClass: 'MANUAL', flags: { ...noFlags, yearEndOnly: true } },
  { code: 'M13', numericAlias: 91, name: '13th Month Entries', sourceClass: 'MANUAL', flags: { ...noFlags, thirteenthOnly: true } },
  { code: 'SVC', numericAlias: 30, name: 'Service ROs', sourceClass: 'SYSTEM', flags: { ...noFlags, autoPost: true } },
  { code: 'PART', numericAlias: 32, name: 'Parts Sales', sourceClass: 'SYSTEM', flags: { ...noFlags, autoPost: true } },
  { code: 'WARR', numericAlias: 40, name: 'Warranty Remittances', sourceClass: 'SYSTEM', flags: { ...noFlags, autoPost: true } },
  { code: 'PAY', numericAlias: 95, name: 'Payroll', sourceClass: 'SYSTEM', flags: { ...noFlags, autoPost: true } },
];

// ── Validators ─────────────────────────────────────────────────────────────────

const CODE_RE = /^[A-Z0-9]{2,6}$/;

export function isValidCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code);
}

export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length >= 1 && name.length <= 120;
}

export function isValidClass(cls: unknown): cls is SourceClass {
  return cls === 'MANUAL' || cls === 'SYSTEM';
}

export function normalizeFlags(input?: Partial<SourceFlags>): SourceFlags {
  return {
    autoPost: input?.autoPost === true,
    yearEndOnly: input?.yearEndOnly === true,
    thirteenthOnly: input?.thirteenthOnly === true,
  };
}
