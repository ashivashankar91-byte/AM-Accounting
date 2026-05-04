const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://amacc:amacc_dev@localhost:5433/amacc' });
p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  .then(r => r.rows.forEach(r => console.log(r.tablename)))
  .finally(() => p.end());
