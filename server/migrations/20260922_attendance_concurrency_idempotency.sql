-- ========================================================================
-- SMARTATTEND ATTENDANCE CONCURRENCY IDEMPOTENCY MIGRATION
-- Safe for execution on live Supabase PostgreSQL (Mumbai ap-south-1)
-- ========================================================================

-- Step 1: Safely de-duplicate any historical duplicate records (if present)
-- Keeps the earliest recorded attendance per (session, student) pair
DELETE FROM attendances a
USING (
    SELECT MIN(ctid) AS keep_ctid, session, student
    FROM attendances
    WHERE student IS NOT NULL AND session IS NOT NULL
    GROUP BY session, student
    HAVING COUNT(*) > 1
) dupes
WHERE a.session = dupes.session
  AND a.student = dupes.student
  AND a.ctid <> dupes.keep_ctid;

-- Step 2: Ensure unique constraint exists on attendances (session, student)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_attendance_session_student'
          AND conrelid = 'attendances'::regclass
    ) THEN
        ALTER TABLE attendances
        ADD CONSTRAINT uq_attendance_session_student UNIQUE (session, student);
    END IF;
END $$;

-- Step 3: Ensure unique index exists on (session, student) for sub-millisecond conflict checks
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendances_session_student_uniq
ON attendances (session, student)
WHERE session IS NOT NULL AND student IS NOT NULL;
