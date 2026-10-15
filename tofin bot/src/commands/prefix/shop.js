const { ITEMS, getItem } = require("../../services/shopItems");
const { applyBuff, hasBuff, timeLeft, fmtTimeLeft } = require("../../services/buffs");
const { getUser: getEcoUser, removeWallet, fmt } = require("../../services/economy");
const { getUser: getLvUser, setUser: setLvUser } = require("../../services/leveling");
const {
  hasCategory, createCategory, addChannel, getChannels, getUnassigned, addUnassigned,
  getUnassignedWorkers, addUnassignedWorker, getUnassignedCollectors, addUnassignedCollector,
  getServerData,
} = require("../../services/machines");
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { success, warn, danger } = require("../../util/embed");
const { PermissionFlagsBits } = require("discord.js");

// ── Visual helpers ─────────────────────────────────────────────────────────
const SECTION = (emoji, label) => `${emoji}  **${label}**`;

function badge(text, owned) {
  return owned ? `\`✅ OWNED\`` : `\`${text}\``;
}

module.exports = {
  name: "shop",
  async run(message, args) {
    const sub = args[0]?.toLowerCase();
    const userId = message.author.id;
    const guildId = message.guild.id;

    // ── Browse ──────────────────────────────────────────────────────────────
    if (!sub || sub === "list") {
      const unassigned  = getUnassigned(userId);
      const unWorkers   = getUnassignedWorkers(userId);
      const unCollect   = getUnassignedCollectors(userId);
      const channels    = getChannels(userId, guildId);
      const hasCat      = hasCategory(userId, guildId);
      const eco         = getEcoUser(userId);

      const luckActive  = hasBuff(guildId, userId, "luck_potion");
      const xpActive    = hasBuff(guildId, userId, "xp_boost");

      const fields = [
        // ─ Boosts ─
        {
          name: "╔══════════  🎰  BOOSTS  ══════════╗",
          value: "\u200b",
          inline: false,
        },
        {
          name: `🧪  Luck Potion  —  \`500 TC\``,
          value: luckActive
            ? `✦ **ACTIVE** — ${fmtTimeLeft(timeLeft(guildId, userId, "luck_potion"))} remaining\nCasino wins pay **1.5×** for 1 hour`
            : `Casino wins pay **1.5×** for 1 hour\n> \`,shop buy luck_potion\``,
          inline: true,
        },
        {
          name: `📜  XP Scroll  —  \`1,000 TC\``,
          value: xpActive
            ? `✦ **ACTIVE** — ${fmtTimeLeft(timeLeft(guildId, userId, "xp_boost"))} remaining\n**2× XP** from messages for 30 min`
            : `**2× XP** from messages for 30 min\n> \`,shop buy xp_scroll\``,
          inline: true,
        },
        {
          name: `💊  Stat Capsule  —  \`2,500 TC\``,
          value: `Instantly grants **+2 stat points**\nUse with \`,stats upgrade\`\n> \`,shop buy stat_capsule\``,
          inline: true,
        },

        // ─ Mine Setup ─
        {
          name: "╔═════════  ⛏️  MINE SETUP  ═════════╗",
          value: "\u200b",
          inline: false,
        },
        {
          name: `⛏️  Mine Category  —  \`50,000 TC\``,
          value: hasCat
            ? `✅ **Owned on this server**\nYour private mine category is active`
            : `Creates your **private mine category**\nRequired before buying channels\n> \`,shop buy mine_category\``,
          inline: true,
        },
        {
          name: `📺  Mine Channel  —  \`8,000 TC\``,
          value: hasCat
            ? `You have **${channels.length}** channel${channels.length !== 1 ? "s" : ""} here\nEach channel holds 1 machine\n> \`,shop buy mine_channel\``
            : `⚠️  *Requires Mine Category first*\nEach channel holds 1 machine`,
          inline: true,
        },
        { name: "\u200b", value: "\u200b", inline: true },

        // ─ Equipment ─
        {
          name: "╔══════════  🏭  EQUIPMENT  ══════════╗",
          value: "\u200b",
          inline: false,
        },
        {
          name: `🏭  Mining Machine  —  \`10,000 TC\``,
          value: unassigned > 0
            ? `📦 **${unassigned}** in inventory — use \`,addmachine <ch#>\`\nEarns up to **${fmt(400)} TC/hr** (upgradeable)`
            : `Passive income machine, earns TC/hr\nUse \`,addmachine <ch#>\` to place\n> \`,shop buy machine\``,
          inline: true,
        },
        {
          name: `👷  Worker  —  \`15,000 TC\``,
          value: unWorkers > 0
            ? `📦 **${unWorkers}** in inventory — use \`,addworker <ch#>\`\nBoosts machine earnings **+25%** each`
            : `Boosts a machine's earnings by **+25%**\nMax 3 per channel  ·  \`,addworker <ch#>\`\n> \`,shop buy worker\``,
          inline: true,
        },
        {
          name: `🤖  Auto Collector  —  \`25,000 TC\``,
          value: unCollect > 0
            ? `📦 **${unCollect}** in inventory — use \`,addcollector <ch#>\`\nCollects TC **every 6 hours** silently`
            : `Auto-collects TC every **6 hours**\nOne per channel  ·  \`,addcollector <ch#>\`\n> \`,shop buy auto_collector\``,
          inline: true,
        },
      ];

      const embed = new EmbedBuilder()
        .setAuthor({ name: `${message.author.username}'s Shop`, iconURL: message.author.displayAvatarURL({ size: 64 }) })
        .setTitle("🛒  Tofin Shop")
        .setDescription(`> 💳  **Wallet:  ${fmt(eco.wallet)} TC**\n> Browse below or use the **Quick Buy** menu to purchase instantly!`)
        .addFields(fields)
        .setColor(0x5865F2)
        .setFooter({ text: "🎭 Level 100 exclusive roles → ,roleshop  ·  Items are global (work on any server)" })
        .setTimestamp();

      const quickBuy = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`shop_select:${userId}`)
          .setPlaceholder("⚡  Quick Buy — select an item...")
          .addOptions(ITEMS.map(item => ({
            label: `${item.name}  —  ${fmt(item.price)} TC`,
            description: item.desc.replace(/\*\*/g, "").slice(0, 100),
            value: item.id,
            emoji: item.emoji,
          })))
      );

      return message.reply({ embeds: [embed], components: [quickBuy] });
    }

    // ── Buy ──────────────────────────────────────────────────────────────────
    if (sub === "buy") {
      const itemId = args[1]?.toLowerCase();
      if (!itemId) return message.reply({ embeds: [warn("Usage", "`,shop buy <item_id>`\nSee `,shop` for item IDs.")] });
      const item = getItem(itemId);
      if (!item) return message.reply({ embeds: [danger("Not Found", `No item with ID \`${itemId}\`.\nSee \`,shop\` for the full list.`)] });

      const eco = getEcoUser(userId);
      if (eco.wallet < item.price) {
        const need = item.price - eco.wallet;
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("⛔  Insufficient Funds")
            .setDescription(`**${item.emoji}  ${item.name}** costs **${fmt(item.price)} TC**\n\n> 💳  You have:  **${fmt(eco.wallet)} TC**\n> 🔻  Short by:  **${fmt(need)} TC**\n\nEarn more with \`,daily\`, \`,work\`, or casino games!`)
            .setColor(0xED4245)
            .setTimestamp(),
        ] });
      }

      // ─ Luck Potion ─
      if (itemId === "luck_potion") {
        removeWallet(userId, item.price);
        applyBuff(guildId, userId, "luck_potion", 3_600_000);
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("🧪  Luck Potion — Active!")
            .setDescription(`Casino wins now pay **1.5×** for the next **1 hour**!\n\n> 🎰  Try \`,slots\`, \`,blackjack\`, or \`,roulette\`\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0x2ECC71)
            .setTimestamp(),
        ] });
      }

      // ─ XP Scroll ─
      if (itemId === "xp_scroll") {
        removeWallet(userId, item.price);
        applyBuff(guildId, userId, "xp_boost", 1_800_000);
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("📜  XP Scroll — Active!")
            .setDescription(`**2× XP** from every message for the next **30 minutes**!\n\n> ⚡  Start chatting to level up fast\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0x3498DB)
            .setTimestamp(),
        ] });
      }

      // ─ Stat Capsule ─
      if (itemId === "stat_capsule") {
        removeWallet(userId, item.price);
        const lv = getLvUser(guildId, userId);
        lv.statPoints += 2;
        setLvUser(guildId, userId, lv);
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("💊  Stat Capsule — Consumed!")
            .setDescription(`You received **+2 stat points**!\n\n> ✨  You now have **${lv.statPoints} stat points** to spend\n> Use \`,stats upgrade <str|int|cha|lck>\`\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0x9B59B6)
            .setTimestamp(),
        ] });
      }

      // ─ Mine Category ─
      if (itemId === "mine_category") {
        const { isAutoChannelsEnabled } = require("./channeltoggle");
        if (!isAutoChannelsEnabled(guildId)) {
          return message.reply({ embeds: [warn("Channels Disabled", "Auto-channel creation is turned off on this server.\nAn admin can re-enable it with `,channelon`.")] });
        }
        if (hasCategory(userId, guildId)) {
          return message.reply({ embeds: [warn("Already Owned", "You already have a Mine Category on this server!\nBuy more channels with `,shop buy mine_channel`.")] });
        }
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return message.reply({ embeds: [danger("Missing Permission", "I need **Manage Channels** permission to create your mine.")] });
        }

        removeWallet(userId, item.price);

        const category = await message.guild.channels.create({
          name: `⛏┊${message.author.username}'s Mine`,
          type: 4,
          permissionOverwrites: [
            { id: guildId, deny: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
            { id: userId, allow: ["ViewChannel", "ReadMessageHistory"] },
            { id: message.guild.members.me.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"] },
          ],
        });

        createCategory(userId, guildId, category.id);

        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("⛏️  Mine Category Created!")
            .setDescription(`Your private mine category has been set up!\n\n> 📂  **${category.name}** — only you can see it\n\n**Next steps:**\n> 1️⃣  \`,shop buy mine_channel\` — add a channel  \`8,000 TC\`\n> 2️⃣  \`,shop buy machine\` — get a machine  \`10,000 TC\`\n> 3️⃣  \`,addmachine <ch#>\` — place it\n\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0xF1C40F)
            .setTimestamp(),
        ] });
      }

      // ─ Mine Channel ─
      if (itemId === "mine_channel") {
        const { isAutoChannelsEnabled } = require("./channeltoggle");
        if (!isAutoChannelsEnabled(guildId)) {
          return message.reply({ embeds: [warn("Channels Disabled", "Auto-channel creation is turned off on this server.\nAn admin can re-enable it with `,channelon`.")] });
        }
        if (!hasCategory(userId, guildId)) {
          return message.reply({ embeds: [warn("No Category", "You need a Mine Category first!\nBuy one with `,shop buy mine_category` for **50,000 TC**.")] });
        }
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return message.reply({ embeds: [danger("Missing Permission", "I need **Manage Channels** permission to create channels.")] });
        }

        const serverData = getServerData(userId, guildId);
        const nextNum = serverData.channels.length + 1;

        removeWallet(userId, item.price);

        const channel = await message.guild.channels.create({
          name: `⛏┊channel-${nextNum}`,
          type: 0,
          parent: serverData.categoryId,
          permissionOverwrites: [
            { id: guildId, deny: ["ViewChannel"] },
            { id: userId, allow: ["ViewChannel", "ReadMessageHistory"] },
            { id: message.guild.members.me.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"] },
          ],
        });

        const num = addChannel(userId, guildId, channel.id);

        await channel.send({ embeds: [
          new EmbedBuilder()
            .setTitle(`📺  Mine Channel #${num}`)
            .setDescription(`Welcome to **Channel #${num}** in your mine!\n\n> 🏭  Use \`,addmachine ${num}\` to place a machine here\n> 👷  Use \`,addworker ${num}\` to boost earnings (+25% per worker)\n> 🤖  Use \`,addcollector ${num}\` to auto-collect every 6h\n\nEach channel holds **1 machine** that earns TC passively.`)
            .setColor(0x5865F2)
            .setFooter({ text: "Tofin Mine System" })
            .setTimestamp(),
        ] });

        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle(`📺  Channel #${num} Created!`)
            .setDescription(`<#${channel.id}> is ready for a machine!\n\n> ▶️  Place a machine: \`,addmachine ${num}\`\n> 🏭  Buy a machine first: \`,shop buy machine\`\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0x57F287)
            .setTimestamp(),
        ] });
      }

      // ─ Mining Machine ─
      if (itemId === "machine") {
        removeWallet(userId, item.price);
        addUnassigned(userId);
        const total = getUnassigned(userId);
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("🏭  Machine Added to Inventory!")
            .setDescription(`You now have **${total} unassigned machine${total !== 1 ? "s" : ""}** in your inventory.\n\n> ▶️  Place it: \`,addmachine <channel#>\`\n> 📋  View channels: \`,addmachine list\`\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0x57F287)
            .setTimestamp(),
        ] });
      }

      // ─ Worker ─
      if (itemId === "worker") {
        removeWallet(userId, item.price);
        addUnassignedWorker(userId);
        const total = getUnassignedWorkers(userId);
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("👷  Worker Added to Inventory!")
            .setDescription(`You now have **${total} unassigned worker${total !== 1 ? "s" : ""}** in your inventory.\n\n> ▶️  Assign: \`,addworker <channel#>\`\n> 📈  Each worker boosts earnings **+25%** (max 3/channel)\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0xE67E22)
            .setTimestamp(),
        ] });
      }

      // ─ Auto Collector ─
      if (itemId === "auto_collector") {
        removeWallet(userId, item.price);
        addUnassignedCollector(userId);
        const total = getUnassignedCollectors(userId);
        return message.reply({ embeds: [
          new EmbedBuilder()
            .setTitle("🤖  Auto Collector Added to Inventory!")
            .setDescription(`You now have **${total} unassigned collector${total !== 1 ? "s" : ""}** in your inventory.\n\n> ▶️  Install: \`,addcollector <channel#>\`\n> ⏰  Collects TC every **6 hours** automatically\n> 💳  Remaining wallet: **${fmt(eco.wallet - item.price)} TC**`)
            .setColor(0x3498DB)
            .setTimestamp(),
        ] });
      }
    }

    return message.reply({ embeds: [warn("Usage", "`,shop` — browse all items\n`,shop buy <item_id>` — purchase an item")] });
  },
};
