const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { upgradeCost, earningsPerHour, pendingEarnings, MAX_WORKERS } = require("../services/machines");

function fmt(n) { return Math.floor(n).toLocaleString("en-US"); }

function bar(value, max, size = 12) {
  const pct = Math.min(Math.max(value / max, 0), 1);
  const filled = Math.round(pct * size);
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

function levelStars(level) {
  const stars = Math.round((level / 30) * 5);
  return `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
}

function levelColor(level) {
  if (level >= 30) return 0xFFD700; // MAX — gold
  if (level >= 21) return 0xFF6B35; // orange
  if (level >= 11) return 0x9B59B6; // purple
  if (level >= 6)  return 0x3498DB; // blue
  return 0x57F287;                  // green
}

function workerDots(workers) {
  return `${"🟢".repeat(workers)}${"⚫".repeat(MAX_WORKERS - workers)}`;
}

function buildMachineEmbed(machine, index, guildId, userId, workers = 0, autoCollect = false) {
  const level = machine.level;
  const isMax = level >= 30;
  const rate = earningsPerHour(level, workers);
  const pending = pendingEarnings(machine, workers);
  const cost = upgradeCost(level);

  const elapsed = (Date.now() - machine.lastCollect) / 3_600_000;
  const hours = Math.min(elapsed, 24);
  const accBar = bar(hours, 24, 14);
  const lvBar = bar(level, 30, 14);

  const workerBoost = workers > 0 ? ` *(+${workers * 25}% boost)*` : "";
  const collectorTag = autoCollect ? "  🤖 **Auto Collector ON**" : "";

  const desc = [
    `> ${levelStars(level)}  **Level ${level}${isMax ? " ✦ MAX" : ` / 30`}**`,
    `> ${lvBar}  \`${Math.round((level / 30) * 100)}%\``,
    ``,
    `⚡  **${fmt(rate)} TC / hr**${workerBoost}`,
    `💰  **Pending:  ${fmt(pending)} TC**`,
    `⏳  \`${accBar}\`  ${Math.floor(hours * 10) / 10}h / 24h`,
    ``,
    `👷  Workers: ${workerDots(workers)}  \`${workers}/${MAX_WORKERS}\`${collectorTag}`,
  ].join("\n");

  const nextRate = earningsPerHour(Math.min(level + 1, 30), workers);

  const embed = new EmbedBuilder()
    .setTitle(`🏭  Mine Channel #${index}  ·  Machine`)
    .setDescription(desc)
    .addFields(
      {
        name: "⬆️  Next Upgrade",
        value: isMax
          ? "✦ **MAX LEVEL REACHED**"
          : `**${fmt(cost)} TC**\n→ ${fmt(nextRate)} TC/hr at Lv ${level + 1}`,
        inline: true,
      },
      {
        name: "📈  Max Potential",
        value: `Lv 30 + 3 workers\n**${fmt(earningsPerHour(30, 3))} TC/hr**`,
        inline: true,
      },
    )
    .setColor(levelColor(level))
    .setFooter({ text: `ID: ${machine.id}  ·  24h accumulation cap  ·  Collect anytime` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`upgrade_machine:${guildId}:${userId}:${machine.id}`)
      .setLabel(isMax ? "✦ MAX LEVEL" : `⬆️  Upgrade  —  ${fmt(cost)} TC`)
      .setStyle(isMax ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(isMax),
    new ButtonBuilder()
      .setCustomId(`collect_machine:${guildId}:${userId}:${machine.id}`)
      .setLabel(pending > 0 ? `💰  Collect  ${fmt(pending)} TC` : "💤  Nothing Yet")
      .setStyle(pending > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(pending === 0),
  );

  return { embed, row };
}

module.exports = { buildMachineEmbed };
