const { upgradeMachine, collectMachine, findMachineById, pendingEarnings, upgradeCost } = require("../services/machines");
const { getUser: getEcoUser, removeWallet, addWallet, fmt } = require("../services/economy");
const { buildMachineEmbed } = require("../util/machineEmbed");
const { games } = require("../services/blackjackState");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require("discord.js");
const { getTemplate, saveTemplate, buildPreviewEmbed, buildWelcomeEmbed, buildBuilderEmbed, buildLivePreviewEmbed, resolveVars, resolveGifUrl } = require("../services/welcomer");
const {
  getDraft, updateDraft, updateDraftLayout, clearDraft, addServer, canAdd,
  parseHexColor, describeCard, DEFAULT_LAYOUT, getTopGuildIds,
} = require("../services/serverLinks");
const { success: successEmbed, danger: dangerEmbed, warn: warnEmbed } = require("../util/embed");
const { colors } = require("../config");

// ── helpers ──────────────────────────────────────────────────────────────────
function disableAll(row) {
  return new ActionRowBuilder().addComponents(
    row.components.map(b => ButtonBuilder.from(b).setDisabled(true))
  );
}

// ── Machine buttons ───────────────────────────────────────────────────────────
async function handleMachine(interaction) {
  const [action, guildId, userId, machineId] = interaction.customId.split(":");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ This is not your machine!", ephemeral: true });
  }

  const found = findMachineById(userId, machineId);
  if (!found) return interaction.reply({ content: "❌ Machine not found.", ephemeral: true });
  const { machine, channelNum, workers, autoCollect } = found;

  if (action === "upgrade_machine") {
    if (machine.level >= 30) return interaction.reply({ content: "✅ Already at max level!", ephemeral: true });
    const cost = upgradeCost(machine.level);
    const eco  = getEcoUser(userId);
    if (eco.wallet < cost) {
      return interaction.reply({ content: `❌ Need **${fmt(cost)} TC** to upgrade. You have **${fmt(eco.wallet)} TC**.`, ephemeral: true });
    }
    removeWallet(userId, cost);
    const result = upgradeMachine(userId, machineId);
    if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    const fresh = findMachineById(userId, machineId);
    const { embed, row } = buildMachineEmbed(result.machine, channelNum, guildId, userId, fresh?.workers ?? workers, fresh?.autoCollect ?? autoCollect);
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (action === "collect_machine") {
    const pending = pendingEarnings(machine, workers);
    if (pending === 0) return interaction.reply({ content: "💤 Nothing to collect yet!", ephemeral: true });
    const result = collectMachine(userId, machineId);
    if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    addWallet(userId, result.earned);
    const fresh = findMachineById(userId, machineId);
    const freshMachine = fresh?.machine ?? result.machine;
    const { embed, row } = buildMachineEmbed(freshMachine, channelNum, guildId, userId, fresh?.workers ?? workers, fresh?.autoCollect ?? autoCollect);
    await interaction.update({ embeds: [embed], components: [row] });
    return interaction.followUp({ content: `💰 Collected **${fmt(result.earned)} TC** from Machine #${channelNum}!`, ephemeral: true });
  }
}

// ── Blackjack buttons ─────────────────────────────────────────────────────────
async function handleBlackjack(interaction) {
  const [action, userId] = interaction.customId.split(":");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ This isn't your game!", ephemeral: true });
  }

  const game = games.get(userId);
  if (!game) {
    return interaction.reply({ content: "❌ No active game found. Start a new one with `,blackjack <bet>`.", ephemeral: true });
  }

  const { bjEmbed, handVal, gameButtons } = require("../commands/prefix/blackjack");
  const { hasBuff } = require("../services/buffs");

  const { deck, playerHand, dealerHand, bet, guildId } = game;

  const end = async (status, extraWinnings = 0) => {
    games.delete(userId);
    let winnings = 0;
    if (status === "win" || status === "dlose") winnings = bet * 2;
    else if (status === "push") winnings = bet;
    else if (status === "bj") winnings = Math.floor(bet * 2.5);
    winnings += extraWinnings;

    const luck = winnings > 0 && hasBuff(guildId, userId, "luck_potion");
    if (luck) winnings = Math.floor(winnings * 1.5);
    if (winnings > 0) addWallet(userId, winnings);

    const finalUser = getEcoUser(userId);
    const net = winnings - bet;
    const embed = bjEmbed(interaction.user, playerHand, dealerHand, bet, false, status, winnings);
    embed.addFields(
      { name: "💳  New Wallet", value: `**${fmt(finalUser.wallet)} TC**`, inline: true },
      { name: "📊  Net", value: `**${net >= 0 ? "+" : ""}${fmt(net)} TC**`, inline: true },
    );
    if (luck) embed.addFields({ name: "🧪  Luck Potion", value: "1.5× bonus applied!", inline: true });

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bj_disabled_1").setLabel("🃏  Hit").setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId("bj_disabled_2").setLabel("🛑  Stand").setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId("bj_disabled_3").setLabel("💰  Double Down").setStyle(ButtonStyle.Success).setDisabled(true),
    );
    return interaction.update({ embeds: [embed], components: [disabledRow] });
  };

  if (action === "bj_hit") {
    playerHand.push(deck.pop());
    const pVal = handVal(playerHand);
    if (pVal > 21) return end("lose");
    if (pVal === 21) {
      while (handVal(dealerHand) < 17) dealerHand.push(deck.pop());
      const dVal = handVal(dealerHand);
      return end(dVal > 21 ? "dlose" : pVal > dVal ? "win" : pVal === dVal ? "push" : "lose");
    }
    const eco = getEcoUser(userId);
    const canDouble = eco.wallet >= bet;
    return interaction.update({
      embeds: [bjEmbed(interaction.user, playerHand, dealerHand, bet)],
      components: [gameButtons(userId, canDouble)],
    });
  }

  if (action === "bj_stand") {
    while (handVal(dealerHand) < 17) dealerHand.push(deck.pop());
    const pVal = handVal(playerHand);
    const dVal = handVal(dealerHand);
    return end(dVal > 21 ? "dlose" : pVal > dVal ? "win" : pVal === dVal ? "push" : "lose");
  }

  if (action === "bj_double") {
    const eco = getEcoUser(userId);
    if (eco.wallet < bet) {
      return interaction.reply({ content: `❌ Need **${fmt(bet)} TC** to double down. You have **${fmt(eco.wallet)} TC**.`, ephemeral: true });
    }
    removeWallet(userId, bet);
    game.bet = bet * 2;
    playerHand.push(deck.pop());
    const pVal = handVal(playerHand);
    if (pVal > 21) return end("lose");
    while (handVal(dealerHand) < 17) dealerHand.push(deck.pop());
    const dVal = handVal(dealerHand);
    return end(dVal > 21 ? "dlose" : pVal > dVal ? "win" : pVal === dVal ? "push" : "lose");
  }
}

// ── Slots again button ────────────────────────────────────────────────────────
async function handleSlotsAgain(interaction) {
  const [, userId, betStr] = interaction.customId.split(":");
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Start your own game with `,slots <bet>`!", ephemeral: true });
  }
  const bet = parseInt(betStr);
  const { doSpin } = require("../commands/prefix/slots");
  await interaction.deferUpdate();
  await doSpin(userId, interaction.guild.id, bet, (opts) => interaction.editReply(opts));
}

