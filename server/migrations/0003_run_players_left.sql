-- A hero who leaves a dungeon early counts as dead in the game; the statistics
-- keep leaving apart from dying.
ALTER TABLE run_players ADD COLUMN left_run BOOLEAN NOT NULL DEFAULT false;
