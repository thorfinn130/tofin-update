const { read, write } = require("../storage");

const STORE = "automod";

function _read()   { return read(STORE, {}); }
function _write(d) { write(STORE, d); }

function getConfig(guildId) {
  return _read()[guildId] ?? { enabled: false, words: [] };
}

function setEnabled(guildId, enabled) {
  const d = _read();
  if (!d[guildId]) d[guildId] = { enabled: false, words: [] };
  d[guildId].enabled = enabled;
  _write(d);
}

function addWord(guildId, word) {
  const d = _read();
  if (!d[guildId]) d[guildId] = { enabled: false, words: [] };
  const w = word.toLowerCase();
  if (!d[guildId].words.includes(w)) {
    d[guildId].words.push(w);
    _write(d);
    return true;
  }
  return false;
}

function removeWord(guildId, word) {
  const d = _read();
  if (!d[guildId]) return false;
  const before = d[guildId].words.length;
  d[guildId].words = d[guildId].words.filter((w) => w !== word.toLowerCase());
  _write(d);
  return d[guildId].words.length < before;
}

function clearWords(guildId) {
  const d = _read();
  if (!d[guildId]) return;
  d[guildId].words = [];
  _write(d);
}

/**
 * Check if a message triggers automod. Returns the matched word or null.
 */
function check(guildId, content) {
  const cfg = getConfig(guildId);
  if (!cfg.enabled || !cfg.words.length) return null;
  const lower = content.toLowerCase();
  return cfg.words.find((w) => lower.includes(w)) ?? null;
}

module.exports = { getConfig, setEnabled, addWord, removeWord, clearWords, check };
