// server/run_supabase_migration.js
require("dotenv").config();
const { Client } = require("pg");

const migrationSql = `
-- ========================================================================
-- WEBAUTHN / HARDWARE PASSKEY MIGRATION FOR SMARTATTEND.APP
-- ========================================================================

-- 1. Update 'faculties' table
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS credential_id VARCHAR(255) DEFAULT NULL;
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS public_key TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS counter BIGINT DEFAULT 0;
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS transports TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Update 'students' table
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS credential_id VARCHAR(255) DEFAULT NULL;
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS public_key TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS counter BIGINT DEFAULT 0;
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS transports TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ DEFAULT NULL;

-- 3. Update 'device_change_requests' table
ALTER TABLE IF EXISTS device_change_requests ADD COLUMN IF NOT EXISTS requested_credential_id VARCHAR(255) DEFAULT NULL;
ALTER TABLE IF EXISTS device_change_requests ADD COLUMN IF NOT EXISTS requested_public_key TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS device_change_requests ADD COLUMN IF NOT EXISTS requested_transports TEXT[] DEFAULT '{}';

-- 4. Create Unique Partial Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_faculties_credential_id ON faculties (credential_id) WHERE credential_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_credential_id ON students (credential_id) WHERE credential_id IS NOT NULL;
`;

async function runMigration() {
  const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!connectionString) {
    console.error("❌ No database connection string found in .env");
    process.exit(1);
  }

  console.log("🔌 Connecting to Supabase PostgreSQL database...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("✓ Connected to Supabase PostgreSQL database successfully.");

    console.log("⚡ Executing WebAuthn Passkey migration SQL...");
    await client.query(migrationSql);
    console.log("✓ Migration executed successfully!");

    // Verify columns on students table
    console.log("🔍 Verifying table columns in Supabase...");
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'students' 
        AND column_name IN ('credential_id', 'public_key', 'counter', 'transports', 'device_bound_at');
    `);

    console.log("Verified columns in 'students' table:");
    console.table(res.rows);

    const facRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'faculties' 
        AND column_name IN ('credential_id', 'public_key', 'counter', 'transports', 'device_bound_at');
    `);

    console.log("Verified columns in 'faculties' table:");
    console.table(facRes.rows);

    console.log("\n🎉 SUPABASE DATABASE SCHEMA IS 100% READY FOR WEBAUTHN PASSKEYS ON SMARTATTEND.APP!");
  } catch (err) {
    console.error("❌ Migration error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
