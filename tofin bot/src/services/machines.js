const { read, write } = require("../storage");
const STORE = "machines";

function _read() { return read(STORE, {}); }
function _write(d) { write(STORE, d); }

function _defaultUser() {
  return { unassigned: 0, unassignedWorkers: 0, unassignedCollectors: 0, servers: {} };
}

function _defaultServer() {
  return { categoryId: null, channels: [] };
}

function getUserData(userId) {
  const d = _read();
  return d[userId] ?? _defaultUser();
}

function _saveUser(userId, data) {
  const d = _read();
  d[userId] = data;
  _write(d);
}

function getServerData(userId, guildId) {
  return getUserData(userId).servers[guildId] ?? _defaultServer();
}

function hasCategory(userId, guildId) {
  return !!getServerData(userId, guildId).categoryId;
}

function createCategory(userId, guildId, categoryId) {
  const u = getUserData(userId);
  if (!u.servers[guildId]) u.servers[guildId] = _defaultServer();
  u.servers[guildId].categoryId = categoryId;
  _saveUser(userId, u);
}

function addChannel(userId, guildId, channelId) {
  const u = getUserData(userId);
  if (!u.servers[guildId]) u.servers[guildId] = _defaultServer();
  const server = u.servers[guildId];
  const num = server.channels.length + 1;
  server.channels.push({ num, channelId, machine: null, workers: 0, autoCollect: false });
  _saveUser(userId, u);
  return num;
}

function getChannels(userId, guildId) {
  return getServerData(userId, guildId).channels;
}

function getChannelByNum(userId, guildId, num) {
  return getServerData(userId, guildId).channels.find(c => c.num === num) ?? null;
}

function getUnassigned(userId) {
  return getUserData(userId).unassigned ?? 0;
}

function addUnassigned(userId) {
  const u = getUserData(userId);
  u.unassigned = (u.unassigned ?? 0) + 1;
  _saveUser(userId, u);
}

function getUnassignedWorkers(userId) {
  return getUserData(userId).unassignedWorkers ?? 0;
}

function addUnassignedWorker(userId) {
  const u = getUserData(userId);
  u.unassignedWorkers = (u.unassignedWorkers ?? 0) + 1;
  _saveUser(userId, u);
}

function getUnassignedCollectors(userId) {
  return getUserData(userId).unassignedCollectors ?? 0;
}

function addUnassignedCollector(userId) {
  const u = getUserData(userId);
  u.unassignedCollectors = (u.unassignedCollectors ?? 0) + 1;
  _saveUser(userId, u);
}

const MAX_WORKERS = 3;

function placeWorker(userId, guildId, channelNum) {
  const u = getUserData(userId);
  if ((u.unassignedWorkers ?? 0) < 1) return { error: "No unassigned workers in your inventory." };
  const server = u.servers[guildId];
  if (!server) return { error: "You don't have a mine category on this server." };
  const ch = server.channels.find(c => c.num === channelNum);
  if (!ch) return { error: `Channel #${channelNum} doesn't exist on this server.` };
  if (!ch.machine) return { error: `Channel #${channelNum} has no machine to assign a worker to.` };
  if ((ch.workers ?? 0) >= MAX_WORKERS) return { error: `Channel #${channelNum} already has the maximum of ${MAX_WORKERS} workers.` };
  ch.workers = (ch.workers ?? 0) + 1;
  u.unassignedWorkers -= 1;
  _saveUser(userId, u);
  return { workers: ch.workers, channelId: ch.channelId };
}

function placeCollector(userId, guildId, channelNum) {
  const u = getUserData(userId);
  if ((u.unassignedCollectors ?? 0) < 1) return { error: "No unassigned collectors in your inventory." };
  const server = u.servers[guildId];
  if (!server) return { error: "You don't have a mine category on this server." };
  const ch = server.channels.find(c => c.num === channelNum);
  if (!ch) return { error: `Channel #${channelNum} doesn't exist on this server.` };
  if (!ch.machine) return { error: `Channel #${channelNum} has no machine to attach a collector to.` };
  if (ch.autoCollect) return { error: `Channel #${channelNum} already has an Auto Collector.` };
  ch.autoCollect = true;
  u.unassignedCollectors -= 1;
  _saveUser(userId, u);
  return { channelId: ch.channelId };
}

