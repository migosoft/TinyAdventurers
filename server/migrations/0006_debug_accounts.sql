-- Debug accounts (#151): only characters of these accounts may use debug mode, and they never play with others.
ALTER TABLE accounts ADD COLUMN debug BOOLEAN NOT NULL DEFAULT false;

-- One-time wipe (#151): the old ?debug let anyone buy and grant for free; nobody keeps progress from before debug accounts.
UPDATE characters SET progress = '{}';
