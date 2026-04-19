-- Migration: 20240101000004_users_search_index.sql
-- Adds a GIN trigram index on users.username so that the user-search endpoint
-- (ILIKE '%query%') is index-scanned rather than sequentially scanned.
-- pg_trgm is already enabled by migration 3; this is safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_users_username_trgm
    ON users USING GIN (username gin_trgm_ops);
