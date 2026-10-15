const {
  isBotOwner,
  canAdd,
  grantAccess,
  revokeAccess,
  removeServer,
  listServers,
  listAllowedAdders,
} = require("../../services/serverLinks");
const { isBotAdmin } = require("../../services/botAdmins");
const { success, danger, warn, info, rich } = require("../../util/embed");
const { colors } = require("../../config");
const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

module.exports = {
  name: "servers",
  async run(message, args) {
    const sub = args[0]?.toLowerCase();

    // ,servers add — pick which server first (bot must already be in it)
    if (sub === "add") {
      if (!canAdd(message.author.id)) {
        return message.reply({ embeds: [danger("Missing Permission", "Only the bot owner or people they've allowed can add servers.")] });
      }

      const allGuilds = [...message.client.guilds.cache.values()];
      if (!allGuilds.length) {
        return message.reply({ embeds: [danger("No Servers", "The bot isn't in any servers.")] });
      }

      const options = allGuilds.slice(0, 25).map((g) => ({
        label: g.name.slice(0, 100),
        value: g.id,
        description: `${g.memberCount} members`.slice(0, 100),
      }));

      const note = allGuilds.length > 25
        ? `\n-# Showing 25 of ${allGuilds.length} servers the bot is in.`
        : "";

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`srvpick:${message.author.id}`)
        .setPlaceholder("Select a server to list...")
        .addOptions(options);

      return message.reply({
        content: `**Which server do you want to list?**${note}`,
        components: [new ActionRowBuilder().addComponents(menu)],
      });
    }

    // ,servers remove <guildId>
    if (sub === "remove") {
      if (!canAdd(message.author.id) && !isBotAdmin(message.author.id)) {
        return message.reply({ embeds: [danger("Missing Permission", "Only the bot owner, people they've allowed, or bot admins can remove servers.")] });
      }

      const guildId = args[1];
      if (!guildId) {
        return message.reply({ embeds: [warn("Missing Server ID", "**Usage:** `,servers remove <serverId>`\nFind the ID by checking `,servers` — it's shown in the listing.")] });
      }

      const removed = removeServer(guildId);
      if (!removed) {
        return message.reply({ embeds: [warn("Not Found", "No listed server matches that ID.")] });
      }

      return message.reply({ embeds: [success("Server Removed", `Removed server ID: ${guildId}`)] });
    }

    // ,servers allow @user — bot owner only, grants add/remove permission
    if (sub === "allow") {
      if (!isBotOwner(message.author.id)) {
        return message.reply({ embeds: [danger("Bot Owner Only", "Only the bot owner can grant this permission.")] });
      }

      const user = message.mentions.users.first();
      if (!user) {
        return message.reply({ embeds: [warn("Missing User", "**Usage:** `,servers allow @user`")] });
      }

      grantAccess(user.id);
      return message.reply({ embeds: [success("Access Granted", `**${user.tag}** can now add/remove servers.`)] });
    }

    // ,servers disallow @user — bot owner only, revokes permission
    if (sub === "disallow") {
      if (!isBotOwner(message.author.id)) {
        return message.reply({ embeds: [danger("Bot Owner Only", "Only the bot owner can revoke this permission.")] });
      }

      const user = message.mentions.users.first();
      if (!user) {
        return message.reply({ embeds: [warn("Missing User", "**Usage:** `,servers disallow @user`")] });
      }

      revokeAccess(user.id);
      return message.reply({ embeds: [success("Access Revoked", `**${user.tag}** can no longer add/remove servers.`)] });
    }

    // ,servers allowed — list who currently has permission (anyone can check)
    if (sub === "allowed") {
      const ids = listAllowedAdders();
      if (!ids.length) {
        return message.reply({ embeds: [info("Allowed Adders", "No one has been given permission yet (only the bot owner can add servers).")] });
      }
      const lines = ids.map((id) => `<@${id}>`).join("\n");
      return message.reply({ embeds: [rich({ title: "✅  Allowed to Add Servers", description: lines, color: colors.primary })] });
    }

    // ,servers (no args) — list all servers, paginated, open to everyone
    const entries = listServers();
    if (!entries.length) {
      return message.reply({ embeds: [info("Server List", "No servers have been added yet.")] });
    }

    const { buildServersPage, serversPageRow } = require("../../handlers/buttons");
    const page = 0;
    const { embeds, content, inviteUrl, guildId, voteCount, hasVoted } = await buildServersPage(entries, page, message.client, message.author.id);
    return message.reply({ content, embeds, components: serversPageRow(message.author.id, page, entries.length, inviteUrl, guildId, voteCount, hasVoted) });
  },
};
