const { placeWorker, getUnassignedWorkers, getChannels, MAX_WORKERS } = require("../../services/machines");
const { buildMachineEmbed } = require("../../util/machineEmbed");
const { warn, danger } = require("../../util/embed");
const { EmbedBuilder } = require("discord.js");

function dots(n, max) {
  return `${"🟢".repeat(n)}${"⚫".repeat(max - n)}`;
}

module.exports = {
  name: "addworker",
  async run(message, args) {
    const userId  = message.author.id;
    const guildId = message.guild.id;

    const channels   = getChannels(userId, guildId);
    const unassigned = getUnassignedWorkers(userId);

    // ─ List ─
    if (!args[0] || args[0].toLowerCase() === "list") {
      if (!channels.length) {
        return message.reply({ embeds: [warn("No Channels", "You have no mine channels on this server yet.")] });
      }

      const fields = channels.map(ch => ({
        name: `Channel #${ch.num}  —  <#${ch.channelId}>`,
        value: ch.machine
          ? `${dots(ch.workers ?? 0, MAX_WORKERS)}  **${ch.workers ?? 0}/${MAX_WORKERS}** workers\n+${(ch.workers ?? 0) * 25}% boost  ·  Lv ${ch.machine.level} machine`
          : `📭  No machine installed`,
        inline: true,
      }));
      if (fields.length % 3 !== 0) fields.push({ name: "\u200b", value: "\u200b", inline: true });

      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("👷  Mine Workers")
          .setDescription(
            `> 📦  **${unassigned}** unassigned worker${unassigned !== 1 ? "s" : ""} in inventory\n` +
            `> Each worker boosts earnings **+25%** (max ${MAX_WORKERS}/channel)\n` +
            `> Use \`,addworker <ch#>\` to assign one`
          )
          .addFields(fields)
          .setColor(0xE67E22)
          .setFooter({ text: `Max ${MAX_WORKERS} workers per channel  ·  Buy more: ,shop buy worker` })
          .setTimestamp(),
      ] });
    }

    const channelNum = parseInt(args[0]);
    if (isNaN(channelNum) || channelNum < 1) {
      return message.reply({ embeds: [warn("Usage", "`,addworker <ch#>` — assign a worker\n`,addworker list` — view channels")] });
    }

    if (unassigned < 1) {
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("⛔  No Workers in Inventory")
          .setDescription("> You have no workers to assign!\n\n> 🛒  Buy one: \`,shop buy worker\`  —  **15,000 TC**")
          .setColor(0xED4245)
          .setTimestamp(),
      ] });
    }

    const result = placeWorker(userId, guildId, channelNum);
    if (result.error) return message.reply({ embeds: [danger("Error", result.error)] });

    // Refresh machine embed
    const discordChannel = message.guild.channels.cache.get(result.channelId);
    if (discordChannel) {
      const { getChannelByNum, findMachineById } = require("../../services/machines");
      const ch = getChannelByNum(userId, guildId, channelNum);
      if (ch?.machine) {
        const found = findMachineById(userId, ch.machine.id);
        if (found?.machine?.messageId) {
          const { embed, row } = buildMachineEmbed(found.machine, channelNum, guildId, userId, result.workers, ch.autoCollect ?? false);
          discordChannel.messages.fetch(found.machine.messageId)
            .then(msg => msg.edit({ embeds: [embed], components: [row] }))
            .catch(() => {});
        }
      }
    }

    const remaining = getUnassignedWorkers(userId);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle("👷  Worker Assigned!")
        .setDescription(
          `Worker deployed to **Channel #${channelNum}**!\n\n` +
          `> ${dots(result.workers, MAX_WORKERS)}  **${result.workers}/${MAX_WORKERS}** workers\n` +
          `> 📈  **+${result.workers * 25}% earnings boost** on that channel\n\n` +
          `> 📦  **${remaining}** worker${remaining !== 1 ? "s" : ""} remaining in inventory`
        )
        .setColor(0xE67E22)
        .setTimestamp(),
    ] });
  },
};
