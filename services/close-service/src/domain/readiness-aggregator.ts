/**
 * CE-15 S113 — Readiness aggregator
 *
 * Readiness = f(mandatory tasks VERIFIED + module signals + reconciliations + exception queue)
 * Deterministic, server-side. Browser computes nothing.
 * Upstream module signals: PENDING_UPSTREAM_TECHNICAL_RECONCILIATION when unavailable.
 */
import { CloseState, computeReadinessState } from './close-state-machine';

export const PUTR = 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';

export type ModuleSignal =
  | 'READY'
  | 'NOT_READY'
  | 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION'
  | 'ELIMINATIONS_PENDING'
  | 'BLOCKED'
  | 'NOT_CONFIGURED';

export interface ReadinessSignal {
  moduleCode: string;
  signal: ModuleSignal;
  message?: string;
}

export interface ReadinessResult {
  allReady: boolean;
  hasExceptions: boolean;
  signals: ReadinessSignal[];
}

/** Simple function form used by ClosePeriodService. */
export function aggregateReadiness(signals: ReadinessSignal[]): ReadinessResult {
  const allReady = signals.every(s => s.signal === 'READY');
  const hasExceptions = signals.some(s => s.signal !== 'READY');
  return { allReady, hasExceptions, signals };
}

/** Default upstream signals — all PUTR until CE-09..14 finalize. */
export function defaultUpstreamSignals(): ReadinessSignal[] {
  return [
    { moduleCode: 'CE09_AP_AR_CASH', signal: PUTR },
    { moduleCode: 'CE11_FIXED_OPS',  signal: PUTR },
    { moduleCode: 'CE12_VEHICLE_DEAL', signal: PUTR },
    { moduleCode: 'CE13_PAYROLL',    signal: PUTR },
    { moduleCode: 'CE14_OEM',        signal: PUTR },
    { moduleCode: 'CE06_ELIMINATIONS', signal: 'ELIMINATIONS_PENDING' },
  ] as ReadinessSignal[];
}

/** Full readiness summary with state derivation. */
export interface ReadinessSummary {
  state: CloseState;
  taskProgress: { total: number; verified: number; open: number };
  reconProgress: { total: number; reconciled: number; unreconciled: number };
  openExceptions: number;
  upstreamSignals: ReadinessSignal[];
  blockers: string[];
}

export class ReadinessAggregator {
  compute(input: {
    tasks: Array<{ status: string; isMandatory: boolean }>;
    reconciliations: Array<{ status: string; isMandatory: boolean }>;
    openExceptions: number;
    upstreamSignals: ReadinessSignal[];
  }): ReadinessSummary {
    const mandatoryTasks = input.tasks.filter(t => t.isMandatory);
    const verifiedTasks = mandatoryTasks.filter(t => t.status === 'VERIFIED');
    const allMandatoryTasksVerified =
      mandatoryTasks.length === 0 || verifiedTasks.length === mandatoryTasks.length;

    const mandatoryRecons = input.reconciliations.filter(r => r.isMandatory);
    const reconciledRecons = mandatoryRecons.filter(r => r.status === 'RECONCILED');
    const hasUnreconciled =
      mandatoryRecons.length > 0 && reconciledRecons.length < mandatoryRecons.length;

    const hasOpenExceptions = input.openExceptions > 0;

    const state = computeReadinessState({
      allMandatoryTasksVerified,
      hasUnreconciled,
      hasOpenExceptions,
      upstreamSignals: input.upstreamSignals.map(s => ({
        moduleCode: s.moduleCode,
        status: s.signal === 'READY' ? 'READY' : s.signal === 'NOT_READY' ? 'NOT_READY' : 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
      })),
    });

    const blockers: string[] = [];
    if (!allMandatoryTasksVerified) {
      blockers.push(`${mandatoryTasks.length - verifiedTasks.length} mandatory tasks not VERIFIED`);
    }
    if (hasUnreconciled) {
      blockers.push(`${mandatoryRecons.length - reconciledRecons.length} mandatory reconciliation(s) UNRECONCILED`);
    }
    if (hasOpenExceptions) {
      blockers.push(`${input.openExceptions} open exception(s)`);
    }

    return {
      state,
      taskProgress: {
        total: mandatoryTasks.length,
        verified: verifiedTasks.length,
        open: mandatoryTasks.length - verifiedTasks.length,
      },
      reconProgress: {
        total: mandatoryRecons.length,
        reconciled: reconciledRecons.length,
        unreconciled: mandatoryRecons.length - reconciledRecons.length,
      },
      openExceptions: input.openExceptions,
      upstreamSignals: input.upstreamSignals,
      blockers,
    };
  }
}
