const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const reskin = require("../../services/reskin");
const { success, danger, info, warn } = require("../../util/embed");

const ADMIN  = PermissionFlagsBits.ManageGuild;
const SYSADM = PermissionFlagsBits.Administrator;

function isValidUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

module.exports = {
  name: "reskin",
  async run(message, args) {
    const sub     = args[0]?.toLowerCase();
    const guildId = message.guild.id;
    const guild   = message.guild;

    // ── ,reskin (no sub) / status — show current config ───────────────────────
    if (!sub || sub === "status" || sub === "info") {
      const cfg = reskin.getGuild(guildId);
      const webhookCount = Object.keys(cfg.webhooks).length;

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎭  Reskin Status")
            .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
            .setThumbnail(cfg.avatar || message.client.user.displayAvatarURL({ size: 128 }))
            .addFields(
              { name: "Status",       value: cfg.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
              { name: "Webhooks",     value: `${webhookCount} channel${webhookCount !== 1 ? "s" : ""}`, inline: true },
              { name: "Display Name", value: cfg.name   || "*Not set*", inline: true },
              { name: "Avatar URL",   value: cfg.avatar  ? `[View](${cfg.avatar})` : "*Not set*", inline: true },
              { name: "Banner URL",   value: cfg.banner  ? `[View](${cfg.banner})` : "*Not set*", inline: true },
              { name: "Status Text",  value: cfg.status  || "*Not set*", inline: true },
            )
            .addFields({
              name: "📋  Commands",
              value:
                "`,reskin setup` — create webhooks *(Manage Server)*\n" +
                "`,reskin name <name>` — set display name\n" +
                "`,reskin avatar <url>` — set per-server avatar\n" +
                "`,reskin banner <url>` — set banner\n" +
                "`,reskin status <text>` — set status text\n" +
                "`,reskin disable` — pause reskin\n" +
                "`,reskin delete` — delete all webhooks\n" +
                "`,reskin clear` — reset all settings",
              inline: false,
            })
            .setFooter({ text: "Per-server reskin · Changes only affect this server" })
            .setTimestamp(),
        ],
      });
    }

    // ── ,reskin setup ──────────────────────────────────────────────────────────
    if (sub === "setup") {
      if (!message.member.permissions.has(ADMIN)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server** to set up reskin.")] });
      }
      if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
        return message.reply({ embeds: [danger("Bot Missing Permission", "I need **Manage Webhooks** permission to create reskin webhooks.")] });
      }

      const loading = await message.reply({ embeds: [info("Setting up…", "Creating webhooks in all channels. This may take a moment…")] });

      try {
        const result = await reskin.setup(guild);
        await loading.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅  Reskin Setup Complete")
              .setDescription(`Reskin is now **active** in this server.\n\n> Messages sent through the bot will use your custom name and avatar.`)
              .setColor(0x57f287)
              .addFields(
                { name: "Webhooks Created", value: `${result.created}`, inline: true },
                { name: "Channels Skipped", value: `${result.skipped}`, inline: true },
              )
              .setFooter({ text: "Use ,reskin name and ,reskin avatar to customize" })
              .setTimestamp(),
          ],
        });
      } catch (e) {
        await loading.edit({ embeds: [danger("Setup Failed", e.message)] });
      }
      return;
    }

    // ── ,reskin name <name> ────────────────────────────────────────────────────
    if (sub === "name") {
      if (!message.member.permissions.has(ADMIN)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server**.")] });
      }
      const name = args.slice(1).join(" ").trim();
      if (!name) return message.reply({ embeds: [warn("Missing Name", "**Usage:** `,reskin name <display name>`")] });
      if (name.length > 32) return message.reply({ embeds: [warn("Too Long", "Display name must be 32 characters or fewer.")] });

      await reskin.setServerName(guild, name);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Display Name Updated")
            .setDescription(`My display name in **${guild.name}** is now **${name}**.\n> Only affects this server.`)
            .setColor(0x57f287)
            .setTimestamp(),
        ],
      });
    }

    // ── ,reskin avatar <url> ───────────────────────────────────────────────────
    if (sub === "avatar" || sub === "pfp") {
      if (!message.member.permissions.has(ADMIN)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server**.")] });
      }
      const url = args[1] ?? message.attachments.first()?.url;
      if (!url || !isValidUrl(url)) {
        return message.reply({ embeds: [warn("Missing/Invalid URL", "Provide a valid image URL (PNG, JPG, GIF supported).\n**Usage:** `,reskin avatar <url>`")] });
      }

      const loading = await message.reply({ embeds: [info("Updating…", "Setting per-server avatar via webhooks…")] });
      await reskin.setServerAvatar(guild, url);
      await loading.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Server Avatar Updated")
            .setDescription("The avatar has been updated for this server's reskin webhooks.\n> This **only** affects this server — other servers are unaffected.")
            .setThumbnail(url)
            .setColor(0x57f287)
            .setTimestamp(),
        ],
      });
      return;
    }

    // ── ,reskin banner <url> ───────────────────────────────────────────────────
    if (sub === "banner") {
      if (!message.member.permissions.has(ADMIN)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server**.")] });
      }
      const url = args[1] ?? message.attachments.first()?.url;
      if (!url || !isValidUrl(url)) {
        return message.reply({ embeds: [warn("Missing/Invalid URL", "Provide a valid image URL.\n**Usage:** `,reskin banner <url>`")] });
      }
      reskin.setBanner(guildId, url);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Banner Set")
            .setDescription("Your reskin banner URL has been saved.")
            .setImage(url)
            .setColor(0x57f287)
            .setTimestamp(),
        ],
      });
    }

    // ── ,reskin status <text> ──────────────────────────────────────────────────
    if (sub === "status") {
      if (!message.member.permissions.has(ADMIN)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server**.")] });
      }
      const text = args.slice(1).join(" ").trim();
      if (!text) return message.reply({ embeds: [warn("Missing Text", "**Usage:** `,reskin status <text>`")] });
      reskin.setStatus(guildId, text.slice(0, 128));
      return message.reply({ embeds: [success("Status Set", `Status text: **${text.slice(0, 128)}**`)] });
    }

    // ── ,reskin disable ────────────────────────────────────────────────────────
    if (sub === "disable") {
      if (!message.member.permissions.has(ADMIN)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server**.")] });
      }
      reskin.setEnabled(guildId, false);
      return message.reply({ embeds: [success("Reskin Disabled", "Webhook reskin has been paused. Use `,reskin setup` to re-enable.")] });
    }

    // ── ,reskin delete ─────────────────────────────────────────────────────────
    if (sub === "delete") {
      if (!message.member.permissions.has(SYSADM)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Administrator** to delete all reskin webhooks.")] });
      }
      const loading = await message.reply({ embeds: [info("Deleting…", "Removing all reskin webhooks…")] });
      const removed = await reskin.deleteReskin(guild);
      await loading.edit({ embeds: [success("Reskin Deleted", `Removed **${removed}** webhook${removed !== 1 ? "s" : ""}. All reskin settings cleared.`)] });
      return;
    }

    // ── ,reskin clear ──────────────────────────────────────────────────────────
    if (sub === "clear") {
      if (!message.member.permissions.has(ADMIN)) {
        return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server**.")] });
      }
      const loading = await message.reply({ embeds: [info("Clearing…", "Resetting reskin settings…")] });
      await reskin.clearSettings(guild);
      await loading.edit({ embeds: [success("Settings Cleared", "Name, avatar, banner, and status have been reset to defaults.\nWebhooks are still active — use `,reskin delete` to remove them.")] });
      return;
    }

    // ── ,reskin reset (alias for clear) ───────────────────────────────────────
    if (sub === "reset") {
      const loading = await message.reply({ embeds: [info("Resetting…", "Resetting display name…")] });
      await reskin.setServerName(guild, null);
      await loading.edit({ embeds: [success("Name Reset", "My display name has been reset to the default in this server.")] });
      return;
    }

    return message.reply({ embeds: [warn("Unknown Subcommand", "**Available:** `setup` · `name` · `avatar` · `banner` · `status` · `disable` · `delete` · `clear`")] });
  },
};
