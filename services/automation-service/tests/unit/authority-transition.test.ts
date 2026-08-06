/**
 * The authority ladder and the truthful state machine. Two properties are
 * asserted here that the rest of the epic leans on: every capability starts at
 * OBSERVE_ONLY, and EXECUTED is terminal — a correction is a new item pointing
 * back at the old one, never an edit of the record that was already posted.
 */

import { describe, it, expect } from 'vitest';
import {
  AUTHORITY_LEVELS, AUTHORITY_LADDER, DEFAULT_AUTHORITY, authorityRank, isAuthorityLevel,
  authorityAtLeast, TRUTHFUL_STATES, isTruthfulState, canTransition, ITEM_TRANSITIONS,
} from '../../src/domain/authority';
import { CAPABILITIES, requireCapabilityDefinition } from '../../src/domain/capabilities';

describe('authority ladder', () => {
  it('defines exactly the six declared authority levels', () => {
    expect([...AUTHORITY_LEVELS]).toEqual([
      'OBSERVE_ONLY', 'RECOMMEND', 'PREPARE_DRAFT',
      'EXECUTE_WITH_APPROVAL', 'AUTO_EXECUTE_WITHIN_POLICY', 'SUSPENDED',
    ]);
  });

  it('keeps SUSPENDED off the ladder — it is a state, not a promotion', () => {
    expect(AUTHORITY_LADDER).not.toContain('SUSPENDED');
    expect(authorityRank('SUSPENDED')).toBe(-1);
    expect(authorityAtLeast('SUSPENDED', 'OBSERVE_ONLY')).toBe(false);
  });

  it('defaults to OBSERVE_ONLY', () => {
    expect(DEFAULT_AUTHORITY).toBe('OBSERVE_ONLY');
    expect(authorityRank(DEFAULT_AUTHORITY)).toBe(0);
  });

  it('orders the rungs monotonically', () => {
    const ranks = AUTHORITY_LADDER.map(authorityRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });

  it('rejects values that are not authority levels', () => {
    expect(isAuthorityLevel('OBSERVE_ONLY')).toBe(true);
    expect(isAuthorityLevel('FULL_CONTROL')).toBe(false);
    expect(authorityRank('FULL_CONTROL')).toBe(-1);
  });

  it('compares authority correctly', () => {
    expect(authorityAtLeast('AUTO_EXECUTE_WITHIN_POLICY', 'EXECUTE_WITH_APPROVAL')).toBe(true);
    expect(authorityAtLeast('RECOMMEND', 'EXECUTE_WITH_APPROVAL')).toBe(false);
    expect(authorityAtLeast('PREPARE_DRAFT', 'PREPARE_DRAFT')).toBe(true);
  });
});

describe('capability ceilings', () => {
  it('registers all fourteen canonical stories exactly once', () => {
    expect(CAPABILITIES).toHaveLength(14);
    const stories = CAPABILITIES.map((c) => c.storyId).sort();
    expect(stories).toEqual([
      'S022', 'S040', 'S058', 'S073', 'S091B', 'S095', 'S096',
      'S101B', 'S103B', 'S107', 'S118', 'S126', 'S127', 'S128',
    ].sort());
    expect(new Set(CAPABILITIES.map((c) => c.code)).size).toBe(14);
  });

  it('holds every declared ceiling on the ladder', () => {
    for (const c of CAPABILITIES) {
      expect(AUTHORITY_LADDER, c.code).toContain(c.ceiling);
    }
  });

  it('caps the chargeback model at RECOMMEND — it can only ever propose a rate', () => {
    expect(requireCapabilityDefinition('S091B_CHARGEBACK_MODEL').ceiling).toBe('RECOMMEND');
    expect(requireCapabilityDefinition('S091B_CHARGEBACK_MODEL').requiresAdoptionCeremony).toBe(true);
  });

  it('caps the GAAP bridge memo generator at PREPARE_DRAFT — it never asserts, it drafts', () => {
    expect(requireCapabilityDefinition('S118_GAAP_MEMO').ceiling).toBe('PREPARE_DRAFT');
  });

  it('never lets an irreversible capability reach AUTO_EXECUTE_WITHIN_POLICY', () => {
    for (const c of CAPABILITIES.filter((x) => x.irreversible)) {
      expect(authorityRank(c.ceiling), c.code).toBeLessThanOrEqual(authorityRank('EXECUTE_WITH_APPROVAL'));
    }
    expect(requireCapabilityDefinition('S126_DSAR').irreversible).toBe(true);
    expect(requireCapabilityDefinition('S126_DSAR').dualAuthorization).toBe(true);
  });

  it('never lets a statutory-adjacent capability run unattended', () => {
    for (const c of CAPABILITIES.filter((x) => x.statutoryAdjacent)) {
      expect(c.ceiling, c.code).not.toBe('AUTO_EXECUTE_WITHIN_POLICY');
    }
    expect(requireCapabilityDefinition('S073_LIFO_OVERLAY').statutoryAdjacent).toBe(true);
    expect(requireCapabilityDefinition('S073_LIFO_OVERLAY').ceiling).toBe('EXECUTE_WITH_APPROVAL');
  });

  it('marks the sandbox as zero-mutation', () => {
    expect(requireCapabilityDefinition('S022_RULE_SANDBOX').zeroMutation).toBe(true);
  });

  it('refuses an unknown capability code with a 400 rather than inventing a definition', () => {
    expect(() => requireCapabilityDefinition('S999_MADE_UP')).toThrowError(/Unknown automation capability/);
    try {
      requireCapabilityDefinition('S999_MADE_UP');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }
  });
});

describe('truthful item states', () => {
  it('defines exactly the nine declared states', () => {
    expect([...TRUTHFUL_STATES]).toEqual([
      'NOT_CONFIGURED', 'OBSERVATION_ONLY', 'RECOMMENDATION_READY', 'APPROVAL_REQUIRED',
      'EXECUTION_PENDING', 'EXECUTED', 'FAILED_CLOSED', 'SUSPENDED', 'MODEL_OR_RULE_UNAVAILABLE',
    ]);
    expect(isTruthfulState('DONE')).toBe(false);
  });

  it('treats EXECUTED as terminal', () => {
    expect(ITEM_TRANSITIONS.EXECUTED).toEqual([]);
    for (const to of TRUTHFUL_STATES) {
      expect(canTransition('EXECUTED', to), `EXECUTED -> ${to}`).toBe(false);
    }
  });

  it('permits the normal approval path and refuses shortcuts', () => {
    expect(canTransition('RECOMMENDATION_READY', 'APPROVAL_REQUIRED')).toBe(true);
    expect(canTransition('APPROVAL_REQUIRED', 'EXECUTION_PENDING')).toBe(true);
    expect(canTransition('EXECUTION_PENDING', 'EXECUTED')).toBe(true);
    expect(canTransition('RECOMMENDATION_READY', 'EXECUTED')).toBe(false);
    expect(canTransition('APPROVAL_REQUIRED', 'EXECUTED')).toBe(false);
  });

  it('lets a failed item be retried but not silently succeed', () => {
    expect(canTransition('FAILED_CLOSED', 'EXECUTION_PENDING')).toBe(true);
    expect(canTransition('FAILED_CLOSED', 'EXECUTED')).toBe(false);
  });

  it('lets any live state be suspended', () => {
    for (const from of ['RECOMMENDATION_READY', 'APPROVAL_REQUIRED', 'EXECUTION_PENDING', 'FAILED_CLOSED'] as const) {
      expect(canTransition(from, 'SUSPENDED'), from).toBe(true);
    }
  });

  it('rejects transitions involving states that do not exist', () => {
    expect(canTransition('RECOMMENDATION_READY', 'ARCHIVED')).toBe(false);
    expect(canTransition('PENDING', 'EXECUTED')).toBe(false);
  });
});
