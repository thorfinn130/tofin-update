const { claimDaily, fmt, fmtTime } = require("../../services/economy");
const { EmbedBuilder } = require("discord.js");

module.exports = {
  name: "daily",
  run(message) {
    const result = claimDaily(message.author.id);

    if (result.cooldown) {
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("⏳  Already Claimed")
          .setDescription(`> Come back in **${fmtTime(result.cooldown)}** for your next daily reward!\n\n> 💼  Use \`,work\` in the meantime — 1h cooldown`)
          .setColor(0xFEE75C)
          .setFooter({ text: "Daily resets every 24 hours" })
          .setTimestamp(),
      ] });
    }

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL({ size: 64 }) })
        .setTitle("🎁  Daily Reward Claimed!")
        .setDescription(
          `> 💰  You received **${fmt(result.amount)} TC**!\n` +
          `> 💳  New wallet: **${fmt(result.u.wallet)} TC**\n\n` +
          `> 💼  Earn more with \`,work\` *(1h cooldown)*\n` +
          `> 🎰  Try your luck at \`,slots\`, \`,blackjack\`, \`,roulette\``
        )
        .setColor(0x57F287)
        .setFooter({ text: "Come back tomorrow for your next daily!" })
        .setTimestamp(),
    ] });
  },
};
