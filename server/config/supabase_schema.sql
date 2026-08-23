-- ========================================================================
-- SMART ATTENDANCE SYSTEM - OPTIMIZED SUPABASE POSTGRESQL SCHEMA
-- Designed for Supabase Free Tier (500MB Database Storage Optimization)
-- Features: Compact Data Types, ON DELETE CASCADE, Auto-Purge Triggers,
-- Row Level Security (RLS), and Realtime Publications.
-- Region: Mumbai (ap-south-1) / Universal Supabase PostgreSQL
-- ========================================================================

-- Enable essential extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========================================================================
-- 1. CORE ENTITY TABLES (Storage Optimized)
-- ========================================================================

-- 1.1 ADMINS TABLE
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    college_name VARCHAR(255) NOT NULL,
    profile_photo_url TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admins_email ON admins (lower(email));

-- 1.2 DEPARTMENTS TABLE
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    code VARCHAR(30) NOT NULL,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_department_name_code_admin UNIQUE (name, code, created_by_admin)
);

CREATE INDEX IF NOT EXISTS idx_departments_admin ON departments (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_departments_code ON departments (code);

-- 1.3 SUBJECTS TABLE
CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(30) NOT NULL,
    year SMALLINT NOT NULL CHECK (year BETWEEN 1 AND 4),
    semester SMALLINT NOT NULL CHECK (semester BETWEEN 1 AND 8),
    departments UUID[] NOT NULL DEFAULT '{}',
    allotted_faculties UUID[] NOT NULL DEFAULT '{}',
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_subject_code_year_sem_admin UNIQUE (code, year, semester, created_by_admin)
);

CREATE INDEX IF NOT EXISTS idx_subjects_admin ON subjects (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects (code);
CREATE INDEX IF NOT EXISTS idx_subjects_faculties ON subjects USING GIN (allotted_faculties);
CREATE INDEX IF NOT EXISTS idx_subjects_departments ON subjects USING GIN (departments);

-- ========================================================================
-- 0. WEBAUTHN / PASSKEY MIGRATION (Execute if upgrading existing tables)
-- ========================================================================
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS credential_id VARCHAR(255) DEFAULT NULL;
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS public_key TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS counter BIGINT DEFAULT 0;
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS transports TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS faculties ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS credential_id VARCHAR(255) DEFAULT NULL;
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS public_key TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS counter BIGINT DEFAULT 0;
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS transports TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS students ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE IF EXISTS device_change_requests ADD COLUMN IF NOT EXISTS requested_credential_id VARCHAR(255) DEFAULT NULL;
ALTER TABLE IF EXISTS device_change_requests ADD COLUMN IF NOT EXISTS requested_public_key TEXT DEFAULT NULL;
ALTER TABLE IF EXISTS device_change_requests ADD COLUMN IF NOT EXISTS requested_transports TEXT[] DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_faculties_credential_id ON faculties (credential_id) WHERE credential_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_credential_id ON students (credential_id) WHERE credential_id IS NOT NULL;

-- 1.4 FACULTIES TABLE
CREATE TABLE IF NOT EXISTS faculties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    profile_photo_url TEXT DEFAULT '',
    department UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(128) NOT NULL,
    credential_id VARCHAR(255) DEFAULT NULL,
    public_key TEXT DEFAULT NULL,
    counter BIGINT DEFAULT 0,
    transports TEXT[] DEFAULT '{}',
    device_bound_at TIMESTAMPTZ DEFAULT NULL,
    device_lock_enabled BOOLEAN NOT NULL DEFAULT true,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    allotted_subjects UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faculties_email ON faculties (lower(email));
CREATE INDEX IF NOT EXISTS idx_faculties_admin ON faculties (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_faculties_department ON faculties (department);
CREATE INDEX IF NOT EXISTS idx_faculties_fingerprint ON faculties (device_fingerprint);

-- 1.5 STUDENTS TABLE
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    enrollment_no VARCHAR(50) NOT NULL UNIQUE,
    year SMALLINT NOT NULL CHECK (year BETWEEN 1 AND 4),
    semester SMALLINT NOT NULL CHECK (semester BETWEEN 1 AND 8),
    section VARCHAR(20) NOT NULL,
    department UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(128) NOT NULL,
    credential_id VARCHAR(255) DEFAULT NULL,
    public_key TEXT DEFAULT NULL,
    counter BIGINT DEFAULT 0,
    transports TEXT[] DEFAULT '{}',
    device_bound_at TIMESTAMPTZ DEFAULT NULL,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    college_name VARCHAR(255) DEFAULT '',
    profile_photo_url TEXT DEFAULT '',
    face_signature TEXT DEFAULT '',
    face_signature_mirror TEXT DEFAULT '',
    face_signature_version VARCHAR(32) DEFAULT '',
    face_embedding JSONB DEFAULT NULL,
    face_embedding_model VARCHAR(50) DEFAULT '',
    face_embedding_version VARCHAR(50) DEFAULT '',
    registered_via_token VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_email ON students (lower(email));
CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students (enrollment_no);
CREATE INDEX IF NOT EXISTS idx_students_admin ON students (created_by_admin);
CREATE INDEX IF NOT EXISTS idx_students_cohort ON students (created_by_admin, department, year, semester, section);
CREATE INDEX IF NOT EXISTS idx_students_fingerprint ON students (device_fingerprint);

-- 1.6 SUBJECT ASSIGNMENTS TABLE
CREATE TABLE IF NOT EXISTS subject_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    department UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    year SMALLINT NOT NULL CHECK (year BETWEEN 1 AND 4),
    semester SMALLINT NOT NULL CHECK (semester BETWEEN 1 AND 8),
    section VARCHAR(20) NOT NULL,
    class_code VARCHAR(50) NOT NULL,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_assignment_full UNIQUE (subject, faculty, department, year, semester, section, created_by_admin),
    CONSTRAINT uq_assignment_class_faculty UNIQUE (class_code, faculty, created_by_admin)
);

CREATE INDEX IF NOT EXISTS idx_assignments_subject_fac ON subject_assignments (subject, faculty);
CREATE INDEX IF NOT EXISTS idx_assignments_admin ON subject_assignments (created_by_admin);

-- 1.7 REGISTRATION TOKENS TABLE
CREATE TABLE IF NOT EXISTS registration_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(128) NOT NULL UNIQUE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('student', 'faculty')),
    admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    college_name VARCHAR(255) DEFAULT NULL,
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
CREATE INDEX IF NOT EXISTS idx_reg_tokens_active ON registration_tokens (is_active) WHERE is_active = true;

