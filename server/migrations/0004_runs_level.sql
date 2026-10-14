-- Runs can play other level types than the boss dungeon; not every level has a boss.
ALTER TABLE runs ADD COLUMN level TEXT NOT NULL DEFAULT 'Dungeon';
ALTER TABLE runs ALTER COLUMN boss DROP NOT NULL;
