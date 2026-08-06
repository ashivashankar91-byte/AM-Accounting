// fix(integration): closes the CE-13 governed-posting gap — payroll's own
// S025 rule pack (packKey/rows, payComponent -> real GL account NUMBER)
// governs ACCOUNT RESOLUTION only. It was never CE-07's own posting-engine
// rule pack (services/coa-service/src/domain/posting-engine), which is the
// SEPARATE, authoritative record of "does this eventType/schemaVersion/
// legalEntityId/effective-date combination have an ACTIVE rule pack at
// all" — and nothing ever registered one for payroll.batch.posted.v1 /
// payroll.batch.reversed.v1, so every real post deterministically refused
// with NO_RULE_MATCH regardless of how correctly payroll's own S025
// governance worked.
//
// This registrar drives CE-07's real rule-pack lifecycle
// (POST /posting-engine/rule-packs -> validate -> activate) as a SHADOW of
// payroll's own rule-pack lifecycle: one CE-07 draft/version per payroll
// rule-pack version, per event type. The blueprint itself never encodes a
// fixed account — it is the SAME `debitLineItemsPath`/`creditLineItemsPath`
// pass-through shape apar-service's real ap.payment.posted.v1 producer pack
// already uses (services/apar-service/src/application/ap-payment-envelope.ts),
// because payroll-service's own PayrollGLMapping has ALREADY resolved every
// line item's real account number before the envelope is ever built (see
// posting-gateway.ts's toResolvedLines) — CE-07's rule pack for this event
// type is therefore never a second, competing account-mapping layer, and
// never hardcodes a production account.
//
// Every call here is made with the REAL, forwarded bearer token of the
// human who is authoring/validating/activating the PAYROLL rule pack (never
// this service's own service-to-service token) — so CE-07 independently
// records and enforces its OWN author != activator SoD (D-S023-28) using
// the SAME two real, distinct identities payroll's own SoD ceremony already
// establishes, and its own posting_engine.rule_pack.activate permission
// tier (ADMIN-only, the documented "highest-risk, hardest-to-reverse
// transition" precedent — see the 20260729020000 catalog migration). If the
// activating user lacks that CE-07 permission, activation genuinely,
// honestly fails end-to-end with CE-07's real 403 — never silently
// downgraded, retried as a different identity, or bypassed.
import { Ce07RulePackRegistrationError, MissingBearerTokenError } from '../domain/errors';

export type PayrollPostingEventKind = 'PAYROLL_BATCH_POSTED' | 'PAYROLL_BATCH_REVERSED';

const CE07_EVENT_TYPE: Record<PayrollPostingEventKind, string> = {
  PAYROLL_BATCH_POSTED: 'payroll.batch.posted.v1',
  PAYROLL_BATCH_REVERSED: 'payroll.batch.reversed.v1',
};

/** Real, reserved 2-char journal source code (Standard General Journal) — payroll has no dedicated legacy source code of its own (see CLAUDE.md's COBOL source-code archaeology), matching the same convention CE-07's own certification fixtures use for a service in the same position. */
const JOURNAL_SOURCE_CODE = 'GJ';

function buildSourceText(kind: PayrollPostingEventKind, tenantId: string, legalEntityId: string, packKey: string, semver: string, effectiveFrom: string): string {
  return JSON.stringify({
    dslVersion: 1,
    packKey,
    semver,
    eventType: CE07_EVENT_TYPE[kind],
    supportedEventSchemaVersions: ['1.0'],
    tenantScope: tenantId,
    entityId: legalEntityId,
    effectiveFrom,
    effectiveTo: null,
    journalSourceCode: JOURNAL_SOURCE_CODE,
    matchStrategy: 'FIRST_MATCH',
    noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
    rules: [
      {
        ruleId: `${packKey}-rule`,
        priority: 1,
        description: `Payroll ${kind === 'PAYROLL_BATCH_POSTED' ? 'batch posting' : 'batch reversal'} — line items resolved by payroll-service's own governed GL mapping (S025), never a second/competing account-mapping layer here.`,
        condition: null,
        blueprint: {
          memoTemplate: 'Payroll batch {{payload.batchNumber}}',
          postingGroups: [
            {
              groupId: 'payroll',
              baseAmountPath: 'payload.totalAmount',
              debitAllocations: [],
              debitLineItemsPath: 'payload.debitLines',
              creditAllocations: [],
              creditLineItemsPath: 'payload.creditLines',
            },
          ],
        },
      },
    ],
  });
}

export interface RegisteredCe07Version {
  id: string;
  status: string;
}

