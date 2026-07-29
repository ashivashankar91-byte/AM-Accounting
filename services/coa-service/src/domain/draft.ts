// S214 — Draft Manual JE domain helpers (pure). Drafts save in ANY state
// (BR214-1) so line fields are all optional; this module only owns attachment
// admission (BR214-4 basic upload) and the draft line shape used for fidelity.

/** Max attachment size — 25 MB (BR214-4 / §2 field inventory). */
export const MAX_ATTACHMENT_BYTES = 26214400;

/** MIME whitelist for R0 basic upload (virus-scan hardening deferred to R1). */
export const ATTACHMENT_MIME_WHITELIST: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** A draft line — every field optional so a half-finished entry persists. */
export interface DraftLineInput {
  accountId?: string | null;
  accountNumber?: string | null;
  storeId?: string | null;
  deptCode?: string | null;
  controlNumber?: string | null; // INTERIM field, semantics UQ-18
  applyNumber?: string | null; // INTERIM field, semantics UQ-18
  dr?: number | string | null;
  cr?: number | string | null;
  memo?: string | null;
  /**
   * S011 — BR011-2, additive/optional (display-only extension to the JE
   * editor, P01-SCR-05). Never affects balancing/posting math (BR011-3);
   * validated + persisted at post time only (see posting-service.ts).
   */
  analysisTags?: { typeId: string; valueId: string }[] | null;
}

export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentRejection {
  field: 'mimeType' | 'sizeBytes' | 'fileName';
  diagnostic: string;
}

/** Validate an attachment against the R0 whitelist + size cap (BR214-4). */
export function admitAttachment(a: AttachmentInput): AttachmentRejection | null {
  if (!a.fileName || !a.fileName.trim()) {
    return { field: 'fileName', diagnostic: 'fileName is required.' };
  }
  if (!ATTACHMENT_MIME_WHITELIST.includes(a.mimeType)) {
    return { field: 'mimeType', diagnostic: `MIME type ${a.mimeType} is not permitted.` };
  }
  if (!Number.isFinite(a.sizeBytes) || a.sizeBytes < 0) {
    return { field: 'sizeBytes', diagnostic: 'sizeBytes must be a non-negative number.' };
  }
  if (a.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { field: 'sizeBytes', diagnostic: `Attachment exceeds the 25 MB limit (${a.sizeBytes} bytes).` };
  }
  return null;
}

/** Normalize a draft line for storage (trim empties to null; keep any state). */
export function normalizeLine(line: DraftLineInput): DraftLineInput {
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
  return {
    accountId: s(line.accountId),
    accountNumber: s(line.accountNumber),
    storeId: s(line.storeId),
    deptCode: s(line.deptCode),
    controlNumber: s(line.controlNumber),
    applyNumber: s(line.applyNumber),
    dr: n(line.dr),
    cr: n(line.cr),
    memo: s(line.memo),
    // S011 — preserve as-is (validated only at post time, never at save-draft
    // time, matching BR214-1 "save in ANY state"); normalize a falsy/empty
    // array to null so it round-trips identically to an untagged line.
    analysisTags: line.analysisTags && line.analysisTags.length > 0 ? line.analysisTags : null,
  };
}
