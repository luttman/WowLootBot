// Thin wrapper around the Warcraft Logs V1 API. Each Discord server supplies
// its own API key via /wcl-config, generated from their own Warcraft Logs
// account at https://www.warcraftlogs.com/profile.
//
// Warcraft Logs splits Classic content across several separate hosts, one per
// realm type, each with its OWN independent zone numbering - confirmed
// directly: Pluttman-Spineshatter's real character page is
// fresh.warcraftlogs.com/character/eu/spineshatter/pluttman, using zone=1056
// for SSC/TK, while classic.warcraftlogs.com (a different host entirely) uses
// 1501 for the same tier. There is no way to guess which host a given realm
// is on, so it is a per-server setting via /wcl-config, not hardcoded.
//
// NOTE: built from the V1 swagger spec, not verified against a live key for
// every site. The V1 endpoint documents `rank`/`outOf` per parse, not a
// direct `percentile` field - percentileFromRank() below derives one from
// those. If a real response does include a `percentile` field directly,
// prefer that instead once confirmed.

const SITES = {
  classic: 'classic.warcraftlogs.com',
  fresh: 'fresh.warcraftlogs.com',
  sod: 'sod.warcraftlogs.com',
  vanilla: 'vanilla.warcraftlogs.com',
};

function baseUrl(site) {
  const host = SITES[site];
  if (!host) throw new Error(`Unknown Warcraft Logs site "${site}". Expected one of: ${Object.keys(SITES).join(', ')}.`);
  return `https://${host}/v1`;
}

async function wclGet(site, path, params, apiKey) {
  const url = new URL(baseUrl(site) + path);
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

// On classic.warcraftlogs.com specifically, /zones returns two generations of
// entries: ids below 1500 are one zone per raid *instance* (e.g. 1007
// "Karazhan"), confirmed to no longer work with /parses/character even for
// characters with real logged parses; ids 1500+ are one zone per raid *tier*
// (e.g. 1502 "TBC Raids (10-Man Tier 4)"), which do work. This split is only
// confirmed for the classic host - other sites (fresh, sod, vanilla) may use
// a different numbering entirely, so it is not filtered for them.
const CLASSIC_MIN_USABLE_ZONE_ID = 1500;

// List of raid zones this account's key can see, used to populate /player-parse's
// zone autocomplete instead of a hardcoded tier->zone-id map that could go stale.
async function fetchZones(site, apiKey) {
  const zones = await wclGet(site, '/zones', {}, apiKey);
  const list = Array.isArray(zones) ? zones : [];
  return site === 'classic' ? list.filter((z) => z.id >= CLASSIC_MIN_USABLE_ZONE_ID) : list;
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

async function fetchCharacterParses(site, apiKey, { character, realm, region, zone, encounter, metric }) {
  const parses = await wclGet(
    site,
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

module.exports = { SITES, fetchZones, fetchCharacterParses, splitCharacter };
