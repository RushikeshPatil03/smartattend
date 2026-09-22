// server/config/postgresPool.js
const { Pool } = require("pg");
const env = require("./env");

let poolInstance = null;

/**
 * Returns a singleton pg.Pool configured for Supabase PostgreSQL.
 * For runtime high-concurrency queries, DATABASE_URL should point to the
 * Supavisor Transaction Pooler on port 6543 (aws-0-ap-south-1.pooler.supabase.com:6543).
 */
function getPostgresPool() {
  if (poolInstance) return poolInstance;

  const connectionString = env.DATABASE_URL || env.DIRECT_URL;
  if (!connectionString) {
    return null;
  }

  const isPooler = connectionString.includes(":6543");
  const maxConnections = Number(process.env.PG_MAX_POOL_SIZE || 10);

  poolInstance = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
    // Keep pool size small for Render Free Tier (512MB RAM, single instance)
    max: maxConnections,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Supavisor transaction pooler does not support session-level prepared statement caching
    ...(isPooler ? { allowExitOnIdle: true } : {}),
  });

  // Prevent idle connection drops from crashing the Node process
  poolInstance.on("error", (err) => {
    console.warn("⚠️ Postgres pool unexpected client error (non-fatal):", err.message);
  });

  return poolInstance;
}

/**
 * Convenience query helper with automatic connection acquisition & release
 */
async function query(text, params) {
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error(
      "Postgres pool is not configured. Set DATABASE_URL or DIRECT_URL in server/.env"
    );
  }
  return pool.query(text, params);
}

/**
 * Acquire a single client from the pool (must be released by caller)
 */
async function getClient() {
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error(
      "Postgres pool is not configured. Set DATABASE_URL or DIRECT_URL in server/.env"
    );
  }
  return pool.connect();
}

function isPostgresPoolConfigured() {
  return Boolean(env.DATABASE_URL || env.DIRECT_URL);
}

module.exports = {
  getPostgresPool,
  query,
  getClient,
  isPostgresPoolConfigured,
};
