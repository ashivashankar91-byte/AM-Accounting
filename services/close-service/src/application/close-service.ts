import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import { applyTransition, CloseState } from '../domain/close-state-machine';
import { aggregateReadiness, ReadinessSignal } from '../domain/readiness-aggregator';
import { ICloseRepository } from '../domain/interfaces';

@injectable()
export class ClosePeriodService {
  constructor(@inject('ICloseRepository') private readonly repo: ICloseRepository) {}

  async getState(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number) {
    return this.repo.findState(tenantId, legalEntityId, periodYear, periodMonth);
  }

  async transition(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number, toState: string, actor: string, reason?: string) {
    const current = await this.repo.findState(tenantId, legalEntityId, periodYear, periodMonth);
    const currentState = (current?.state ?? CloseState.NOT_READY) as CloseState;
    const overriderIds = await this.repo.getExceptionOverriderIds(tenantId, legalEntityId, periodYear, periodMonth);
    const newState = applyTransition(currentState, toState as CloseState, actor, { overriderIds, requiresSoDCheck: true });
    return this.repo.upsertState(tenantId, legalEntityId, periodYear, periodMonth, newState, currentState, actor, reason, current?.version ?? 0);
  }

  async getReadiness(_tenantId: string, _legalEntityId: string, _periodYear: number, _periodMonth: number, signals: ReadinessSignal[]) {
    return aggregateReadiness(signals);
  }
}