// ── Role shop buy button ───────────────────────────────────────────────────────
async function handleRoleShopBuy(interaction) {
  const [, userId, roleId] = interaction.customId.split(":");
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Open your own `,roleshop` to buy roles!", ephemeral: true });
  }

  const { getRole, getOwnedRoles, addOwnedRole, getOrCreateDiscordRole } = require("../services/roleShop");
  const { getUser: getLvUser } = require("../services/leveling");
  const { LEVEL_REQ } = require("../services/roleShop");
  const { buildShopEmbed, buildButtons } = require("../commands/prefix/roleshop");

  const guildId = interaction.guild.id;
  const lv      = getLvUser(guildId, userId);
  if (lv.level < LEVEL_REQ) {
    return interaction.reply({ content: `❌ Requires Level **${LEVEL_REQ}**. You're Level **${lv.level}**.`, ephemeral: true });
  }

  const roleDef = getRole(roleId);
  if (!roleDef) return interaction.reply({ content: "❌ Role not found.", ephemeral: true });

  const owned = getOwnedRoles(userId);
  if (owned.includes(roleId)) return interaction.reply({ content: `✅ You already own **${roleDef.name}**!`, ephemeral: true });

  const eco = getEcoUser(userId);
  if (eco.wallet < roleDef.price) {
    return interaction.reply({
      content: `❌ **${roleDef.emoji} ${roleDef.name}** costs **${fmt(roleDef.price)} TC**. You have **${fmt(eco.wallet)} TC**. Short by **${fmt(roleDef.price - eco.wallet)} TC**.`,
      ephemeral: true,
    });
  }

  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({ content: "❌ I need **Manage Roles** permission.", ephemeral: true });
  }

  removeWallet(userId, roleDef.price);

  try {
    const discordRole = await getOrCreateDiscordRole(interaction.guild, roleId);
    if (!discordRole) { addWallet(userId, roleDef.price); return interaction.reply({ content: "❌ Couldn't create role. TC refunded.", ephemeral: true }); }

    const member = await interaction.guild.members.fetch(userId);
    await member.roles.add(discordRole, "Role Shop purchase");
    addOwnedRole(userId, roleId);

    const hex = `#${roleDef.color.toString(16).padStart(6, "0").toUpperCase()}`;

    // Update the shop embed with new ownership state
    const newEmbed = buildShopEmbed(userId, guildId, interaction.user);
    const newRows  = buildButtons(userId, guildId);
    await interaction.update({ embeds: [newEmbed], components: newRows });

    return interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${roleDef.emoji}  ${roleDef.name.replace(/^[^\s]+\s/, "")} — Unlocked!`)
          .setDescription(`You now have the **${roleDef.name}** role!\n> 🎨 Color: \`${hex}\`\n> ✅ Hoisted in the member list\n> 💳 Remaining wallet: **${fmt(eco.wallet - roleDef.price)} TC**`)
          .setColor(roleDef.color)
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  } catch (e) {
    addWallet(userId, roleDef.price);
    if (e.code === 50013) return interaction.reply({ content: "❌ Move my role above the shop roles in the role list.", ephemeral: true });
    throw e;
  }
}

// ── Stat upgrade button ───────────────────────────────────────────────────────
async function handleStatUp(interaction) {
  const [, guildId, userId, stat] = interaction.customId.split(":");
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Open your own `,stats` to upgrade!", ephemeral: true });
  }

  const { getUser, upgradeStats } = require("../services/leveling");
  const { buildStatsEmbed, buildUpgradeButtons } = require("../commands/prefix/stats");

  const isOwner = userId === "1276884559467643042";
  const result  = upgradeStats(guildId, userId, { [stat]: 1 }, isOwner);

  if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });

  const { STAT_INFO } = (() => {
    const s = { str: { emoji: "💪", name: "Strength" }, int: { emoji: "🧠", name: "Intelligence" }, cha: { emoji: "🎭", name: "Charisma" }, lck: { emoji: "🍀", name: "Luck" } };
    return { STAT_INFO: s };
  })();

  const u = getUser(guildId, userId);
  const newEmbed = buildStatsEmbed(interaction.user, u);
  const btnRow   = buildUpgradeButtons(guildId, userId, u);

  await interaction.update({
    embeds: [newEmbed],
    components: btnRow ? [btnRow] : [],
  });

  return interaction.followUp({
    content: `✨ **${STAT_INFO[stat].emoji} ${STAT_INFO[stat].name}** upgraded to **${result.u.stats[stat]}**! (${result.u.statPoints} points left)`,
    ephemeral: true,
  });
}

// ── Help category select ──────────────────────────────────────────────────────
async function handleHelpCat(interaction) {
  const [, userId] = interaction.customId.split(":");
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Run `,thelp` yourself to use the menu!", ephemeral: true });
  }

  const { categoryEmbed, buildMenu } = require("../commands/prefix/thelp");
  const selected = interaction.values[0];
  return interaction.update({
    embeds: [categoryEmbed(selected, interaction.user)],
    components: [buildMenu(userId, selected)],
  });
}

// ── Shop quick-buy select menu ────────────────────────────────────────────────
async function handleShopSelect(interaction) {
  const [, userId] = interaction.customId.split(":");
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Open your own `,shop` to buy!", ephemeral: true });
  }

  const { getItem } = require("../services/shopItems");
  const itemId  = interaction.values[0];
  const item    = getItem(itemId);
  const eco     = getEcoUser(userId);
  const canBuy  = eco.wallet >= item.price;

  const confirmEmbed = new EmbedBuilder()
    .setTitle(`${item.emoji}  ${item.name}`)
    .setDescription(
      `${item.desc}\n${item.detail}\n\n` +
      `> 💰  Price:  **${fmt(item.price)} TC**\n` +
      `> 💳  Your wallet:  **${fmt(eco.wallet)} TC**\n` +
      (canBuy ? `> ✅  You can afford this!` : `> ❌  Need **${fmt(item.price - eco.wallet)} TC** more`)
    )
    .setColor(canBuy ? 0x57F287 : 0xED4245)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_confirm:${userId}:${itemId}`)
      .setLabel(`Buy for ${fmt(item.price)} TC`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canBuy),
    new ButtonBuilder()
      .setCustomId(`shop_cancel:${userId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  return interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
}

