const fs = require("fs");
const path = require("path");
const { query } = require("../config/postgresPool");

async function run() {
  console.log("Checking columns in activity_batches...");
  const colRes = await query(
    "SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'activity_batches'"
  );
  console.log("activity_batches columns:", colRes.rows);

  const colRes2 = await query(
    "SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'subject_batches'"
  );
  console.log("subject_batches columns:", colRes2.rows);

  const sqlPath = path.join(__dirname, "../migrations/20260926_batch_roster_snapshots_backfill.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  console.log("Running migration and backfill...");
  await query(sql);
  console.log("Migration executed successfully!");

  const snapCount = await query("SELECT count(*) FROM session_roster_snapshots");
  console.log("Total session_roster_snapshots rows:", snapCount.rows[0].count);

  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
