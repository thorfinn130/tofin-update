const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, ChannelType,
} = require("discord.js");
const {
  getTemplate, listTemplates, deleteTemplate, createBlankTemplate,
  getGuildConfig, setGuildConfig, disableWelcomer,
  buildPreviewEmbed, buildBuilderEmbed, buildLivePreviewEmbed,
  resolveVars, resolveGifUrl,
} = require("../../services/welcomer");
const { success, info, danger, warn } = require("../../util/embed");

const isAdmin = (message) =>
  message.member.permissions.has(PermissionFlagsBits.Administrator);

// ── Builder button rows ───────────────────────────────────────────────────────

function builderRows(userId, templateName) {
  const key = `${userId}:${templateName}`;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wlc_content:${key}`).setLabel("Message").setStyle(ButtonStyle.Secondary).setEmoji("📨"),
      new ButtonBuilder().setCustomId(`wlc_title:${key}`).setLabel("Title").setStyle(ButtonStyle.Secondary).setEmoji("📝"),
      new ButtonBuilder().setCustomId(`wlc_desc:${key}`).setLabel("Description").setStyle(ButtonStyle.Secondary).setEmoji("📄"),
      new ButtonBuilder().setCustomId(`wlc_author:${key}`).setLabel("Author").setStyle(ButtonStyle.Secondary).setEmoji("👤"),
      new ButtonBuilder().setCustomId(`wlc_footer:${key}`).setLabel("Footer").setStyle(ButtonStyle.Secondary).setEmoji("📋"),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wlc_color:${key}`).setLabel("Color").setStyle(ButtonStyle.Secondary).setEmoji("🎨"),
      new ButtonBuilder().setCustomId(`wlc_thumb:${key}`).setLabel("Thumbnail").setStyle(ButtonStyle.Secondary).setEmoji("🖼️"),
      new ButtonBuilder().setCustomId(`wlc_image:${key}`).setLabel("Banner / GIF").setStyle(ButtonStyle.Secondary).setEmoji("🌄"),
      new ButtonBuilder().setCustomId(`wlc_fields:${key}`).setLabel("Fields").setStyle(ButtonStyle.Secondary).setEmoji("🔧"),
      new ButtonBuilder().setCustomId(`wlc_test:${key}`).setLabel("Test Send").setStyle(ButtonStyle.Success).setEmoji("📤"),
    ),
  ];
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "welcome",
  aliases: ["welcomer", "wlc"],
  async run(message, args) {
    const sub = args[0]?.toLowerCase();

    // ── create ────────────────────────────────────────────────────────────────
    if (sub === "create") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const name = args.slice(1).join(" ");
      if (!name) return message.reply({ embeds: [warn("Missing Name", "Usage: `,welcome create <name>`")] });
      if (getTemplate(message.author.id, name)) {
        return message.reply({ embeds: [warn("Already Exists", `Template **${name}** already exists.\nUse \`,welcome edit ${name}\` to edit it.`)] });
      }
      const tpl = createBlankTemplate(message.author.id, name);
      const { embed: previewEmbed } = buildLivePreviewEmbed(tpl, message.member);
      return message.reply({
        embeds: [buildBuilderEmbed(tpl), previewEmbed],
        components: builderRows(message.author.id, name),
      });
    }

    // ── edit ──────────────────────────────────────────────────────────────────
    if (sub === "edit") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const name = args.slice(1).join(" ");
      if (!name) return message.reply({ embeds: [warn("Missing Name", "Usage: `,welcome edit <name>`")] });
      const tpl = getTemplate(message.author.id, name);
      if (!tpl) return message.reply({ embeds: [danger("Not Found", `No template named **${name}**.\nCreate one with \`,welcome create ${name}\`.`)] });
      const { embed: previewEmbed } = buildLivePreviewEmbed(tpl, message.member);
      return message.reply({
        embeds: [buildBuilderEmbed(tpl), previewEmbed],
        components: builderRows(message.author.id, name),
      });
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === "list") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const list = listTemplates(message.author.id);
      const desc = list.length
        ? list.map((t) => `• **${t.name}** — saved <t:${Math.floor((t.updatedAt ?? t.createdAt) / 1000)}:R>`).join("\n")
        : "_No welcome templates yet._\n\nCreate one with `,welcome create <name>`.";
      return message.reply({ embeds: [info("🎉 Your Welcome Templates", desc)] });
    }

    // ── delete ────────────────────────────────────────────────────────────────
    if (sub === "delete") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const name = args.slice(1).join(" ");
      if (!name) return message.reply({ embeds: [warn("Missing Name", "Usage: `,welcome delete <name>`")] });
      const deleted = deleteTemplate(message.author.id, name);
      if (!deleted) return message.reply({ embeds: [danger("Not Found", `No template named **${name}** in your account.`)] });
      return message.reply({ embeds: [success("Deleted!", `Welcome template **${name}** permanently deleted.`)] });
    }

    // ── set channel ───────────────────────────────────────────────────────────
    if (sub === "set" && args[1]?.toLowerCase() === "channel") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const channel = message.mentions.channels.first()
        ?? message.guild.channels.cache.get(args[2]);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return message.reply({ embeds: [warn("Invalid Channel", "Mention a text channel.\nUsage: `,welcome set channel #channel`")] });
      }
      const cfg = getGuildConfig(message.guild.id) ?? {};
      setGuildConfig(message.guild.id, { ...cfg, channelId: channel.id });
      return message.reply({ embeds: [success("Channel Set!", `Welcome messages will go to ${channel}.`)] });
    }

    // ── set template ──────────────────────────────────────────────────────────
    if (sub === "set" && args[1]?.toLowerCase() === "template") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const name = args.slice(2).join(" ");
      if (!name) return message.reply({ embeds: [warn("Missing Name", "Usage: `,welcome set template <name>`")] });
      const tpl = getTemplate(message.author.id, name);
      if (!tpl) return message.reply({ embeds: [danger("Not Found", `No template named **${name}** in your account.`)] });
      const cfg = getGuildConfig(message.guild.id) ?? {};
      setGuildConfig(message.guild.id, { ...cfg, templateOwner: message.author.id, templateName: name, enabled: true });
      return message.reply({ embeds: [success("Template Set!", `Server now uses **${name}** for welcome messages. Welcomer is **enabled** ✅`)] });
    }

    // ── enable ────────────────────────────────────────────────────────────────
    if (sub === "enable") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const cfg = getGuildConfig(message.guild.id);
      if (!cfg?.templateName) return message.reply({ embeds: [warn("No Template", "Set one first: `,welcome set template <name>`")] });
      if (!cfg?.channelId)    return message.reply({ embeds: [warn("No Channel",  "Set one first: `,welcome set channel #channel`")] });
      setGuildConfig(message.guild.id, { ...cfg, enabled: true });
      return message.reply({ embeds: [success("Welcomer Enabled!", "New members will receive a welcome message.")] });
    }

    // ── disable ───────────────────────────────────────────────────────────────
    if (sub === "disable") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      disableWelcomer(message.guild.id);
      return message.reply({ embeds: [success("Welcomer Disabled", "Welcome messages paused until re-enabled.")] });
    }

    // ── test ──────────────────────────────────────────────────────────────────
    if (sub === "test") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const cfg = getGuildConfig(message.guild.id);
      if (!cfg?.templateName || !cfg?.templateOwner) {
        return message.reply({ embeds: [warn("Not Configured", "Set a template first: `,welcome set template <name>`")] });
      }
      const tpl = getTemplate(cfg.templateOwner, cfg.templateName);
      if (!tpl) return message.reply({ embeds: [danger("Template Missing", "The configured template no longer exists.")] });
      // Resolve Tenor/Giphy page URLs → direct media URLs so setImage works
      const member = message.member;
      const [resolvedImage, resolvedThumb] = await Promise.all([
        resolveGifUrl(tpl.image     ? resolveVars(tpl.image,     member) : null),
        resolveGifUrl(tpl.thumbnail ? resolveVars(tpl.thumbnail, member) : null),
      ]);
      const tplResolved = { ...tpl, image: resolvedImage, thumbnail: resolvedThumb };
      const { embed, content } = buildPreviewEmbed(tplResolved, member);
      return message.reply({
        content: content
          ? `${content}\n-# 🧪 Test — using your profile as preview`
          : `-# 🧪 Test — using your profile as preview`,
        embeds: [embed],
      });
    }

    // ── info ──────────────────────────────────────────────────────────────────
    if (sub === "info") {
      if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });
      const cfg = getGuildConfig(message.guild.id);
      if (!cfg) {
        return message.reply({ embeds: [info("Welcomer Config", "_Not set up yet._\n\n`,welcome set channel #channel` — set the channel\n`,welcome set template <name>` — pick a template")] });
      }
      const ch  = cfg.channelId    ? `<#${cfg.channelId}>`     : "_not set_";
      const tpl = cfg.templateName ? `**${cfg.templateName}**` : "_not set_";
      const st  = cfg.enabled      ? "✅ Enabled"               : "❌ Disabled";
      return message.reply({ embeds: [info("Welcomer Config", `**Status:** ${st}\n**Channel:** ${ch}\n**Template:** ${tpl}`)] });
    }

    // ── fallback / help ───────────────────────────────────────────────────────
    if (!isAdmin(message)) return message.reply({ embeds: [danger("Missing Permission", "Requires Administrator.")] });

    return message.reply({ embeds: [info("Welcomer — Commands",
      "**Build templates:**\n" +
      "`,welcome create <name>` — create a template (opens live builder)\n" +
      "`,welcome edit <name>` — re-open the builder\n" +
      "`,welcome list` — list all your templates\n" +
      "`,welcome delete <name>` — delete a template\n\n" +
      "**Configure this server:**\n" +
      "`,welcome set channel #channel` — where to send welcome messages\n" +
      "`,welcome set template <name>` — which template to use\n" +
      "`,welcome enable` / `,welcome disable` — toggle on/off\n" +
      "`,welcome test` — send a full test using your own profile\n" +
      "`,welcome info` — show current config\n\n" +
      "**Variables:**\n" +
      "`{user}` — mention/ping the user\n" +
      "`{user_name}` — username  •  `{user_display}` — display name\n" +
      "`{user_avatar}` — avatar URL\n" +
      "`{server_name}` `{server_icon}` `{server_membercount}`\n\n" +
      "**Tips:**\n" +
      "• Use `{user}` in **Message** to ping on join\n" +
      "• **Banner / GIF** supports animated `.gif` URLs\n" +
      "• **Fields** adds up to 3 custom inline fields to the embed\n" +
      "• Hit **📤 Test Send** in the builder to preview in the channel"
    )] });
  },
};
