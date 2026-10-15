/**
 * Reskin Service — per-server webhook-based identity system.
 *
 * Each guild can configure:
 *   name     — custom display name shown in webhook messages + bot nickname
 *   avatar   — custom avatar URL used in webhook messages
 *   banner   — stored banner URL (shown in reskin status embed)
 *   status   — custom status text
 *   enabled  — whether webhook reskin is active
 *   webhooks — { channelId: webhookUrl }
 *
 * The bot's GLOBAL avatar is separate: setGlobalAvatar() changes the bot account itself.
 */

const { read, write } = require("../storage");

const STORE = "reskin";

function _read()   { return read(STORE, { guilds: {}, aiPersonas: {} }); }
function _write(d) { write(STORE, d); }

function getGuild(guildId) {
  const d = _read();
  return d.guilds?.[guildId] ?? {
    name: null, avatar: null, banner: null, status: null,
    enabled: false, webhooks: {},
  };
}

function _setGuild(guildId, data) {
  const d = _read();
  if (!d.guilds) d.guilds = {};
  d.guilds[guildId] = data;
  _write(d);
}

// ── Setup — create webhooks in every accessible text channel ──────────────────
async function setup(guild) {
  const cfg = getGuild(guild.id);
  const textChannels = guild.channels.cache.filter(
    (c) => c.isTextBased() && !c.isThread() &&
      c.permissionsFor(guild.members.me)?.has("ManageWebhooks")
  );

  let created = 0, skipped = 0;

  for (const [id, channel] of textChannels) {
    if (cfg.webhooks[id]) { skipped++; continue; }
    try {
      const wh = await channel.createWebhook({
        name:   cfg.name  || guild.client.user.username,
        avatar: cfg.avatar || guild.client.user.displayAvatarURL({ size: 256 }),
        reason: "Reskin setup",
      });
      cfg.webhooks[id] = wh.url;
      created++;
    } catch { skipped++; }
  }

  cfg.enabled = true;
  _setGuild(guild.id, cfg);
  return { created, skipped, total: textChannels.size };
}

// ── Name ──────────────────────────────────────────────────────────────────────
async function setServerName(guild, name) {
  const cfg = getGuild(guild.id);
  cfg.name  = name;
  _setGuild(guild.id, cfg);

  try { await guild.members.me.setNickname(name || null, "Reskin name change"); } catch {}

  if (cfg.enabled && Object.keys(cfg.webhooks).length) {
    await _updateWebhooks(guild, { name: name || guild.client.user.username });
  }
}

// ── Avatar (per-server, stored + webhooks updated) ────────────────────────────
async function setServerAvatar(guild, url) {
  const cfg = getGuild(guild.id);
  cfg.avatar = url;
  _setGuild(guild.id, cfg);

  if (cfg.enabled && Object.keys(cfg.webhooks).length) {
    await _updateWebhooks(guild, { avatar: url });
  }
}

// ── Global avatar (changes actual bot account — all servers) ──────────────────
async function setGlobalAvatar(client, url) {
  await client.user.setAvatar(url);
}

// Legacy compat
async function setAvatar(client, url) {
  return setGlobalAvatar(client, url);
}

// ── Banner & Status ───────────────────────────────────────────────────────────
function setBanner(guildId, url) {
  const cfg = getGuild(guildId);
  cfg.banner = url;
  _setGuild(guildId, cfg);
}

function setStatus(guildId, text) {
  const cfg = getGuild(guildId);
  cfg.status = text;
  _setGuild(guildId, cfg);
}

// ── Enable / Disable ──────────────────────────────────────────────────────────
function setEnabled(guildId, enabled) {
  const cfg = getGuild(guildId);
  cfg.enabled = enabled;
  _setGuild(guildId, cfg);
}

// ── Delete — remove all webhooks & wipe data ──────────────────────────────────
async function deleteReskin(guild) {
  const cfg = getGuild(guild.id);
  let removed = 0;

  for (const [channelId, whUrl] of Object.entries(cfg.webhooks)) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      const webhooks = await channel.fetchWebhooks().catch(() => null);
      if (!webhooks) continue;
      const wh = webhooks.find((w) => w.url === whUrl);
      if (wh) { await wh.delete("Reskin deleted"); removed++; }
    } catch {}
  }

  _setGuild(guild.id, { name: null, avatar: null, banner: null, status: null, enabled: false, webhooks: {} });
  return removed;
}

// ── Clear — wipe name/avatar/banner/status, keep webhooks ────────────────────
async function clearSettings(guild) {
  const cfg = getGuild(guild.id);
  cfg.name   = null;
  cfg.avatar = null;
  cfg.banner = null;
  cfg.status = null;

  try { await guild.members.me.setNickname(null); } catch {}

  if (cfg.enabled && Object.keys(cfg.webhooks).length) {
    await _updateWebhooks(guild, {
      name:   guild.client.user.username,
      avatar: guild.client.user.displayAvatarURL({ size: 256 }),
    });
  }

  _setGuild(guild.id, cfg);
}

// ── Internal: patch all stored webhooks ──────────────────────────────────────
async function _updateWebhooks(guild, patch) {
  const cfg = getGuild(guild.id);
  for (const [channelId, whUrl] of Object.entries(cfg.webhooks)) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      const webhooks = await channel.fetchWebhooks().catch(() => null);
      if (!webhooks) continue;
      const wh = webhooks.find((w) => w.url === whUrl);
      if (wh) await wh.edit(patch).catch(() => {});
    } catch {}
  }
}

/**
 * Send a message through the guild's reskin webhook for a channel.
 * Returns the sent message, or null if reskin not configured.
 */
async function sendAsReskin(channel, payload) {
  const cfg = getGuild(channel.guild.id);
  if (!cfg.enabled) return null;

  const whUrl = cfg.webhooks[channel.id];
  if (!whUrl) return null;

  try {
    const webhooks = await channel.fetchWebhooks().catch(() => null);
    if (!webhooks) return null;
    const wh = webhooks.find((w) => w.url === whUrl);
    if (!wh) return null;
    return await wh.send({
      ...payload,
      username:  cfg.name   || channel.client.user.username,
      avatarURL: cfg.avatar || channel.client.user.displayAvatarURL(),
    });
  } catch { return null; }
}

// ── AI Persona helpers (per-user) ─────────────────────────────────────────────
function getAiPersona(userId) {
  return _read().aiPersonas?.[userId] ?? null;
}

function setAiPersona(userId, name) {
  const d = _read();
  if (!d.aiPersonas) d.aiPersonas = {};
  if (name) d.aiPersonas[userId] = name;
  else delete d.aiPersonas[userId];
  _write(d);
}

async function getOrCreateWebhook(channel) {
  const webhooks = await channel.fetchWebhooks().catch(() => null);
  if (!webhooks) return null;
  const existing = webhooks.find((wh) => wh.owner?.id === channel.client.user.id);
  if (existing) return existing;
  try {
    return await channel.createWebhook({
      name:   channel.client.user.username,
      avatar: channel.client.user.displayAvatarURL({ size: 256 }),
      reason: "ReskinAI webhook",
    });
  } catch { return null; }
}

module.exports = {
  getGuild, setup,
  setServerName, setServerAvatar, setGlobalAvatar, setAvatar,
  setBanner, setStatus, setEnabled,
  deleteReskin, clearSettings,
  sendAsReskin,
  getAiPersona, setAiPersona, getOrCreateWebhook,
};
