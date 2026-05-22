import { IStepHandler, IEOMStepContext, StepResult } from '@amacc/shared-kernel';

export class EOMOrchestrator {
  constructor(private readonly handlers: IStepHandler[]) {}

  async advance(context: IEOMStepContext): Promise<StepResult> {
    const handler = this.handlers.find((h) => h.canHandle(context.currentStep.stepCode));
    if (!handler) {
      return {
        stepCode: context.currentStep.stepCode,
        success: false,
        message: `No handler registered for step ${context.currentStep.stepCode}`,
      };
    }
    return handler.execute(context);
  }
}
