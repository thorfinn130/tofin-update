const { Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits, REST, Routes } = require("discord.js");
const { token, clientId } = require("./config");
const prefix   = require("./handlers/prefix");
const slash    = require("./handlers/slash");
const buttons  = require("./handlers/buttons");
const antiNuke = require("./services/antiNuke");
const logging  = require("./services/logging");
const giveaway = require("./services/giveaway");
const { track: trackMessage } = require("./services/messageTracker");
const inviteTracker = require("./services/inviteTracker");
const { addXP } = require("./services/leveling");
const { runAutoCollect } = require("./services/machines");
const { addWallet, fmt } = require("./services/economy");
const aiChat = require("./services/aiChat");
const { extractGifUrl, saveGif } = require("./services/gifMemory");
const { storeDelete } = require("./commands/prefix/snipe");
const { getAfk, clearAfk, isAfk } = require("./services/afk");
const { check: automodCheck } = require("./services/automod");
const { getDueReminders, removeById } = require("./services/reminder");
const { handleSocial } = require("./services/socialHandler");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Channel, Partials.Message],
  presence: { status: "online" },
});

prefix.loadCommands();
slash.loadCommands();
antiNuke.register(client);
logging.register(client);

// ── Auto‑deploy slash commands on startup ──
async function deployCommands() {
  try {
    slash.loadCommands();
    const body = slash.getAll().map((c) => c.data.toJSON());
    const rest = new REST({ version: "10" }).setToken(token);
    console.log(`🔄 Deploying ${body.length} slash command(s)…`);
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log("✅ Slash commands deployed globally.");
  } catch (err) {
    console.error("❌ Slash deploy failed:", err.message);
  }
}

// Record the exact moment the bot came online — used to discard replayed events
let BOT_READY_AT = 0;

client.once("clientReady", async () => {
  BOT_READY_AT = Date.now();
  console.log(`✅ Logged in as ${client.user.tag}`);

  // ── Set custom status ──
  client.user.setPresence({
    status: "streaming",           // ✅ Valid: online, idle, dnd, invisible
    activities: [
      {
        name: "tlpur",
        type: 1,                 // 1 = Streaming
        url: "https://www.twitch.tv/tofins1", // ✅ Required for Streaming type
      },
    ],
  });

  startAutoCollectLoop();
  startJailExpiryLoop();
  startReminderLoop();
  giveaway.startLoop(client);
  await inviteTracker.register(client).catch(() => {});
});

client.on("messageCreate", async (m) => {
  if (m.author.bot) return;

  if (m.createdTimestamp < BOT_READY_AT) return;

  if (!m.guild) {
    aiChat.chat(m).catch(() => {});
    return;
  }

  // ── Automod ──
  try {
    const matched = automodCheck(m.guild.id, m.content);
    if (matched) {
      await m.delete().catch(() => {});
      const warnMsg = await m.channel.send({
        content: `⚠️ ${m.author}, your message was removed for containing a blocked word.`,
      }).catch(() => null);
      if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }
  } catch {}

  // ── AFK ──
  try {
    if (isAfk(m.guild.id, m.author.id)) {
      const { EmbedBuilder } = require("discord.js");
      clearAfk(m.guild.id, m.author.id);
      m.channel.send({
        embeds: [
          new EmbedBuilder()
            .setDescription(`👋 Welcome back, ${m.author}! Your AFK status has been removed.`)
            .setColor(0x57f287),
        ],
      }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 6000)).catch(() => {});
    }
  } catch {}

  try {
    if (m.mentions.users.size) {
      const { EmbedBuilder } = require("discord.js");
      for (const [userId, user] of m.mentions.users) {
        if (userId === m.author.id) continue;
        const afkData = getAfk(m.guild.id, userId);
        if (!afkData) continue;
        const since = Math.floor(afkData.since / 1000);
        m.channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("💤  User is AFK")
              .setDescription(`${user} is currently AFK.`)
              .addFields(
                { name: "Status", value: afkData.reason, inline: true },
                { name: "Since",  value: `<t:${since}:R>`, inline: true },
              )
              .setColor(0x5865f2)
              .setThumbnail(user.displayAvatarURL()),
          ],
        }).catch(() => {});
        break;
      }
    }
  } catch {}

  // Social media auto‑downloader (without Spotify)
  handleSocial(m).catch(() => {});

  const gifUrl = extractGifUrl(m);
  if (gifUrl) saveGif(m.guild.id, gifUrl);

  trackMessage(m.guild.id, m.author.id);

  const { isLevelingEnabled } = require("./commands/prefix/leveltoggle");
  if (isLevelingEnabled(m.guild.id)) {
    const result = addXP(m.guild.id, m.author.id);
    if (result?.leveled) {
      m.channel.send({
        content: `🎉 ${m.author} leveled up to **Level ${result.level}**! You earned **3 stat points** — use \`,stats\` to spend them with the upgrade buttons!`,
      }).catch(() => {});
    }
  }
  prefix.handle(m);
  aiChat.chat(m).catch(() => {});
});

