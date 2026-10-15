const { read, write } = require("../storage");

const OWNED_STORE = "roleshop_owned";
const GUILD_STORE = "roleshop_guilds";

const LEVEL_REQ = 100;

const ROLES = [
  {
    id: "king",
    name: "👑 King",
    emoji: "👑",
    price: 75_000_000,
    color: 0xFFD700,
    desc: "The ultimate rank. Pure gold.",
    hoist: true,
    mentionable: true,
    permissions: ["ChangeNickname", "UseExternalEmojis", "AddReactions", "AttachFiles", "EmbedLinks", "UseApplicationCommands"],
  },
  {
    id: "warlord",
    name: "⚔️ Warlord",
    emoji: "⚔️",
    price: 50_000_000,
    color: 0xE74C3C,
    desc: "Crimson battle-hardened warrior.",
    hoist: true,
    mentionable: false,
    permissions: ["UseExternalEmojis", "AddReactions", "AttachFiles", "EmbedLinks", "UseApplicationCommands"],
  },
  {
    id: "archmage",
    name: "🔮 Archmage",
    emoji: "🔮",
    price: 35_000_000,
    color: 0x9B59B6,
    desc: "Master of arcane power. Deep purple.",
    hoist: true,
    mentionable: false,
    permissions: ["UseExternalEmojis", "AddReactions", "AttachFiles", "EmbedLinks", "UseApplicationCommands"],
  },
  {
    id: "diamond",
    name: "💎 Diamond",
    emoji: "💎",
    price: 25_000_000,
    color: 0x00D4FF,
    desc: "Brilliant cyan, rarer than rare.",
    hoist: true,
    mentionable: false,
    permissions: ["UseExternalEmojis", "AddReactions", "AttachFiles", "EmbedLinks", "UseApplicationCommands"],
  },
  {
    id: "inferno",
    name: "🔥 Inferno",
    emoji: "🔥",
    price: 15_000_000,
    color: 0xFF6B35,
    desc: "Blazing orange — burning bright.",
    hoist: true,
    mentionable: false,
    permissions: ["UseExternalEmojis", "AddReactions", "AttachFiles", "EmbedLinks", "UseApplicationCommands"],
  },
  {
    id: "shadow",
    name: "🌑 Shadow",
    emoji: "🌑",
    price: 10_000_000,
    color: 0x95A5A6,
    desc: "Cool grey, enigmatic and sleek.",
    hoist: true,
    mentionable: false,
    permissions: ["UseExternalEmojis", "AddReactions", "AttachFiles", "EmbedLinks", "UseApplicationCommands"],
  },
];

function getRole(id) { return ROLES.find(r => r.id === id); }

function getOwnedRoles(userId) {
  const d = read(OWNED_STORE, {});
  return d[userId] ?? [];
}

function addOwnedRole(userId, roleId) {
  const d = read(OWNED_STORE, {});
  d[userId] = d[userId] ?? [];
  if (!d[userId].includes(roleId)) d[userId].push(roleId);
  write(OWNED_STORE, d);
}

function getGuildRoleId(guildId, roleId) {
  const d = read(GUILD_STORE, {});
  return d[guildId]?.[roleId] ?? null;
}

function setGuildRoleId(guildId, roleId, discordRoleId) {
  const d = read(GUILD_STORE, {});
  if (!d[guildId]) d[guildId] = {};
  d[guildId][roleId] = discordRoleId;
  write(GUILD_STORE, d);
}

// Get or create a Discord role for this role shop item on the given guild
async function getOrCreateDiscordRole(guild, roleId) {
  const existing = getGuildRoleId(guild.id, roleId);
  const roleDef = getRole(roleId);
  if (!roleDef) return null;

  // Check if the stored role still exists
  if (existing) {
    const discordRole = guild.roles.cache.get(existing) ?? await guild.roles.fetch(existing).catch(() => null);
    if (discordRole) return discordRole;
  }

  // Create it fresh
  const newRole = await guild.roles.create({
    name: roleDef.name,
    color: roleDef.color,
    hoist: roleDef.hoist,
    mentionable: roleDef.mentionable,
    permissions: roleDef.permissions,
    reason: "Role Shop purchase",
  });

  setGuildRoleId(guild.id, roleId, newRole.id);
  return newRole;
}

module.exports = {
  ROLES, LEVEL_REQ,
  getRole, getOwnedRoles, addOwnedRole,
  getGuildRoleId, setGuildRoleId, getOrCreateDiscordRole,
};
