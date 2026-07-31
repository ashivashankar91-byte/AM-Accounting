import { Pool, PoolClient } from 'pg';
import { IAuditLogger, AuditEntry, AgentLogEntry, TenantId } from '@amacc/shared-kernel';

// Persists agent activity to the shared `agent_action_logs` Postgres table
// (owned/migrated by audit-service, see
// services/audit-service/prisma/migrations/20260731000000_add_agent_action_logs)
// so the unified AI Agents dashboard (apps/web/src/pages/Agents.tsx, via
// agent-t1's /api/v1/agents/log) can display real actions taken by ANY of the
// 5 agent services (agent-gl, agent-eom, agent-payroll, agent-apar, agent-t1),
// and so history survives service restarts. Previously each service kept its
// own private in-memory array, so the "unified" log could only ever show
// agent-t1's own actions (never GL Integrity/EOM/Payroll/AP-AR), and all of it
// was lost on every restart.
//
// Uses a raw `pg` client (like services/query-service) rather than a full
// Prisma workspace, since these 5 services don't otherwise use Prisma. RLS on
// agent_action_logs requires `app.current_tenant_id` to be set via
// set_config() on the SAME physical connection as the query that follows it
// (see packages/shared-kernel/src/tenancy/rls-middleware.ts for the equivalent
// Prisma-side pattern/caveats) — so every operation here checks out a
// dedicated client from the pool for the SET + query pair, then releases it.
const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
});

async function withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

function toEntry(row: any): AgentLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    agentName: row.agent_name,
    triggerEvent: row.trigger_event,
    inputSummary: row.input_summary,
    actionTaken: row.action_taken,
    outcome: row.outcome,
    humanRequired: row.human_required,
    humanResolvedAt: row.human_resolved_at,
    createdAt: row.created_at,
    details: row.details ?? null,
  };
}

export class PostgresAuditLogger implements IAuditLogger {
  async log(entry: AuditEntry): Promise<void> {
    const tenantId = entry.tenantId ?? '';
    await withTenant(tenantId, (client) =>
      client.query(
        `INSERT INTO agent_action_logs
          (id, tenant_id, agent_name, trigger_event, input_summary, action_taken, outcome, human_required, details)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          entry.agentName,
          'agent_action',
          '',
          entry.actionTaken,
          entry.outcome,
          entry.humanRequired,
          entry.details ? JSON.stringify(entry.details) : null,
        ],
      ),
    );
  }

  async getByTenant(tenantId: TenantId, limit = 50, agentName?: string, offset = 0): Promise<AgentLogEntry[]> {
    const { rows } = await withTenant(tenantId, (client) =>
      agentName
        ? client.query(
            `SELECT * FROM agent_action_logs WHERE tenant_id = $1 AND agent_name = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
            [tenantId, agentName, limit, offset],
          )
        : client.query(
            `SELECT * FROM agent_action_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [tenantId, limit, offset],
          ),
    );
    return rows.map(toEntry);
  }

  async getById(id: string, tenantId?: string): Promise<AgentLogEntry | null> {
    // tenantId is an addition beyond the base IAuditLogger signature (an
    // optional extra param is a valid structural subtype) — RLS on
    // agent_action_logs requires it to return anything at all, so callers
    // (see services/agent-t1/src/http/routes.ts) now thread the
    // x-tenant-id header through here.
    if (!tenantId) return null;
    const { rows } = await withTenant(tenantId, (client) =>
      client.query(`SELECT * FROM agent_action_logs WHERE id = $1`, [id]),
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async resolveHumanRequired(id: string, tenantId?: string): Promise<void> {
    if (!tenantId) return;
    await withTenant(tenantId, (client) =>
      client.query(
        `UPDATE agent_action_logs SET human_required = false, human_resolved_at = now() WHERE id = $1`,
        [id],
      ),
    );
  }
}

// Kept for local/unit-test usage where a live Postgres connection isn't available.
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

  async getByTenant(tenantId: TenantId, limit = 50, agentName?: string, offset = 0): Promise<AgentLogEntry[]> {
    return this.logs
      .filter((l) => l.tenantId === tenantId && (!agentName || l.agentName === agentName))
      .slice(offset, offset + limit);
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
