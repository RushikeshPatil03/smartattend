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

  // Prioritize DATABASE_URL (Port 6543 Transaction Pooler) over DIRECT_URL (Port 5432)
  let connectionString = env.DATABASE_URL || env.DIRECT_URL;
  if (!connectionString) {
    return null;
  }

  const isPooler = connectionString.includes(":6543");
  const isDirect = connectionString.includes(":5432");

  if (isDirect && !isPooler) {
    if (env.IS_PRODUCTION) {
      console.warn(
        "⚠️ WARNING: Postgres pool is connecting directly to port 5432. " +
        "For minimal connection overhead and high-concurrency scaling, switch DATABASE_URL to Supavisor Transaction Pooler (port 6543)."
      );
    }
  }

  const maxConnections = Number(process.env.PG_MAX_POOL_SIZE || 10);

  poolInstance = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
    // Keep pool size small for low-overhead instances (512MB RAM free tier)
    max: maxConnections,
    min: 0,
    idleTimeoutMillis: 10000, // Return idle connections rapidly to Supavisor pool
    connectionTimeoutMillis: 5000,
    // Supavisor transaction pooler does not support session-level prepared statements
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
