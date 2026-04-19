-- Migration: 20240101000002_social_features.sql
-- Adds channel ownership, membership, join requests, invites, and friend system.

-- ── Extend channels ───────────────────────────────────────────────────────────
ALTER TABLE channels
    ADD COLUMN description TEXT,
    ADD COLUMN is_public   BOOLEAN     NOT NULL DEFAULT true,
    ADD COLUMN created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN is_direct   BOOLEAN     NOT NULL DEFAULT false;

-- ── Channel members ───────────────────────────────────────────────────────────
-- Tracks who belongs to a channel and their role.
-- Public channels: members are users who explicitly joined.
-- Private channels: membership is required to read/write.
CREATE TABLE channel_members (
    channel_id UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL DEFAULT 'member'
                           CHECK (role IN ('admin', 'member')),
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_channel_members_user ON channel_members (user_id);

-- ── Join requests (private channels) ─────────────────────────────────────────
CREATE TABLE join_requests (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    status     VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, user_id)
);

CREATE INDEX idx_join_requests_channel_pending
    ON join_requests (channel_id)
    WHERE status = 'pending';

-- ── Channel invites (admin → user) ────────────────────────────────────────────
CREATE TABLE channel_invites (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    inviter_id UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    invitee_id UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    status     VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, invitee_id)
);

CREATE INDEX idx_channel_invites_invitee_pending
    ON channel_invites (invitee_id)
    WHERE status = 'pending';

-- ── Friend requests ───────────────────────────────────────────────────────────
CREATE TABLE friend_requests (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sender_id, receiver_id),
    CHECK (sender_id != receiver_id)
);

CREATE INDEX idx_friend_requests_receiver_pending
    ON friend_requests (receiver_id)
    WHERE status = 'pending';

-- ── Friends + shared DM channel ───────────────────────────────────────────────
-- user_id_1 < user_id_2 so each pair is stored exactly once.
CREATE TABLE friends (
    user_id_1     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id_2     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dm_channel_id UUID        REFERENCES channels(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id_1, user_id_2),
    CHECK (user_id_1 < user_id_2)
);
