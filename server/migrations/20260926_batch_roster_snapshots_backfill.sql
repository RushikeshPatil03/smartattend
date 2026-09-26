-- ========================================================================
-- SMARTATTEND: IMMUTABLE SESSION ROSTER SNAPSHOTS & BATCH AUDIT MIGRATION
-- Safe, idempotent execution for Supabase PostgreSQL
-- ========================================================================

-- 1. Support Soft Archiving in subject_batches and activity_batches
ALTER TABLE IF EXISTS subject_batches ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS subject_batches ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE IF EXISTS activity_batches ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS activity_batches ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_subject_batches_active ON subject_batches(subject_id, faculty_id, is_active);
CREATE INDEX IF NOT EXISTS idx_activity_batches_active ON activity_batches(activity_id, is_active);

-- 2. IMMUTABLE SESSION ROSTER SNAPSHOTS TABLE
-- Freezes the exact cohort and batch members expected at the time a session is created.
-- Ensures historical sessions and attendance records are never altered by subsequent batch edits.
CREATE TABLE IF NOT EXISTS session_roster_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    enrollment_no VARCHAR(50) NOT NULL,
    student_name VARCHAR(120) NOT NULL,
    student_email VARCHAR(255) DEFAULT NULL,
    batch_id UUID DEFAULT NULL, -- Intentionally no FK constraint to prevent cascading deletes on batch cleanup
    batch_name VARCHAR(100) DEFAULT NULL,
    batch_number INT DEFAULT NULL,
    category VARCHAR(50) DEFAULT 'REGULAR',
    subject_id UUID DEFAULT NULL,
    activity_id UUID DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_session_roster_snapshot UNIQUE (session_id, enrollment_no)
);

CREATE INDEX IF NOT EXISTS idx_roster_snap_session ON session_roster_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_roster_snap_student ON session_roster_snapshots(student_id);
CREATE INDEX IF NOT EXISTS idx_roster_snap_enrollment ON session_roster_snapshots(enrollment_no);
CREATE INDEX IF NOT EXISTS idx_roster_snap_batch ON session_roster_snapshots(batch_id);
CREATE INDEX IF NOT EXISTS idx_roster_snap_subj ON session_roster_snapshots(subject_id);
CREATE INDEX IF NOT EXISTS idx_roster_snap_act ON session_roster_snapshots(activity_id);
CREATE INDEX IF NOT EXISTS idx_roster_snap_student_session ON session_roster_snapshots(student_id, session_id);

