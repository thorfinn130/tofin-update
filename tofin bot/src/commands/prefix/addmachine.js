const { placeMachine, setMachineMessage, getUnassigned, getChannels } = require("../../services/machines");
const { buildMachineEmbed } = require("../../util/machineEmbed");
const { warn, danger } = require("../../util/embed");
const { EmbedBuilder } = require("discord.js");

function statusLine(ch) {
  if (!ch.machine) return `📭  *Empty*`;
  const w = ch.workers ?? 0;
  const ac = ch.autoCollect ? "  🤖" : "";
  return `🏭  Lv **${ch.machine.level}**  ·  👷 ${w}/3${ac}`;
}

module.exports = {
  name: "addmachine",
  async run(message, args) {
    const userId  = message.author.id;
    const guildId = message.guild.id;

    const channels   = getChannels(userId, guildId);
    const unassigned = getUnassigned(userId);

    // ─ List ─
    if (!args[0] || args[0].toLowerCase() === "list") {
      if (!channels.length) {
        return message.reply({ embeds: [warn("No Channels", "You have no mine channels on this server.\nBuy one with `,shop buy mine_channel` for **8,000 TC**.")] });
      }

      const fields = channels.map(ch => ({
        name: `Channel #${ch.num}  —  <#${ch.channelId}>`,
        value: statusLine(ch),
        inline: true,
      }));
      if (fields.length % 3 !== 0) fields.push({ name: "\u200b", value: "\u200b", inline: true });

      return message.reply({ embeds: [
        new EmbedBuilder()
          .setAuthor({ name: `${message.author.username}'s Mine Channels`, iconURL: message.author.displayAvatarURL({ size: 64 }) })
          .setTitle("⛏️  Mine Channels")
          .setDescription(
            `> 📦  **${unassigned}** unassigned machine${unassigned !== 1 ? "s" : ""} in inventory\n` +
            `> Use \`,addmachine <ch#>\` to place one\n` +
            `> Buy machines: \`,shop buy machine\``
          )
          .addFields(fields)
          .setColor(0xF1C40F)
          .setFooter({ text: "👷 ,addworker <ch#>  ·  🤖 ,addcollector <ch#>  ·  🏭 ,addmachine <ch#>" })
          .setTimestamp(),
      ] });
    }

    const channelNum = parseInt(args[0]);
    if (isNaN(channelNum) || channelNum < 1) {
      return message.reply({ embeds: [warn("Usage", "`,addmachine <ch#>` — place a machine\n`,addmachine list` — view your channels")] });
    }

    if (unassigned < 1) {
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("⛔  No Machines in Inventory")
          .setDescription("> You have no machines to place!\n\n> 🛒  Buy one: \`,shop buy machine\`  —  **10,000 TC**")
          .setColor(0xED4245)
          .setTimestamp(),
      ] });
    }

    const result = placeMachine(userId, guildId, channelNum);
    if (result.error) return message.reply({ embeds: [danger("Error", result.error)] });

    const { machine, channelId } = result;
    const discordChannel = message.guild.channels.cache.get(channelId);
    if (!discordChannel) {
      return message.reply({ embeds: [danger("Channel Missing", `Channel #${channelNum}'s Discord channel couldn't be found. It may have been deleted.`)] });
    }

    const { embed, row } = buildMachineEmbed(machine, channelNum, guildId, userId);
    const machineMsg = await discordChannel.send({ embeds: [embed], components: [row] });
    setMachineMessage(userId, machine.id, machineMsg.id);

    const remaining = getUnassigned(userId);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle("🏭  Machine Deployed!")
        .setDescription(
          `Machine placed in **Channel #${channelNum}** → <#${channelId}>\n\n` +
          `> ⚡  Earning **400 TC/hr** — upgrade to earn more\n` +
          `> 👷  Add workers: \`,addworker ${channelNum}\` (+25% each)\n` +
          `> 🤖  Add collector: \`,addcollector ${channelNum}\` (auto every 6h)\n\n` +
          `> 📦  **${remaining}** machine${remaining !== 1 ? "s" : ""} remaining in inventory`
        )
        .setColor(0x57F287)
        .setTimestamp(),
    ] });
  },
};
