// Thin wrapper around the Warcraft Logs V1 API. Each Discord server supplies
// its own API key via /wcl-config, generated from their own Warcraft Logs
// account at https://www.warcraftlogs.com/profile.
//
// Classic content (including TBC) lives entirely on a separate host,
// classic.warcraftlogs.com, not www.warcraftlogs.com (which is retail-only).
// There is no further split by expansion (no tbc./wotlk. subdomains exist,
// verified directly) - classic.warcraftlogs.com's /zones lists every raid
// across every Classic era it has ever tracked, TBC included.
//
// NOTE: built from the V1 swagger spec, not verified against a live key. The V1
// endpoint documents `rank`/`outOf` per parse, not a direct `percentile` field -
// percentileFromRank() below derives one from those. If real responses turn out
// to include a `percentile` field directly, prefer that instead once confirmed.

const BASE_URL = 'https://classic.warcraftlogs.com/v1';

async function wclGet(path, params, apiKey) {
  const url = new URL(BASE_URL + path);
  url.searchParams.set('api_key', apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Warcraft Logs API error ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  return res.json();
}

// classic.warcraftlogs.com's /zones returns two generations of entries:
// - ids below 1500: one zone per raid *instance* (e.g. 1007 "Karazhan",
//   1008 "Gruul / Magtheridon"). Confirmed by testing that these no longer
//   work with /parses/character - they return no data even for characters
//   with real logged parses.
// - ids 1500+: one zone per raid *tier* (e.g. 1502 "TBC Raids (10-Man Tier
//   4)", grouping Karazhan + Gruul + Magtheridon together), which is both
//   what actually works for character parses and matches what this bot's
//   users mean by "tier" (T4, T5, ...) in the first place.
// Only the 1500+ generation is exposed here.
const MIN_USABLE_ZONE_ID = 1500;

// List of raid zones this account's key can see, used to populate /player-parse's
// zone autocomplete instead of a hardcoded tier->zone-id map that could go stale.
async function fetchZones(apiKey) {
  const zones = await wclGet('/zones', {}, apiKey);
  return (Array.isArray(zones) ? zones : []).filter((z) => z.id >= MIN_USABLE_ZONE_ID);
}

// character/realm split on the last "-", matching the "Name-Realm" convention
// already used throughout this project's loot data.
function splitCharacter(name) {
  const idx = name.lastIndexOf('-');
  if (idx === -1) return { character: name, realm: null };
  return { character: name.slice(0, idx), realm: name.slice(idx + 1) };
}

function percentileFromRank(rank, outOf) {
  if (!outOf) return null;
  return Math.round((1 - (rank - 1) / outOf) * 1000) / 10;
}

async function fetchCharacterParses(apiKey, { character, realm, region, zone, encounter, metric }) {
  const parses = await wclGet(
    `/parses/character/${encodeURIComponent(character)}/${encodeURIComponent(realm)}/${encodeURIComponent(region)}`,
    { zone, encounter, metric },
    apiKey,
  );
  return (Array.isArray(parses) ? parses : []).map((p) => ({
    encounterName: p.encounterName || p.encounter?.name || 'Unknown encounter',
    spec: p.spec,
    class: p.class,
    total: p.total,
    percentile: typeof p.percentile === 'number' ? p.percentile : percentileFromRank(p.rank, p.outOf),
  }));
}

module.exports = { fetchZones, fetchCharacterParses, splitCharacter };
