-- ==============================================================================
-- SMARTATTEND SECURITY HARDENING MIGRATION: RLS PRIVACY RESTRICTION
-- Migration: 20260922_security_rls_hardening.sql
-- 
-- Rationale:
-- 1. Previously, "anon_read_attendances" allowed ANY client with the public
--    Supabase anon key to query all student attendance records across all colleges.
-- 2. SmartAttend attendance verification is delivered synchronously over HTTP API
--    responses and micro-batched faculty broadcasts. Public REST SELECT access
--    to the attendances table is not required and represents a privacy risk.
-- 3. Dropping this policy ensures attendance data is only accessible by the backend
--    Express API via service_role, while preserving all existing flows.
-- ==============================================================================

-- 1. Drop public/anon SELECT policy on attendances
DROP POLICY IF EXISTS "anon_read_attendances" ON attendances;

-- 2. Ensure RLS is active on attendances table
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;

-- 3. Ensure service_role policy is present and intact
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'attendances' AND policyname = 'service_role_all_attendances'
  ) THEN
    CREATE POLICY "service_role_all_attendances" 
      ON attendances FOR ALL TO service_role 
      USING (true) WITH CHECK (true);
  END IF;
END $$;
