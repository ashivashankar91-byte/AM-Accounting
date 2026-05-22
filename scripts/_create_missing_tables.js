const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://amacc:amacc_dev@localhost:5433/amacc' });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        event_type TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        correlation_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ,
        retry_count INT NOT NULL DEFAULT 0
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_outbox_published ON outbox_events(published_at)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS deal_product_lines (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        journal_entry_id TEXT NOT NULL,
        deal_number TEXT NOT NULL,
        product_type TEXT NOT NULL,
        product_name TEXT NOT NULL,
        sale_price REAL NOT NULL,
        dealer_cost REAL NOT NULL,
        gross_profit REAL NOT NULL,
        provider_name TEXT
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_dpl_je ON deal_product_lines(journal_entry_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_dpl_deal ON deal_product_lines(deal_number)');

    // Also create agent_logs if missing (for audit-service)
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_logs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        action_taken TEXT,
        severity TEXT DEFAULT 'INFO',
        human_required BOOLEAN DEFAULT false,
        details JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    console.log('All missing tables created successfully');
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(e => { console.error(e.message); process.exit(1); });
