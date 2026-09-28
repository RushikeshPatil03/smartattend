-- Migration: 20260928_batch_transfer_auditing.sql
-- Description: Add audit columns to session_roster_snapshots for tracking batch reassignments
-- and indices for high-performance cross-batch student queries.

-- 1. Support Batch Transfer Tracking in Snapshots
ALTER TABLE IF EXISTS session_roster_snapshots
ADD COLUMN IF NOT EXISTS transferred_to_batch_id UUID REFERENCES subject_batches(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS transfer_note TEXT DEFAULT NULL;

-- 2. Index for Rapid Cross-Batch Lookup
CREATE INDEX IF NOT EXISTS idx_snapshots_student_subject 
ON session_roster_snapshots(subject_id, enrollment_no);

CREATE INDEX IF NOT EXISTS idx_attendances_student_subject 
ON attendances(subject, student, timestamp DESC);
