require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { parseLootExport } = require('./parseLoot');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const PAGE_SIZE = 10;
const BUTTON_TIMEOUT_MS = 5 * 60 * 1000; // how long Prev/Next buttons stay clickable before they're disabled

// Player and owner names come as "Name-Realm" from the addons. We only display the name.
function stripRealm(name) {
  return (name || '').split('-')[0];
}

// A server can set a specific "loot officer" role via /loot-config; otherwise
// anyone with Discord's Manage Server permission can add/clear loot.
function canManageLoot(interaction) {
  const settings = db.prepare('SELECT loot_role_id FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
  if (settings?.loot_role_id) return interaction.member.roles.cache.has(settings.loot_role_id);
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

const NO_PERMISSION_REPLY = {
  content: "You don't have permission to manage loot in this server. Ask an admin to grant you the loot-officer role, or to run /loot-config.",
  flags: MessageFlags.Ephemeral,
};

// Formats one loot row for display. Each row keeps its own date/owner (not the raid's),
// since a single import can span multiple actual raid nights and loot masters.
function lootLine(row) {
  const link = row.item_id ? `[${row.item_name}](https://www.wowhead.com/item=${row.item_id})` : row.item_name;
  const meta = `${row.item_date || '?'} - ${stripRealm(row.owner) || '?'}`;
  return `**${row.player}** - ${link} (${row.response}${row.boss ? `, ${row.boss}` : ''}) - _${meta}_`;
}

// Builds the embed for one page of results (see replyPaginated below).
function pageEmbed(title, rows, page) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(pageRows.length ? pageRows.map(lootLine).join('\n') : '_nothing found_')
    .setFooter({ text: `Page ${page}/${totalPages} • ${rows.length} items total` });
}

function pageButtons(page, totalPages) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
  );
  return totalPages > 1 ? [row] : [];
}

// Replies with page 1 and, if there's more than one page, wires up Prev/Next buttons
// that only the original caller can use, for BUTTON_TIMEOUT_MS.
async function replyPaginated(interaction, title, rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  let page = 1;
  const response = await interaction.reply({
    embeds: [pageEmbed(title, rows, page)],
    components: pageButtons(page, totalPages),
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });
  if (totalPages <= 1) return;

  const collector = response.resource.message.createMessageComponentCollector({
    filter: (btn) => btn.user.id === interaction.user.id,
    time: BUTTON_TIMEOUT_MS,
  });
  collector.on('collect', async (btn) => {
    page = btn.customId === 'next' ? Math.min(totalPages, page + 1) : Math.max(1, page - 1);
    await btn.update({ embeds: [pageEmbed(title, rows, page)], components: pageButtons(page, totalPages) });
  });
  collector.on('end', async () => {
    try { await interaction.editReply({ components: [] }); } catch { /* message may already be gone */ }
  });
}

