-- ========================================================================
-- SMARTATTEND MIGRATION: High-Throughput Atomic Attendance Check-In RPC
--
-- Collapses 4-5 network round-trips into ONE atomic stored procedure.
-- Validates session status, cohort eligibility, section match, and batch roster,
-- performs idempotent ON CONFLICT (session, student) DO NOTHING insertion,
-- updates session last_activity_at, and returns structured JSONB for
-- immediate WebSocket/Realtime broadcast and frontend response.
-- ========================================================================

CREATE OR REPLACE FUNCTION mark_student_attendance_atomic(
    p_session_id UUID,
    p_student_id UUID,
    p_device_fingerprint VARCHAR(128),
    p_location JSONB DEFAULT NULL,
    p_face_verification JSONB DEFAULT NULL,
    p_qr2_scan_timing_ms INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session RECORD;
    v_student RECORD;
    v_subject RECORD;
    v_attendance RECORD;
    v_dept_code VARCHAR(50);
    v_session_section VARCHAR(50);
    v_student_section VARCHAR(50);
    v_student_usn VARCHAR(50);
    v_batch_id UUID := NULL;
    v_is_batch_restricted BOOLEAN := false;
    v_snap_batch_id UUID;
    v_snap_batch_name VARCHAR(255);
    v_snap_batch_number INT;
    v_snap_count INT := 0;
    v_matched_batch_id UUID;
    v_is_activity BOOLEAN := false;
BEGIN
    -- 1. Lock & Verify Session
    SELECT *
    INTO v_session
    FROM sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'SESSION_NOT_FOUND',
            'message', 'Session not found'
        );
    END IF;

    IF NOT COALESCE(v_session.is_active, false) THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'SESSION_EXPIRED',
            'message', 'Session is no longer active'
        );
    END IF;

    -- 2. Verify Student
    SELECT *
    INTO v_student
    FROM students
    WHERE id = p_student_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'STUDENT_NOT_FOUND',
            'message', 'Student record not found'
        );
    END IF;

    -- Fetch subject metadata
    SELECT *
    INTO v_subject
    FROM subjects
    WHERE id = v_session.subject;

    -- 2.1 College Check
    IF v_subject.created_by_admin IS NOT NULL 
       AND v_student.created_by_admin IS NOT NULL 
       AND v_subject.created_by_admin <> v_student.created_by_admin THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'COLLEGE_MISMATCH',
            'message', 'Student does not belong to this college'
        );
    END IF;

    -- 2.2 Department Check
    IF v_session.department IS NOT NULL AND v_student.department IS NOT NULL THEN
        IF v_session.department <> v_student.department THEN
            RETURN jsonb_build_object(
                'ok', false,
                'code', 'ELIGIBILITY_MISMATCH',
                'message', 'Student not enrolled in this session department'
            );
        END IF;
    ELSIF v_student.department IS NOT NULL 
          AND v_subject.departments IS NOT NULL 
          AND array_length(v_subject.departments, 1) > 0 THEN
        IF NOT (v_student.department::text = ANY(v_subject.departments::text[])) THEN
            RETURN jsonb_build_object(
                'ok', false,
                'code', 'ELIGIBILITY_MISMATCH',
                'message', 'Student not enrolled in this session department'
            );
        END IF;
    END IF;

    -- 2.3 Year & Semester Check
    IF v_session.year IS NOT NULL AND v_student.year IS NOT NULL AND v_session.year <> v_student.year THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'ELIGIBILITY_MISMATCH',
            'message', format('Academic mismatch: You are in Year %s, but this lecture is for Year %s', v_student.year, v_session.year)
        );
    END IF;

    IF v_session.semester IS NOT NULL AND v_student.semester IS NOT NULL AND v_session.semester <> v_student.semester THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'ELIGIBILITY_MISMATCH',
            'message', format('Academic mismatch: You are in Semester %s, but this lecture is for Semester %s', v_student.semester, v_session.semester)
        );
    END IF;

    -- 2.4 Section Check (Case-Insensitive, Multi-Section & Wildcard Aware)
    v_session_section := upper(trim(COALESCE(v_session.section, '')));
    v_student_section := upper(trim(COALESCE(v_student.section, '')));

    IF v_session_section <> '' AND v_session_section <> 'ALL' AND v_session_section <> '*' THEN
        IF v_student_section = '' THEN
            RETURN jsonb_build_object(
                'ok', false,
                'code', 'ELIGIBILITY_MISMATCH',
                'message', format('Section mismatch: You have no section assigned in your profile, but this lecture is restricted to Section %s.', v_session.section)
            );
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM regexp_split_to_table(v_session_section, '[,/&|]+') AS s(part)
            WHERE trim(s.part) = v_student_section
        ) THEN
            RETURN jsonb_build_object(
                'ok', false,
                'code', 'ELIGIBILITY_MISMATCH',
                'message', format('Section mismatch: You are registered in Section %s, but this lecture is for Section %s.', v_student.section, v_session.section)
            );
        END IF;
    END IF;

    -- 2.5 Batch Enrollment Check
    v_student_usn := upper(trim(COALESCE(v_student.enrollment_no, '')));
    v_is_batch_restricted := (
        (v_session.batch_id IS NOT NULL AND upper(v_session.batch_id::text) <> 'ALL') OR
        (v_session.batch_ids IS NOT NULL AND array_length(v_session.batch_ids, 1) > 0)
    );

    IF v_is_batch_restricted THEN
        -- Check immutable roster snapshot first
        SELECT batch_id, batch_name, batch_number
        INTO v_snap_batch_id, v_snap_batch_name, v_snap_batch_number
        FROM session_roster_snapshots
        WHERE session_id = p_session_id
          AND upper(trim(enrollment_no)) = v_student_usn
        LIMIT 1;

        IF FOUND THEN
            v_batch_id := COALESCE(v_snap_batch_id, v_session.batch_id);
        ELSE
            -- Check if snapshots exist for this session
            SELECT count(*) INTO v_snap_count
            FROM session_roster_snapshots
            WHERE session_id = p_session_id;

            IF v_snap_count > 0 THEN
                RETURN jsonb_build_object(
                    'ok', false,
                    'code', 'ELIGIBILITY_MISMATCH',
                    'message', 'You are not enrolled in this batch session roster. Please scan during your assigned session.'
                );
            ELSE
                -- Fallback to live subject_batches or activity_batches table
                v_is_activity := (v_session.category = 'ACTIVITY' OR v_session.activity_id IS NOT NULL);
                IF v_is_activity THEN
                    SELECT id, batch_name, batch_number
                    INTO v_matched_batch_id, v_snap_batch_name, v_snap_batch_number
                    FROM activity_batches
                    WHERE activity_id = v_session.activity_id
                      AND (
                          (v_session.batch_id IS NOT NULL AND id = v_session.batch_id) OR
                          (v_session.batch_ids IS NOT NULL AND id::text = ANY(v_session.batch_ids::text[]))
                      )
                      AND v_student_usn = ANY(SELECT upper(trim(u)) FROM unnest(student_enrollments) AS u)
                    LIMIT 1;
                ELSE
                    SELECT id, batch_name, batch_number
                    INTO v_matched_batch_id, v_snap_batch_name, v_snap_batch_number
                    FROM subject_batches
                    WHERE subject_id = v_session.subject
                      AND (
                          (v_session.batch_id IS NOT NULL AND id = v_session.batch_id) OR
                          (v_session.batch_ids IS NOT NULL AND id::text = ANY(v_session.batch_ids::text[]))
                      )
                      AND v_student_usn = ANY(SELECT upper(trim(u)) FROM unnest(student_enrollments) AS u)
                    LIMIT 1;
                END IF;

                IF NOT FOUND THEN
                    RETURN jsonb_build_object(
                        'ok', false,
                        'code', 'ELIGIBILITY_MISMATCH',
                        'message', 'You are not enrolled in this batch session. Please scan during your assigned session.'
                    );
                END IF;
                v_batch_id := v_matched_batch_id;
            END IF;
        END IF;
    ELSE
        v_batch_id := v_session.batch_id;
    END IF;

    -- Lookup student department code
    SELECT code INTO v_dept_code
    FROM departments
    WHERE id = v_student.department;

    -- 3. Atomic Upsert with Concurrency Guard (ON CONFLICT DO NOTHING)
    INSERT INTO attendances (
        session,
        student,
        faculty,
        subject,
        enrollment_no,
        student_name,
        student_email,
        department_code,
        semester,
        section,
        year,
        batch_id,
        category,
        activity_id,
        timestamp,
        status,
        location,
        device_fingerprint,
        face_verification,
        qr2_scan_timing_ms
    ) VALUES (
        p_session_id,
        p_student_id,
        v_session.faculty,
        v_session.subject,
        v_student.enrollment_no,
        v_student.name,
        v_student.email,
        v_dept_code,
        COALESCE(v_student.semester, v_session.semester),
        upper(trim(COALESCE(v_student.section, v_session.section))),
        COALESCE(v_student.year, v_session.year),
        v_batch_id,
        COALESCE(v_session.category, 'REGULAR'),
        v_session.activity_id,
        now(),
        'present',
        p_location,
        p_device_fingerprint,
        p_face_verification,
        p_qr2_scan_timing_ms
    )
    ON CONFLICT (session, student) DO NOTHING
    RETURNING * INTO v_attendance;

    -- Keep session last_activity_at warm
    UPDATE sessions
    SET last_activity_at = now()
    WHERE id = p_session_id;

    IF v_attendance.id IS NULL THEN
        -- Record already existed! Fetch it
        SELECT * INTO v_attendance
        FROM attendances
        WHERE session = p_session_id AND student = p_student_id
        LIMIT 1;

        RETURN jsonb_build_object(
            'ok', true,
            'already_marked', true,
            'attendance', row_to_json(v_attendance),
            'student', jsonb_build_object(
                'id', v_student.id,
                'name', v_student.name,
                'enrollment_no', v_student.enrollment_no,
                'email', v_student.email
            ),
            'session', jsonb_build_object(
                'id', v_session.id,
                'subject_name', v_subject.name,
                'subject_code', v_subject.code,
                'section', v_session.section
            )
        );
    ELSE
        -- Newly inserted attendance
        RETURN jsonb_build_object(
            'ok', true,
            'already_marked', false,
            'attendance', row_to_json(v_attendance),
            'student', jsonb_build_object(
                'id', v_student.id,
                'name', v_student.name,
                'enrollment_no', v_student.enrollment_no,
                'email', v_student.email
            ),
            'session', jsonb_build_object(
                'id', v_session.id,
                'subject_name', v_subject.name,
                'subject_code', v_subject.code,
                'section', v_session.section
            )
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_student_attendance_atomic(UUID, UUID, VARCHAR, JSONB, JSONB, INT) TO anon, authenticated, service_role;
