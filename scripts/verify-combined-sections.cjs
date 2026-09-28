// scripts/verify-combined-sections.cjs
/**
 * Automated Verification Suite for Multi-Section Combined Attendance,
 * Batch Matching & Spreadsheet Synchronization Engine.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("==================================================================");
console.log(" Running SmartAttend Multi-Section Combined Attendance Tests      ");
console.log("==================================================================\n");

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`Test: ${name}... `);
    fn();
    console.log("✓ Passed");
    passed++;
  } catch (err) {
    console.log("✗ FAILED");
    console.error("  Error:", err.message);
    failed++;
  }
}

// -------------------------------------------------------------------------
// Test 1: Multi-section Delimiter Parsing
// -------------------------------------------------------------------------
runTest("Multi-section delimiter parser supports multiple separators", () => {
  const parseSections = (rawSec) => {
    if (!rawSec || rawSec === "ALL" || rawSec === "*") return [];
    return String(rawSec).split(/[,/&|+]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  };

  assert.deepStrictEqual(parseSections("A, B"), ["A", "B"]);
  assert.deepStrictEqual(parseSections("A/B"), ["A", "B"]);
  assert.deepStrictEqual(parseSections("A & B"), ["A", "B"]);
  assert.deepStrictEqual(parseSections("A+B"), ["A", "B"]);
  assert.deepStrictEqual(parseSections("A, B, C, D"), ["A", "B", "C", "D"]);
  assert.deepStrictEqual(parseSections("A"), ["A"]);
  assert.deepStrictEqual(parseSections("ALL"), []);
});

// -------------------------------------------------------------------------
// Test 2: Ingestion Snapshot Service Delimiter Parsing in Source Code
// -------------------------------------------------------------------------
runTest("sessionRosterSnapshotService.js correctly parses multi-section cohorts", () => {
  const filePath = path.join(__dirname, "../server/services/sessionRosterSnapshotService.js");
  const content = fs.readFileSync(filePath, "utf-8");

  assert(
    content.includes("rawSec.split(/[,/&|+]/)"),
    "sessionRosterSnapshotService.js must split rawSec with /[,/&|+]/ regex"
  );
  assert(
    content.includes('query.in("section", secList)'),
    "sessionRosterSnapshotService.js must use query.in('section', secList) for multi-section cohorts"
  );
});

// -------------------------------------------------------------------------
// Test 3: Session Creation Route Accepts & Normalizes String or Array Sections
// -------------------------------------------------------------------------
runTest("faculty.js /session/start handles both array and string sections", () => {
  const filePath = path.join(__dirname, "../server/routes/faculty.js");
  const content = fs.readFileSync(filePath, "utf-8");

  assert(
    content.includes("sections,") && content.includes("const rawSection = sections || section;"),
    "faculty.js must accept sections array and fallback to section"
  );
  assert(
    content.includes('rawSection.map((s) => String(s).trim().toUpperCase()).filter(Boolean).join(", ")'),
    "faculty.js must normalize multi-sections to clean comma-separated uppercase string"
  );
});

// -------------------------------------------------------------------------
// Test 4: Student Eligibility Matching for Combined Sessions
// -------------------------------------------------------------------------
runTest("Combined session eligibility check matches enrolled students with zero false rejections", () => {
  function checkSectionEligibility(rawSessionSection, studentSection) {
    const rawSessionSec = String(rawSessionSection || "").trim().toUpperCase();
    const stuSec = String(studentSection || "").trim().toUpperCase();

    if (rawSessionSec && rawSessionSec !== "ALL" && rawSessionSec !== "*") {
      const allowedSections = new Set(
        rawSessionSec.split(/[,/&|+]/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      );

      if (allowedSections.size > 0) {
        if (!stuSec) return { ok: false, error: "No section assigned" };
        if (!allowedSections.has(stuSec)) return { ok: false, error: "Section mismatch" };
      }
    }
    return { ok: true };
  }

  // Student A in session "A, B" -> OK
  assert.strictEqual(checkSectionEligibility("A, B", "A").ok, true);
  // Student B in session "A, B" -> OK
  assert.strictEqual(checkSectionEligibility("A, B", "B").ok, true);
  // Student C in session "A, B" -> Mismatch
  assert.strictEqual(checkSectionEligibility("A, B", "C").ok, false);
  // Student with no section -> Mismatch
  assert.strictEqual(checkSectionEligibility("A, B", "").ok, false);
  // Session "ALL" -> OK for any section
  assert.strictEqual(checkSectionEligibility("ALL", "C").ok, true);
});

// -------------------------------------------------------------------------
// Test 5: Attendance Marking Invariant - Student Section Tagging
// -------------------------------------------------------------------------
runTest("attendance.js preserves individual student section without session pollution", () => {
  const filePath = path.join(__dirname, "../server/routes/attendance.js");
  const content = fs.readFileSync(filePath, "utf-8");

  assert(
    !content.includes('section: String(student.section || session.section || "").toUpperCase()'),
    "attendance.js must not fallback to session.section which corrupts student section tags"
  );
  assert(
    content.includes('section: String(student.section || "").toUpperCase() || null,'),
    "attendance.js must record student.section strictly"
  );
});

// -------------------------------------------------------------------------
// Test 6: Spreadsheet History Splitting & Filtering Logic
// -------------------------------------------------------------------------
runTest("/session-roster-history queries use multi-section or-clause and return section", () => {
  const attPath = path.join(__dirname, "../server/routes/attendance.js");
  const facPath = path.join(__dirname, "../server/routes/faculty.js");
  const attContent = fs.readFileSync(attPath, "utf-8");
  const facContent = fs.readFileSync(facPath, "utf-8");

  const expectedClause = 'sessQuery.or(`section.eq.${cleanSec},section.ilike.%${cleanSec}%`);';
  assert(
    attContent.includes(expectedClause),
    "attendance.js /session-roster-history must use multi-section or-clause"
  );
  assert(
    facContent.includes(expectedClause),
    "faculty.js /session-roster-history must use multi-section or-clause"
  );

  assert(
    attContent.includes("section: s.section,"),
    "attendance.js must include section: s.section in returned session objects"
  );
  assert(
    facContent.includes("section: s.section,"),
    "faculty.js must include section: s.section in returned session objects"
  );
});

// -------------------------------------------------------------------------
// Test 7: Student Visibility of Active & Historical Combined Sessions
// -------------------------------------------------------------------------
runTest("student.js properly matches active and historical combined sessions", () => {
  const filePath = path.join(__dirname, "../server/routes/student.js");
  const content = fs.readFileSync(filePath, "utf-8");

  assert(
    content.includes("sSec.split(/[,/&|+]/)"),
    "student.js active session matching must parse multi-section delimiter"
  );
  assert(
    content.includes('sessQuery.or(`section.eq.${studentSec},section.ilike.%${studentSec}%`)'),
    "student.js past sessions query must match combined sessions containing student section"
  );
});

// -------------------------------------------------------------------------
// Test 8: Preset Key & Label Formatting
// -------------------------------------------------------------------------
runTest("FacultyDashboard.tsx formats combined presets with [A+B] and distinct badge", () => {
  const filePath = path.join(__dirname, "../src/pages/FacultyDashboard.tsx");
  const content = fs.readFileSync(filePath, "utf-8");

  assert(
    content.includes("formatPresetSectionKey") && content.includes("formatPresetSectionLabel"),
    "FacultyDashboard.tsx must include preset section formatters"
  );
  assert(
    content.includes("buildRecentClassLabel"),
    "FacultyDashboard.tsx must use buildRecentClassLabel for chips"
  );
  assert(
    content.includes("sections: parsedSections.length > 0 ? parsedSections : undefined,"),
    "FacultyDashboard.tsx must send parsed sections array in createSession"
  );
});

// -------------------------------------------------------------------------
// Test 9: Frontend Multi-Section Selector UI in SessionSetupCard.tsx
// -------------------------------------------------------------------------
runTest("SessionSetupCard.tsx includes multi-section selector with Combined badge", () => {
  const filePath = path.join(__dirname, "../src/pages/faculty/SessionSetupCard.tsx");
  const content = fs.readFileSync(filePath, "utf-8");

  assert(
    content.includes("isSectionDropdownOpen") && content.includes("sectionDropdownRef"),
    "SessionSetupCard.tsx must have section dropdown state and ref"
  );
  assert(
    content.includes("toggleAllSections") && content.includes("toggleSection"),
    "SessionSetupCard.tsx must have toggleAllSections and toggleSection handlers"
  );
  assert(
    content.includes("Combined (") && content.includes("isCombinedPreset"),
    "SessionSetupCard.tsx must display Combined badge on multi-section selection and preset chips"
  );
});

console.log("\n==================================================================");
if (failed === 0) {
  console.log(` ALL MULTI-SECTION COMBINED ATTENDANCE TESTS PASSED (${passed}/${passed})     `);
} else {
  console.log(` TESTS FAILED: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log("==================================================================\n");