// ── Shop confirm buy button ───────────────────────────────────────────────────
async function handleShopConfirm(interaction) {
  const parts  = interaction.customId.split(":");
  const action = parts[0];
  const userId = parts[1];

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ This isn't your purchase!", ephemeral: true });
  }

  if (action === "shop_cancel") {
    return interaction.update({ content: "Purchase cancelled.", embeds: [], components: [] });
  }

  // shop_confirm
  const itemId = parts[2];
  const { getItem } = require("../services/shopItems");
  const { applyBuff } = require("../services/buffs");
  const { addUnassigned, addUnassignedWorker, addUnassignedCollector, hasCategory, createCategory, addChannel, getServerData } = require("../services/machines");
  const { getUser: getLvUser, setUser: setLvUser } = require("../services/leveling");
  const item    = getItem(itemId);
  const eco     = getEcoUser(userId);
  const guildId = interaction.guild.id;

  if (eco.wallet < item.price) {
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle("⛔  Insufficient Funds").setDescription(`You need **${fmt(item.price)} TC** but only have **${fmt(eco.wallet)} TC**.`).setColor(0xED4245).setTimestamp()],
      components: [],
    });
  }

  if (itemId === "luck_potion") {
    removeWallet(userId, item.price);
    applyBuff(guildId, userId, "luck_potion", 3_600_000);
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("🧪  Luck Potion Active!").setDescription(`Casino wins now pay **1.5×** for 1 hour!\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0x2ECC71).setTimestamp()], components: [] });
  }

  if (itemId === "xp_scroll") {
    removeWallet(userId, item.price);
    applyBuff(guildId, userId, "xp_boost", 1_800_000);
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("📜  XP Scroll Active!").setDescription(`**2× XP** from messages for 30 minutes!\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0x3498DB).setTimestamp()], components: [] });
  }

  if (itemId === "stat_capsule") {
    removeWallet(userId, item.price);
    const lv = getLvUser(guildId, userId);
    lv.statPoints += 2;
    setLvUser(guildId, userId, lv);
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("💊  Stat Capsule Used!").setDescription(`+2 stat points added!\n> ✨ Total points: **${lv.statPoints}**\n> Use \`,stats\` to spend them\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0x9B59B6).setTimestamp()], components: [] });
  }

  if (itemId === "machine") {
    removeWallet(userId, item.price);
    addUnassigned(userId);
    const { getUnassigned } = require("../services/machines");
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("🏭  Machine Added!").setDescription(`Added to inventory! Use \`,addmachine <ch#>\` to place it.\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0x57F287).setTimestamp()], components: [] });
  }

  if (itemId === "worker") {
    removeWallet(userId, item.price);
    addUnassignedWorker(userId);
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("👷  Worker Added!").setDescription(`Added to inventory! Use \`,addworker <ch#>\` to assign.\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0xE67E22).setTimestamp()], components: [] });
  }

  if (itemId === "auto_collector") {
    removeWallet(userId, item.price);
    addUnassignedCollector(userId);
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("🤖  Auto Collector Added!").setDescription(`Added to inventory! Use \`,addcollector <ch#>\` to install.\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0x3498DB).setTimestamp()], components: [] });
  }

  if (itemId === "mine_category") {
    const { isAutoChannelsEnabled } = require("../commands/prefix/channeltoggle");
    if (!isAutoChannelsEnabled(guildId)) {
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("❌  Channels Disabled").setDescription("Auto-channel creation is off on this server.\nAn admin can re-enable it with `,channelon`.").setColor(0xED4245).setTimestamp()], components: [] });
    }
    if (hasCategory(userId, guildId)) {
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("⚠️  Already Owned").setDescription("You already have a Mine Category on this server.").setColor(0xFEE75C).setTimestamp()], components: [] });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("⛔  Missing Permission").setDescription("I need **Manage Channels** permission.").setColor(0xED4245).setTimestamp()], components: [] });
    }
    removeWallet(userId, item.price);
    const category = await interaction.guild.channels.create({
      name: `⛏┊${interaction.user.username}'s Mine`,
      type: 4,
      permissionOverwrites: [
        { id: guildId, deny: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: userId, allow: ["ViewChannel", "ReadMessageHistory"] },
        { id: interaction.guild.members.me.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"] },
      ],
    });
    createCategory(userId, guildId, category.id);
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("⛏️  Mine Category Created!").setDescription(`**${category.name}** created!\n> Next: buy a channel with \`,shop buy mine_channel\`\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0xF1C40F).setTimestamp()], components: [] });
  }

  if (itemId === "mine_channel") {
    const { isAutoChannelsEnabled } = require("../commands/prefix/channeltoggle");
    if (!isAutoChannelsEnabled(guildId)) {
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("❌  Channels Disabled").setDescription("Auto-channel creation is off on this server.\nAn admin can re-enable it with `,channelon`.").setColor(0xED4245).setTimestamp()], components: [] });
    }
    if (!hasCategory(userId, guildId)) {
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("⚠️  No Category").setDescription("Buy a **Mine Category** first with `,shop buy mine_category`.").setColor(0xFEE75C).setTimestamp()], components: [] });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("⛔  Missing Permission").setDescription("I need **Manage Channels** permission.").setColor(0xED4245).setTimestamp()], components: [] });
    }
    const serverData = getServerData(userId, guildId);
    const nextNum    = serverData.channels.length + 1;
    removeWallet(userId, item.price);
    const channel = await interaction.guild.channels.create({
      name: `⛏┊channel-${nextNum}`,
      type: 0,
      parent: serverData.categoryId,
      permissionOverwrites: [
        { id: guildId, deny: ["ViewChannel"] },
        { id: userId, allow: ["ViewChannel", "ReadMessageHistory"] },
        { id: interaction.guild.members.me.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"] },
      ],
    });
    addChannel(userId, guildId, channel.id);
    return interaction.update({ embeds: [new EmbedBuilder().setTitle(`📺  Channel #${nextNum} Created!`).setDescription(`<#${channel.id}> is ready!\n> Use \`,addmachine ${nextNum}\` to place a machine\n> 💳 Remaining: **${fmt(eco.wallet - item.price)} TC**`).setColor(0x57F287).setTimestamp()], components: [] });
  }

  return interaction.update({ content: "❌ Unknown item.", embeds: [], components: [] });
}

// ── Server restart confirmation ───────────────────────────────────────────────
async function handleTrestart(interaction) {
  const parts  = interaction.customId.split(":");
  const action = parts[0];
  const userId = parts[1];

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the server owner can confirm this!", ephemeral: true });
  }

  if (action === "trestart_no") {
    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅  Restart Cancelled")
          .setDescription("Nothing was deleted. Your server is safe.")
          .setColor(0x57F287)
          .setTimestamp(),
      ],
      components: [],
    });
  }

  // trestart_yes — delete everything
  const guild = interaction.guild;

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("🗑️  Restarting Server...")
        .setDescription("Deleting all channels, roles, and voice channels.\nThis may take a moment...")
        .setColor(0xED4245)
        .setTimestamp(),
    ],
    components: [],
  });

  // Fetch all members first
  await guild.members.fetch().catch(() => {});

  const botId = interaction.client.user.id;

  // Kick all bots (except ourselves)
  const botsToKick = guild.members.cache.filter(m => m.user.bot && m.id !== botId);
  for (const [, member] of botsToKick) {
    await member.kick("Server restart: trestart").catch(() => {});
  }

  // Delete all channels
  for (const [, ch] of guild.channels.cache) {
    await ch.delete("Server restart: trestart").catch(() => {});
  }

  // Delete all non-managed, non-everyone roles
  for (const [, role] of guild.roles.cache) {
    if (role.name === "@everyone" || role.managed || role.id === guild.id) continue;
    await role.delete("Server restart: trestart").catch(() => {});
  }

  // DM the owner since channels are gone
  try {
    await interaction.user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅  Server Restart Complete")
          .setDescription(
            `**${guild.name}** has been fully wiped.\n\n` +
            `> 🤖  All bots kicked (**${botsToKick.size}**)\n` +
            `> 🗑️  All channels deleted\n` +
            `> 🏷️  All roles deleted\n\n` +
            `The server is completely empty. Rebuild from scratch or use \`,template load <name>\`.`
          )
          .setColor(0x57F287)
          .setTimestamp(),
      ],
    });
  } catch {}
}

