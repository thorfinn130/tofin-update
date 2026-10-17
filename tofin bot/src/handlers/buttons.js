const { resolveGifUrl } = require("../util/gifUrl");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require("discord.js");
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

// ── Main router ───────────────────────────────────────────────────────────────
async function handle(interaction) {
  try {
    if (interaction.isButton()) {
      const action = interaction.customId.split(":")[0];
      if (action === "trestart_yes" || action === "trestart_no") return handleTrestart(interaction);
      if (action.startsWith("srv_")) return handleServerBuilder(interaction);
      if (action.startsWith("srvtab_")) return handleServerTabSwitch(interaction);
      if (action.startsWith("srvlay_")) return handleServerLayoutPick(interaction);
      if (action.startsWith("svp_")) return handleServersPagination(interaction);
      if (action.startsWith("svvote")) return handleServerVote(interaction);
      if (action.startsWith("tplshop_")) return handleTemplateShopButton(interaction);
      if (action.startsWith("gw_")) return handleGiveawayButton(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      const action = interaction.customId.split(":")[0];
      if (action === "help_cat") return handleHelpCat(interaction);
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
    if (action.startsWith("srvm_"))  return handleServerModal(interaction);
    if (action.startsWith("srvlaym_")) return handleServerLayoutModal(interaction);
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