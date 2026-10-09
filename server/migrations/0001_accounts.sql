-- Accounts hold no personal data: a name and an Argon2id password hash.
CREATE TABLE accounts (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_name_key ON accounts (lower(name));

-- Only a SHA-256 of each session id is stored; the id itself lives in the
-- player's signed session cookie.
CREATE TABLE sessions (
    id_hash    BYTEA PRIMARY KEY,
    account_id INT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_idx ON sessions (account_id);

-- Identity is relational; all progression is one versioned JSON document
-- (see server/src/progress.rs), so it can change without SQL migrations.
CREATE TABLE characters (
    id         SERIAL PRIMARY KEY,
    account_id INT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    class      TEXT NOT NULL CHECK (class IN ('Wizard', 'Paladin', 'Barbarian', 'Assassin')),
    progress   JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX characters_name_key ON characters (lower(name));
CREATE INDEX characters_account_idx ON characters (account_id);