-- ========================================================================
-- 2. ATTENDANCE & SESSION TABLES (High-Throughput / Optimized)
-- ========================================================================

-- 2.1 SESSIONS TABLE
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    department UUID REFERENCES departments(id) ON DELETE SET NULL,
    year SMALLINT NOT NULL CHECK (year BETWEEN 1 AND 4),
    semester SMALLINT NOT NULL CHECK (semester BETWEEN 1 AND 8),
    section VARCHAR(20) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time TIMESTAMPTZ DEFAULT NULL,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    location JSONB NOT NULL, -- { lat: float, lng: float, radiusMeters: float }
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial Unique Index: Exactly ONE active session allowed per faculty at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_per_faculty ON sessions (faculty) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_sessions_faculty_start ON sessions (faculty, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cohort_timeline ON sessions (year, semester, section, department, is_active, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions (is_active) WHERE is_active = true;

-- 2.2 ATTENDANCES TABLE
CREATE TABLE IF NOT EXISTS attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(20) NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent')),
    location JSONB DEFAULT NULL,
    device_fingerprint VARCHAR(128) DEFAULT NULL,
    face_verification JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_attendance_session_student UNIQUE (session, student)
);

CREATE INDEX IF NOT EXISTS idx_attendances_session_status ON attendances (session, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendances_student_time ON attendances (student, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendances_subject_faculty ON attendances (subject, faculty, timestamp DESC);

-- 2.3 ATTENDANCE AUDITS TABLE (Auto-Pruned)
CREATE TABLE IF NOT EXISTS attendance_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance UUID REFERENCES attendances(id) ON DELETE SET NULL,
    session UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    faculty UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    subject UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    method VARCHAR(30) NOT NULL,
    actor_role VARCHAR(20) NOT NULL CHECK (actor_role IN ('STUDENT', 'FACULTY', 'ADMIN')),
    actor UUID NOT NULL,
    device_fingerprint VARCHAR(128) DEFAULT '',
    location JSONB DEFAULT NULL,
    qr JSONB DEFAULT NULL,
    face_verification JSONB DEFAULT NULL,
    request_meta JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audits_session_student ON attendance_audits (session, student);
CREATE INDEX IF NOT EXISTS idx_audits_created_at ON attendance_audits (created_at DESC);

-- 2.4 DEVICE CHANGE REQUESTS TABLE
CREATE TABLE IF NOT EXISTS device_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    department UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_by_admin UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    old_device_fingerprint VARCHAR(128) NOT NULL,
    requested_device_fingerprint VARCHAR(128) NOT NULL,
    selfie_data_url TEXT DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    reviewed_by UUID REFERENCES faculties(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    review_note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_req_dept_status ON device_change_requests (department, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_device_req_student ON device_change_requests (student, created_at DESC);

-- ========================================================================
-- 3. EPHEMERAL & TEMPORARY SESSION TABLES (Zero Storage Bloat)
-- ========================================================================

-- 3.1 QR ROTATING STATES
CREATE TABLE IF NOT EXISTS qr_states (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    state JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qr_states_expires ON qr_states (expires_at);

-- 3.2 TOTP SECRETS
CREATE TABLE IF NOT EXISTS totp_secrets (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    secret_key VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_totp_secrets_expires ON totp_secrets (expires_at);

-- 3.3 SCAN GRANTS (Temporary 2-step token)
CREATE TABLE IF NOT EXISTS scan_grants (
    grant_token VARCHAR(128) PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    fingerprint VARCHAR(128) NOT NULL,
    consumed BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_grants_expires ON scan_grants (expires_at);
CREATE INDEX IF NOT EXISTS idx_scan_grants_student_session ON scan_grants (student_id, session_id);

-- 3.4 MOBILE LOCATION CAPTURES
CREATE TABLE IF NOT EXISTS mobile_location_captures (
    token VARCHAR(128) PRIMARY KEY,
    faculty_id UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    coords JSONB DEFAULT NULL,
    accuracy REAL DEFAULT NULL,
    device_label VARCHAR(100) DEFAULT NULL,
    captured_at TIMESTAMPTZ DEFAULT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loc_captures_expires ON mobile_location_captures (expires_at);

-- 3.5 REFRESH TOKENS (JWT Sessions)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- ========================================================================
-- 4. STORAGE SAVER: AUTOMATIC PURGE FUNCTIONS & TRIGGERS (Free Tier Saver)
-- ========================================================================

-- Master purge function to clean all stale & expired temporary data
CREATE OR REPLACE FUNCTION purge_expired_attendance_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_purged_grants INT := 0;
    v_purged_qr INT := 0;
    v_purged_totp INT := 0;
    v_purged_tokens INT := 0;
    v_purged_locs INT := 0;
    v_purged_audits INT := 0;
BEGIN
    -- 1. Purge expired scan grants
    DELETE FROM scan_grants WHERE expires_at < now() - INTERVAL '5 minutes';
    GET DIAGNOSTICS v_purged_grants = ROW_COUNT;

    -- 2. Purge stale QR states
    DELETE FROM qr_states WHERE expires_at < now() - INTERVAL '15 minutes';
    GET DIAGNOSTICS v_purged_qr = ROW_COUNT;

    -- 3. Purge stale TOTP secrets
    DELETE FROM totp_secrets WHERE expires_at < now() - INTERVAL '15 minutes';
    GET DIAGNOSTICS v_purged_totp = ROW_COUNT;

    -- 4. Purge expired refresh tokens
    DELETE FROM refresh_tokens WHERE expires_at < now();
    GET DIAGNOSTICS v_purged_tokens = ROW_COUNT;

    -- 5. Purge expired mobile location requests
    DELETE FROM mobile_location_captures WHERE expires_at < now() - INTERVAL '10 minutes';
    GET DIAGNOSTICS v_purged_locs = ROW_COUNT;

    -- 6. Purge old audit logs (> 90 days old) to protect the 500MB free quota
    DELETE FROM attendance_audits WHERE created_at < now() - INTERVAL '90 days';
    GET DIAGNOSTICS v_purged_audits = ROW_COUNT;

    -- 7. Mark expired device change requests
    UPDATE device_change_requests 
    SET status = 'expired', updated_at = now() 
    WHERE status = 'pending' AND expires_at < now();

    RETURN jsonb_build_object(
        'success', true,
        'purged_grants', v_purged_grants,
        'purged_qr_states', v_purged_qr,
        'purged_totp_secrets', v_purged_totp,
        'purged_refresh_tokens', v_purged_tokens,
        'purged_location_captures', v_purged_locs,
        'purged_audits_90d', v_purged_audits,
        'cleaned_at', now()
    );
END;
$$;

-- Trigger Function: Opportunistically cleans expired tokens on new insertions
CREATE OR REPLACE FUNCTION trigger_cleanup_stale_ephemeral()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Fast non-blocking cleanup of records already expired
    IF TG_TABLE_NAME = 'scan_grants' THEN
        DELETE FROM scan_grants WHERE expires_at < now();
    ELSIF TG_TABLE_NAME = 'refresh_tokens' THEN
        DELETE FROM refresh_tokens WHERE expires_at < now();
    ELSIF TG_TABLE_NAME = 'mobile_location_captures' THEN
        DELETE FROM mobile_location_captures WHERE expires_at < now();
    END IF;
    RETURN NEW;
END;
$$;

-- Attach auto-cleanup triggers
DROP TRIGGER IF EXISTS trg_cleanup_scan_grants ON scan_grants;
CREATE TRIGGER trg_cleanup_scan_grants
AFTER INSERT ON scan_grants
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_cleanup_stale_ephemeral();

DROP TRIGGER IF EXISTS trg_cleanup_refresh_tokens ON refresh_tokens;
CREATE TRIGGER trg_cleanup_refresh_tokens
AFTER INSERT ON refresh_tokens
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_cleanup_stale_ephemeral();

-- ========================================================================
-- 5. ATOMIC RPC HELPER FUNCTIONS
-- ========================================================================

-- Reserve registration token slot atomically
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

-- ========================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================================================

-- Enable RLS across all tables
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculties ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE totp_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_location_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- 6.1 SERVICE_ROLE FULL ACCESS (Backend API with service_role secret)
-- The Express.js backend connects via SUPABASE_SERVICE_ROLE_KEY and has full access.
DROP POLICY IF EXISTS "service_role_all_admins" ON admins;
CREATE POLICY "service_role_all_admins" ON admins FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_departments" ON departments;
CREATE POLICY "service_role_all_departments" ON departments FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_subjects" ON subjects;
CREATE POLICY "service_role_all_subjects" ON subjects FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_faculties" ON faculties;
CREATE POLICY "service_role_all_faculties" ON faculties FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_students" ON students;
CREATE POLICY "service_role_all_students" ON students FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_assignments" ON subject_assignments;
CREATE POLICY "service_role_all_assignments" ON subject_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_tokens" ON registration_tokens;
CREATE POLICY "service_role_all_tokens" ON registration_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_sessions" ON sessions;
CREATE POLICY "service_role_all_sessions" ON sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_attendances" ON attendances;
CREATE POLICY "service_role_all_attendances" ON attendances FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_audits" ON attendance_audits;
CREATE POLICY "service_role_all_audits" ON attendance_audits FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_device_reqs" ON device_change_requests;
CREATE POLICY "service_role_all_device_reqs" ON device_change_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_qr" ON qr_states;
CREATE POLICY "service_role_all_qr" ON qr_states FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_totp" ON totp_secrets;
CREATE POLICY "service_role_all_totp" ON totp_secrets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_grants" ON scan_grants;
CREATE POLICY "service_role_all_grants" ON scan_grants FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_location" ON mobile_location_captures;
CREATE POLICY "service_role_all_location" ON mobile_location_captures FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_refresh" ON refresh_tokens;
CREATE POLICY "service_role_all_refresh" ON refresh_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6.2 ANON / PUBLIC POLICIES (Read-only / Frontend Realtime channels)
-- Allows frontend clients with anon key to listen for Realtime broadcast events
DROP POLICY IF EXISTS "anon_read_active_sessions" ON sessions;
CREATE POLICY "anon_read_active_sessions" ON sessions FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS "anon_read_attendances" ON attendances;
CREATE POLICY "anon_read_attendances" ON attendances FOR SELECT TO anon, authenticated USING (true);

-- ========================================================================
-- 7. SUPABASE REALTIME PUBLICATION SETUP
-- ========================================================================

-- Enable Realtime replication for live dashboard attendance updates
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'attendances'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE attendances;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'sessions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END;
$$;
