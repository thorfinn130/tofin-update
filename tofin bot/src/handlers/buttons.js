const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { success: successEmbed, danger: dangerEmbed, warn: warnEmbed } = require("../util/embed");
const { colors } = require("../config");

// ── helpers ──────────────────────────────────────────────────────────────────
function disableAll(row) {
  return new ActionRowBuilder().addComponents(
    row.components.map(b => ButtonBuilder.from(b).setDisabled(true))
  );
}

// ── Help category select ──────────────────────────────────────────────────────
async function handleHelpCat(interaction) {
  const [, userId] = interaction.customId.split(":");
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ Run `,help` yourself to use the menu!", ephemeral: true });
  }

  const { categoryEmbed, buildMenu } = require("../commands/prefix/thelp");
  const selected = interaction.values[0];
  return interaction.update({
    embeds: [categoryEmbed(selected, interaction.user)],
    components: [buildMenu(userId, selected)],
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

// ── Main router ───────────────────────────────────────────────────────────────
async function handle(interaction) {
  try {
    if (interaction.isButton()) {
      const action = interaction.customId.split(":")[0];
      if (action.startsWith("gw_")) return handleGiveawayButton(interaction);
      if (action.startsWith("aiconf_")) return require("../services/ai/tools").handleConfirmButton(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      const action = interaction.customId.split(":")[0];
      if (action === "help_cat") return handleHelpCat(interaction);
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

module.exports = { handle };
