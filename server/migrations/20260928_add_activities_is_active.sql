-- Migration: 20260928_add_activities_is_active.sql
-- Description: Add is_active column to activities table for lifecycle status and archiving.

ALTER TABLE IF EXISTS activities 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_activities_faculty_active 
ON activities (faculty, is_active);
