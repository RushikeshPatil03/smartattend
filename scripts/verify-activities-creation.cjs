// scripts/verify-activities-creation.cjs
const assert = require("assert");
const { getSupabaseClient } = require("../server/config/supabase");

async function verifyActivityCreation() {
  console.log("=== Verifying Activity Creation & Lifecycle (Training & Event) ===\n");
  const supabase = getSupabaseClient();
  assert(supabase, "Supabase client must be available");

  // 1. Fetch a faculty and department to use for test
  const { data: faculty, error: facErr } = await supabase
    .from("faculties")
    .select("id, department, email")
    .limit(1)
    .single();

  assert(!facErr && faculty, "Must have at least one faculty in database to test");
  console.log(`Using faculty ${faculty.id} (${faculty.email}) with department ${faculty.department}`);

  let departmentId = faculty.department;
  if (!departmentId) {
    const { data: dept } = await supabase.from("departments").select("id").limit(1).single();
    assert(dept, "Must have at least one department in database");
    departmentId = dept.id;
  }

  // 2. Test inserting a TRAINING activity directly into DB with is_active
  const trainingName = `Test Training ${Date.now()}`;
  const startDate = "2026-10-01";
  const endDate = "2026-10-05";

  console.log("Testing insert of TRAINING activity...");
  const { data: createdTraining, error: createErr } = await supabase
    .from("activities")
    .insert({
      faculty: faculty.id,
      department: departmentId,
      name: trainingName,
      type: "TRAINING",
      start_date: startDate,
      end_date: endDate,
      years: [2, 3],
      semesters: [3, 5],
      semester: 3,
      section: "A",
      is_active: true,
    })
    .select("id, faculty, department, name, type, event_date, start_date, end_date, years, semesters, semester, section, is_active, created_at")
    .single();

  if (createErr) {
    console.error("Failed to insert training activity:", createErr);
    process.exit(1);
  }

  assert(createdTraining, "Training activity should be created");
  assert.strictEqual(createdTraining.name, trainingName);
  assert.strictEqual(createdTraining.type, "TRAINING");
  assert.strictEqual(createdTraining.is_active, true);
  console.log(`✅ [PASS] Training activity created successfully with id: ${createdTraining.id}`);

  // 3. Test inserting an EVENT activity
  const eventName = `Test Event ${Date.now()}`;
  const eventDate = "2026-10-15";

  console.log("Testing insert of EVENT activity...");
  const { data: createdEvent, error: eventErr } = await supabase
    .from("activities")
    .insert({
      faculty: faculty.id,
      department: departmentId,
      name: eventName,
      type: "EVENT",
      event_date: eventDate,
      years: [1],
      semesters: [1],
      semester: 1,
      section: "B",
      is_active: true,
    })
    .select("id, faculty, department, name, type, event_date, start_date, end_date, years, semesters, semester, section, is_active, created_at")
    .single();

  if (eventErr) {
    console.error("Failed to insert event activity:", eventErr);
    process.exit(1);
  }

  assert(createdEvent, "Event activity should be created");
  assert.strictEqual(createdEvent.name, eventName);
  assert.strictEqual(createdEvent.type, "EVENT");
  assert.strictEqual(createdEvent.is_active, true);
  console.log(`✅ [PASS] Event activity created successfully with id: ${createdEvent.id}`);

  // 4. Test updating activity with is_active
  console.log("Testing update of activity...");
  const { data: updated, error: updateErr } = await supabase
    .from("activities")
    .update({ name: `${trainingName} (Updated)`, is_active: true })
    .eq("id", createdTraining.id)
    .select("id, name, is_active, updated_at")
    .single();

  assert(!updateErr, `Update failed: ${updateErr?.message}`);
  assert.strictEqual(updated.name, `${trainingName} (Updated)`);
  assert.strictEqual(updated.is_active, true);
  console.log("✅ [PASS] Activity updated successfully");

  // 5. Clean up test records
  await supabase.from("activities").delete().in("id", [createdTraining.id, createdEvent.id]);
  console.log("✅ [PASS] Test records cleaned up cleanly");

  console.log("\n🎉 ALL ACTIVITY CREATION TESTS PASSED!");
  process.exit(0);
}

verifyActivityCreation().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
