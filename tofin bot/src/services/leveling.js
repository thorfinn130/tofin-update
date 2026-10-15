const { read, write } = require("../storage");
const { hasBuff } = require("./buffs");

const STORE = "leveling";
const JOBS_STORE = "custom_jobs";
const XP_PER_MSG = 15;
const XP_COOLDOWN = 30_000;
const xpCooldowns = new Map();

function xpNeeded(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

function defaultUser() {
  return { xp: 0, level: 1, statPoints: 0, stats: { str: 0, int: 0, cha: 0, lck: 0 }, job: null };
}

function _read() { return read(STORE, {}); }
function _write(d) { write(STORE, d); }

function getUser(guildId, userId) {
  const d = _read();
  return d[guildId]?.[userId] ?? defaultUser();
}

function setUser(guildId, userId, u) {
  const d = _read();
  if (!d[guildId]) d[guildId] = {};
  d[guildId][userId] = u;
  _write(d);
}

// Admin setters
function adminSetLevel(guildId, userId, level) {
  const u = getUser(guildId, userId);
  u.level = Math.max(1, parseInt(level) || 1);
  u.xp = 0;
  setUser(guildId, userId, u);
  return u;
}

function adminSetStat(guildId, userId, stat, value) {
  const STATS = ["str", "int", "cha", "lck"];
  if (!STATS.includes(stat)) return null;
  const u = getUser(guildId, userId);
  u.stats[stat] = Math.max(0, parseInt(value) || 0);
  setUser(guildId, userId, u);
  return u;
}

function adminSetStatPoints(guildId, userId, points) {
  const u = getUser(guildId, userId);
  u.statPoints = Math.max(0, parseInt(points) || 0);
  setUser(guildId, userId, u);
  return u;
}

// Returns { leveled: bool, level, statPoints } or null if on cooldown
function addXP(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  if (xpCooldowns.has(key) && now - xpCooldowns.get(key) < XP_COOLDOWN) return null;
  xpCooldowns.set(key, now);

  const u = getUser(guildId, userId);
  const xpGain = hasBuff(guildId, userId, "xp_boost") ? XP_PER_MSG * 2 : XP_PER_MSG;
  u.xp += xpGain;
  let leveled = false;
  while (u.xp >= xpNeeded(u.level)) {
    u.xp -= xpNeeded(u.level);
    u.level++;
    u.statPoints += 3;
    leveled = true;
  }
  setUser(guildId, userId, u);
  return { leveled, level: u.level, statPoints: u.statPoints };
}

// Multi-stat upgrade: upgrades is { str: 2, int: 1 } etc.
// bypassPoints = true skips the point cost check (owner only)
function upgradeStats(guildId, userId, upgrades, bypassPoints = false) {
  const VALID = ["str", "int", "cha", "lck"];
  const invalid = Object.keys(upgrades).filter(s => !VALID.includes(s));
  if (invalid.length) return { error: `Invalid stat(s): ${invalid.join(", ")}. Choose: \`str\` · \`int\` · \`cha\` · \`lck\`` };
  const total = Object.values(upgrades).reduce((a, b) => a + b, 0);
  const u = getUser(guildId, userId);
  if (!bypassPoints && u.statPoints < total) return { error: `You need **${total} stat point${total !== 1 ? "s" : ""}** but only have **${u.statPoints}**.` };
  for (const [stat, amt] of Object.entries(upgrades)) {
    u.stats[stat] = (u.stats[stat] || 0) + amt;
  }
  if (!bypassPoints) u.statPoints -= total;
  setUser(guildId, userId, u);
  return { u, upgrades, total };
}

function xpBar(xp, needed) {
  const pct = Math.min(xp / needed, 1);
  const filled = Math.round(pct * 12);
  return `${"█".repeat(filled)}${"░".repeat(12 - filled)} ${Math.round(pct * 100)}%`;
}

// ---- BUILT-IN JOBS ----
const BUILTIN_JOBS = [
  { id: "pizza",      name: "Pizza Delivery",   emoji: "🍕", level: 1,  stats: {},                    min: 50,   max: 150  },
  { id: "fastfood",   name: "Fast Food Worker",  emoji: "🍔", level: 3,  stats: {},                    min: 100,  max: 250  },
  { id: "driver",     name: "Truck Driver",      emoji: "🚛", level: 5,  stats: { str: 3 },            min: 200,  max: 400  },
  { id: "security",   name: "Security Guard",    emoji: "🛡️", level: 8,  stats: { str: 5 },            min: 250,  max: 450  },
  { id: "teacher",    name: "Teacher",           emoji: "📚", level: 10, stats: { int: 3 },            min: 300,  max: 500  },
  { id: "programmer", name: "Programmer",        emoji: "💻", level: 15, stats: { int: 8 },            min: 450,  max: 700  },
  { id: "doctor",     name: "Doctor",            emoji: "🏥", level: 20, stats: { int: 15 },           min: 600,  max: 900  },
  { id: "lawyer",     name: "Lawyer",            emoji: "⚖️", level: 25, stats: { int: 12, cha: 8 },  min: 700,  max: 1000 },
  { id: "celebrity",  name: "Celebrity",         emoji: "🌟", level: 30, stats: { cha: 20 },           min: 900,  max: 1400 },
  { id: "ceo",        name: "CEO",               emoji: "💼", level: 50, stats: { int: 20, cha: 15 }, min: 1200, max: 2000 },
];

// ---- CUSTOM JOBS ----
function getCustomJobs() { return read(JOBS_STORE, []); }
function saveCustomJobs(jobs) { write(JOBS_STORE, jobs); }

function getAllJobs() {
  return [...BUILTIN_JOBS, ...getCustomJobs()];
}

function getJob(id) { return getAllJobs().find(j => j.id === id); }

function addCustomJob(job) {
  const jobs = getCustomJobs();
  const existing = jobs.findIndex(j => j.id === job.id);
  if (existing >= 0) jobs[existing] = job;
  else jobs.push(job);
  saveCustomJobs(jobs);
}

function removeCustomJob(id) {
  const jobs = getCustomJobs().filter(j => j.id !== id);
  saveCustomJobs(jobs);
}

function editCustomJob(id, fields) {
  const jobs = getCustomJobs();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx < 0) return false;
  jobs[idx] = { ...jobs[idx], ...fields };
  saveCustomJobs(jobs);
  return jobs[idx];
}