export interface ICe07RulePackRegistrar {
  /** Draft a shadow CE-07 rule-pack version for one payroll event kind, authenticated as the real payroll rule-pack author. */
  draft(input: { bearerToken: string | null; tenantId: string; legalEntityId: string; kind: PayrollPostingEventKind; packKey: string; semver: string; effectiveFrom: string }): Promise<RegisteredCe07Version>;
  /** Re-run CE-07's own structural/semantic validation against an already-drafted shadow version. */
  validate(input: { bearerToken: string | null; tenantId: string; ce07VersionId: string }): Promise<{ valid: boolean; findings: unknown[] }>;
  /** Activate an already-validated shadow version, authenticated as the real payroll rule-pack activator (a DIFFERENT identity than draft()'s caller). */
  activate(input: { bearerToken: string | null; tenantId: string; ce07VersionId: string }): Promise<RegisteredCe07Version>;
}

async function parseJsonSafe(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

export class HttpCe07RulePackRegistrar implements ICe07RulePackRegistrar {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private requireToken(bearerToken: string | null): string {
    if (!bearerToken) throw new MissingBearerTokenError();
    return bearerToken;
  }

  async draft(input: { bearerToken: string | null; tenantId: string; legalEntityId: string; kind: PayrollPostingEventKind; packKey: string; semver: string; effectiveFrom: string }): Promise<RegisteredCe07Version> {
    const token = this.requireToken(input.bearerToken);
    const sourceText = buildSourceText(input.kind, input.tenantId, input.legalEntityId, input.packKey, input.semver, input.effectiveFrom);
    const res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/rule-packs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': input.tenantId, Authorization: token },
      body: JSON.stringify({ packKey: input.packKey, sourceText }),
    });
    const parsed = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Ce07RulePackRegistrationError(res.status, parsed?.error ?? 'CE07_RULE_PACK_DRAFT_FAILED', parsed?.message ?? `CE-07 refused to draft the shadow rule pack for ${input.kind} (HTTP ${res.status}).`);
    }
    return { id: parsed.id, status: parsed.status };
  }

  async validate(input: { bearerToken: string | null; tenantId: string; ce07VersionId: string }): Promise<{ valid: boolean; findings: unknown[] }> {
    const token = this.requireToken(input.bearerToken);
    const res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/rule-pack-versions/${input.ce07VersionId}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': input.tenantId, Authorization: token },
      body: '{}',
    });
    const parsed = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Ce07RulePackRegistrationError(res.status, parsed?.error ?? 'CE07_RULE_PACK_VALIDATE_FAILED', parsed?.message ?? `CE-07 refused to validate the shadow rule pack (HTTP ${res.status}).`);
    }
    return { valid: Boolean(parsed?.valid), findings: parsed?.findings ?? [] };
  }

  async activate(input: { bearerToken: string | null; tenantId: string; ce07VersionId: string }): Promise<RegisteredCe07Version> {
    const token = this.requireToken(input.bearerToken);
    const res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/rule-pack-versions/${input.ce07VersionId}/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': input.tenantId, Authorization: token },
      body: '{}',
    });
    const parsed = await parseJsonSafe(res);
    if (!res.ok) {
      // CE-07's own SelfActivationForbiddenError (403) and ADMIN-only
      // permission denial (also 403) both surface here verbatim — never
      // retried as a different identity, never bypassed.
      throw new Ce07RulePackRegistrationError(res.status, parsed?.error ?? 'CE07_RULE_PACK_ACTIVATE_FAILED', parsed?.message ?? `CE-07 refused to activate the shadow rule pack (HTTP ${res.status}).`);
    }
    return { id: input.ce07VersionId, status: parsed?.status ?? 'ACTIVE' };
  }
}

/** Fail-closed placeholder used only when COA_SERVICE_URL is not configured — never a silent no-op success. */
export class UnavailableCe07RulePackRegistrar implements ICe07RulePackRegistrar {
  async draft(): Promise<RegisteredCe07Version> {
    throw new Ce07RulePackRegistrationError(503, 'CE07_REGISTRAR_NOT_CONFIGURED', 'CE-07 rule-pack registrar is not configured (COA_SERVICE_URL missing).');
  }
  async validate(): Promise<{ valid: boolean; findings: unknown[] }> {
    throw new Ce07RulePackRegistrationError(503, 'CE07_REGISTRAR_NOT_CONFIGURED', 'CE-07 rule-pack registrar is not configured (COA_SERVICE_URL missing).');
  }
  async activate(): Promise<RegisteredCe07Version> {
    throw new Ce07RulePackRegistrationError(503, 'CE07_REGISTRAR_NOT_CONFIGURED', 'CE-07 rule-pack registrar is not configured (COA_SERVICE_URL missing).');
  }
}
