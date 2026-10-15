const { ROLES, LEVEL_REQ, getRole, getOwnedRoles, addOwnedRole, getOrCreateDiscordRole } = require("../../services/roleShop");
const { getUser: getLvUser } = require("../../services/leveling");
const { getUser: getEcoUser, removeWallet, fmt } = require("../../services/economy");
const { warn, danger } = require("../../util/embed");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { PermissionFlagsBits } = require("discord.js");

function bar(value, max, size = 16) {
  const pct = Math.min(Math.max(value / max, 0), 1);
  const filled = Math.round(pct * size);
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

function buildShopEmbed(userId, guildId, author) {
  const lv    = getLvUser(guildId, userId);
  const owned = getOwnedRoles(userId);
  const eco   = getEcoUser(userId);

  const fields = ROLES.map(r => {
    const isOwned = owned.includes(r.id);
    const hex = `#${r.color.toString(16).padStart(6, "0").toUpperCase()}`;
    return {
      name: `${r.emoji}  ${r.name.replace(/^[^\s]+\s/, "")}  ${isOwned ? "✅" : `— ${fmt(r.price)} TC`}`,
      value: isOwned
        ? `> ✦ **Owned**  ·  \`${hex}\``
        : `> ${r.desc}  ·  \`${hex}\`\nID: \`${r.id}\``,
      inline: true,
    };
  });
  if (fields.length % 3 !== 0) fields.push({ name: "\u200b", value: "\u200b", inline: true });

  return new EmbedBuilder()
    .setAuthor({ name: `${author.username}  ·  Level ${lv.level}`, iconURL: author.displayAvatarURL({ size: 64 }) })
    .setTitle("🎭  Role Shop — Level 100 Exclusive")
    .setDescription(
      `Exclusive **hoisted** roles — visible in the member list with unique colours.\n\n` +
      `> 💳  Wallet:  **${fmt(eco.wallet)} TC**  ·  Owned: **${owned.length}/${ROLES.length}**`
    )
    .addFields(fields)
    .setColor(0xFFD700)
    .setFooter({ text: "Click a button below to buy  ·  Roles are created on first purchase" })
    .setTimestamp();
}

function buildButtons(userId, guildId) {
  const owned  = getOwnedRoles(userId);
  const eco    = getEcoUser(userId);
  const rows   = [];
  const chunks = [];

  for (let i = 0; i < ROLES.length; i += 5) chunks.push(ROLES.slice(i, i + 5));

  for (const chunk of chunks) {
    const row = new ActionRowBuilder().addComponents(
      chunk.map(r => {
        const isOwned = owned.includes(r.id);
        const canAfford = eco.wallet >= r.price;
        return new ButtonBuilder()
          .setCustomId(`rshop_buy:${userId}:${r.id}`)
          .setLabel(isOwned ? `${r.emoji} Owned` : `${r.emoji} ${r.name.replace(/^[^\s]+\s/, "")}`)
          .setStyle(isOwned ? ButtonStyle.Secondary : canAfford ? ButtonStyle.Success : ButtonStyle.Danger)
          .setDisabled(isOwned);
      })
    );
    rows.push(row);
  }
  return rows;
}

module.exports = {
  name: "roleshop",
  aliases: ["rshop"],
  buildShopEmbed, buildButtons,
  async run(message, args) {
    const userId  = message.author.id;
    const guildId = message.guild.id;
    const lv      = getLvUser(guildId, userId);

    // ── Locked ───────────────────────────────────────────────────────────────
    if (lv.level < LEVEL_REQ) {
      const lvBar = bar(lv.level, LEVEL_REQ, 16);
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("🔒  Role Shop — Level 100 Exclusive")
          .setDescription(
            `This shop is **locked** until you reach Level **${LEVEL_REQ}**.\n\n` +
            `> 📊  Your level: **${lv.level} / ${LEVEL_REQ}**\n` +
            `> \`${lvBar}\`  ${Math.round((lv.level / LEVEL_REQ) * 100)}%\n` +
            `> ⚡  **${LEVEL_REQ - lv.level} levels to go** — keep chatting & working!`
          )
          .setColor(0x2C2F33)
          .setFooter({ text: "Earn XP by chatting  ·  Use ,work and ,daily for TC" })
          .setTimestamp(),
      ] });
    }

    // ── Legacy text buy ──────────────────────────────────────────────────────
    if (args[0]?.toLowerCase() === "buy") {
      const roleId  = args[1]?.toLowerCase();
      if (!roleId) return message.reply({ embeds: [warn("Usage", "`,roleshop buy <role_id>`  or just click a button in `,roleshop`")] });

      const roleDef = getRole(roleId);
      if (!roleDef) return message.reply({ embeds: [danger("Not Found", `No role \`${roleId}\`. See \`,roleshop\` for the list.`)] });

      const owned = getOwnedRoles(userId);
      if (owned.includes(roleId)) return message.reply({ embeds: [warn("Already Owned", `You already own **${roleDef.name}**!`)] });

      const eco = getEcoUser(userId);
      if (eco.wallet < roleDef.price) {
        return message.reply({ embeds: [danger("Insufficient Funds",
          `**${roleDef.emoji}  ${roleDef.name}** costs **${fmt(roleDef.price)} TC**\n> You have: **${fmt(eco.wallet)} TC**`
        )] });
      }

      if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return message.reply({ embeds: [danger("Missing Permission", "I need **Manage Roles** permission.")] });
      }

      removeWallet(userId, roleDef.price);
      try {
        const discordRole = await getOrCreateDiscordRole(message.guild, roleId);
        if (!discordRole) { const { addWallet } = require("../../services/economy"); addWallet(userId, roleDef.price); return message.reply({ embeds: [danger("Error", "Couldn't create role. TC refunded.")] }); }
        const member = await message.guild.members.fetch(userId);
        await member.roles.add(discordRole, "Role Shop purchase");
        addOwnedRole(userId, roleId);
        const hex = `#${roleDef.color.toString(16).padStart(6, "0").toUpperCase()}`;
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle(`${roleDef.emoji}  ${roleDef.name.replace(/^[^\s]+\s/, "")} — Unlocked!`)
            .setDescription(`You now have the **${roleDef.name}** role!\n> 🎨 Color: \`${hex}\`\n> ✅ Visible in the member list\n> 💳 Remaining wallet: **${fmt(eco.wallet - roleDef.price)} TC**`)
            .setColor(roleDef.color)
            .setFooter({ text: "Browse more → ,roleshop" })
            .setTimestamp(),
        ] });
      } catch (e) {
        const { addWallet } = require("../../services/economy");
        addWallet(userId, roleDef.price);
        if (e.code === 50013) return message.reply({ embeds: [danger("Permission Error", "Move my role above the shop roles in the role list.")] });
        throw e;
      }
    }

    // ── Browse with buttons ──────────────────────────────────────────────────
    const embed = buildShopEmbed(userId, guildId, message.author);
    const rows  = buildButtons(userId, guildId);
    return message.reply({ embeds: [embed], components: rows });
  },
};
