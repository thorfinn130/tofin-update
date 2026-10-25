// Forgiving member / role lookup: mentions, IDs, exact names, partial names and typos.

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// Damerau–Levenshtein (optimal string alignment): counts a swap like "jhon"→"john" as 1 edit.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// 0..100. 100 = identical (ignoring case/symbols).
function score(query, name) {
  const q = norm(query);
  const n = norm(name);
  if (!q || !n) return 0;
  if (q === n) return 100;
  if (n.startsWith(q)) return 90 - Math.min(10, n.length - q.length);
  if (n.includes(q)) return 75 - Math.min(10, n.length - q.length);
  if (q.length >= 3 && q.includes(n) && n.length >= 3) return 60;
  const sim = 1 - levenshtein(q, n) / Math.max(q.length, n.length);
  // also compare against a same-length prefix, so "moderatr" ~ "moderator-team"
  const pre = n.slice(0, q.length);
  const simPre = pre.length ? 1 - levenshtein(q, pre) / Math.max(q.length, pre.length) : 0;
  const best = Math.max(sim, simPre * 0.9);
  return best >= 0.6 ? Math.round(best * 55) : 0; // 33..55
}

function pickBest(query, items, namesOf) {
  let best = null;
  let second = 0;
  for (const item of items) {
    let s = 0;
    for (const name of namesOf(item)) s = Math.max(s, score(query, name));
    if (s > (best?.score ?? 0)) {
      second = best?.score ?? 0;
      best = { item, score: s };
    } else if (s > second) {
      second = s;
    }
  }
  if (!best || best.score === 0) return null;
  return { item: best.item, score: best.score, exact: best.score === 100, ambiguous: second >= best.score - 2 && second > 0 };
}

async function allMembers(guild) {
  if (guild.members.cache.size < Math.max(2, guild.memberCount * 0.9)) {
    await Promise.race([
      guild.members.fetch().catch(() => {}),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
  }
  return [...guild.members.cache.values()];
}

// Returns { member, guessed } or null
async function resolveMember(guild, input, { allowBots = true } = {}) {
  if (!input) return null;
  const id = String(input).match(/^<@!?(\d{15,25})>$/)?.[1] ?? (/^\d{15,25}$/.test(input) ? input : null);
  if (id) {
    const m = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
    return m ? { member: m, guessed: false } : null;
  }

  const query = String(input).replace(/^@/, "");
  const pool = (await allMembers(guild)).filter((m) => allowBots || !m.user.bot);
  const hit = pickBest(query, pool, (m) => [m.displayName, m.user.username, m.user.globalName ?? ""]);
  if (!hit) return null;
  return { member: hit.item, guessed: !hit.exact, score: hit.score };
}

// Returns { role, guessed } or null
function resolveRole(guild, input) {
  if (!input) return null;
  const id = String(input).match(/^<@&(\d{15,25})>$/)?.[1] ?? (/^\d{15,25}$/.test(input) ? input : null);
  if (id) {
    const r = guild.roles.cache.get(id);
    return r ? { role: r, guessed: false } : null;
  }
  const query = String(input).replace(/^@/, "");
  const pool = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id);
  const hit = pickBest(query, pool, (r) => [r.name]);
  if (!hit) return null;
  return { role: hit.item, guessed: !hit.exact, score: hit.score };
}

// Suggest the closest of several plain strings (subcommands, preset names...)
function closest(input, options) {
  const hit = pickBest(input, options, (o) => [o]);
  return hit ? { value: hit.item, exact: hit.exact } : null;
}

// For commands shaped like `<user> <rest...>`: mention, ID, or name (first word).
async function memberFromArgs(message, args, index = 0, opts) {
  const mentioned = message.mentions.members?.first();
  if (mentioned && /^<@!?\d+>$/.test(args[index] ?? "")) return { member: mentioned, guessed: false };
  return resolveMember(message.guild, args[index], opts);
}

// For commands shaped like `<role...>`: mention or name (one or more words).
function roleFromArgs(message, args, from = 0) {
  const mentioned = message.mentions.roles?.first();
  if (mentioned) return { role: mentioned, guessed: false };
  const text = args.slice(from).join(" ").trim();
  return resolveRole(message.guild, text);
}

const guessNote = (what, typed, got) => `\n> 🔎 I guessed **${got}** from "${typed}".`;

module.exports = {
  score, closest, resolveMember, resolveRole, memberFromArgs, roleFromArgs, guessNote, norm,
};
