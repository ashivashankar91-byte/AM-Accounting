import { IAuditLogger, AuditEntry, AgentLogEntry, TenantId, asTenantId } from '@amacc/shared-kernel';

export class InMemoryAuditLogger implements IAuditLogger {
  private logs: AgentLogEntry[] = [];

  async log(entry: AuditEntry): Promise<void> {
    this.logs.push({
      id: crypto.randomUUID(),
      tenantId: (entry.tenantId ?? '') as TenantId,
      agentName: entry.agentName,
      triggerEvent: 'agent_action',
      inputSummary: '',
      actionTaken: entry.actionTaken,
      outcome: entry.outcome,
      humanRequired: entry.humanRequired,
      humanResolvedAt: null,
      createdAt: new Date(),
    });
  }

  async getByTenant(tenantId: TenantId, limit = 50): Promise<AgentLogEntry[]> {
    return this.logs.filter((l) => l.tenantId === tenantId).slice(0, limit);
  }

  async getById(id: string): Promise<AgentLogEntry | null> {
    return this.logs.find((l) => l.id === id) ?? null;
  }

  async resolveHumanRequired(id: string): Promise<void> {
    const log = this.logs.find((l) => l.id === id);
    if (log) {
      log.humanRequired = false;
      log.humanResolvedAt = new Date();
    }
  }
}
