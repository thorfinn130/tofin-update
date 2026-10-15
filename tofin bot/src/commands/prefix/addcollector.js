const { placeCollector, getUnassignedCollectors, getChannels } = require("../../services/machines");
const { warn, danger } = require("../../util/embed");
const { EmbedBuilder } = require("discord.js");

module.exports = {
  name: "addcollector",
  async run(message, args) {
    const userId  = message.author.id;
    const guildId = message.guild.id;

    const channels   = getChannels(userId, guildId);
    const unassigned = getUnassignedCollectors(userId);

    // ─ List ─
    if (!args[0] || args[0].toLowerCase() === "list") {
      if (!channels.length) {
        return message.reply({ embeds: [warn("No Channels", "You have no mine channels on this server yet.")] });
      }

      const fields = channels.map(ch => ({
        name: `Channel #${ch.num}  —  <#${ch.channelId}>`,
        value: ch.machine
          ? (ch.autoCollect
              ? `🤖  **Auto Collector active** — collects every 6h\nLv ${ch.machine.level} machine`
              : `💤  No collector  ·  Lv ${ch.machine.level} machine`)
          : `📭  No machine installed`,
        inline: true,
      }));
      if (fields.length % 3 !== 0) fields.push({ name: "\u200b", value: "\u200b", inline: true });

      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("🤖  Auto Collectors")
          .setDescription(
            `> 📦  **${unassigned}** unassigned collector${unassigned !== 1 ? "s" : ""} in inventory\n` +
            `> Auto-collects TC every **6 hours** per channel\n` +
            `> Use \`,addcollector <ch#>\` to install one`
          )
          .addFields(fields)
          .setColor(0x3498DB)
          .setFooter({ text: "One collector per channel  ·  Buy more: ,shop buy auto_collector" })
          .setTimestamp(),
      ] });
    }

    const channelNum = parseInt(args[0]);
    if (isNaN(channelNum) || channelNum < 1) {
      return message.reply({ embeds: [warn("Usage", "`,addcollector <ch#>` — install a collector\n`,addcollector list` — view channels")] });
    }

    if (unassigned < 1) {
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("⛔  No Collectors in Inventory")
          .setDescription("> You have no collectors to install!\n\n> 🛒  Buy one: \`,shop buy auto_collector\`  —  **25,000 TC**")
          .setColor(0xED4245)
          .setTimestamp(),
      ] });
    }

    const result = placeCollector(userId, guildId, channelNum);
    if (result.error) return message.reply({ embeds: [danger("Error", result.error)] });

    const remaining = getUnassignedCollectors(userId);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle("🤖  Auto Collector Installed!")
        .setDescription(
          `Collector active on **Channel #${channelNum}** → <#${result.channelId}>\n\n` +
          `> ⏰  Collects TC **every 6 hours** automatically\n` +
          `> 💬  You'll get a message in the channel when it runs\n` +
          `> 💤  Fully passive — no action needed\n\n` +
          `> 📦  **${remaining}** collector${remaining !== 1 ? "s" : ""} remaining in inventory`
        )
        .setColor(0x3498DB)
        .setTimestamp(),
    ] });
  },
};
