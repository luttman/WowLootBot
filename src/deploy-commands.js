require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('loot-add')
    .setDescription('Add loot from an RCLootCouncil or Gargul export (officers only) - see /help lootmaster')
    .addStringOption((o) => o.setName('name').setDescription("Raid name, e.g. 'VPK'"))
    .addAttachmentOption((o) => o.setName('file').setDescription('Exported .csv (RCLootCouncil) or .json (Gargul) file'))
    .addStringOption((o) => o.setName('data').setDescription('Pasted export text (short raids only)'))
    .addStringOption((o) => o.setName('uploader').setDescription('Loot master to credit (defaults to you) - use for backfilling old history')),
  new SlashCommandBuilder()
    .setName('loot-last')
    .setDescription('Show items from the most recently added raid'),
  new SlashCommandBuilder()
    .setName('loot-raid')
    .setDescription('Show items from a specific raid')
    .addStringOption((o) => o.setName('name').setDescription('Start typing to pick a raid').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName('loot-player')
    .setDescription('Show everything a player has won')
    .addStringOption((o) => o.setName('name').setDescription('Player name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('loot-item')
    .setDescription('Show who has won a specific item')
    .addStringOption((o) => o.setName('name').setDescription('Item name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('loot-clear')
    .setDescription("Delete this server's stored loot data (officers only)")
    .addBooleanOption((o) => o.setName('confirm').setDescription('Must be true to actually delete').setRequired(true))
    .addStringOption((o) => o.setName('raid').setDescription('Only clear this raid (leave blank to clear everything for this server)')),
  new SlashCommandBuilder()
    .setName('loot-config')
    .setDescription('Set who can manage loot and which channel commands work in (admins only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((o) => o.setName('role').setDescription('Role allowed to add/clear loot'))
    .addChannelOption((o) => o.setName('channel').setDescription('Restrict all commands to this channel').addChannelTypes(ChannelType.GuildText))
    .addBooleanOption((o) => o.setName('reset').setDescription('Reset role and channel restrictions back to default')),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('How to use WoWLootBot')
    .addStringOption((o) => o.setName('for').setDescription('Which help to show').addChoices(
      { name: 'Everyone (browsing loot)', value: 'everyone' },
      { name: 'Loot master (adding loot, exports)', value: 'lootmaster' },
    )),
  new SlashCommandBuilder()
    .setName('admin-status')
    .setDescription('Bot health check (bot owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('wcl-config')
    .setDescription('Set this server\'s Warcraft Logs API key for /player-parse (admins only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('api_key').setDescription('Your Warcraft Logs V1 API key, from warcraftlogs.com/profile'))
    .addStringOption((o) => o.setName('region').setDescription('Default region for /player-parse').addChoices(
      { name: 'US', value: 'US' },
      { name: 'EU', value: 'EU' },
      { name: 'KR', value: 'KR' },
      { name: 'TW', value: 'TW' },
    ))
    .addBooleanOption((o) => o.setName('reset').setDescription('Remove the stored API key and default region')),
  new SlashCommandBuilder()
    .setName('player-parse')
    .setDescription('Show a player\'s Warcraft Logs parses for a raid tier')
    .addStringOption((o) => o.setName('player').setDescription("Character name, e.g. 'Fulfrans-Spineshatter'").setRequired(true))
    .addStringOption((o) => o.setName('zone').setDescription('Start typing to pick a raid tier').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('region').setDescription('Overrides this server\'s default region').addChoices(
      { name: 'US', value: 'US' },
      { name: 'EU', value: 'EU' },
      { name: 'KR', value: 'KR' },
      { name: 'TW', value: 'TW' },
    ))
    .addStringOption((o) => o.setName('metric').setDescription('Defaults to dps').addChoices(
      { name: 'DPS', value: 'dps' },
      { name: 'HPS', value: 'hps' },
    )),
].map((c) => c.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log(`Deployed ${commands.length} commands${process.env.GUILD_ID ? ' (guild scoped, instant)' : ' (global, up to 1h to propagate)'}.`);
})();
