# Deploying Tiny Adventurers

How the game runs on a public server. The local setup is in the [README](../README.md); the settings are explained in [TECHNICAL.md](TECHNICAL.md) (server settings table).

This file is public: it never holds the real server's address, secrets or key paths. Every value below is an example.

## Setup

The server is an ordinary Linux machine with Docker and the Compose plugin. Two cores are enough for the game (it is the size the server code is tuned for).

- A git clone of `main` in the home directory (e.g. `~/TinyAdventurers`).
- `docker compose` runs two containers from `docker-compose.yml`: `db` (PostgreSQL, data in the `ta-db` volume) and `game` (the Rust server, which also serves the built client).
- A third container, **Caddy**, sits in front as the reverse proxy. It gets the HTTPS certificate and forwards to the game. It is added by the server-only `docker-compose.override.yml`, which Compose reads on its own next to `docker-compose.yml`.
- Only Caddy is reachable from outside (ports 80 and 443). The game's port 8080 is not published.

## Server-only files

These three files sit in the checkout but are not tracked by git. Never commit them.

### `.env`

Copy `.env.example` and fill it in. For a public server:

```sh
POSTGRES_PASSWORD=<openssl rand -hex 32>
SESSION_SECRET=<openssl rand -hex 32>
COOKIE_SECURE=1                     # the game is served over HTTPS
TRUSTED_PROXIES=172.16.0.0/12       # Caddy on the Compose network; the login limiters then see each player's address
ADMIN_USER=admin
ADMIN_PASSWORD=<at least 12 characters, random>
```

The other settings keep their defaults. Changing `SESSION_SECRET` logs everyone out.

### `docker-compose.override.yml`

```yaml
services:
  game:
    ports: !reset []          # 8080 is reached only through Caddy
  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - game
    restart: unless-stopped

volumes:
  caddy-data:
  caddy-config:
```

### `Caddyfile`

```
game.example.org {
    encode gzip
    reverse_proxy game:8080
}
```

Caddy handles WebSockets on its own and appends the player's address to `X-Forwarded-For`, which is what `TRUSTED_PROXIES` relies on. The domain must point at the server before the first start, or Caddy cannot get a certificate.

## Updating

Take a backup first (below), then:

```sh
cd ~/TinyAdventurers
git pull
docker compose up -d --build
```

- **A restart ends every running game.** Players in a run lose it; banked progress is safe. Update when nobody is playing.
- **Check that the update happened.** A failed image build leaves the old container running, and `/health` still answers `OK`. Look at the exit code of `docker compose up -d --build` itself (not through a pipe), and check that the game container is new: `docker compose ps game` (its "Created" time) or `docker inspect -f '{{.Created}}' <container>`.
- Build the client locally first (`cd client && npm run build`) when the change touches it: some steps (the atlas) only run in the production build.
- `git -C ~/TinyAdventurers log -1` shows what runs.

## Trying a branch

A branch that is not pushed can be copied over with a git bundle:

```sh
# on the development machine
git bundle create /tmp/feature.bundle main..feature/123-name
scp /tmp/feature.bundle <server>:/tmp/

# on the server (after a backup)
cd ~/TinyAdventurers
git fetch /tmp/feature.bundle feature/123-name:feature/123-name
git checkout feature/123-name
docker compose up -d --build
```

Go back to `main` afterwards (`git checkout main && docker compose up -d --build`) and delete the bundle and the branch.

## Backups

A nightly cron job dumps the database, keeps two weeks of dumps on the server and copies each one off the server.

Example script (`~/bin/tinyadventurers-backup.sh`):

```sh
#!/bin/sh
set -eu
dir=~/backups/tinyadventurers
mkdir -p "$dir"
file="$dir/tiny-$(date -u +%Y%m%d-%H%M).sql.gz"
cd ~/TinyAdventurers
docker compose exec -T db pg_dump -U tiny -d tiny | gzip > "$file"
find "$dir" -name 'tiny-*.sql.gz' -mtime +14 -delete
rclone copy "$file" offsite:tinyadventurers-backup   # any rclone remote with its own retention rule
```

Crontab entry (`crontab -e`), every night at 03:30 UTC:

```
30 3 * * * $HOME/bin/tinyadventurers-backup.sh >> $HOME/backups/backup.log 2>&1
```

The dumps are not encrypted: keep the off-site bucket private. The script must run as a user that may run `docker`.

### Restoring

Stop the game first, so nothing writes while the dump is loaded, then load the dump into an emptied database:

```sh
cd ~/TinyAdventurers
docker compose stop game
docker compose exec -T db psql -U tiny -d postgres -c 'DROP DATABASE tiny' -c 'CREATE DATABASE tiny OWNER tiny'
gunzip -c ~/backups/tinyadventurers/tiny-YYYYMMDD-HHMM.sql.gz | docker compose exec -T db psql -U tiny -d tiny
docker compose start game
```

Test a restore now and then, e.g. into a throwaway stack on another machine.

## Admin and debug accounts

The admin area is at `/admin`, with `ADMIN_USER` and `ADMIN_PASSWORD` from `.env` (disabled unless both are set). There the admin sees statistics, players and the audit log, and marks the accounts that may use debug features. Only marked accounts can start debug runs, and they play only with each other; unmarking an account wipes its progress (TECHNICAL.md, debug accounts).
