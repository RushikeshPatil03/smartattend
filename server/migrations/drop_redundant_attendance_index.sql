-- ========================================================================
-- SMARTATTEND MIGRATION: Drop Redundant Attendance Index
--
-- Background:
-- In table `attendances`, PostgreSQL creates a backing unique index for
-- `CONSTRAINT uq_attendance_session_student UNIQUE (session, student)`.
-- The manual `idx_attendances_session_student_uniq` was an exact duplicate,
-- doubling index maintenance write I/O on every single check-in burst.
--
-- This migration drops the duplicate manual index while leaving the
-- table constraint and its primary unique index 100% intact.
-- ========================================================================

DROP INDEX IF EXISTS public.idx_attendances_session_student_uniq;
