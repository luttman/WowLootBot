# WoWLootBot

A Discord bot for tracking World of Warcraft raid loot. A loot master uploads an
RCLootCouncil or Gargul export after each raid, and everyone else can look up
what dropped, who won a specific item, or what a player has received, all
through slash commands so the channel does not get spammed.

## Requirements

- Node.js 18 or newer (uses the built-in `fetch`), or Docker (see "Running with
  Docker" below) if you would rather not install Node.js at all
- A Discord bot application (see Setup below)

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Create a Discord application and bot user at
   https://discord.com/developers/applications, then copy `.env.example` to
   `.env` and fill in:

   - `DISCORD_TOKEN`: Bot tab, Reset Token
   - `CLIENT_ID`: General Information, Application ID
   - `GUILD_ID`: your Discord server's ID (enable Developer Mode in Discord,
     right click the server icon, Copy Server ID). Optional, but commands
     appear instantly with it set instead of up to an hour later.
   - `DB_PATH`: optional, defaults to `loot.db` in the project folder

3. Invite the bot to your server. In the Developer Portal, OAuth2 > URL
   Generator, check the `bot` and `applications.commands` scopes, then open
   the generated URL.

4. Register the slash commands:

   ```
   npm run deploy
   ```

5. Start the bot:

   ```
   npm start
   ```

Run `npm run deploy` again any time a command's options or description
change. `npm start` alone is enough for everything else, including database
schema changes, which apply automatically on startup.

## Running with Docker

An alternative to the Node.js setup above: build and run the bot in a
container instead, with `docker-compose.yml` and `Dockerfile` already set up.

1. Do steps 1-3 of Setup above (create the Discord application, fill in
   `.env`, invite the bot) but skip `npm install`, `npm run deploy`, and
   `npm start`. Leave `DB_PATH` commented out in `.env`, the Dockerfile
   already points it at a persisted volume so your data survives image
   rebuilds; setting it in `.env` would override that and lose the data.
2. Register the slash commands (only needed once, and again whenever a
   command's options or description change):

   ```
   docker compose run --rm bot npm run deploy
   ```

3. Start the bot:

   ```
   docker compose up -d --build
   ```

Data is stored in a named Docker volume (`loot-data`), not a file on your
host, so `docker compose down` and `docker compose up` again keeps your
history. `docker compose down -v` deletes the volume along with it, only do
that if you actually want to wipe all stored loot data.

## Commands

For everyone:

- `/loot-last`: items from the most recently added raid
- `/loot-raid`: items from a specific raid, pick one from the autocomplete list
- `/loot-player name:`: everything a player has won
- `/loot-item name:`: who has won a specific item
- `/help`: usage guide, with a loot master section covering exports

For loot masters (Manage Server permission by default, or a role set with
`/loot-config`):

- `/loot-add`: upload an export (file or pasted text). Splits automatically
  into one raid per date, skips items already imported, and lets a `name:`
  option label the raid.
- `/loot-clear`: delete one raid or everything for the server, requires
  `confirm:true`
- `/loot-config`: set which role can use the two commands above, and
  optionally lock all commands to one channel (Manage Server admins only).
  `/loot-config` and `/help` are never locked, so the setting can always be
  changed.

Results from the read commands are private (only visible to whoever ran the
command) and paginated with buttons when there are more than 10 items.

## Supported export formats

Auto-detected from the file or pasted text, no need to say which one it is:

- RCLootCouncil CSV export
- RCLootCouncil JSON export (recommended over CSV where available, since it
  has less ambiguity to parse)
- Gargul JSON export

See `/help lootmaster` in Discord for the exact steps to export from each
addon.

## Data storage

Everything is stored in a single SQLite file (`loot.db` by default). Data is
scoped per Discord server, so multiple servers using the same bot cannot see
or delete each other's data. There is no external database to set up.

## Security notes before publishing this repository

- `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` live only in `.env`, which is
  listed in `.gitignore` and is not tracked by git. Never commit `.env` or
  paste its contents anywhere public. `.env.example` is safe to share, it
  contains no real values.
- `loot.db` (and its `-wal`/`-shm` companion files) contains your server's
  raid and player data. It is also listed in `.gitignore`. Delete or move it
  before publishing if you do not want that history included.
- The source code has no hardcoded tokens or secrets. Anything sensitive is
  read from environment variables via `process.env`.
- `docker compose` reads `.env` at container start via `env_file`, it is never
  copied into the image itself. `.dockerignore` also excludes `.env` and
  `*.db*` from the build context.

## Project layout

- `src/db.js`: opens the SQLite database and manages the schema
- `src/parseLoot.js`: turns an RCLootCouncil or Gargul export into a common
  item format
- `src/index.js`: the bot itself, one function per slash command
- `src/deploy-commands.js`: registers slash command definitions with Discord
- `Dockerfile`, `docker-compose.yml`: run the bot in a container (see
  "Running with Docker" above)
- `test/parseLoot.test.js`: a self-check for the export parsers, run with
  `npm test`
- `website/`: a static landing page with an install button, Terms of Service,
  and Privacy Policy (see below)

## Website

`website/` is a plain HTML/CSS site, no build step, no framework: `index.html`
(landing page with an install button and two real Discord screenshots),
`terms.html`, `privacy.html`, `styles.css`, and an `assets/` folder for the
logo, favicon, and screenshots.

Before publishing it:

1. In `index.html`, the three "Add to Discord" buttons already point at the
   real Application ID. If you ever create a new bot application, replace
   `client_id=` in all three with the new one (General Information tab in the
   Developer Portal, same value as `CLIENT_ID` in `.env`, safe to put in
   public HTML since it is not a secret).
2. `terms.html` and `privacy.html` already list `contact@wowlootbot.xyz` as
   the contact address. Still fill in the "last updated" date near the top of
   each file before publishing.
3. If you want Discord to link to these pages from the bot's profile, add them
   in the Developer Portal under your application's General Information tab
   (Privacy Policy URL / Terms of Service URL).

To preview it locally, open `website/index.html` directly in a browser, or
serve the folder with any static file server, for example `npx serve website`.

To host it for real, any static hosting works since there is no server-side
code: Cloudflare Pages or GitHub Pages are both free and only need the
`website` folder. Point either one at this repository with `website` set as
the build output directory (no build command needed), or drag-and-drop the
folder's contents if the host supports that.
