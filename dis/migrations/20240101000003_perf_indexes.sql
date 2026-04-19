-- Migration: 20240101000003_perf_indexes.sql
-- Performance indexes: trigram search on channel names, and a reverse-direction
-- B-tree index on the friends table so lookups by user_id_2 are equally fast.

-- ── Trigram channel search ────────────────────────────────────────────────────
-- discover_channels uses `ILIKE '%query%'` on channels.name.  Without a GIN
-- trigram index this becomes a sequential scan that grows linearly with the
-- number of channels.  The pg_trgm extension ships with postgres and converts
-- an ILIKE pattern into an indexed set intersection.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_channels_name_trgm
    ON channels USING GIN (name gin_trgm_ops);

-- ── Friends reverse-direction lookup ─────────────────────────────────────────
-- The friends table enforces user_id_1 < user_id_2 for uniqueness, so the PK
-- covers lookups where the user is user_id_1.  But list_friends needs to find
-- rows where the user is EITHER side:
--   WHERE (user_id_1 = $1 OR user_id_2 = $1)
-- Without a second index, the user_id_2 side requires a full table scan.
CREATE INDEX IF NOT EXISTS idx_friends_user_id_2
    ON friends (user_id_2);