function addJobStatReq(id, stat, value) {
  const jobs = getCustomJobs();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx < 0) return false;
  jobs[idx].stats = jobs[idx].stats || {};
  jobs[idx].stats[stat] = value;
  saveCustomJobs(jobs);
  return jobs[idx];
}

function removeJobStatReq(id, stat) {
  const jobs = getCustomJobs();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx < 0) return false;
  delete jobs[idx].stats[stat];
  saveCustomJobs(jobs);
  return jobs[idx];
}

function meetsRequirements(user, job) {
  if (user.level < job.level) return false;
  for (const [stat, req] of Object.entries(job.stats || {})) {
    if ((user.stats[stat] ?? 0) < req) return false;
  }
  return true;
}

function applyJob(guildId, userId, jobId) {
  const job = getJob(jobId);
  if (!job) return { error: `Job \`${jobId}\` not found. Use \`,tjobs list\` to see available jobs.` };
  const u = getUser(guildId, userId);
  if (!meetsRequirements(u, job)) {
    const reqs = [`Level **${job.level}**`, ...Object.entries(job.stats || {}).map(([s, v]) => `**${s.toUpperCase()} ${v}**`)];
    return { error: `You don't meet the requirements: ${reqs.join(", ")}` };
  }
  u.job = jobId;
  setUser(guildId, userId, u);
  return { job, u };
}

function workWithJob(guildId, userId) {
  const u = getUser(guildId, userId);
  if (!u.job) return null;
  const job = getJob(u.job);
  if (!job) return null;
  const amount = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
  return { job, amount };
}

module.exports = {
  getUser, setUser, addXP, upgradeStats, xpNeeded, xpBar,
  getAllJobs, getJob, getCustomJobs,
  addCustomJob, removeCustomJob, editCustomJob, addJobStatReq, removeJobStatReq,
  meetsRequirements, applyJob, workWithJob,
  adminSetLevel, adminSetStat, adminSetStatPoints,
};
