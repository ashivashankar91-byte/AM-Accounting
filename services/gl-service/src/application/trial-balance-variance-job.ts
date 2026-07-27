import { inject, injectable } from 'tsyringe';
import { createEvent, IEventPublisher } from '@amacc/shared-kernel';
import {
  TrialBalanceComparison,
  TrialBalanceFilters,
  TrialBalanceService,
} from './trial-balance-service';

@injectable()
export class TrialBalanceVarianceJob {
  constructor(
    @inject(TrialBalanceService) private readonly trialBalance: TrialBalanceService,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  async run(tenantId: string, filters: TrialBalanceFilters): Promise<TrialBalanceComparison> {
    const comparison = await this.trialBalance.compareProjectionToRebuild(tenantId, filters);
    if (comparison.delta > 0.005) {
      await this.events.publish(
        createEvent('report.tb.variance' as any, tenantId as any, {
          ...comparison.scope,
          delta: comparison.delta,
          mismatchCount: comparison.mismatches.length,
          mismatches: comparison.mismatches,
        }),
      );
    }
    return comparison;
  }
}