// Uploads an export (RCLootCouncil CSV/JSON or Gargul JSON, auto-detected in parseLoot.js),
// splits it into one raid per date, skips items already imported, and stores the rest.
async function handleLootAdd(interaction) {
  if (!canManageLoot(interaction)) return interaction.reply(NO_PERMISSION_REPLY);

  const name = interaction.options.getString('name');
  const file = interaction.options.getAttachment('file');
  const data = interaction.options.getString('data');
  const manualUploader = interaction.options.getString('uploader');

  let text = data;
  if (file) {
    const res = await fetch(file.url);
    text = await res.text();
  }
  if (!text) {
    return interaction.reply({ content: 'Attach a `file` or paste `data` with an RCLootCouncil or Gargul export. See `/help lootmaster` for how to export.', flags: MessageFlags.Ephemeral });
  }

  const items = parseLootExport(text);
  if (items.length === 0) {
    return interaction.reply({ content: "Couldn't find any loot rows in that export.", flags: MessageFlags.Ephemeral });
  }

  // Skip items already recorded for this server (matched by the export's own per-award ID).
  const existingIds = new Set(
    db.prepare(`SELECT external_id FROM loot WHERE guild_id = ? AND external_id IS NOT NULL AND external_id != ''`)
      .all(interaction.guildId).map((r) => r.external_id),
  );
  const newItems = items.filter((it) => !it.externalId || !existingIds.has(it.externalId));
  const duplicateCount = items.length - newItems.length;
  if (newItems.length === 0) {
    return interaction.reply({ content: `All ${items.length} items in that export were already recorded - nothing new to add.`, flags: MessageFlags.Ephemeral });
  }

  // One export can span many raid nights (different `date` per row) - split into one raid per date.
  const groups = new Map();
  for (const it of newItems) {
    const date = it.date || new Date().toISOString().slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(it);
  }

  const insertRaid = db.prepare('INSERT INTO raids (guild_id, name, raid_date, created_by) VALUES (?, ?, ?, ?)');
  const insertLoot = db.prepare(`INSERT INTO loot
    (raid_id, player, class, item_name, item_id, response, boss, instance, note, item_date, item_time, previous_item, owner, guild_id, external_id)
    VALUES (@raid_id, @player, @class, @item_name, @item_id, @response, @boss, @instance, @note, @item_date, @item_time, @previous_item, @owner, @guild_id, @external_id)`);

  db.transaction(() => {
    for (const [date, groupItems] of groups) {
      const uploader = manualUploader || groupItems[0].owner || interaction.user.username;
      const raidName = name ? `${name} - ${date}` : `${date} - ${stripRealm(uploader)}`;
      const { lastInsertRowid: raidId } = insertRaid.run(interaction.guildId, raidName, date, uploader);
      for (const it of groupItems) {
        insertLoot.run({
          raid_id: raidId,
          player: it.player,
          class: it.class,
          item_name: it.itemName,
          item_id: it.itemId,
          response: it.response,
          boss: it.boss,
          instance: it.instance,
          note: it.note,
          item_date: it.date,
          item_time: it.time,
          previous_item: it.previousItem,
          owner: it.owner,
          guild_id: interaction.guildId,
          external_id: it.externalId || null,
        });
      }
    }
  })();

  const dates = [...groups.keys()].sort();
  const dateSummary = dates.length <= 5 ? dates.join(', ') : `${dates[0]} → ${dates[dates.length - 1]}`;
  const dupSuffix = duplicateCount > 0 ? ` Skipped ${duplicateCount} already-recorded duplicate${duplicateCount === 1 ? '' : 's'}.` : '';
  await interaction.reply(`Added ${newItems.length} items across ${groups.size} raid${groups.size === 1 ? '' : 's'} (${dateSummary}).${dupSuffix}`);
}

// The four read commands below all reply through replyPaginated so they share
// the same layout, page size, and Prev/Next button behavior.

async function handleLootLast(interaction) {
  const raid = db.prepare('SELECT * FROM raids WHERE guild_id = ? ORDER BY id DESC LIMIT 1').get(interaction.guildId);
  if (!raid) return interaction.reply({ content: 'No raids added yet.', flags: MessageFlags.Ephemeral });
  const rows = db.prepare('SELECT * FROM loot WHERE raid_id = ? ORDER BY id').all(raid.id);
  await replyPaginated(interaction, raid.name, rows);
}

// The `name` option is really the raid's internal id, chosen through Discord's
// autocomplete dropdown (see handleLootRaidAutocomplete) rather than typed free text.
async function handleLootRaid(interaction) {
  const raidId = Number(interaction.options.getString('name'));
  const raid = Number.isInteger(raidId)
    ? db.prepare('SELECT * FROM raids WHERE guild_id = ? AND id = ?').get(interaction.guildId, raidId)
    : null;
  if (!raid) return interaction.reply({ content: 'Pick a raid from the autocomplete list.', flags: MessageFlags.Ephemeral });
  const rows = db.prepare('SELECT * FROM loot WHERE raid_id = ? ORDER BY id').all(raid.id);
  await replyPaginated(interaction, raid.name, rows);
}

async function handleLootPlayer(interaction) {
  const query = interaction.options.getString('name');
  const rows = db.prepare(`SELECT loot.* FROM loot JOIN raids ON loot.raid_id = raids.id
    WHERE raids.guild_id = ? AND loot.player LIKE ? ORDER BY loot.id DESC LIMIT 50`).all(interaction.guildId, `%${query}%`);
  await replyPaginated(interaction, `Loot won by ${query}`, rows);
}