function placeMachine(userId, guildId, channelNum) {
  const u = getUserData(userId);
  if ((u.unassigned ?? 0) < 1) return { error: "No unassigned machines in your inventory." };
  const server = u.servers[guildId];
  if (!server) return { error: "You don't have a mine category on this server." };
  const ch = server.channels.find(c => c.num === channelNum);
  if (!ch) return { error: `Channel #${channelNum} doesn't exist on this server.` };
  if (ch.machine) return { error: `Channel #${channelNum} already has a machine.` };
  const machine = { id: `m_${Date.now()}`, level: 1, lastCollect: Date.now(), messageId: null };
  ch.machine = machine;
  u.unassigned -= 1;
  _saveUser(userId, u);
  return { machine, channelId: ch.channelId };
}

function findMachineById(userId, machineId) {
  const u = getUserData(userId);
  for (const [guildId, server] of Object.entries(u.servers ?? {})) {
    for (const ch of server.channels ?? []) {
      if (ch.machine?.id === machineId) {
        return { machine: ch.machine, guildId, channelNum: ch.num, channelId: ch.channelId, workers: ch.workers ?? 0, autoCollect: ch.autoCollect ?? false };
      }
    }
  }
  return null;
}

function setMachineMessage(userId, machineId, messageId) {
  const u = getUserData(userId);
  for (const server of Object.values(u.servers ?? {})) {
    for (const ch of server.channels ?? []) {
      if (ch.machine?.id === machineId) {
        ch.machine.messageId = messageId;
        _saveUser(userId, u);
        return;
      }
    }
  }
}

function upgradeCost(level) {
  return Math.floor(2_000 * Math.pow(1.35, level - 1));
}

function earningsPerHour(level, workers = 0) {
  const base = Math.floor(400 * Math.pow(1.3, level - 1));
  const boost = 1 + (workers * 0.25);
  return Math.floor(base * boost);
}

function pendingEarnings(machine, workers = 0) {
  const maxHours = 24;
  const hours = Math.min((Date.now() - machine.lastCollect) / 3_600_000, maxHours);
  return Math.floor(hours * earningsPerHour(machine.level, workers));
}

function upgradeMachine(userId, machineId) {
  const u = getUserData(userId);
  for (const server of Object.values(u.servers ?? {})) {
    for (const ch of server.channels ?? []) {
      if (ch.machine?.id === machineId) {
        const m = ch.machine;
        if (m.level >= 30) return { error: "Already max level (30)!" };
        const cost = upgradeCost(m.level);
        m.level++;
        _saveUser(userId, u);
        return { machine: m, cost };
      }
    }
  }
  return { error: "Machine not found." };
}

function collectMachine(userId, machineId) {
  const u = getUserData(userId);
  for (const server of Object.values(u.servers ?? {})) {
    for (const ch of server.channels ?? []) {
      if (ch.machine?.id === machineId) {
        const m = ch.machine;
        const earned = pendingEarnings(m, ch.workers ?? 0);
        m.lastCollect = Date.now();
        _saveUser(userId, u);
        return { earned, machine: m };
      }
    }
  }
  return { error: "Machine not found." };
}

// Called by the auto-collect background job
// Returns array of { userId, earned }
function runAutoCollect() {
  const d = _read();
  const results = [];
  const AUTO_COLLECT_INTERVAL = 6 * 3_600_000; // 6 hours

  for (const [userId, userData] of Object.entries(d)) {
    for (const [guildId, server] of Object.entries(userData.servers ?? {})) {
      for (const ch of server.channels ?? []) {
        if (!ch.autoCollect || !ch.machine) continue;
        const timeSince = Date.now() - ch.machine.lastCollect;
        if (timeSince < AUTO_COLLECT_INTERVAL) continue;
        const earned = pendingEarnings(ch.machine, ch.workers ?? 0);
        if (earned <= 0) continue;
        ch.machine.lastCollect = Date.now();
        results.push({ userId, guildId, channelId: ch.channelId, channelNum: ch.num, machineId: ch.machine.id, earned });
      }
    }
  }

  if (results.length > 0) _write(d);
  return results;
}

module.exports = {
  getUserData, getServerData,
  hasCategory, createCategory,
  addChannel, getChannels, getChannelByNum,
  getUnassigned, addUnassigned, placeMachine,
  getUnassignedWorkers, addUnassignedWorker, placeWorker,
  getUnassignedCollectors, addUnassignedCollector, placeCollector,
  findMachineById, setMachineMessage,
  upgradeMachine, collectMachine, runAutoCollect,
  upgradeCost, earningsPerHour, pendingEarnings,
  MAX_WORKERS,
};