// ── Welcome builder — button handler ─────────────────────────────────────────
// customId format: wlc_<field>:<userId>:<templateName>
async function handleWelcomeBuilder(interaction) {
  const [actionFull, userId, ...nameParts] = interaction.customId.split(":");
  const templateName = nameParts.join(":");
  const field = actionFull.replace("wlc_", "");

  // Only the owner of the template can use its builder buttons
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the person who created this template can edit it.", ephemeral: true });
  }

  // Test Send — sends a real non-ephemeral welcome to the channel
  if (field === "test") {
    const tpl = getTemplate(userId, templateName);
    if (!tpl) return interaction.reply({ content: "❌ Template not found.", ephemeral: true });
    // Resolve Tenor/Giphy page URLs → direct media URLs so setImage works
    const member = interaction.member;
    const [resolvedImage, resolvedThumb] = await Promise.all([
      resolveGifUrl(tpl.image     ? resolveVars(tpl.image,     member) : null),
      resolveGifUrl(tpl.thumbnail ? resolveVars(tpl.thumbnail, member) : null),
    ]);
    const tplResolved = { ...tpl, image: resolvedImage, thumbnail: resolvedThumb };
    const { embed, content } = buildPreviewEmbed(tplResolved, member);
    try {
      const sendContent = content
        ? `${content}\n-# 🧪 Test — using your profile as preview`
        : `-# 🧪 Test — using your profile as preview`;
      await interaction.channel.send({ content: sendContent, embeds: [embed] });
      return interaction.reply({ content: "✅ **Test sent!** Check the message above.", ephemeral: true });
    } catch {
      return interaction.reply({ content: "❌ Couldn't send — I may not have permission to send messages here.", ephemeral: true });
    }
  }

  // All other fields open a modal
  const fieldConfig = {
    content: { label: "Message (text above embed)",          style: TextInputStyle.Short,     placeholder: "🎉 Welcome, {user}!",                         maxLength: 2000 },
    title:   { label: "Embed title",                         style: TextInputStyle.Short,     placeholder: "Welcome to {server_name}!",                    maxLength: 256  },
    desc:    { label: "Embed description",                   style: TextInputStyle.Paragraph, placeholder: "Hey {user_display}, welcome!\n\n✦ Check #rules", maxLength: 4000 },
    author:  { label: "Author: Name (line 1) + Icon URL (line 2)", style: TextInputStyle.Paragraph, placeholder: "{user_name}\n{user_avatar}",             maxLength: 512  },
    footer:  { label: "Footer text",                         style: TextInputStyle.Short,     placeholder: "You are member #{server_membercount}",          maxLength: 2048 },
    color:   { label: "Hex color  e.g. #FF69B4",             style: TextInputStyle.Short,     placeholder: "#5865F2",                                       maxLength: 7    },
    thumb:   { label: "Thumbnail URL or variable",           style: TextInputStyle.Short,     placeholder: "{user_avatar}",                                 maxLength: 1024 },
    image:   { label: "Banner / GIF URL  (.png .jpg .gif)",  style: TextInputStyle.Short,     placeholder: "https://example.com/banner.gif",                maxLength: 1024 },
    fields:  { label: "Custom fields  Name | Value | inline? (1 per line)", style: TextInputStyle.Paragraph, placeholder: "🌟 Roles | Check #roles | yes\n📣 Rules | Read #rules | yes\n🎉 Events | Join weekly events! | no", maxLength: 900 },
  };

  const cfg = fieldConfig[field];
  if (!cfg) return interaction.reply({ content: "❌ Unknown field.", ephemeral: true });

  const tpl = getTemplate(userId, templateName);
  let currentValue = "";
  if (field === "content") currentValue = tpl?.content      ?? "";
  if (field === "title")   currentValue = tpl?.title        ?? "";
  if (field === "desc")    currentValue = tpl?.description  ?? "";
  if (field === "author")  currentValue = tpl?.author ? `${tpl.author.name ?? ""}\n${tpl.author.iconUrl ?? ""}` : "";
  if (field === "footer")  currentValue = tpl?.footer       ?? "";
  if (field === "color")   currentValue = tpl?.color        ?? "";
  if (field === "thumb")   currentValue = tpl?.thumbnail    ?? "";
  if (field === "image")   currentValue = tpl?.image        ?? "";
  if (field === "fields")  currentValue = tpl?.fields
    ? tpl.fields.map((f) => `${f.name} | ${f.value} | ${f.inline ? "yes" : "no"}`).join("\n")
    : "";

  const modal = new ModalBuilder()
    .setCustomId(`wlcm_${field}:${userId}:${templateName}`)
    .setTitle(`Edit ${cfg.label.split("(")[0].trim()}`);

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(cfg.label)
    .setStyle(cfg.style)
    .setMaxLength(cfg.maxLength)
    .setRequired(false)
    .setPlaceholder(cfg.placeholder);

  if (currentValue) input.setValue(currentValue.slice(0, cfg.maxLength));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

// ── Server List builder — guild picker (select menu) ──────────────────────────
// customId format: srvpick:<userId>   (value = chosen guildId)
async function handleServerPick(interaction) {
  const [, userId] = interaction.customId.split(":");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the person who ran the command can pick a server.", ephemeral: true });
  }
  if (!canAdd(userId)) {
    return interaction.reply({ content: "❌ You no longer have permission to add servers.", ephemeral: true });
  }

  const guildId = interaction.values[0];
  const guild = interaction.client.guilds.cache.get(guildId);
  if (!guild) {
    return interaction.reply({ content: "❌ I'm no longer in that server.", ephemeral: true });
  }

  updateDraft(userId, { guildId, name: guild.name, activeTab: "content" });
  const draft = getDraft(userId);

  await interaction.update({
    content: "**Build your server listing** — fill in each part, then hit ✅ Submit.",
    embeds: [srvDraftEmbed(draft, guild)],
    components: srvBuilderRows(userId, draft),
  });
}

// ── Server List builder — tab + button rows ───────────────────────────────────
// customId format: srv_<field>:<userId>   |   srvtab_<tab>:<userId>
function srvBuilderRows(userId, draft) {
  const tab = draft.activeTab || "content";

  const tabRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`srvtab_content:${userId}`)
      .setLabel("📝 Content")
      .setStyle(tab === "content" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`srvtab_layout:${userId}`)
      .setLabel("🎛️ Layout")
      .setStyle(tab === "layout" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`srv_submit:${userId}`).setLabel("Submit").setStyle(ButtonStyle.Success).setEmoji("✅"),
  );

  if (tab === "layout") {
    const lay = draft.layout || DEFAULT_LAYOUT;
    const on = ButtonStyle.Success;   // green = active/shown
    const off = ButtonStyle.Secondary; // grey = inactive/hidden

    const tagsStyleLabel = { pills: "🏷️ Tags: Pills", description: "🏷️ Tags: In Desc", hidden: "🏷️ Tags: Hidden" }[lay.tagsStyle];

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`srvlay_banner:${userId}`)
        .setLabel(lay.banner === "none" ? "🌄 Banner: Off" : "🌄 Banner: On")
        .setStyle(lay.banner === "none" ? off : on),
      new ButtonBuilder()
        .setCustomId(`srvlay_stats:${userId}`)
        .setLabel(lay.stats === "hide" ? "📊 Stats: Off" : "📊 Stats: On")
        .setStyle(lay.stats === "hide" ? off : on),
      new ButtonBuilder()
        .setCustomId(`srvlay_tagsStyle:${userId}`)
        .setLabel(tagsStyleLabel)
        .setStyle(lay.tagsStyle === "hidden" ? off : ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`srvlay_density:${userId}`)
        .setLabel(lay.density === "compact" ? "📐 Compact" : "📐 Expanded")
        .setStyle(lay.density === "compact" ? off : on),
      new ButtonBuilder()
        .setCustomId(`srvlay_fieldOrder:${userId}`)
        .setLabel(lay.fieldOrder === "desc_first" ? "🔀 Desc First" : "🔀 Stats First")
        .setStyle(ButtonStyle.Primary),
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`srvlay_titleEmoji:${userId}`)
        .setLabel(lay.titleEmoji ? `✨ Emoji: ${lay.titleEmoji}` : "✨ Set Title Emoji")
        .setStyle(lay.titleEmoji ? on : off),
      new ButtonBuilder()
        .setCustomId(`srvlay_footerText:${userId}`)
        .setLabel(lay.footerText ? "🖋️ Footer: Set" : "🖋️ Set Footer Text")
        .setStyle(lay.footerText ? on : off),
    );

    return [tabRow, row2, row3];
  }

  // Content tab — main fields
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`srv_link:${userId}`).setLabel("Link").setStyle(ButtonStyle.Secondary).setEmoji("🔗"),
    new ButtonBuilder().setCustomId(`srv_desc:${userId}`).setLabel("Description").setStyle(ButtonStyle.Secondary).setEmoji("📄"),
    new ButtonBuilder().setCustomId(`srv_banner:${userId}`).setLabel("Banner").setStyle(ButtonStyle.Secondary).setEmoji("🌄"),
    new ButtonBuilder().setCustomId(`srv_icon:${userId}`).setLabel("Icon").setStyle(ButtonStyle.Secondary).setEmoji("🖼️"),
    new ButtonBuilder().setCustomId(`srv_color:${userId}`).setLabel("Color").setStyle(ButtonStyle.Secondary).setEmoji("🎨"),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`srv_tags:${userId}`).setLabel("Tags").setStyle(ButtonStyle.Secondary).setEmoji("🏷️"),
  );

  return [tabRow, row1, row2];
}

