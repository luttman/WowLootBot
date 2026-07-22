// Opens (or creates) the SQLite file and makes sure the schema is current.
// This file runs once per process start, since every other module does `require('./db')`.

const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || 'loot.db');
db.pragma('journal_mode = WAL'); // lets reads happen while a write is in progress

// Base schema for a fresh database. CREATE TABLE IF NOT EXISTS is a no-op on an
// existing database, which is why columns added later live in the migration
// block below instead of here - editing this block does not touch old databases.
db.exec(`
CREATE TABLE IF NOT EXISTS raids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  raid_date TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raid_id INTEGER NOT NULL REFERENCES raids(id),
  player TEXT NOT NULL,
  class TEXT,
  item_name TEXT NOT NULL,
  item_id INTEGER,
  response TEXT,
  boss TEXT,
  instance TEXT,
  note TEXT,
  item_date TEXT,
  item_time TEXT,
  previous_item TEXT,
  owner TEXT,
  guild_id TEXT NOT NULL DEFAULT '',
  external_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_loot_player ON loot(player);
CREATE INDEX IF NOT EXISTS idx_loot_item ON loot(item_name);
CREATE INDEX IF NOT EXISTS idx_loot_raid ON loot(raid_id);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  loot_role_id TEXT
);
`);

// Migrations for columns added after the initial release. Each block checks whether
// the column is already there before adding it, so this is safe to run on every startup.
const lootColumns = db.prepare("PRAGMA table_info(loot)").all().map((c) => c.name);
if (!lootColumns.includes('previous_item')) {
  db.exec('ALTER TABLE loot ADD COLUMN previous_item TEXT');
}
if (!lootColumns.includes('owner')) {
  db.exec('ALTER TABLE loot ADD COLUMN owner TEXT');
}
if (!lootColumns.includes('guild_id')) {
  db.exec("ALTER TABLE loot ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''");
}
if (!lootColumns.includes('external_id')) {
  db.exec('ALTER TABLE loot ADD COLUMN external_id TEXT');
}
// This index must be created after the column exists, not in the schema block above,
// or it fails with "no such column" on any database created before guild_id/external_id existed.
db.exec('CREATE INDEX IF NOT EXISTS idx_loot_guild_external ON loot(guild_id, external_id)');
// Rows inserted before guild_id existed have '' here; fill them in from their raid so
// per-server filtering and duplicate detection keep working for old data.
db.exec(`UPDATE loot SET guild_id = (SELECT guild_id FROM raids WHERE raids.id = loot.raid_id) WHERE guild_id = ''`);

const raidColumns = db.prepare("PRAGMA table_info(raids)").all().map((c) => c.name);
if (!raidColumns.includes('guild_id')) {
  db.exec("ALTER TABLE raids ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_raids_guild ON raids(guild_id)');

const settingsColumns = db.prepare("PRAGMA table_info(guild_settings)").all().map((c) => c.name);
if (!settingsColumns.includes('channel_id')) {
  db.exec('ALTER TABLE guild_settings ADD COLUMN channel_id TEXT');
}

module.exports = db;
