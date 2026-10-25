const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { query } = require("../config/postgresPool");

async function check() {
  try {
    const res = await query(
      "SELECT proname, proargnames FROM pg_proc WHERE proname = $1",
      ["mark_student_attendance_atomic"]
    );
    console.log("mark_student_attendance_atomic in DB:", res.rows);

    const tablesRes = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log("Tables in DB:", tablesRes.rows.map(r => r.table_name));

    // Check columns of sessions and attendances
    const sessCols = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'sessions'
      ORDER BY ordinal_position;
    `);
    console.log("Sessions columns:", sessCols.rows.map(r => r.column_name));

    const attCols = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'attendances'
      ORDER BY ordinal_position;
    `);
    console.log("Attendances columns:", attCols.rows.map(r => r.column_name));

    process.exit(0);
  } catch (err) {
    console.error("DB check error:", err);
    process.exit(1);
  }
}

check();