function srvDraftEmbed(draft, guild) {
  const resolvedColor = parseHexColor(draft.color);
  const card = describeCard({
    content: { name: draft.name, description: draft.description, tags: draft.tags ? draft.tags.split(",").map((t) => t.trim()).filter(Boolean) : [] },
    layout: draft.layout,
    guildInfo: guild,
    isTop3: false,
  });

  const embed = new EmbedBuilder()
    .setTitle(card.title)
    .setDescription(card.description)
    .setColor(resolvedColor ?? colors.primary);

  const thumbnail = draft.icon || guild?.iconURL?.({ size: 256 });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (card.showBanner && draft.banner) embed.setImage(draft.banner);

  const linkField = { name: "Link", value: draft.link || "_Not set — click Link to add one._", inline: false };
  const statsField = { name: "Members", value: guild ? `${guild.memberCount}` : "—", inline: true };

  if (card.statsFirst) {
    embed.addFields(linkField);
    if (card.showStats) embed.addFields(statsField);
  } else {
    if (card.showStats) embed.addFields(statsField);
    embed.addFields(linkField);
  }

  if (card.showTagsPills) {
    embed.addFields({ name: "Tags", value: card.tagList.map((t) => `\`${t}\``).join(" "), inline: false });
  }

  embed.setFooter({ text: card.footerText ? `${card.footerText} • live preview` : "Live preview — click the buttons below" });
  return embed;
}

async function handleServerTabSwitch(interaction) {
  const [action, userId] = interaction.customId.split(":");
  const tab = action.replace("srvtab_", "");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the person building this listing can switch tabs.", ephemeral: true });
  }

  const draft = updateDraft(userId, { activeTab: tab });
  const guild = draft.guildId ? interaction.client.guilds.cache.get(draft.guildId) : null;

  await interaction.update({
    embeds: [srvDraftEmbed(draft, guild)],
    components: srvBuilderRows(userId, draft),
  });
}

// ── Server List builder — Layout toggle buttons ───────────────────────────────
// customId format: srvlay_<setting>:<userId>
async function handleServerLayoutPick(interaction) {
  const [action, userId] = interaction.customId.split(":");
  const setting = action.replace("srvlay_", "");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the person building this listing can edit layout.", ephemeral: true });
  }

  const draft = getDraft(userId);
  const guild = draft.guildId ? interaction.client.guilds.cache.get(draft.guildId) : null;

  // Simple toggles — flip immediately, no modal needed
  if (setting === "banner") {
    updateDraftLayout(userId, { banner: draft.layout.banner === "none" ? "full" : "none" });
  } else if (setting === "stats") {
    updateDraftLayout(userId, { stats: draft.layout.stats === "hide" ? "show" : "hide" });
  } else if (setting === "tagsStyle") {
    const order = ["pills", "description", "hidden"];
    const next = order[(order.indexOf(draft.layout.tagsStyle) + 1) % order.length];
    updateDraftLayout(userId, { tagsStyle: next });
  } else if (setting === "density") {
    updateDraftLayout(userId, { density: draft.layout.density === "compact" ? "expanded" : "compact" });
  } else if (setting === "fieldOrder") {
    updateDraftLayout(userId, { fieldOrder: draft.layout.fieldOrder === "desc_first" ? "stats_first" : "desc_first" });
  } else if (setting === "titleEmoji" || setting === "footerText") {
    // These need text input — open a modal instead of toggling
    const isEmoji = setting === "titleEmoji";
    const modal = new ModalBuilder()
      .setCustomId(`srvlaym_${setting}:${userId}`)
      .setTitle(isEmoji ? "Title Emoji Prefix" : "Custom Footer Text");

    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel(isEmoji ? "Emoji (leave blank to remove)" : "Footer text (leave blank to remove)")
      .setStyle(TextInputStyle.Short)
      .setMaxLength(isEmoji ? 10 : 100)
      .setRequired(false)
      .setPlaceholder(isEmoji ? "🔥" : "A chill place to hang out")
      .setValue((isEmoji ? draft.layout.titleEmoji : draft.layout.footerText) || "");

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  const updatedDraft = getDraft(userId);
  await interaction.update({
    embeds: [srvDraftEmbed(updatedDraft, guild)],
    components: srvBuilderRows(userId, updatedDraft),
  });
}

// ── Server List builder — Layout text modals (emoji / footer) ─────────────────
// customId format: srvlaym_<setting>:<userId>
async function handleServerLayoutModal(interaction) {
  const [action, userId] = interaction.customId.split(":");
  const setting = action.replace("srvlaym_", "");

  if (interaction.user.id !== userId) {
    return interaction.reply({ embeds: [dangerEmbed("Not Your Draft", "You can't edit someone else's draft.")], ephemeral: true });
  }

  const value = interaction.fields.getTextInputValue("value").trim();
  updateDraftLayout(userId, { [setting]: value });

  const draft = getDraft(userId);
  const guild = draft.guildId ? interaction.client.guilds.cache.get(draft.guildId) : null;

  try {
    await interaction.update({
      embeds: [srvDraftEmbed(draft, guild)],
      components: srvBuilderRows(userId, draft),
    });
  } catch {
    await interaction.reply({ content: "✅ Saved.", ephemeral: true });
  }
}

async function handleServerBuilder(interaction) {
  const [action, userId] = interaction.customId.split(":");
  const field = action.replace("srv_", "");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the person building this listing can use these buttons.", ephemeral: true });
  }
  if (!canAdd(userId)) {
    return interaction.reply({ content: "❌ You no longer have permission to add servers.", ephemeral: true });
  }

  const draft = getDraft(userId);
  const guild = draft.guildId ? interaction.client.guilds.cache.get(draft.guildId) : null;

  // Submit — validates and saves the draft
  if (field === "submit") {
    if (!draft.guildId || !draft.link) {
      return interaction.reply({ content: "❌ You need a server selected and a **Link** before submitting.", ephemeral: true });
    }

    const result = addServer({
      guildId: draft.guildId,
      link: draft.link,
      description: draft.description || "No description",
      banner: draft.banner || null,
      icon: draft.icon || null,
      color: draft.color || null,
      tags: draft.tags ? draft.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      layout: draft.layout,
      addedBy: userId,
    });

    if (!result.ok && result.reason === "duplicate") {
      return interaction.reply({ content: "❌ That server is already listed.", ephemeral: true });
    }

    clearDraft(userId);
    return interaction.reply({ embeds: [successEmbed("Server Added!", `**${guild?.name ?? "Server"}** has been added to the server list.`)] });
  }

  // All other fields open a modal
  const fieldConfig = {
    link:   { label: "Invite Link",                  style: TextInputStyle.Short,     placeholder: "https://discord.gg/abc123",       maxLength: 200,  required: false },
    desc:   { label: "Short Description",            style: TextInputStyle.Paragraph, placeholder: "A chill community for gamers",     maxLength: 300,  required: false },
    banner: { label: "Banner URL (.png .jpg .gif)",  style: TextInputStyle.Short,     placeholder: "https://example.com/banner.png",   maxLength: 1024, required: false },
    icon:   { label: "Icon URL (overrides server icon)", style: TextInputStyle.Short,  placeholder: "https://example.com/icon.png",     maxLength: 1024, required: false },
    color:  { label: "Embed Color (hex)",            style: TextInputStyle.Short,     placeholder: "#5865F2",                          maxLength: 7,    required: false },
    tags:   { label: "Tags (comma separated, max 5)", style: TextInputStyle.Short,     placeholder: "Gaming, Anime, 18+",               maxLength: 100,  required: false },
  };

  const cfg = fieldConfig[field];
  if (!cfg) return interaction.reply({ content: "❌ Unknown field.", ephemeral: true });

  let currentValue = "";
  if (field === "link")   currentValue = draft.link ?? "";
  if (field === "desc")   currentValue = draft.description ?? "";
  if (field === "banner") currentValue = draft.banner ?? "";
  if (field === "icon")   currentValue = draft.icon ?? "";
  if (field === "color")  currentValue = draft.color ?? "";
  if (field === "tags")   currentValue = draft.tags ?? "";

  const modal = new ModalBuilder()
    .setCustomId(`srvm_${field}:${userId}`)
    .setTitle(`Edit ${cfg.label}`);

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(cfg.label)
    .setStyle(cfg.style)
    .setMaxLength(cfg.maxLength)
    .setRequired(cfg.required)
    .setPlaceholder(cfg.placeholder);

  if (currentValue) input.setValue(currentValue.slice(0, cfg.maxLength));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

