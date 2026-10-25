const fs = require("fs");
const path = require("path");
const { prefix } = require("../config");
const { handleTriggers } = require("../util/greeting");

const commands = new Map();

function loadCommands() {
  const dir = path.join(__dirname, "..", "commands", "prefix");
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const cmd = require(path.join(dir, file));
    commands.set(cmd.name, cmd);
    (cmd.aliases ?? []).forEach((a) => commands.set(a, cmd));
  }
}

async function handle(message) {
  if (message.author.bot || !message.guild) return;

  // Checks every word trigger defined in src/util/greeting.js (hello, there, etc.)
  // Add more slots there — nothing here needs to change.
  try {
    const handled = await handleTriggers(message);
    if (handled) return;
  } catch (err) {
    console.error("trigger error:", err);
  }

  if (!message.content.startsWith(prefix)) return;

  let [raw, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
  raw = raw?.toLowerCase();

  // ── Alias resolution ──────────────────────────────────────────────────────
  try {
    const { resolveAlias } = require("../services/alias");
    const aliasExpansion = resolveAlias(message.guild.id, raw);
    if (aliasExpansion) {
      const parts = aliasExpansion.trim().split(/\s+/);
      raw  = parts[0].toLowerCase();
      args = [...parts.slice(1), ...args];
    }
  } catch {}

  const cmd = commands.get(raw);
  if (!cmd) return;

  try {
    await cmd.run(message, args);
  } catch (err) {
    console.error(err);
    message.reply(`❌ ${err.message ?? "Command failed"}`).catch(() => {});
  }
}

function getCommand(name) {
  return commands.get(String(name).toLowerCase());
}

function commandNames() {
  return [...new Set([...commands.values()].map((c) => c.name))];
}

module.exports = { loadCommands, handle, getCommand, commandNames };