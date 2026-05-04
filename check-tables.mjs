import pg from 'pg';
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
console.log('Tables in DB:', res.rows.map(r => r.table_name).join(', '));
await client.end();
