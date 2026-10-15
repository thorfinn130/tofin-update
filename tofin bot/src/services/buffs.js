// Active timed buffs — stored in data/buffs.json for persistence across restarts
const { read, write } = require("../storage");
const STORE = "buffs";

function _read() { return read(STORE, {}); }
function _write(d) { write(STORE, d); }

function key(guildId, userId) { return `${guildId}:${userId}`; }

function getBuffs(guildId, userId) {
  return _read()[key(guildId, userId)] ?? {};
}

function applyBuff(guildId, userId, buff, durationMs) {
  const d = _read();
  const k = key(guildId, userId);
  if (!d[k]) d[k] = {};
  d[k][buff] = Date.now() + durationMs;
  _write(d);
}

function hasBuff(guildId, userId, buff) {
  const buffs = getBuffs(guildId, userId);
  const exp = buffs[buff];
  return exp && exp > Date.now();
}

function timeLeft(guildId, userId, buff) {
  const buffs = getBuffs(guildId, userId);
  const exp = buffs[buff];
  if (!exp || exp <= Date.now()) return 0;
  return exp - Date.now();
}

function fmtTimeLeft(ms) {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

module.exports = { applyBuff, hasBuff, timeLeft, fmtTimeLeft };
