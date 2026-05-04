import { FastifyPluginAsync } from 'fastify';
import { Pool } from 'pg';

const SAFE_QUERY_PATTERNS: Record<string, { sql: string; description: string }> = {
  'technician.*flat.?rate|tech.*hours': {
    sql: `SELECT technician_id, SUM(flat_rate_hours) as total_flat_rate, SUM(clock_hours) as total_clock, COUNT(*) as line_count
          FROM journal_lines WHERE technician_id IS NOT NULL AND journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = $1)
          GROUP BY technician_id ORDER BY total_flat_rate DESC LIMIT 20`,
    description: 'Technician flat-rate hours',
  },
  'gl.*entries.*over.*\\$?\\d|entries.*10.?000|large.*entries': {
    sql: `SELECT je.id, je.description, je.entry_date, je.status, je.source, SUM(jl.debit) as total_debit
          FROM journal_entries je JOIN journal_lines jl ON je.id = jl.journal_entry_id
          WHERE je.tenant_id = $1 GROUP BY je.id HAVING SUM(jl.debit) > 10000 ORDER BY total_debit DESC LIMIT 50`,
    description: 'GL entries over $10,000',
  },
  'payroll.*cost.*department|department.*payroll': {
    sql: `SELECT jl.department_code, SUM(jl.debit) as total_cost, COUNT(*) as line_count
          FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id
          WHERE je.tenant_id = $1 AND je.source = 'PAYROLL' AND jl.department_code IS NOT NULL
          GROUP BY jl.department_code ORDER BY total_cost DESC`,
    description: 'Payroll cost by department',
  },
  'parts.*below.*cost|parts.*negative.*margin': {
    sql: `SELECT jl.part_number, SUM(jl.debit) as total_cost, SUM(jl.credit) as total_revenue
          FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id
          WHERE je.tenant_id = $1 AND jl.part_number IS NOT NULL
          GROUP BY jl.part_number HAVING SUM(jl.credit) < SUM(jl.debit) ORDER BY (SUM(jl.credit) - SUM(jl.debit)) ASC LIMIT 20`,
    description: 'Parts sold below cost',
  },
  'f.?i.*gross.*profit|highest.*deal.*profit': {
    sql: `SELECT dp.deal_number, dp.product_name, dp.sale_price, dp.dealer_cost, dp.gross_profit
          FROM deal_product_lines dp JOIN journal_entries je ON dp.journal_entry_id = je.id
          WHERE je.tenant_id = $1 ORDER BY dp.gross_profit DESC LIMIT 20`,
    description: 'Highest F&I gross profit',
  },
};

function matchQuery(question: string): { sql: string; description: string } | null {
  const lower = question.toLowerCase();
  for (const [pattern, query] of Object.entries(SAFE_QUERY_PATTERNS)) {
    if (new RegExp(pattern, 'i').test(lower)) return query;
  }
  return null;
}

export function queryRoutes(prisma: any, pool: Pool): FastifyPluginAsync {
  return async (app) => {
    app.post('/ask', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const { question } = request.body as { question: string };
      const start = Date.now();

      const matched = matchQuery(question);
      if (!matched) {
        return {
          question,
          results: [],
          message: 'Could not understand the query. Try one of the example questions.',
          rowCount: 0,
          durationMs: Date.now() - start,
        };
      }

      try {
        const result = await pool.query(matched.sql, [tenantId]);
        const durationMs = Date.now() - start;

        // Log to history
        await prisma.queryHistory.create({
          data: { tenantId, userId: 'default-user', question, prismaQuery: { sql: matched.description }, rowCount: result.rows.length, durationMs },
        }).catch(() => { /* ignore */ });

        return { question, description: matched.description, results: result.rows, rowCount: result.rows.length, durationMs };
      } catch (err: any) {
        return { question, results: [], error: err.message, rowCount: 0, durationMs: Date.now() - start };
      }
    });

    app.post('/save', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const { name, question } = request.body as { name: string; question: string };
      const matched = matchQuery(question);
      const saved = await prisma.savedQuery.create({
        data: { tenantId, userId: 'default-user', name, question, prismaQuery: matched ? { sql: matched.description } : {} },
      });
      return saved;
    });

    app.get('/saved', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      return reply.send(await prisma.savedQuery.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 }).catch(() => []));
    });

    app.get('/history', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      return reply.send(await prisma.queryHistory.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 10 }).catch(() => []));
    });
  };
}