client.on("messageDelete", (m) => storeDelete(m));

client.on("presenceUpdate", async (oldPresence, newPresence) => {
  try {
    const { getAllRules } = require("./services/statusRoles");
    const member = newPresence?.member;
    if (!member || member.user.bot) return;

    const rules = getAllRules().filter((r) => r.guildId === member.guild.id);
    if (!rules.length) return;

    const customStatus = newPresence.activities?.find((a) => a.type === 4)?.state || "";

    for (const rule of rules) {
      const matches = customStatus.toLowerCase().includes(rule.matchText.toLowerCase());
      const hasRole = member.roles.cache.has(rule.roleId);

      if (matches && !hasRole) {
        await member.roles.add(rule.roleId).catch(() => {});
      } else if (!matches && hasRole) {
        await member.roles.remove(rule.roleId).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[presenceUpdate statusRoles]", e);
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const { isTrigger, getTriggerLimit, registerTemp, isTempChannel, removeTemp } = require("./services/joinToCreate");

    if (newState.channelId && newState.channelId !== oldState.channelId) {
      const guild = newState.guild;
      if (isTrigger(guild.id, newState.channelId)) {
        const triggerChannel = newState.channel;
        const member = newState.member;
        const configuredLimit = getTriggerLimit(guild.id, newState.channelId);

        const created = await guild.channels.create({
          name: `${member.user.username}'s channel`,
          type: triggerChannel.type,
          parent: triggerChannel.parentId,
          userLimit: configuredLimit ?? 0,
          permissionOverwrites: [
            {
              id: member.id,
              allow: [
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
              ],
            },
          ],
        });

        registerTemp(created.id, guild.id, member.id);
        await member.voice.setChannel(created).catch(() => {});
      }
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const leftChannel = oldState.channel;
      if (leftChannel && isTempChannel(leftChannel.id) && leftChannel.members.size === 0) {
        removeTemp(leftChannel.id);
        await leftChannel.delete().catch(() => {});
      }
    }
  } catch (e) {
    console.error("[voiceStateUpdate joinToCreate]", e);
  }
});

client.on("interactionCreate", async (i) => {
  if (i.isButton() || i.isStringSelectMenu()) return buttons.handle(i);
  if (i.isModalSubmit()) return buttons.handleModal(i);
  slash.handle(i);
});

client.on("guildMemberAdd", async (member) => {
  inviteTracker.resolveInviter(member).catch(() => {});

  // ── Autorole — give every configured role to new members ──────────────────
  try {
    const { getRoles } = require("./services/autorole");
    const roleIds = getRoles(member.guild.id);
    for (const roleId of roleIds) {
      const role = member.guild.roles.cache.get(roleId);
      if (role) await member.roles.add(role).catch(() => {});
    }
  } catch (e) {
    console.error("[guildMemberAdd autorole]", e);
  }

  try {
    const { getGuildConfig, getTemplate, buildWelcomeEmbed, resolveVars, resolveGifUrl } = require("./services/welcomer");
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg?.enabled || !cfg?.channelId || !cfg?.templateName || !cfg?.templateOwner) return;
    const tpl = getTemplate(cfg.templateOwner, cfg.templateName);
    if (!tpl) return;
    const channel = member.guild.channels.cache.get(cfg.channelId);
    if (!channel) return;
    const [resolvedImage, resolvedThumb] = await Promise.all([
      resolveGifUrl(tpl.image    ? resolveVars(tpl.image,     member) : null),
      resolveGifUrl(tpl.thumbnail? resolveVars(tpl.thumbnail, member) : null),
    ]);
    const tplResolved = { ...tpl, image: resolvedImage, thumbnail: resolvedThumb };
    const { embed, content } = buildWelcomeEmbed(tplResolved, member);
    await channel.send({ content: content ?? undefined, embeds: [embed] });
  } catch (e) {
    console.error("[guildMemberAdd welcomer]", e);
  }
});

client.on("guildMemberRemove", (member) => {
  inviteTracker.onMemberLeave(member.guild.id, member.id);
});

// ── Auto Collect Loop ─────────────────────────────────────────────────────────
function startAutoCollectLoop() {
  const CHECK_INTERVAL = 10 * 60_000;

  setInterval(async () => {
    try {
      const results = runAutoCollect();
      if (!results.length) return;

      for (const r of results) {
        addWallet(r.userId, r.earned);
        try {
          const guild   = client.guilds.cache.get(r.guildId);
          if (!guild) continue;
          const channel = guild.channels.cache.get(r.channelId);
          if (!channel) continue;
          const { EmbedBuilder } = require("discord.js");
          await channel.send({ embeds: [
            new EmbedBuilder()
              .setTitle("🤖  Auto Collector")
              .setDescription(`Collected **${fmt(r.earned)} TC** from Machine #${r.channelNum}!\n> 💳 Added directly to your wallet`)
              .setColor(0x3498DB)
              .setFooter({ text: "Tofin Mine  ·  Auto-collects every 6h" })
              .setTimestamp(),
          ] });
        } catch {}
      }
    } catch (e) {
      console.error("[autoCollect]", e);
    }
  }, CHECK_INTERVAL);
}

// ── Jail Expiry Loop ───────────────────────────────────────────────────────────
function startJailExpiryLoop() {
  const CHECK_INTERVAL = 30_000;

  setInterval(async () => {
    try {
      const { getAllActiveAcrossGuilds, clearActiveJail } = require("./services/jail");
      const now = Date.now();
      const active = getAllActiveAcrossGuilds();

      for (const entry of active) {
        if (!entry.expiresAt || entry.expiresAt > now) continue;

        try {
          const guild = client.guilds.cache.get(entry.guildId);
          if (!guild) { clearActiveJail(entry.guildId, entry.userId); continue; }

          const member = await guild.members.fetch(entry.userId).catch(() => null);
          if (member) {
            const rolesToRestore = (entry.roleSnapshot || []).filter((id) => guild.roles.cache.has(id));
            await member.roles.set(rolesToRestore).catch(() => {});
          }

          clearActiveJail(entry.guildId, entry.userId);
        } catch (e) {
          console.error("[jailExpiry entry]", e);
        }
      }
    } catch (e) {
      console.error("[jailExpiry]", e);
    }
  }, CHECK_INTERVAL);
}

// ── Reminder Loop ──────────────────────────────────────────────────────────────
function startReminderLoop() {
  const CHECK_INTERVAL = 30_000;

  setInterval(async () => {
    try {
      const due = getDueReminders();
      for (const r of due) {
        removeById(r.id);
        try {
          const guild   = client.guilds.cache.get(r.guildId);
          const channel = guild?.channels.cache.get(r.channelId);
          if (!channel) continue;

          const { EmbedBuilder } = require("discord.js");
          const { formatDuration } = require("./util/time");
          const elapsed = Date.now() - (r.createdAt ?? 0);

          await channel.send({
            content: `<@${r.userId}>`,
            embeds: [
              new EmbedBuilder()
                .setTitle("⏰  Reminder")
                .setDescription(`<@${r.userId}>, here is your reminder!`)
                .addFields(
                  { name: "📝 Message", value: r.text, inline: false },
                  { name: "⏱️ Time Elapsed", value: formatDuration(elapsed), inline: true },
                )
                .setColor(0x5865f2)
                .setFooter({ text: `Reminder #${r.id}` })
                .setTimestamp(),
            ],
          });
        } catch {}
      }
    } catch (e) {
      console.error("[reminderLoop]", e);
    }
  }, CHECK_INTERVAL);
}

// ── Deploy commands (non‑blocking) ──
deployCommands().catch(() => {});

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(token);