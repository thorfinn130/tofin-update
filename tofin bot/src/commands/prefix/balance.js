const { getUser, fmt } = require("../../services/economy");
const { EmbedBuilder } = require("discord.js");

function bar(value, max, size = 14) {
  if (max === 0) return "░".repeat(size);
  const pct = Math.min(Math.max(value / max, 0), 1);
  const filled = Math.round(pct * size);
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

module.exports = {
  name: "balance",
  aliases: ["bal", "wallet"],
  run(message, args) {
    const user = message.mentions.users.first() ?? message.author;
    const u = getUser(user.id);
    const total = u.wallet + u.bank;

    const walletPct = total > 0 ? Math.round((u.wallet / total) * 100) : 0;
    const bankPct   = total > 0 ? Math.round((u.bank   / total) * 100) : 0;

    const desc = [
      `### 👛  Wallet`,
      `\`${bar(u.wallet, total)}\`  **${fmt(u.wallet)} TC**  *(${walletPct}%)*`,
      `### 🏦  Bank`,
      `\`${bar(u.bank, total)}\`  **${fmt(u.bank)} TC**  *(${bankPct}%)*`,
      ``,
      `> 📊  **Net Worth:  ${fmt(total)} TC**`,
    ].join("\n");

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${user.username}'s Balance`, iconURL: user.displayAvatarURL({ size: 64 }) })
      .setDescription(desc)
      .setColor(0xF1C40F)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: "Tofin Coin (TC)  ·  Global currency — same on every server" })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  },
};
