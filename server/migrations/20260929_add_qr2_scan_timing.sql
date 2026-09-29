-- Migration: 20260929_add_qr2_scan_timing.sql
-- Description: Add qr2_scan_timing_ms column to attendances table for faculty timing review metrics.

ALTER TABLE IF EXISTS attendances
ADD COLUMN IF NOT EXISTS qr2_scan_timing_ms INTEGER;

-- Index for session-level timing statistics queries
CREATE INDEX IF NOT EXISTS idx_attendances_session_timing
ON attendances (session, qr2_scan_timing_ms)
WHERE qr2_scan_timing_ms IS NOT NULL;
