# Debug accounts: design (2026-10-24)

Issue: #151 (follow-up of #150). Decided with the user on 2026-10-24.
For: the agent who writes the implementation plan, the reviewer, and the builder.

## Intent

Debug mode exists only for the user (the admin) to test and debug the game. It is not a feature for players. Today anyone can add `?debug` to the URL, and on the live server (`ALLOW_DEBUG=1`) that does two kinds of damage:

- **Persistent bleed:** `DebugGrantItem`, `DebugBuyAttribute`, `DebugBuyNode` and `DebugRespec` change the saved character for free. That character can then play normal games with things it never earned.
- **Mixed rooms:** one debug player in a room turns the whole run into a debug run, so the other players lose their XP.

The user's requirement: debug must never bleed into normal games, and it must be airtight ("debug can damage a lot of the gameplay if it bleeds").

## The decisions (the user's)

1. **Only the admin can use debug.** The admin marks game accounts as **debug accounts** in the admin area (`/admin`). Only characters on a debug account can use any debug feature. The user tests only with completely separate characters, never with their normal ones.
2. **Debug and normal never meet.** Debug characters play only in debug rooms; normal characters only in normal rooms.
3. **Debug runs bank normally.** XP and coins earned in a debug run are banked like in a normal run, so banking itself can be tested. This is safe only because nothing debug can reach a normal game.
4. **Unmarking wipes.** When the admin removes the debug mark from an account, the progress of **all** its characters is wiped (reset to a new character's progress), so nothing gained in debug survives as a normal character.
5. **`ALLOW_DEBUG` is removed.** The debug mark is the only switch. No marked account = debug is off for everyone. The admin area switched off (no `ADMIN_USER`) = nobody can be marked.

## Calls made in the design (not asked; the user can overrule)

- **`?debug` is no longer read by the game client.** A debug account is always in debug mode: the waiting-room debug pickers, the free buys and Grant in the hub, and in a run immortality (F9 toggles it), the boss and ogre paths, F4 darkvision and F8 effects.
- **The URL boss preselect (`&boss=demon|lich|dragon`) is removed** (the user, 2026-10-24); the host picks the boss in the waiting room.
- **Every hero in a debug run starts in debug mode** (immortal, with the paths) on the server; the client no longer sends `Debug { on: true }`. The `ClientMsg::Debug` message is removed.
- **Marking an account keeps its characters' progress.** Normal progress moving into debug is harmless. Marking or unmarking ends the account's open game connections (like an admin password change), so it reconnects with the new state.
- **The lobby shows each kind only its own rooms.** Normal players never see debug rooms; a debug player sees only debug rooms, under a "Debug" label.
- **Debug accounts are left out of the admin statistics** that sum over characters (total XP, coins, characters per class, tree-node levels, the top-10), as debug runs already are. The player list, the player page and its recent runs show a "debug" tag. Account counts and active-player counts keep counting debug accounts (they count logins).
- The debug run's extra rules stay as they are (Ruling 13: the whole class pool and the Attribute lift with `DebugLoadout`/`DebugEquip`; free buys refund nothing on respec).

## The safety model (what makes it airtight)

The in-memory flag on a connection decides what the player sees and which rooms they can use. It can be stale for a moment (a connection opening while the admin changes the mark). So **the database is the authority for everything that is saved**:

- **Free buys and grants** (`DebugGrantItem`, `DebugBuyAttribute`, `DebugBuyNode`, `DebugRespec`) are applied only if the character's account is a debug account **at the moment of the save, read inside the same transaction** with the character row locked.
- **Banking** a run's awards applies to a character only if its account's debug mark **at the moment of banking** equals the run's kind (debug run → debug account; normal run → normal account). Otherwise that character's award is dropped (logged). This closes: a player kicked by an unmark whose debug run ends later (players who left still bank), and the reverse.
- **Unmarking** (flag off + wipe of every character of the account) is one transaction, and it ends the account's connections **after** the commit. Any connection open at commit time is closed; any connection opened later reads the new state.
- **Lock order** everywhere: the account row first, then character rows by id (as `create_character` and account deletion already do). The unmark transaction locks the account first, so a character created at the same moment is either wiped with the others or created after the commit as a normal one.
- **Which changes need a debug account** is decided by the change itself (free buys, free respec, grants), not by the caller.

In memory (defence in depth, and for the player's view):

- The connection's flag is read from the database when the WebSocket connects (`accounts.debug`) and sent to the client in `Welcome`.
- A room's kind is fixed by its creator's flag. `JoinRun` refuses the other kind, both ways.
- Every debug message is refused unless the connection's flag is set (lobby messages) or the run is a debug run (in-run messages). A debug run contains only debug players, because its room does.
- The run's kind (debug or not) is recorded in `runs.debug` as before, and the statistics keep skipping debug runs.

## Anti-goals

- A normal player seeing, joining, or being affected by anything debug.
- A character keeping anything from debug after its account is unmarked.
- Any client-supplied value (URL parameter, message) deciding whether debug is allowed.

## Existing data

Stored data may be dropped instead of migrated (CLAUDE.md). The migration adds `accounts.debug` (default false). Characters changed by debug under the old system cannot be recognised reliably, so **the migration wipes the progress of every existing character once** (the user's decision, 2026-10-24).

## What is left to the builder

Message texts, the admin control's look (a checkbox or button on the player page with a confirmation that names the wipe), the label of the debug lobby, how the e2e smoke test marks its throwaway account for `?debug` runs.
