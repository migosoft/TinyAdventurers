-- History for the admin statistics. These tables deliberately have no foreign
-- keys to accounts or characters: when an account is deleted its name goes
-- with it, and what stays is an anonymous id, so past counts do not change.

-- One row per account and day it logged in or connected (UTC days).
CREATE TABLE activity_days (
    account_id INT  NOT NULL,
    day        DATE NOT NULL,
    PRIMARY KEY (account_id, day)
);
CREATE INDEX activity_days_day_idx ON activity_days (day);

-- One row per dungeon run that ended (won, lost, or left by everyone).
CREATE TABLE runs (
    id         BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    boss       TEXT NOT NULL,
    outcome    TEXT NOT NULL CHECK (outcome IN ('victory', 'defeat', 'abandoned')),
    duration_s REAL NOT NULL,
    players    SMALLINT NOT NULL,
    -- Someone used debug mode: kept for completeness, left out of the stats.
    debug      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX runs_started_idx ON runs (started_at);

CREATE TABLE run_players (
    run_id       BIGINT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    account_id   INT,
    character_id INT,
    class        TEXT NOT NULL,
    kills        INT NOT NULL,
    damage       REAL NOT NULL,
    healing      REAL NOT NULL,
    xp           INT NOT NULL,
    coins        INT NOT NULL,
    survived     BOOLEAN NOT NULL
);
CREATE INDEX run_players_run_idx ON run_players (run_id);
CREATE INDEX run_players_account_idx ON run_players (account_id);

-- What admins did, and to whom (the name at that time).
CREATE TABLE admin_actions (
    id     BIGSERIAL PRIMARY KEY,
    at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin  TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT
);

CREATE INDEX accounts_created_idx ON accounts (created_at);
CREATE INDEX characters_created_idx ON characters (created_at);