// ── Server List builder — modal submit handler ────────────────────────────────
// customId format: srvm_<field>:<userId>
async function handleServerModal(interaction) {
  const [action, userId] = interaction.customId.split(":");
  const field = action.replace("srvm_", "");

  if (interaction.user.id !== userId) {
    return interaction.reply({ embeds: [dangerEmbed("Not Your Draft", "You can't edit someone else's draft.")], ephemeral: true });
  }

  const value = interaction.fields.getTextInputValue("value").trim();

  if (field === "link") {
    if (!value) {
      return interaction.reply({ embeds: [dangerEmbed("Missing Link", "You need to enter a Discord invite link (e.g. `https://discord.gg/abc123`).")], ephemeral: true });
    }

    const isDiscordInvite = /^https?:\/\/(www\.)?(discord\.gg|discord(app)?\.com\/invite)\/[a-zA-Z0-9-]+\/?$/i.test(value);
    if (!isDiscordInvite) {
      return interaction.reply({ embeds: [dangerEmbed("Invalid Link", "Link must be a real Discord invite (e.g. `https://discord.gg/abc123`). Other links aren't allowed, for everyone's safety.")], ephemeral: true });
    }

    const invite = await interaction.client.fetchInvite(value).catch(() => null);
    if (!invite || !invite.guild) {
      return interaction.reply({ embeds: [dangerEmbed("Invalid Invite", "That invite link is invalid or expired.")], ephemeral: true });
    }

    const draft = getDraft(userId);
    if (draft.guildId && invite.guild.id !== draft.guildId) {
      return interaction.reply({ embeds: [dangerEmbed("Server Mismatch", `That invite leads to **${invite.guild.name}**, not the server you selected. The invite must match the server you picked.`)], ephemeral: true });
    }
  }
  if (field === "banner" && value && !/^https?:\/\//i.test(value)) {
    return interaction.reply({ embeds: [dangerEmbed("Invalid Banner", "Banner must be a valid `https://` image URL.")], ephemeral: true });
  }
  if (field === "icon" && value && !/^https?:\/\//i.test(value)) {
    return interaction.reply({ embeds: [dangerEmbed("Invalid Icon", "Icon must be a valid `https://` image URL.")], ephemeral: true });
  }
  if (field === "color" && value && !/^#?[0-9a-fA-F]{6}$/.test(value)) {
    return interaction.reply({ embeds: [dangerEmbed("Invalid Color", "Color must be a 6-character hex code, e.g. `#5865F2`.")], ephemeral: true });
  }
  if (field === "tags" && value && value.split(",").length > 5) {
    return interaction.reply({ embeds: [dangerEmbed("Too Many Tags", "You can only set up to 5 tags, separated by commas.")], ephemeral: true });
  }

  const patch = {};
  if (field === "link")   patch.link = value;
  if (field === "desc")   patch.description = value;
  if (field === "banner") patch.banner = value ? await resolveGifUrl(value) : "";
  if (field === "icon")   patch.icon = value;
  if (field === "color")  patch.color = value;
  if (field === "tags")   patch.tags = value;

  const draft = updateDraft(userId, patch);
  const guild = draft.guildId ? interaction.client.guilds.cache.get(draft.guildId) : null;

  try {
    await interaction.update({
      embeds: [srvDraftEmbed(draft, guild)],
      components: srvBuilderRows(userId, draft),
    });
  } catch {
    await interaction.reply({ content: "✅ Saved.", ephemeral: true });
  }
}

// ── Server List — pagination (1 server per page, live guild info + Join/Vote buttons) ─
const SERVERS_PER_PAGE = 1;

function serversPageRow(userId, page, totalEntries, inviteUrl, guildId, voteCount, hasVoted) {
  const totalPages = Math.max(1, Math.ceil(totalEntries / SERVERS_PER_PAGE));
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`svp_prev:${userId}:${page}`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`svp_page:${userId}:${page}`)
      .setLabel(`Page ${page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`svp_next:${userId}:${page}`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );

  const actionRow = new ActionRowBuilder();
  if (guildId) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`svvote:${userId}:${page}:${guildId}`)
        .setLabel(hasVoted ? `✅ Voted (${voteCount})` : `👍 Upvote (${voteCount})`)
        .setStyle(hasVoted ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  }
  if (inviteUrl) {
    actionRow.addComponents(
      new ButtonBuilder().setLabel("Join Server").setStyle(ButtonStyle.Link).setEmoji("🔗").setURL(inviteUrl)
    );
  }

  return actionRow.components.length ? [navRow, actionRow] : [navRow];
}

async function buildServersPage(entries, page, client, viewerId) {
  const start = page * SERVERS_PER_PAGE;
  const slice = entries.slice(start, start + SERVERS_PER_PAGE);
  const entry = slice[0];

  if (!entry) {
    return { embeds: [], content: "📜  **Server List**", inviteUrl: null, guildId: null, voteCount: 0, hasVoted: false };
  }

  const guild = client.guilds.cache.get(entry.guildId);
  const resolvedColor = parseHexColor(entry.color);
  const topGuildIds = getTopGuildIds(3);
  const topRank = topGuildIds.indexOf(entry.guildId);
  const isTop3 = topRank >= 0 ? topRank + 1 : false;

  const card = describeCard({
    content: { name: guild?.name, description: entry.description, tags: entry.tags },
    layout: entry.layout,
    guildInfo: guild,
    isTop3,
  });

  const embed = new EmbedBuilder()
    .setTitle(card.title)
    .setDescription(card.description)
    .setColor(resolvedColor ?? colors.primary);

  const thumbnail = entry.icon || guild?.iconURL?.({ size: 256 });
  if (thumbnail) embed.setThumbnail(thumbnail);

  if (card.showBanner && entry.banner) {
    const resolvedBanner = await resolveGifUrl(entry.banner);
    if (resolvedBanner) embed.setImage(resolvedBanner);
  }

  const statsFields = [];
  if (guild) {
    const owner = await guild.fetchOwner().catch(() => null);
    statsFields.push(
      { name: "👥  Members", value: `${guild.memberCount}`, inline: true },
      { name: "👑  Owner", value: owner ? owner.user.tag : "_Unknown_", inline: true },
      { name: "📅  Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
    );
  }

  if (card.showStats && statsFields.length) embed.addFields(...statsFields);
  if (card.showTagsPills) embed.addFields({ name: "🏷️  Tags", value: card.tagList.map((t) => `\`${t}\``).join(" "), inline: false });

  embed.addFields({ name: "📅  Added", value: `<t:${Math.floor((entry.addedAt ?? Date.now()) / 1000)}:R>`, inline: true });
  if (card.footerText) embed.setFooter({ text: card.footerText });

  const voteCount = entry.votes?.length || 0;
  const hasVoted = viewerId ? (entry.votes || []).includes(viewerId) : false;

  return { embeds: [embed], content: "📜  **Server List**", inviteUrl: entry.link, guildId: entry.guildId, voteCount, hasVoted };
}

async function handleServersPagination(interaction) {
  const [action, userId, pageStr] = interaction.customId.split(":");
  let page = parseInt(pageStr, 10) || 0;

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the person who ran the command can flip pages.", ephemeral: true });
  }

  if (action === "svp_prev") page -= 1;
  if (action === "svp_next") page += 1;
  page = Math.max(0, page);

  const { listServers } = require("../services/serverLinks");
  const entries = listServers();
  const { embeds, content, inviteUrl, guildId, voteCount, hasVoted } = await buildServersPage(entries, page, interaction.client, userId);

  await interaction.update({
    content,
    embeds,
    components: serversPageRow(userId, page, entries.length, inviteUrl, guildId, voteCount, hasVoted),
  });
}

