const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected DB pool error:', err.message);
});

// Test connection on startup
pool.query('SELECT NOW()').then(() => {
  console.log('✅ Connected to Neon PostgreSQL');
}).catch(err => {
  console.error('❌ DB connection failed:', err.message);
});

module.exports = pool;