-- 3. BATCH CONFIGURATION AUDITS TABLE
-- Maintains an append-only audit trail of batch creation, modification, renaming, reassignments, and archiving.
CREATE TABLE IF NOT EXISTS batch_configuration_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type VARCHAR(20) NOT NULL, -- 'SUBJECT' | 'ACTIVITY'
    scope_id UUID NOT NULL,
    faculty_id UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL,
    actor_role VARCHAR(20) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    before_state JSONB NOT NULL DEFAULT '[]'::jsonb,
    after_state JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_audits_scope ON batch_configuration_audits(scope_type, scope_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_audits_faculty ON batch_configuration_audits(faculty_id, created_at DESC);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON session_roster_snapshots TO authenticated, service_role, anon;
GRANT SELECT, INSERT ON batch_configuration_audits TO authenticated, service_role, anon;

-- 4. BACKFILL PROCEDURES FOR HISTORICAL SESSIONS
-- Step 4a: Backfill from recorded attendances (absolute certainty: students who attended belonged to the session)
INSERT INTO session_roster_snapshots (
    session_id, student_id, enrollment_no, student_name, student_email,
    batch_id, batch_name, category, subject_id, activity_id, created_at
)
SELECT DISTINCT ON (a.session, COALESCE(NULLIF(TRIM(UPPER(a.enrollment_no)), ''), NULLIF(TRIM(UPPER(s.enrollment_no)), '')))
    a.session,
    COALESCE(a.student, s.id),
    COALESCE(NULLIF(TRIM(UPPER(a.enrollment_no)), ''), NULLIF(TRIM(UPPER(s.enrollment_no)), '')),
    COALESCE(NULLIF(TRIM(a.student_name), ''), NULLIF(TRIM(s.name), ''), 'Student'),
    COALESCE(NULLIF(TRIM(a.student_email), ''), s.email),
    COALESCE(a.batch_id, sess.batch_id),
    NULL,
    COALESCE(sess.category, 'REGULAR'),
    sess.subject,
    sess.activity_id,
    sess.start_time
FROM attendances a
JOIN sessions sess ON sess.id = a.session
LEFT JOIN students s ON s.id = a.student
WHERE COALESCE(NULLIF(TRIM(UPPER(a.enrollment_no)), ''), NULLIF(TRIM(UPPER(s.enrollment_no)), '')) IS NOT NULL
ON CONFLICT (session_id, enrollment_no) DO NOTHING;

-- Step 4b: Backfill subject batch sessions where subject_batches record still exists
INSERT INTO session_roster_snapshots (
    session_id, student_id, enrollment_no, student_name, student_email,
    batch_id, batch_name, batch_number, category, subject_id, created_at
)
SELECT
    sess.id,
    s.id,
    TRIM(UPPER(unnest.usn)),
    COALESCE(s.name, unnest.usn),
    s.email,
    sb.id,
    sb.batch_name,
    sb.batch_number,
    'REGULAR',
    sess.subject,
    sess.start_time
FROM sessions sess
JOIN subject_batches sb ON (sb.id = sess.batch_id OR sb.id = ANY(sess.batch_ids))
CROSS JOIN LATERAL unnest(sb.student_enrollments) AS unnest(usn)
LEFT JOIN students s ON UPPER(TRIM(s.enrollment_no)) = UPPER(TRIM(unnest.usn))
WHERE sess.subject IS NOT NULL
  AND unnest.usn IS NOT NULL
  AND TRIM(unnest.usn) <> ''
ON CONFLICT (session_id, enrollment_no) DO UPDATE SET
    batch_id = COALESCE(session_roster_snapshots.batch_id, EXCLUDED.batch_id),
    batch_name = COALESCE(session_roster_snapshots.batch_name, EXCLUDED.batch_name),
    batch_number = COALESCE(session_roster_snapshots.batch_number, EXCLUDED.batch_number);

-- Step 4c: Backfill activity batch sessions where activity_batches record still exists
INSERT INTO session_roster_snapshots (
    session_id, student_id, enrollment_no, student_name, student_email,
    batch_id, batch_name, batch_number, category, activity_id, created_at
)
SELECT
    sess.id,
    s.id,
    TRIM(UPPER(unnest.usn)),
    COALESCE(s.name, unnest.usn),
    s.email,
    ab.id,
    ab.batch_name,
    ab.batch_number,
    'ACTIVITY',
    sess.activity_id,
    sess.start_time
FROM sessions sess
JOIN activity_batches ab ON (ab.id = sess.batch_id OR ab.id = ANY(sess.batch_ids))
CROSS JOIN LATERAL unnest(ab.student_enrollments) AS unnest(usn)
LEFT JOIN students s ON UPPER(TRIM(s.enrollment_no)) = UPPER(TRIM(unnest.usn))
WHERE sess.activity_id IS NOT NULL
  AND unnest.usn IS NOT NULL
  AND TRIM(unnest.usn) <> ''
ON CONFLICT (session_id, enrollment_no) DO UPDATE SET
    batch_id = COALESCE(session_roster_snapshots.batch_id, EXCLUDED.batch_id),
    batch_name = COALESCE(session_roster_snapshots.batch_name, EXCLUDED.batch_name),
    batch_number = COALESCE(session_roster_snapshots.batch_number, EXCLUDED.batch_number);

-- Step 4d: Backfill whole-class sessions (where no specific batches were chosen)
INSERT INTO session_roster_snapshots (
    session_id, student_id, enrollment_no, student_name, student_email,
    batch_id, batch_name, category, subject_id, activity_id, created_at
)
SELECT
    sess.id,
    s.id,
    TRIM(UPPER(s.enrollment_no)),
    s.name,
    s.email,
    NULL,
    NULL,
    COALESCE(sess.category, 'REGULAR'),
    sess.subject,
    sess.activity_id,
    sess.start_time
FROM sessions sess
JOIN students s ON s.year = sess.year
               AND s.semester = sess.semester
               AND (sess.section IS NULL OR UPPER(TRIM(sess.section)) = 'ALL' OR UPPER(TRIM(s.section)) = UPPER(TRIM(sess.section)))
               AND (sess.department IS NULL OR s.department = sess.department)
WHERE (sess.batch_id IS NULL AND (sess.batch_ids IS NULL OR sess.batch_ids = '{}'))
ON CONFLICT (session_id, enrollment_no) DO NOTHING;
