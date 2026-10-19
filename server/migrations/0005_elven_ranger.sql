-- The Assassin becomes the Elven Ranger. The user approved wiping the game data
-- (2026-10-16): every character, run and run record goes. Accounts, sessions,
-- activity_days and admin_actions stay.
DELETE FROM run_players;
DELETE FROM runs;
DELETE FROM characters;
ALTER TABLE characters DROP CONSTRAINT characters_class_check;
ALTER TABLE characters ADD CONSTRAINT characters_class_check
    CHECK (class IN ('Wizard', 'Paladin', 'Barbarian', 'ElvenRanger'));
