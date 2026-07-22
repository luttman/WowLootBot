// Parses loot exports from RCLootCouncil (CSV or JSON) and Gargul (JSON) into a common
// item shape, listed below, that the rest of the bot (index.js) works with regardless
// of which addon or format the loot master used:
//   { player, class, itemName, itemId, response, boss, instance, note,
//     date, time, owner, previousItem, externalId }
// date/time are always "YYYY/MM/DD" and "HH:MM:SS" text, even for Gargul (which only
// gives a unix timestamp) - this keeps grouping-by-date and sorting simple everywhere else.

// A minimal CSV line splitter that understands double-quoted fields with embedded
// commas and escaped quotes (""), since RCLootCouncil's `note` column can contain both.
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

// Pulls the readable name out of a WoW chat-link string or plain "[Name]" bracket, e.g.
// "|cffa335ee|Hitem:...|h[Blessed Qiraji Bulwark]|h|r" -> "Blessed Qiraji Bulwark"
function stripItemLink(link) {
  const match = /\[(.+?)\]/.exec(link || '');
  return match ? match[1] : '';
}

// RCLootCouncil's CSV export: a header row followed by one row per awarded item.
// gear1/gear2 hold the item(s) the player had equipped before the upgrade (shown to
// the loot council for context) - we keep the first one as `previousItem`, purely
// informational, not counted as a second award.
function parseRCLootCouncilCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = values[i]; });
    return {
      player: row.player,
      class: row.class,
      itemName: (row.item || '').replace(/^\[|\]$/g, ''),
      itemId: Number(row.itemID) || null,
      response: row.response,
      boss: row.boss,
      instance: row.instance,
      note: row.note || '',
      date: row.date,
      time: row.time,
      owner: row.owner || '',
      previousItem: stripItemLink(row.gear1) || stripItemLink(row.gear2) || '',
      externalId: row.id || '',
    };
  });
}

// RCLootCouncil's own JSON export - same data as its CSV, but itemName/gear1/gear2
// are already plain text (no chat-link codes) and there's no CSV quoting to trip over.
function parseRCLootCouncilJson(list) {
  return list.map((e) => ({
    player: e.player,
    class: e.class,
    itemName: e.itemName || stripItemLink(e.item) || '',
    itemId: Number(e.itemID) || null,
    response: e.response,
    boss: e.boss,
    instance: e.instance,
    note: e.note || '',
    date: e.date,
    time: e.time,
    owner: e.owner || '',
    previousItem: stripItemLink(e.gear1) || stripItemLink(e.gear2) || '',
    externalId: e.id || '',
  }));
}

// Standard WoW classID -> class name (matches RCLootCouncil's uppercase class strings).
const CLASS_NAMES = {
  1: 'WARRIOR', 2: 'PALADIN', 3: 'HUNTER', 4: 'ROGUE', 5: 'PRIEST',
  6: 'DEATH KNIGHT', 7: 'SHAMAN', 8: 'MAGE', 9: 'WARLOCK', 10: 'MONK', 11: 'DRUID',
};

function pad(n) {
  return String(n).padStart(2, '0');
}

// Gargul's JSON export. A `received:false` entry means the award was logged but later
// corrected/reassigned (the real recipient shows up in a separate `received:true` entry
// with the same itemID) - we drop those so nobody gets credited for loot they didn't get.
// Gargul has no boss/instance/note fields at all, so those stay blank here.
function parseGargul(list) {
  return list.filter((e) => e.received !== false).map((e) => {
    const d = new Date((e.timestamp || 0) * 1000);
    return {
      player: e.awardedTo,
      class: CLASS_NAMES[e.winnerClass] || '',
      itemName: stripItemLink(e.itemLink),
      itemId: Number(e.itemID) || null,
      response: e.winningRollType || '',
      boss: '',
      instance: '',
      note: '',
      date: `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`,
      time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
      owner: e.awardedBy || '',
      previousItem: '',
      externalId: e.checksum || '',
    };
  });
}

// Entry point used by index.js. Detects the format from the text itself so the
// loot master never has to say which addon it came from:
//   - doesn't start with [ or { -> CSV (only RCLootCouncil exports CSV)
//   - JSON array/object with an `awardedTo` field -> Gargul
//   - any other JSON -> RCLootCouncil's JSON export
function parseLootExport(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return parseRCLootCouncilCsv(text);

  const entries = JSON.parse(text);
  const list = Array.isArray(entries) ? entries : [entries];
  const first = list[0] || {};
  return 'awardedTo' in first ? parseGargul(list) : parseRCLootCouncilJson(list);
}

module.exports = { parseCsvLine, parseLootExport, parseRCLootCouncilCsv, parseRCLootCouncilJson, parseGargul };
