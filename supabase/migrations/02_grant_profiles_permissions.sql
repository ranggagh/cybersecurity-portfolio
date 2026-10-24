-- =====================================================================
-- Migration 02: Grant Table Permissions on public.profiles
-- Target: Supabase PostgreSQL (SQL Editor)
-- Purpose: Fix code 42501 (permission denied for table profiles)
-- Note: Row Level Security (RLS) policies continue to enforce row access
-- =====================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