// ── Server List — voting ──────────────────────────────────────────────────────
// customId format: svvote:<userId>:<page>:<guildId>
async function handleServerVote(interaction) {
  const [, userId, pageStr, guildId] = interaction.customId.split(":");
  const page = parseInt(pageStr, 10) || 0;

  // Anyone can vote, but the page-flip ownership still belongs to whoever ran the command —
  // voting itself should be open to everyone viewing, not just the command runner.
  const { toggleVote, listServers } = require("../services/serverLinks");
  toggleVote(guildId, interaction.user.id);

  const entries = listServers();
  const { embeds, content, inviteUrl, voteCount, hasVoted } = await buildServersPage(entries, page, interaction.client, interaction.user.id);

  await interaction.update({
    content,
    embeds,
    components: serversPageRow(userId, page, entries.length, inviteUrl, guildId, voteCount, hasVoted),
  });
}

// ── Welcome builder — modal submit handler ────────────────────────────────────
// customId format: wlcm_<field>:<userId>:<templateName>
async function handleWelcomeModal(interaction) {
  const [actionFull, userId, ...nameParts] = interaction.customId.split(":");
  const templateName = nameParts.join(":");
  const field = actionFull.replace("wlcm_", "");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ You can't edit someone else's template.", ephemeral: true });
  }

  const tpl = getTemplate(userId, templateName);
  if (!tpl) return interaction.reply({ content: "❌ Template not found.", ephemeral: true });

  const value = interaction.fields.getTextInputValue("value").trim();

  const updates = { ...tpl };
  if (field === "content") updates.content     = value || null;
  if (field === "title")   updates.title       = value || null;
  if (field === "desc")    updates.description = value || null;
  if (field === "footer")  updates.footer      = value || null;
  if (field === "color")   updates.color       = value || null;
  if (field === "thumb")   updates.thumbnail   = value || null;
  if (field === "image")   updates.image       = value || null;
  if (field === "author") {
    const lines = value.split("\n").map((l) => l.trim());
    const name    = lines[0] || null;
    const iconUrl = lines[1] || null;
    updates.author = name ? { name, iconUrl } : null;
  }
  if (field === "fields") {
    const lines = value.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = lines.slice(0, 3).map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      return {
        name:   parts[0] || "Field",
        value:  parts[1] || "\u200b",
        inline: !(parts[2] ?? "yes").toLowerCase().startsWith("n"),
      };
    });
    updates.fields = parsed.length ? parsed : null;
  }

  const saved = saveTemplate(userId, templateName, updates);

  // Rebuild both embeds: control panel + live preview
  const { embed: livePreview } = buildLivePreviewEmbed(saved, interaction.member);

  const key = `${userId}:${templateName}`;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wlc_content:${key}`).setLabel("Message").setStyle(ButtonStyle.Secondary).setEmoji("📨"),
    new ButtonBuilder().setCustomId(`wlc_title:${key}`).setLabel("Title").setStyle(ButtonStyle.Secondary).setEmoji("📝"),
    new ButtonBuilder().setCustomId(`wlc_desc:${key}`).setLabel("Description").setStyle(ButtonStyle.Secondary).setEmoji("📄"),
    new ButtonBuilder().setCustomId(`wlc_author:${key}`).setLabel("Author").setStyle(ButtonStyle.Secondary).setEmoji("👤"),
    new ButtonBuilder().setCustomId(`wlc_footer:${key}`).setLabel("Footer").setStyle(ButtonStyle.Secondary).setEmoji("📋"),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wlc_color:${key}`).setLabel("Color").setStyle(ButtonStyle.Secondary).setEmoji("🎨"),
    new ButtonBuilder().setCustomId(`wlc_thumb:${key}`).setLabel("Thumbnail").setStyle(ButtonStyle.Secondary).setEmoji("🖼️"),
    new ButtonBuilder().setCustomId(`wlc_image:${key}`).setLabel("Banner / GIF").setStyle(ButtonStyle.Secondary).setEmoji("🌄"),
    new ButtonBuilder().setCustomId(`wlc_fields:${key}`).setLabel("Fields").setStyle(ButtonStyle.Secondary).setEmoji("🔧"),
    new ButtonBuilder().setCustomId(`wlc_test:${key}`).setLabel("Test Send").setStyle(ButtonStyle.Success).setEmoji("📤"),
  );

  return interaction.update({ embeds: [buildBuilderEmbed(saved), livePreview], components: [row1, row2] });
}

// ── Color picker — button handler ────────────────────────────────────────────
// customId format: cp_<action>:<userId>:<h>:<s>:<l>
async function handleColorPicker(interaction) {
  const { generatePickerImage, buildPickerMessage, hslToHex, clamp } = require("../util/colorPicker");

  const parts  = interaction.customId.split(":");
  const action = parts[0].replace("cp_", "");
  const userId = parts[1];
  let h = parseInt(parts[2]);
  let s = parseInt(parts[3]);
  let l = parseInt(parts[4]);

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Start your own with `,colorpicker`!", ephemeral: true });
  }

  // Done button — show final result
  if (action === "end") {
    const hex = hslToHex(h, s, l);
    const { EmbedBuilder } = require("discord.js");
    return interaction.update({
      content: null,
      embeds: [
        new EmbedBuilder()
          .setTitle("🎨  Color Selected")
          .setDescription(`\`\`\`${hex}\`\`\``)
          .addFields(
            { name: "HEX",  value: `\`${hex}\``,             inline: true },
            { name: "HSL",  value: `\`${h}°  ${s}%  ${l}%\``, inline: true },
          )
          .setColor(parseInt(hex.replace("#", ""), 16))
          .setFooter({ text: "Paste the HEX value into any Color field in the welcome builder" }),
      ],
      files: [],
      components: [],
    });
  }

  // Hex input modal
  if (action === "hex") {
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
    const modal = new ModalBuilder()
      .setCustomId(`cphex_${userId}:${h}:${s}:${l}`)
      .setTitle("Enter a Hex Color");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel("Hex code  (e.g. #FF5733 or FF5733)")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(7)
          .setRequired(true)
          .setPlaceholder("#FF5733"),
      ),
    );
    return interaction.showModal(modal);
  }

  // Image URL modal
  if (action === "img") {
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
    const modal = new ModalBuilder()
      .setCustomId(`cpimg_${userId}:${h}:${s}:${l}`)
      .setTitle("Sample Color from Image");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel("Image URL (.png, .jpg, .gif, etc.)")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(512)
          .setRequired(true)
          .setPlaceholder("https://example.com/image.png"),
      ),
    );
    return interaction.showModal(modal);
  }

  // Ignore disabled label buttons
  if (action === "hlbl" || action === "slbl" || action === "llbl") return;

  // Adjust values
  if (action === "hd30") h = (h - 30 + 360) % 360;
  if (action === "hd10") h = (h - 10 + 360) % 360;
  if (action === "hu10") h = (h + 10) % 360;
  if (action === "hu30") h = (h + 30) % 360;
  if (action === "sd20") s = clamp(s - 20, 0, 100);
  if (action === "sd10") s = clamp(s - 10, 0, 100);
  if (action === "su10") s = clamp(s + 10, 0, 100);
  if (action === "su20") s = clamp(s + 20, 0, 100);
  if (action === "ld20") l = clamp(l - 20, 0, 100);
  if (action === "ld10") l = clamp(l - 10, 0, 100);
  if (action === "lu10") l = clamp(l + 10, 0, 100);
  if (action === "lu20") l = clamp(l + 20, 0, 100);

  await interaction.deferUpdate();
  const buf = await generatePickerImage(h, s, l);
  return interaction.editReply(buildPickerMessage(userId, h, s, l, buf));
}

