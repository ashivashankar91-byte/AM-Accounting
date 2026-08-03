/**
 * CE-17 — Permission keys.
 *
 * Fourteen keys: seven for the governance framework, three for the work
 * queue, and four capability-owner tiers for the story surfaces that carry
 * their own professional accountability (sandbox, day-to-day story operation,
 * privacy, and internal audit).
 *
 * Grant and activate are separate keys because a ceremony one person can
 * perform end-to-end is not a ceremony. Suspend is separate again so an
 * emergency stop is never blocked by a missing grant permission.
 */
export const PERMS = {
  /** Read the command centre, capability grid, work queue, health and versions. */
  READ: 'automation.read',
  /** Create a capability row (always at OBSERVE_ONLY) and record versions. */
  CAPABILITY_CONFIGURE: 'automation.capability.configure',
  /** Propose an authority promotion. */
  AUTHORITY_GRANT: 'automation.authority.grant',
  /** Activate a proposed promotion — must not be the grantor. */
  AUTHORITY_ACTIVATE: 'automation.authority.activate',
  /** Suspend a capability or trigger the emergency stop. */
  SUSPEND: 'automation.suspend',
  /** Author a policy-gate version. */
  POLICY_AUTHOR: 'automation.policy.author',
  /** Activate a policy-gate version — must not be the author. */
  POLICY_ACTIVATE: 'automation.policy.activate',

  /** Approve or reject a recommendation. */
  ITEM_APPROVE: 'automation.item.approve',
  /** Execute or retry an approved item. */
  ITEM_EXECUTE: 'automation.item.execute',
  /** Reverse an executed item. */
  ITEM_REVERSE: 'automation.item.reverse',

  /** S022 — run simulations. Zero mutation, but still permissioned. */
  SANDBOX_RUN: 'automation.sandbox.run',
  /** Day-to-day operation of the story surfaces. */
  STORY_OPERATE: 'automation.story.operate',
  /** S126 — privacy administration, including erasure authorization. */
  DSAR_MANAGE: 'automation.dsar.manage',
  /** S128 — control binder attestation. */
  SOX_ATTEST: 'automation.sox.attest',
} as const;

export const ALL_PERMISSIONS: string[] = Object.values(PERMS);
