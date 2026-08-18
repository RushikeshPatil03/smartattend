-- ========================================================================
-- SMART ATTENDANCE SYSTEM - SUPABASE POSTGRESQL SCHEMA
-- Complete, production-grade schema with Foreign Keys, Partial Indexes,
-- JSONB columns, RLS Policies, and Realtime publication.
-- ========================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------
-- 1. ADMINS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    college_name TEXT NOT NULL,
    profile_photo_url TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admins_email ON admins (lower(email));

-- ------------------------------------------------------------------------
-- 2. DEPARTMENTS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_department_name_code_admin UNIQUE (name, code, created_by_admin)
);

CREATE INDEX IF NOT EXISTS idx_departments_admin ON departments (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_departments_code ON departments (code);

-- ------------------------------------------------------------------------
-- 3. SUBJECTS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    year INT NOT NULL CHECK (year BETWEEN 1 AND 4),
    semester INT NOT NULL CHECK (semester BETWEEN 1 AND 8),
    departments UUID[] NOT NULL DEFAULT '{}',
    allotted_faculties UUID[] NOT NULL DEFAULT '{}',
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_subject_code_year_sem_admin UNIQUE (code, year, semester, created_by_admin)
);

CREATE INDEX IF NOT EXISTS idx_subjects_admin ON subjects (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects (code);
CREATE INDEX IF NOT EXISTS idx_subjects_allotted_faculties ON subjects USING GIN (allotted_faculties);
CREATE INDEX IF NOT EXISTS idx_subjects_departments ON subjects USING GIN (departments);

-- ------------------------------------------------------------------------
-- 4. FACULTIES TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faculties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    profile_photo_url TEXT DEFAULT '',
    department UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    device_fingerprint TEXT NOT NULL,
    device_lock_enabled BOOLEAN NOT NULL DEFAULT true,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    allotted_subjects UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faculties_email ON faculties (lower(email));
CREATE INDEX IF NOT EXISTS idx_faculties_admin ON faculties (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_faculties_department ON faculties (department);
CREATE INDEX IF NOT EXISTS idx_faculties_device_fingerprint ON faculties (device_fingerprint);

-- ------------------------------------------------------------------------
-- 5. STUDENTS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    enrollment_no TEXT NOT NULL UNIQUE,
    year INT NOT NULL,
    semester INT NOT NULL,
    section TEXT NOT NULL,
    department UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    device_fingerprint TEXT NOT NULL,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    college_name TEXT DEFAULT '',
    profile_photo_url TEXT DEFAULT '',
    face_signature TEXT DEFAULT '',
    face_signature_mirror TEXT DEFAULT '',
    face_signature_version TEXT DEFAULT '',
    face_embedding JSONB DEFAULT NULL,
    face_embedding_model TEXT DEFAULT '',
    face_embedding_version TEXT DEFAULT '',
    registered_via_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_email ON students (lower(email));
CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students (enrollment_no);
CREATE INDEX IF NOT EXISTS idx_students_admin ON students (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_students_department ON students (department);
CREATE INDEX IF NOT EXISTS idx_students_device_fingerprint ON students (device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_students_cohort ON students (created_by_admin, department, year, semester, section);

-- ------------------------------------------------------------------------
-- 6. SUBJECT ASSIGNMENTS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subject_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    department UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    year INT NOT NULL,
    semester INT NOT NULL,
    section TEXT NOT NULL,
    class_code TEXT NOT NULL,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_assignment_full UNIQUE (subject, department, year, semester, section, created_by_admin),
    CONSTRAINT uq_assignment_class_code UNIQUE (class_code, created_by_admin)
);

CREATE INDEX IF NOT EXISTS idx_assignments_subject ON subject_assignments (subject);
CREATE INDEX IF NOT EXISTS idx_assignments_faculty ON subject_assignments (faculty);
CREATE INDEX IF NOT EXISTS idx_assignments_admin ON subject_assignments (created_by_admin);

-- ------------------------------------------------------------------------
-- 7. REGISTRATION TOKENS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('student', 'faculty')),
    admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    college_name TEXT DEFAULT NULL,
    expires_at TIMESTAMPTZ DEFAULT NULL,
    max_uses INT NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
    uses_count INT NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_tokens_token ON registration_tokens (token);
CREATE INDEX IF NOT EXISTS idx_reg_tokens_admin ON registration_tokens (admin_id);
CREATE INDEX IF NOT EXISTS idx_reg_tokens_expires ON registration_tokens (expires_at);

-- ------------------------------------------------------------------------
-- 8. SESSIONS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    department UUID REFERENCES departments(id) ON DELETE SET NULL,
    year INT NOT NULL,
    semester INT NOT NULL,
    section TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time TIMESTAMPTZ DEFAULT NULL,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    location JSONB NOT NULL, -- { lat: float, lng: float, radiusMeters: float }
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial Unique Index: Only ONE active session allowed per faculty at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_per_faculty ON sessions (faculty) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_sessions_faculty_start ON sessions (faculty, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cohort_timeline ON sessions (year, semester, section, department, is_active, start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_subject_timeline ON sessions (subject, year, semester, section, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions (is_active);

-- ------------------------------------------------------------------------
-- 9. ATTENDANCES TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent')),
    location JSONB DEFAULT NULL, -- { lat: float, lng: float }
    device_fingerprint TEXT DEFAULT NULL,
    face_verification JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_attendance_session_student UNIQUE (session, student)
);

CREATE INDEX IF NOT EXISTS idx_attendances_session_status ON attendances (session, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendances_student_time ON attendances (student, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendances_subject_faculty ON attendances (subject, faculty, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendances_faculty_time ON attendances (faculty, timestamp DESC);

-- ------------------------------------------------------------------------
-- 10. ATTENDANCE AUDITS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance UUID REFERENCES attendances(id) ON DELETE SET NULL,
    session UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- MARK_PRESENT, MANUAL_PRESENT, MANUAL_ABSENT, TOTP_VERIFIED
    method TEXT NOT NULL, -- QR_TWO_STEP, QR_TOTP, MANUAL
    actor_role TEXT NOT NULL CHECK (actor_role IN ('STUDENT', 'FACULTY', 'ADMIN')),
    actor UUID NOT NULL,
    device_fingerprint TEXT DEFAULT '',
    location JSONB DEFAULT NULL, -- { lat, lng, accuracy }
    qr JSONB DEFAULT NULL, -- { firstIat, secondIat, gapSeconds }
    face_verification JSONB DEFAULT NULL,
    request_meta JSONB DEFAULT NULL, -- { ip, userAgent }
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audits_session_student ON attendance_audits (session, student, action);
CREATE INDEX IF NOT EXISTS idx_audits_created_at ON attendance_audits (created_at DESC);

-- ------------------------------------------------------------------------
-- 11. DEVICE CHANGE REQUESTS TABLE
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    department UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    old_device_fingerprint TEXT NOT NULL,
    requested_device_fingerprint TEXT NOT NULL,
    selfie_data_url TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    reviewed_by UUID REFERENCES faculties(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    review_note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_requests_student ON device_change_requests (student, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_requests_dept_status ON device_change_requests (department, status, expires_at);

-- ------------------------------------------------------------------------
-- 12. EPHEMERAL STATE TABLES (Zero Redis Dependency)
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qr_states (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    state JSONB NOT NULL, -- { recentTokenHashes: [], lastIssuedAt: number, lastToken: string }
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS totp_secrets (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    secret_key TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_grants (
    grant_token TEXT PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    consumed BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_grants_student ON scan_grants (student_id);

CREATE TABLE IF NOT EXISTS mobile_location_captures (
    token TEXT PRIMARY KEY,
    faculty_id UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, captured
    coords JSONB DEFAULT NULL, -- { lat, lng }
    accuracy FLOAT DEFAULT NULL,
    device_label TEXT DEFAULT NULL,
    captured_at TIMESTAMPTZ DEFAULT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ------------------------------------------------------------------------
-- 13. ATOMIC RPC HELPER FUNCTIONS
-- ------------------------------------------------------------------------

-- Reserve a registration token slot atomically
CREATE OR REPLACE FUNCTION reserve_registration_slot(p_token_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token RECORD;
BEGIN
    UPDATE registration_tokens
    SET uses_count = uses_count + 1,
        last_used_at = now(),
        is_active = CASE WHEN uses_count + 1 >= max_uses THEN false ELSE is_active END,
        updated_at = now()
    WHERE id = p_token_id
      AND is_active = true
      AND uses_count < max_uses
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING * INTO v_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Registration token limit reached or token expired');
    END IF;

    RETURN jsonb_build_object('ok', true, 'token', row_to_json(v_token));
END;
$$;

-- Release a reserved registration token slot on rollback
CREATE OR REPLACE FUNCTION release_registration_slot(p_token_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE registration_tokens
    SET uses_count = GREATEST(uses_count - 1, 0),
        is_active = CASE WHEN (expires_at IS NULL OR expires_at > now()) THEN true ELSE is_active END,
        updated_at = now()
    WHERE id = p_token_id;
END;
$$;

-- ------------------------------------------------------------------------
-- 14. REALTIME PUBLICATION SETUP
-- ------------------------------------------------------------------------
-- Enable Supabase Realtime for attendances table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'attendances'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE attendances;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END;
$$;
