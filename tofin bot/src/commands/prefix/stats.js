const { getUser, upgradeStats } = require("../../services/leveling");
const OWNER_ID = "1276884559467643042";
const { warn, danger } = require("../../util/embed");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const STAT_INFO = {
  str: { emoji: "💪", name: "Strength",     desc: "Boosts manual labor jobs (Driver, Security Guard)" },
  int: { emoji: "🧠", name: "Intelligence", desc: "Boosts intellectual jobs (Teacher, Programmer, Doctor, CEO)" },
  cha: { emoji: "🎭", name: "Charisma",     desc: "Boosts social jobs (Lawyer, Celebrity, CEO)" },
  lck: { emoji: "🍀", name: "Luck",         desc: "Improves casino odds and rare bonuses" },
};

const VALID_STATS = ["str", "int", "cha", "lck"];

function statBar(value, size = 10) {
  const pct = Math.min(value / 100, 1);
  const filled = Math.round(pct * size);
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

function parseUpgrades(args) {
  const upgrades = {};
  let current = null;
  for (const arg of args) {
    if (VALID_STATS.includes(arg)) { current = arg; if (!upgrades[current]) upgrades[current] = 1; }
    else if (/^\d+$/.test(arg) && current) { upgrades[current] = parseInt(arg); }
  }
  return upgrades;
}

function buildStatsEmbed(author, u) {
  const fields = Object.entries(STAT_INFO).map(([key, info]) => ({
    name: `${info.emoji}  ${info.name}  —  **${u.stats[key] ?? 0}**`,
    value: `\`${statBar(u.stats[key] ?? 0)}\`\n*${info.desc}*`,
    inline: true,
  }));
  if (fields.length % 3 !== 0) fields.push({ name: "\u200b", value: "\u200b", inline: true });

  const pointsLine = u.statPoints > 0
    ? `> ✨  **${u.statPoints} point${u.statPoints !== 1 ? "s" : ""} available** — click a button to spend!`
    : `> 🔒  No points — level up to earn more`;

  return new EmbedBuilder()
    .setAuthor({ name: `${author.username}'s Stats`, iconURL: author.displayAvatarURL({ size: 64 }) })
    .setDescription(`> 🎯  **Level ${u.level}**\n${pointsLine}`)
    .addFields(fields)
    .setColor(0x5865F2)
    .setFooter({ text: "Each level-up grants 3 stat points  ·  Max per stat: 100" })
    .setTimestamp();
}

function buildUpgradeButtons(guildId, userId, u) {
  if (u.statPoints < 1) return null;
  const row = new ActionRowBuilder().addComponents(
    Object.entries(STAT_INFO).map(([key, info]) =>
      new ButtonBuilder()
        .setCustomId(`stat_up:${guildId}:${userId}:${key}`)
        .setLabel(`${info.emoji} +1 ${info.name}`)
        .setStyle(ButtonStyle.Primary)
    )
  );
  return row;
}

module.exports = {
  name: "stats",
  buildStatsEmbed, buildUpgradeButtons,
  run(message, args) {
    const sub = args[0]?.toLowerCase();

    if (sub === "upgrade") {
      const rest = args.slice(1).map(a => a.toLowerCase());
      if (!rest.length) {
        return message.reply({ embeds: [warn("Usage",
          "**`,stats upgrade <stat> [amount]`**\n\n" +
          "**Examples:**\n> `,stats upgrade str` — +1 Strength\n" +
          "> `,stats upgrade str 3` — +3 Strength\n" +
          "> `,stats upgrade str 2 int cha 3` — multiple\n\n" +
          "**Stats:** `str` · `int` · `cha` · `lck`"
        )] });
      }

      const upgrades = parseUpgrades(rest);
      if (!Object.keys(upgrades).length) return message.reply({ embeds: [danger("Invalid", "No valid stats. Choose: `str` · `int` · `cha` · `lck`")] });

      const isOwner = message.author.id === OWNER_ID;
      const result  = upgradeStats(message.guild.id, message.author.id, upgrades, isOwner);
      if (result.error) return message.reply({ embeds: [danger("Can't Upgrade", result.error)] });

      const lines = Object.entries(result.upgrades).map(([s, amt]) =>
        `> ${STAT_INFO[s].emoji}  **${STAT_INFO[s].name}**  +${amt}  →  \`${statBar(result.u.stats[s])}\`  **${result.u.stats[s]}**`
      );

      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("✨  Stats Upgraded!")
          .setDescription(`${lines.join("\n")}\n\n> 🔮  Points remaining: **${result.u.statPoints}**`)
          .setColor(0x9B59B6)
          .setTimestamp(),
      ] });
    }

    const u = getUser(message.guild.id, message.author.id);
    const embed = buildStatsEmbed(message.author, u);
    const btnRow = buildUpgradeButtons(message.guild.id, message.author.id, u);
    return message.reply({
      embeds: [embed],
      components: btnRow ? [btnRow] : [],
    });
  },
};