async function handleLootItem(interaction) {
  const query = interaction.options.getString('name');
  const rows = db.prepare(`SELECT loot.* FROM loot JOIN raids ON loot.raid_id = raids.id
    WHERE raids.guild_id = ? AND loot.item_name LIKE ? ORDER BY loot.id DESC LIMIT 50`).all(interaction.guildId, `%${query}%`);
  await replyPaginated(interaction, `Winners of "${query}"`, rows);
}

// Deletes one raid (raidQuery given) or every raid/loot row for this server (no raidQuery).
// Requires confirm:true so a stray command invocation can't wipe data by accident.
async function handleLootClear(interaction) {
  if (!canManageLoot(interaction)) return interaction.reply(NO_PERMISSION_REPLY);

  const confirm = interaction.options.getBoolean('confirm');
  const raidQuery = interaction.options.getString('raid');
  if (!confirm) {
    return interaction.reply({ content: 'Set `confirm:true` to actually delete data - this cannot be undone.', flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guildId;

  if (raidQuery) {
    const raid = db.prepare('SELECT * FROM raids WHERE guild_id = ? AND (name LIKE ? OR raid_date LIKE ?) ORDER BY id DESC LIMIT 1')
      .get(guildId, `%${raidQuery}%`, `%${raidQuery}%`);
    if (!raid) return interaction.reply({ content: `No raid matching "${raidQuery}" in this server.`, flags: MessageFlags.Ephemeral });
    db.transaction(() => {
      db.prepare('DELETE FROM loot WHERE raid_id = ?').run(raid.id);
      db.prepare('DELETE FROM raids WHERE id = ?').run(raid.id);
    })();
    return interaction.reply(`Deleted raid **${raid.name}** and its loot entries.`);
  }

  const { count } = db.prepare('SELECT COUNT(*) count FROM raids WHERE guild_id = ?').get(guildId);
  db.transaction(() => {
    db.prepare('DELETE FROM loot WHERE raid_id IN (SELECT id FROM raids WHERE guild_id = ?)').run(guildId);
    db.prepare('DELETE FROM raids WHERE guild_id = ?').run(guildId);
  })();
  await interaction.reply(`Cleared all loot data for this server (${count} raids deleted).`);
}

// Lets a server admin (Manage Server permission, enforced by Discord itself on this
// command) name a role that's allowed to use /loot-add and /loot-clear, and/or lock all
// commands to a single channel. /loot-config and /help are never locked, so a server
// can't accidentally block itself from ever changing this setting again.
async function handleLootConfig(interaction) {
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');
  const reset = interaction.options.getBoolean('reset');

  if (reset) {
    db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(interaction.guildId);
    return interaction.reply({ content: 'Reset - Manage Server permission is required to add/clear loot, and commands work in any channel.', flags: MessageFlags.Ephemeral });
  }

  if (role || channel) {
    db.prepare(`INSERT INTO guild_settings (guild_id, loot_role_id, channel_id) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        loot_role_id = COALESCE(excluded.loot_role_id, guild_settings.loot_role_id),
        channel_id = COALESCE(excluded.channel_id, guild_settings.channel_id)`)
      .run(interaction.guildId, role ? role.id : null, channel ? channel.id : null);
    const updates = [];
    if (role) updates.push(`members with the ${role} role can now use /loot-add and /loot-clear`);
    if (channel) updates.push(`commands now only work in <#${channel.id}>`);
    return interaction.reply({ content: `Updated: ${updates.join(', ')}.`, flags: MessageFlags.Ephemeral });
  }

  const settings = db.prepare('SELECT loot_role_id, channel_id FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
  const roleText = settings?.loot_role_id ? `<@&${settings.loot_role_id}>` : '**Manage Server** permission (default)';
  const channelText = settings?.channel_id ? `<#${settings.channel_id}>` : 'any channel (default)';
  await interaction.reply({ content: `Allowed to add/clear loot: ${roleText}\nCommands restricted to: ${channelText}`, flags: MessageFlags.Ephemeral });
}

async function handleHelp(interaction) {
  const audience = interaction.options.getString('for') || 'everyone';

  if (audience === 'lootmaster') {
    const embed = new EmbedBuilder()
      .setTitle('WoWLootBot - loot master guide')
      .addFields(
        {
          name: 'Commands',
          value: [
            '`/loot-add` - upload an export. Splits automatically into one raid per date.',
            '`/loot-clear` - delete a raid, or everything for this server (requires `confirm:true`).',
            '`/loot-config` - set which role (besides Manage Server) can use the two commands above, and optionally lock all commands to one channel.',
          ].join('\n'),
        },
        {
          name: 'Exporting from RCLootCouncil',
          value: [
            '1. Open RCLootCouncil → **History** tab.',
            '2. Select the session(s) to export.',
            '3. Click **Export**, choosing **JSON** if given the option (recommended - more reliable than CSV). CSV export also works.',
            '4. Save it as a file and use `/loot-add file:`, or paste short exports with `/loot-add data:`.',
          ].join('\n'),
        },
        {
          name: 'Exporting from Gargul',
          value: [
            '1. Open Gargul → loot **History**/**Data** view.',
            '2. Use its Export/Copy option to get the JSON array of awarded loot.',
            '3. Save it as a .json file and use `/loot-add file:` (JSON exports are usually too long to paste).',
          ].join('\n'),
        },
        {
          name: 'Notes',
          value: [
            '- Both formats are auto-detected - no need to say which one it is.',
            '- `uploader:` overrides who gets credited as loot master (useful when backfilling old history).',
            '- `name:` sets a label used in the raid name, e.g. `VPK - 2026/07/19`.',
          ].join('\n'),
        },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setTitle('WoWLootBot - commands')
    .setDescription([
      '`/loot-last` - items from the most recently added raid.',
      '`/loot-raid` - items from a specific raid (start typing to pick one from the list).',
      '`/loot-player name:` - everything a player has won.',
      '`/loot-item name:` - who has won a specific item.',
      '',
      'Results are only visible to you, with ◀/▶ buttons if there are more than 10 items.',
      '',
      'Loot master? See `/help for:lootmaster`.',
    ].join('\n'));
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Fires as the user types in /loot-raid's `name` field. Discord shows the returned
// list as a clickable dropdown; the `value` sent back is the raid id, not its name.
async function handleLootRaidAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const raids = db.prepare(`SELECT id, name FROM raids WHERE guild_id = ? AND name LIKE ?
    ORDER BY raid_date DESC LIMIT 25`).all(interaction.guildId, `%${focused}%`);
  await interaction.respond(raids.map((r) => ({ name: r.name, value: String(r.id) })));
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'loot-raid') await handleLootRaidAutocomplete(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    // If a server locked commands to one channel via /loot-config, enforce it here for
    // everything except /loot-config and /help, so the setting can always be changed.
    if (interaction.commandName !== 'loot-config' && interaction.commandName !== 'help') {
      const settings = db.prepare('SELECT channel_id FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
      if (settings?.channel_id && interaction.channelId !== settings.channel_id) {
        return interaction.reply({ content: `This command only works in <#${settings.channel_id}>.`, flags: MessageFlags.Ephemeral });
      }
    }

    // One switch dispatching to the per-command handlers above; errors from any of
    // them land in the catch block below instead of crashing the bot process.
    switch (interaction.commandName) {
      case 'loot-add': return await handleLootAdd(interaction);
      case 'loot-last': return await handleLootLast(interaction);
      case 'loot-raid': return await handleLootRaid(interaction);
      case 'loot-player': return await handleLootPlayer(interaction);
      case 'loot-item': return await handleLootItem(interaction);
      case 'loot-clear': return await handleLootClear(interaction);
      case 'loot-config': return await handleLootConfig(interaction);
      case 'help': return await handleHelp(interaction);
    }
  } catch (err) {
    console.error(err);
    const reply = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  }
});

client.once('clientReady', () => console.log(`Logged in as ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
