/**
 * S021 — loads the deterministic sample envelopes into a running
 * posting-recovery-service via its POSTING_RECOVERY_FIXTURES_ENABLED-gated
 * /_fixtures endpoints, then appends one failed replay-attempt to the
 * "failed replay history" case. Used by the browser journey (see
 * tests/e2e/posting-recovery.spec.ts) and available for manual smoke
 * verification. Never used to seed production data.
 *
 * Usage:
 *   POSTING_RECOVERY_FIXTURES_ENABLED=true npm run dev   (in one terminal)
 *   AMACC_JWT_SECRET=... npx tsx tests/fixtures/load-fixtures.ts
 */
import { createServiceToken } from '@amacc/shared-kernel';
import {
  ALL_FIXTURE_ENVELOPES,
  FIXTURE_TENANT_A,
  FIXTURE_WITH_FAILED_REPLAY,
  FIXTURE_REPLAY_ELIGIBLE,
} from './sample-envelopes';

const BASE_URL = process.env['POSTING_RECOVERY_URL'] ?? 'http://localhost:3049';
const JWT_SECRET = process.env['AMACC_JWT_SECRET'];

if (!JWT_SECRET) {
  console.error('AMACC_JWT_SECRET must be set (must match the running service).');
  process.exit(1);
}

function authHeaders(tenantId: string) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    authorization: `Bearer ${createServiceToken('fixture-loader', JWT_SECRET as string)}`,
  };
}

async function main() {
  const deadLetterIds: Record<string, string> = {};

  for (const envelope of ALL_FIXTURE_ENVELOPES) {
    const res = await fetch(`${BASE_URL}/posting-recovery/v1/_fixtures/dead-letters`, {
      method: 'POST',
      headers: authHeaders(envelope.event.tenantId),
      body: JSON.stringify({ envelope, actor: 'fixture-loader' }),
    });
    if (!res.ok) {
      throw new Error(`Failed to load fixture ${envelope.event.eventId}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { deadLetterId: string; created: boolean };
    deadLetterIds[envelope.event.eventId] = body.deadLetterId;
    console.log(`loaded ${envelope.event.eventId} -> ${body.deadLetterId} (created=${body.created})`);
  }

  const failedReplayCaseId = deadLetterIds[FIXTURE_WITH_FAILED_REPLAY.event.eventId];
  const attemptRes = await fetch(
    `${BASE_URL}/posting-recovery/v1/_fixtures/dead-letters/${failedReplayCaseId}/attempts`,
    {
      method: 'POST',
      headers: authHeaders(FIXTURE_TENANT_A),
      body: JSON.stringify({
        status: 'FAILED',
        requestedBy: 'fixture-loader',
        requestedAt: '2026-07-25T15:00:00.000Z',
        resultMessage: 'Replay rejected: GL account mapping still unresolved',
      }),
    },
  );
  if (!attemptRes.ok) {
    throw new Error(`Failed to load failed-replay-attempt fixture: ${attemptRes.status} ${await attemptRes.text()}`);
  }
  console.log(`loaded failed replay attempt for case ${failedReplayCaseId}`);

  // CE-07 integration — move the replay-eligible fixture case through
  // QUARANTINED -> UNDER_REVIEW -> READY_FOR_REPLAY so the browser journey
  // can exercise a REAL replay call against CH01 (see
  // tests/e2e/posting-recovery.spec.ts).
  const replayEligibleCaseId = deadLetterIds[FIXTURE_REPLAY_ELIGIBLE.event.eventId];
  for (const toStatus of ['UNDER_REVIEW', 'READY_FOR_REPLAY']) {
    const res = await fetch(
      `${BASE_URL}/posting-recovery/v1/_fixtures/dead-letters/${replayEligibleCaseId}/transition`,
      {
        method: 'POST',
        headers: authHeaders(FIXTURE_TENANT_A),
        body: JSON.stringify({ toStatus, actor: 'fixture-loader', reason: 'fixture setup for browser replay journey' }),
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to transition replay-eligible fixture to ${toStatus}: ${res.status} ${await res.text()}`);
    }
  }
  console.log(`moved replay-eligible fixture case ${replayEligibleCaseId} to READY_FOR_REPLAY`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
