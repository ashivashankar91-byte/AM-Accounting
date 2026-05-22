import {
  OnboardingSession,
  OnboardingStep,
  OnboardingStatus,
  TenantId,
  OEMType,
  IEventPublisher,
  asTenantId,
} from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';

const STEPS: OnboardingStep[] = ['DMS_CONFIG', 'OEM_CONFIG', 'COA_SETUP', 'IMPORT_HISTORY', 'FS_VALIDATION'];

type ExtendedSession = OnboardingSession & { dealerName: string; slug: string; oems: OEMType[]; updatedAt: Date; errorMessage?: string };

export class InMemoryOnboardingService {
  private sessions = new Map<string, ExtendedSession>();

  constructor(private readonly eventPublisher: IEventPublisher) {}

  async startOnboarding(dealerName: string, slug: string, oems: OEMType[]): Promise<OnboardingSession> {
    const id = crypto.randomUUID();
    const tenantId = asTenantId(id);
    const session: ExtendedSession = {
      id,
      tenantId,
      dealerName,
      slug,
      oems,
      currentStep: 'DMS_CONFIG',
      status: 'IN_PROGRESS',
      stepsCompleted: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(id, session);
    return session;
  }

  async completeStep(sessionId: string, step: OnboardingStep, data: Record<string, unknown>): Promise<OnboardingSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Onboarding session not found');
    if (session.status !== 'IN_PROGRESS') throw new Error('Onboarding is not in progress');
    if (session.currentStep !== step) throw new Error(`Expected step ${session.currentStep}, got ${step}`);

    session.stepsCompleted.push(step);
    session.updatedAt = new Date();

    // Store step-specific data on the session
    (session as any)[`${step}_data`] = data;

    // Advance to next step or finish
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      session.currentStep = STEPS[idx + 1];
    } else {
      session.status = 'COMPLETED';
      session.completedAt = new Date();

      await this.eventPublisher.publish(
        createEvent('TENANT_PROVISIONED', session.tenantId, {
          tenantId: session.tenantId,
          dealerName: session.dealerName,
          slug: session.slug,
          oems: session.oems,
        }),
      );

      await this.eventPublisher.publish(
        createEvent('ONBOARDING_COMPLETED', session.tenantId, { sessionId, dealerName: session.dealerName }),
      );
    }

    return session;
  }

  async getSession(sessionId: string): Promise<OnboardingSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getSessionByTenant(tenantId: TenantId): Promise<OnboardingSession | null> {
    for (const s of this.sessions.values()) {
      if (s.tenantId === tenantId) return s;
    }
    return null;
  }

  async listSessions(): Promise<OnboardingSession[]> {
    return [...this.sessions.values()];
  }

  async failStep(sessionId: string, reason: string): Promise<OnboardingSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Onboarding session not found');
    session.status = 'FAILED';
    session.errorMessage = reason;
    session.updatedAt = new Date();
    return session;
  }
}