// ── Color picker — modal submit handler ──────────────────────────────────────
// customId format: cphex_<userId>:<h>:<s>:<l>  or  cpimg_<userId>:<h>:<s>:<l>
async function handleColorPickerModal(interaction) {
  const { generatePickerImage, buildPickerMessage, hexToHsl, sampleImageColor } = require("../util/colorPicker");

  const [actionFull, ...rest] = interaction.customId.split(":");
  const userId = actionFull.replace("cphex_", "").replace("cpimg_", "");
  const isHex  = actionFull.startsWith("cphex_");
  let h = parseInt(rest[0]);
  let s = parseInt(rest[1]);
  let l = parseInt(rest[2]);

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Not your color picker.", ephemeral: true });
  }

  const value = interaction.fields.getTextInputValue("value").trim();

  if (isHex) {
    const raw = value.startsWith("#") ? value : `#${value}`;
    if (!/^#[0-9a-fA-F]{6}$/i.test(raw)) {
      return interaction.reply({ content: "❌ Invalid hex — use format `#FF5733` or `FF5733`.", ephemeral: true });
    }
    [h, s, l] = hexToHsl(raw);
  } else {
    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      return interaction.reply({ content: "❌ Please provide a valid `https://` image URL.", ephemeral: true });
    }
    await interaction.deferUpdate();
    [h, s, l] = await sampleImageColor(value);
    const buf = await generatePickerImage(h, s, l);
    return interaction.editReply(buildPickerMessage(userId, h, s, l, buf));
  }

  await interaction.deferUpdate();
  const buf = await generatePickerImage(h, s, l);
  return interaction.editReply(buildPickerMessage(userId, h, s, l, buf));
}

// ── Main router ───────────────────────────────────────────────────────────────
async function handle(interaction) {
  try {
    if (interaction.isButton()) {
      const action = interaction.customId.split(":")[0];
      if (action === "upgrade_machine" || action === "collect_machine") return handleMachine(interaction);
      if (action.startsWith("bj_")) return handleBlackjack(interaction);
      if (action === "slots_again") return handleSlotsAgain(interaction);
      if (action === "rshop_buy") return handleRoleShopBuy(interaction);
      if (action === "stat_up") return handleStatUp(interaction);
      if (action === "shop_confirm" || action === "shop_cancel") return handleShopConfirm(interaction);
      if (action === "trestart_yes" || action === "trestart_no") return handleTrestart(interaction);
      if (action.startsWith("wlc_")) return handleWelcomeBuilder(interaction);
      if (action.startsWith("srv_")) return handleServerBuilder(interaction);
      if (action.startsWith("srvtab_")) return handleServerTabSwitch(interaction);
      if (action.startsWith("srvlay_")) return handleServerLayoutPick(interaction);
      if (action.startsWith("svp_")) return handleServersPagination(interaction);
      if (action.startsWith("svvote")) return handleServerVote(interaction);
      if (action.startsWith("tplshop_")) return handleTemplateShopButton(interaction);
      if (action.startsWith("gw_")) return handleGiveawayButton(interaction);
      if (action.startsWith("cp_"))  return handleColorPicker(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      const action = interaction.customId.split(":")[0];
      if (action === "help_cat") return handleHelpCat(interaction);
      if (action === "shop_select") return handleShopSelect(interaction);
      if (action === "srvpick") return handleServerPick(interaction);
    }
  } catch (err) {
    console.error("[interaction handler]", err);
    try {
      const reply = { content: "❌ Something went wrong. Try again!", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch {}
  }
}

async function handleModal(interaction) {
  try {
    const action = interaction.customId.split(":")[0];
    if (action.startsWith("wlcm_"))  return handleWelcomeModal(interaction);
    if (action.startsWith("srvm_"))  return handleServerModal(interaction);
    if (action.startsWith("srvlaym_")) return handleServerLayoutModal(interaction);
    if (action.startsWith("cphex_") || action.startsWith("cpimg_")) return handleColorPickerModal(interaction);
  } catch (err) {
    console.error("[modal handler]", err);
    try {
      const reply = { content: "❌ Something went wrong saving that field.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch {}
  }
}

// ── Template Shop — pagination + quick buy ────────────────────────────────────
// customId format: tplshop_<action>:<userId>:<pageOrListingId>
async function handleTemplateShopButton(interaction) {
  const [action, userId, value] = interaction.customId.split(":");

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Only the person who ran the command can use these buttons.", ephemeral: true });
  }

  const { getAllListings } = require("../services/templateShop");
  const { buildListingEmbed, buildPageRow, purchaseListing } = require("../commands/prefix/templateshop");

  if (action === "tplshop_buy") {
    const id = parseInt(value, 10);
    await purchaseListing(interaction, id);
    return;
  }

  let page = parseInt(value, 10) || 0;
  if (action === "tplshop_prev") page -= 1;
  if (action === "tplshop_next") page += 1;
  page = Math.max(0, page);

  const listings = getAllListings();
  if (!listings.length) {
    return interaction.update({ content: "No templates are currently listed for sale.", embeds: [], components: [] });
  }
  page = Math.min(page, listings.length - 1);

  const listing = listings[page];
  await interaction.update({
    embeds: [buildListingEmbed(listing, page, listings.length)],
    components: [buildPageRow(userId, page, listings.length, listing.id)],
  });
}

// ── Giveaway — Join / End Early / Cancel buttons ──────────────────────────────
// customId format: gw_<action>:<messageId>
async function handleGiveawayButton(interaction) {
  const [action, messageId] = interaction.customId.split(":");
  const { getGiveaway, saveGiveaway, removeGiveaway, buildMessage, hasManagerRole, endGiveaway } = require("../services/giveaway");

  const gw = getGiveaway(messageId);
  if (!gw) {
    return interaction.reply({ content: "❌ This giveaway no longer exists.", ephemeral: true });
  }

  if (action === "gw_join") {
    if (gw.ended) {
      return interaction.reply({ content: "❌ This giveaway has already ended.", ephemeral: true });
    }

    // ── Eligibility checks — block entry if requirements aren't met ───────────
    if (gw.requiredRoleId && !interaction.member.roles.cache.has(gw.requiredRoleId)) {
      return interaction.reply({ content: `❌ You need the <@&${gw.requiredRoleId}> role to join this giveaway.`, ephemeral: true });
    }

    if (gw.requiredLevel) {
      const { getUser } = require("../services/leveling");
      const lvl = getUser(interaction.guild.id, interaction.user.id);
      if ((lvl?.level ?? 1) < gw.requiredLevel) {
        return interaction.reply({ content: `❌ You need to be **Level ${gw.requiredLevel}** or higher to join this giveaway. You're currently Level ${lvl?.level ?? 1}.`, ephemeral: true });
      }
    }

    gw.entries = gw.entries ?? [];

    if (gw.entries.includes(interaction.user.id)) {
      gw.entries = gw.entries.filter((id) => id !== interaction.user.id);
      saveGiveaway(gw);
      await interaction.update({ embeds: [require("../services/giveaway").buildEmbed(gw, false)], components: require("../services/giveaway").buildButtons(gw, false) }).catch(() => {});
      return interaction.followUp({ content: "👋 You left the giveaway.", ephemeral: true }).catch(() => {});
    }

    gw.entries.push(interaction.user.id);
    saveGiveaway(gw);

    const { buildEmbed, buildButtons } = require("../services/giveaway");
    await interaction.update({ embeds: [buildEmbed(gw, false)], components: buildButtons(gw, false) }).catch(() => {});
    return interaction.followUp({ content: "🎉 You're in! Good luck.", ephemeral: true }).catch(() => {});
  }

  if (action === "gw_end") {
    if (!hasManagerRole(interaction.member)) {
      return interaction.reply({ content: "❌ You need **Manage Server** or a configured manager role to end this giveaway.", ephemeral: true });
    }
    await interaction.reply({ content: "⏳ Ending giveaway...", ephemeral: true });
    await endGiveaway(gw, interaction.client);
    return interaction.followUp({ content: "✅ Giveaway ended!", ephemeral: true }).catch(() => {});
  }

  if (action === "gw_cancel") {
    if (!hasManagerRole(interaction.member)) {
      return interaction.reply({ content: "❌ You need **Manage Server** or a configured manager role to cancel this giveaway.", ephemeral: true });
    }
    removeGiveaway(messageId);
    await interaction.update({ content: "❌ This giveaway was cancelled.", embeds: [], components: [] }).catch(() => {});
    return;
  }
}

module.exports = { handle, handleModal, buildServersPage, serversPageRow };