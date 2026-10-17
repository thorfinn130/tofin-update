const { claimWork, addWallet, getUser, fmt } = require("../../services/economy");
const { workWithJob, getUser: getLvUser } = require("../../services/leveling");
const { EmbedBuilder } = require("discord.js");
const { warn } = require("../../util/embed");

const WORK_COOLDOWN = 3_600_000;
const workCooldowns = new Map();

module.exports = {
  name: "work",
  async run(message) {
    const userId = message.author.id;
    const now    = Date.now();
    const last   = workCooldowns.get(userId) ?? 0;
    const remaining = WORK_COOLDOWN - (now - last);

    if (remaining > 0) {
      const h = Math.floor(remaining / 3_600_000);
      const m = Math.floor((remaining % 3_600_000) / 60_000);
      const s = Math.floor((remaining % 60_000) / 1_000);
      const t = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("⏳  Too Soon!")
          .setDescription(`> You can work again in **${t}**\n\n> 🎁  Use \`,daily\` for your daily reward\n> 🎰  Try \`,slots\` or \`,blackjack\` in the meantime`)
          .setColor(0xFEE75C)
          .setTimestamp(),
      ] });
    }

    workCooldowns.set(userId, now);

    const jobWork = workWithJob(message.guild.id, userId);
    if (jobWork) {
      addWallet(userId, jobWork.amount);
      const eco = getUser(userId);
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL({ size: 64 }) })
          .setTitle(`${jobWork.job.emoji}  Work Shift Complete!`)
          .setDescription(
            `> Worked as **${jobWork.job.name}**\n` +
            `> 💰  Earned **${fmt(jobWork.amount)} TC**\n` +
            `> 💳  Wallet: **${fmt(eco.wallet)} TC**\n\n` +
            `> ⏰  Next shift available in **1 hour**`
          )
          .setColor(0x57F287)
          .setFooter({ text: "Change jobs: ,jobs  ·  Upgrade stats: ,stats" })
          .setTimestamp(),
      ] });
    }

    const result = claimWork(userId);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL({ size: 64 }) })
        .setTitle("💼  Work Complete!")
        .setDescription(
          `> ${result.msg} and earned **${fmt(result.amount)} TC**\n` +
          `> 💳  Wallet: **${fmt(result.u.wallet)} TC**\n\n` +
          `> 🧑‍💼  Get a job for better pay: \`,jobs list\`\n` +
          `> ⏰  Next shift available in **1 hour**`
        )
        .setColor(0x57F287)
        .setFooter({ text: "Get a job with ,jobs list to earn more TC" })
        .setTimestamp(),
    ] });
  },
};
