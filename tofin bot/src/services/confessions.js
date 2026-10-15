const { read, write } = require("../storage");

const STORE = "confessions";

function _read()   { return read(STORE, {}); }
function _write(d) { write(STORE, d); }

function getGuild(guildId) {
  return _read()[guildId] ?? {
    channelId: null,
    count: 0,
    blacklist: [],   // user IDs who cannot confess
    muted: [],       // user IDs on cooldown / muted
    emojis: ["👍", "👎"],
  };
}

function _setGuild(guildId, data) {
  const d = _read();
  d[guildId] = data;
  _write(d);
}

function setChannel(guildId, channelId) {
  const g = getGuild(guildId);
  g.channelId = channelId;
  _setGuild(guildId, g);
}

function removeChannel(guildId) {
  const g = getGuild(guildId);
  g.channelId = null;
  _setGuild(guildId, g);
}

function nextNumber(guildId) {
  const g = getGuild(guildId);
  g.count = (g.count ?? 0) + 1;
  _setGuild(guildId, g);
  return g.count;
}

// Blacklist
function blacklistAdd(guildId, userId) {
  const g = getGuild(guildId);
  if (!g.blacklist.includes(userId)) g.blacklist.push(userId);
  _setGuild(guildId, g);
}
function blacklistRemove(guildId, userId) {
  const g = getGuild(guildId);
  g.blacklist = g.blacklist.filter((id) => id !== userId);
  _setGuild(guildId, g);
}
function blacklistClear(guildId) {
  const g = getGuild(guildId);
  g.blacklist = [];
  _setGuild(guildId, g);
}
function isBlacklisted(guildId, userId) {
  return getGuild(guildId).blacklist.includes(userId);
}

// Mute
function muteUser(guildId, userId) {
  const g = getGuild(guildId);
  if (!g.muted.includes(userId)) g.muted.push(userId);
  _setGuild(guildId, g);
}
function unmuteUser(guildId, userId) {
  const g = getGuild(guildId);
  g.muted = g.muted.filter((id) => id !== userId);
  _setGuild(guildId, g);
}
function isMuted(guildId, userId) {
  return getGuild(guildId).muted.includes(userId);
}

// Emojis
function setEmojis(guildId, up, down) {
  const g = getGuild(guildId);
  g.emojis = [up, down];
  _setGuild(guildId, g);
}
function resetEmojis(guildId) {
  const g = getGuild(guildId);
  g.emojis = ["👍", "👎"];
  _setGuild(guildId, g);
}

module.exports = {
  getGuild, setChannel, removeChannel, nextNumber,
  blacklistAdd, blacklistRemove, blacklistClear, isBlacklisted,
  muteUser, unmuteUser, isMuted,
  setEmojis, resetEmojis,
};
