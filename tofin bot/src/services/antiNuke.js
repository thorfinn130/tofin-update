// Simple anti-nuke: tracks rapid channel/role deletions per actor.
// If threshold exceeded, strip their roles and alert the owner.
const buckets = new Map(); // key: `${guildId}:${userId}` -> [timestamps]
const WINDOW_MS = 10_000;
const THRESHOLD = 4;

async function trackDestructive(guild, executorId, kind) {
  if (!executorId) return;
  const key = `${guild.id}:${executorId}`;
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  buckets.set(key, arr);

  if (arr.length >= THRESHOLD) {
    buckets.delete(key);
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (member && member.id !== guild.ownerId) {
      await member.roles.set([], "Anti-nuke triggered").catch(() => {});
    }
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner) {
      owner
        .send(`🚨 Anti-nuke triggered in **${guild.name}** by <@${executorId}> (${kind}).`)
        .catch(() => {});
    }
  }
}

function register(client) {
  client.on("channelDelete", async (channel) => {
    if (!channel.guild) return;
    const log = await channel.guild.fetchAuditLogs({ type: 12, limit: 1 }).catch(() => null);
    const entry = log?.entries.first();
    if (entry && entry.executor?.id !== client.user.id) {
      trackDestructive(channel.guild, entry.executor?.id, "channelDelete");
    }
  });
  client.on("roleDelete", async (role) => {
    const log = await role.guild.fetchAuditLogs({ type: 32, limit: 1 }).catch(() => null);
    const entry = log?.entries.first();
    if (entry && entry.executor?.id !== client.user.id) {
      trackDestructive(role.guild, entry.executor?.id, "roleDelete");
    }
  });
}

module.exports = { register };
