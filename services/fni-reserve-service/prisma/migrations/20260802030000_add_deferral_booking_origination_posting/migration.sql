-- CE-12 gap-closure: schedule-service schedule 96 (Deferred Income
-- Liability) is now ORIGINATED by this service at deferral-booking
-- registration time (ce12.fni-reserve.deferral-booking-origination rule
-- pack, see scripts/ce12-rule-pack-definitions.ts). Track the resulting
-- posting execution + status on the booking row, same pattern as every
-- other posting-carrying table in this service (e.g. reserve_remittance's
-- posting_execution_id / status columns).
ALTER TABLE "deferral_booking"
  ADD COLUMN "origination_posting_execution_id" TEXT,
  ADD COLUMN "origination_status" TEXT NOT NULL DEFAULT 'PENDING';
