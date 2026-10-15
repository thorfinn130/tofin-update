const { read, write } = require("../storage");

const STORE = "economy";
const DAILY_AMOUNT = 500;
const DAILY_COOLDOWN = 86_400_000;
const WORK_COOLDOWN = 3_600_000;
const WORK_MIN = 50;
const WORK_MAX = 200;

const WORK_MESSAGES = [
  "You delivered pizzas", "You fixed some code", "You walked dogs",
  "You streamed for 2 hours", "You sold lemonade", "You did freelance design",
  "You wrote a blog post", "You tutored a student",
];

function _read() { return read(STORE, {}); }
function _write(data) { write(STORE, data); }

function getUser(userId) {
  const data = _read();
  return data[userId] ?? { wallet: 0, bank: 0, lastDaily: 0, lastWork: 0 };
}

function setUser(userId, user) {
  const data = _read();
  data[userId] = user;
  _write(data);
}

function addWallet(userId, amount) {
  const u = getUser(userId);
  u.wallet += amount;
  setUser(userId, u);
  return u;
}

function removeWallet(userId, amount) {
  const u = getUser(userId);
  if (u.wallet < amount) return null;
  u.wallet -= amount;
  setUser(userId, u);
  return u;
}

function deposit(userId, amount) {
  const u = getUser(userId);
  if (u.wallet < amount) return null;
  u.wallet -= amount;
  u.bank += amount;
  setUser(userId, u);
  return u;
}

function withdraw(userId, amount) {
  const u = getUser(userId);
  if (u.bank < amount) return null;
  u.bank -= amount;
  u.wallet += amount;
  setUser(userId, u);
  return u;
}

function transfer(fromId, toId, amount) {
  const from = getUser(fromId);
  if (from.wallet < amount) return null;
  from.wallet -= amount;
  setUser(fromId, from);
  const to = getUser(toId);
  to.wallet += amount;
  setUser(toId, to);
  return { from, to };
}

function claimDaily(userId) {
  const u = getUser(userId);
  const now = Date.now();
  const remaining = DAILY_COOLDOWN - (now - u.lastDaily);
  if (remaining > 0) return { cooldown: remaining };
  u.wallet += DAILY_AMOUNT;
  u.lastDaily = now;
  setUser(userId, u);
  return { amount: DAILY_AMOUNT, u };
}

function claimWork(userId) {
  const u = getUser(userId);
  const now = Date.now();
  const remaining = WORK_COOLDOWN - (now - u.lastWork);
  if (remaining > 0) return { cooldown: remaining };
  const amount = Math.floor(Math.random() * (WORK_MAX - WORK_MIN + 1)) + WORK_MIN;
  const msg = WORK_MESSAGES[Math.floor(Math.random() * WORK_MESSAGES.length)];
  u.wallet += amount;
  u.lastWork = now;
  setUser(userId, u);
  return { amount, msg, u };
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

function fmtTime(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function addBank(userId, amount) {
  const u = getUser(userId);
  u.bank += amount;
  setUser(userId, u);
  return u;
}

function setWallet(userId, amount) {
  const u = getUser(userId);
  u.wallet = Math.max(0, amount);
  setUser(userId, u);
  return u;
}

function setBank(userId, amount) {
  const u = getUser(userId);
  u.bank = Math.max(0, amount);
  setUser(userId, u);
  return u;
}

module.exports = {
  getUser, setUser,
  addWallet, addBank, removeWallet, setWallet, setBank,
  deposit, withdraw, transfer,
  claimDaily, claimWork,
  fmt, fmtTime,
};
