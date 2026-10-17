const { ChannelType, PermissionsBitField, PermissionFlagsBits } = require("discord.js");
const { read, write, getUser, setUser } = require("../storage");
const crypto = require("crypto");
const { closest } = require("../util/resolve");

const STORE = "templates";
const LINKS = "tpl_links";
const MODES = ["roles", "channels", "bots", "emojis", "stickers"];

function listTemplates(userId) {
  return Object.values(getUser(STORE, userId, {}));
}

function getTemplate(userId, name) {
  return getUser(STORE, userId, {})[name];
}

// Exact name first, otherwise the closest saved name ("my servr" → "My Server").
function findTemplate(userId, name) {
  const all = getUser(STORE, userId, {});
  if (all[name]) return { tpl: all[name], name, guessed: false };
  const hit = closest(name, Object.keys(all));
  return hit ? { tpl: all[hit.value], name: hit.value, guessed: !hit.exact } : null;
}

function saveTemplate(guild, userId, name) {
  // Save bot entries: id, username, roles
  const botRoles = [];
  guild.members.cache
    .filter((m) => m.user.bot)
    .forEach((m) => {
      botRoles.push({
        botId:   m.user.id,
        botName: m.user.username,
        roles:   m.roles.cache
          .filter((r) => r.name !== "@everyone")
          .map((r) => r.name),
      });
    });

  const tpl = {
    name,
    createdAt: Date.now(),

    // ── Roles ──────────────────────────────────────────────────────────────
    roles: guild.roles.cache
      .filter((r) => r.name !== "@everyone" && !r.managed)
      .map((r) => ({
        name:        r.name,
        color:       r.color,
        hoist:       r.hoist,
        mentionable: r.mentionable,
        permissions: r.permissions.bitfield.toString(),
        position:    r.rawPosition,
      })),

    // ── Channels (with permission overwrites) ──────────────────────────────
    channels: guild.channels.cache.map((c) => ({
      id:       c.id,
      name:     c.name,
      type:     c.type,
      parentId: c.parentId,
      topic:    c.topic  ?? null,
      nsfw:     c.nsfw   ?? false,
      position: c.rawPosition,
      // Save permission overwrites with role names for cross-server portability
      permissionOverwrites: (c.permissionOverwrites?.cache ?? []).map
        ? [...(c.permissionOverwrites?.cache ?? new Map()).values()].map((ow) => ({
            id:       ow.id,
            type:     ow.type, // 0 = role, 1 = member
            allow:    ow.allow.bitfield.toString(),
            deny:     ow.deny.bitfield.toString(),
            roleName: ow.type === 0
              ? (guild.roles.cache.get(ow.id)?.name ?? null)
              : null,
          }))
        : [],
    })),

    botRoles,

    // ── Emojis ────────────────────────────────────────────────────────────────
    emojis: guild.emojis.cache.map((e) => ({
      name:      e.name,
      url:       e.imageURL({ extension: e.animated ? "gif" : "png" }),
      animated:  e.animated,
    })),

    // ── Stickers ──────────────────────────────────────────────────────────────
    // Skip Lottie (format 3) — those are JSON animation files, not images, and can't be re-uploaded this way.
    stickers: guild.stickers.cache
      .filter((s) => s.type === 2 && s.format !== 3) // type 2 = GUILD sticker (uploaded by this server)
      .map((s) => ({
        name:        s.name,
        description: s.description ?? "",
        tags:        s.tags ?? "",
        url:         s.url,
        format:      s.format, // 1=PNG, 2=APNG, 4=GIF
      })),
  };

  const all = getUser(STORE, userId, {});
  all[name] = tpl;
  setUser(STORE, userId, all);
  return tpl;
}

// Accepts the last arg as either a single mode ("roles"), a comma-separated
// list ("roles,channels,stickers"), or omitted entirely (defaults to "full").
// Returns { modes: string[], name } where modes always contains at least one entry.
function parseModeAndName(args) {
  const last = args[args.length - 1] ?? "";
  const candidateModes = last
    .toLowerCase()
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const allValid = candidateModes.length > 0 && candidateModes.every((m) => MODES.includes(m));

  if (allValid) {
    return { modes: candidateModes, name: args.slice(0, -1).join(" ") };
  }
  return { modes: ["full"], name: args.join(" ") };
}

// Backwards-compatible single-mode check used by applyTemplate's per-section gates.
function modeIncludes(modes, section) {
  return modes.includes("full") || modes.includes(section);
}

// Build an OAuth2 bot-invite URL for a given bot client ID
function botInviteUrl(botId, permissions = 8n) {
  return `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot%20applications.commands&permissions=${permissions}`;
}

// Runs `fn` over `items` with at most `limit` in flight. Keeps result order.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const failReason = (err) => (err?.message?.includes("Maximum") ? "slot limit reached" : "failed");

// Create saved channels (categories first, then the rest) in parallel batches,
// then put them back in their saved order. `existingRoles` maps role name → Role.
async function createChannels(guild, tpl, roleMap, reason) {
  const idMap = new Map(); // old channel id → new channel id
  const byPos = (a, b) => a.position - b.position;

  const cats = (tpl.channels ?? []).filter((c) => c.type === ChannelType.GuildCategory).sort(byPos);
  const catsMade = await pool(cats, 5, (c) => {
    const ow = buildOverwrites(c, guild, roleMap);
    return guild.channels.create({
      name: c.name,
      type: ChannelType.GuildCategory,
      ...(ow.length ? { permissionOverwrites: ow } : {}),
      reason,
    }).catch(() => null);
  });
  cats.forEach((c, i) => catsMade[i] && idMap.set(c.id, catsMade[i].id));

  const others = (tpl.channels ?? []).filter((c) => c.type !== ChannelType.GuildCategory).sort(byPos);
  const othersMade = await pool(others, 6, (c) => {
    const ow = buildOverwrites(c, guild, roleMap);
    const parent = c.parentId ? (idMap.get(c.parentId) ?? undefined) : undefined;
    return guild.channels.create({
      name: c.name,
      type: c.type,
      parent,
      topic: c.topic ?? undefined,
      nsfw: c.nsfw ?? false,
      ...(ow.length ? { permissionOverwrites: ow } : {}),
      reason,
    }).catch(() => null);
  });

  // Parallel creation finishes in random order, so restore the saved order in ONE call.
  const positions = [];
  catsMade.forEach((ch, i) => ch && positions.push({ channel: ch.id, position: i }));
  const groups = new Map(); // old parent id → running index
  others.forEach((c, i) => {
    const ch = othersMade[i];
    if (!ch) return;
    const key = c.parentId ?? "root";
    const idx = groups.get(key) ?? 0;
    groups.set(key, idx + 1);
    positions.push({ channel: ch.id, position: idx });
  });
  if (positions.length) await guild.channels.setPositions(positions).catch(() => {});

  return {
    cats: { made: catsMade, src: cats },
    others: { made: othersMade, src: others },
    added: catsMade.filter(Boolean).length + othersMade.filter(Boolean).length,
    failed: [
      ...cats.filter((_, i) => !catsMade[i]).map((c) => ({ name: c.name, reason: "failed" })),
      ...others.filter((_, i) => !othersMade[i]).map((c) => ({ name: c.name, reason: "failed" })),
    ],
  };
}

async function createEmojis(guild, list, reason, skipNames = new Set()) {
  const result = { added: 0, failed: [] };
  await pool(list ?? [], 4, async (e) => {
    if (skipNames.has(e.name)) { result.failed.push({ name: e.name, reason: "already exists" }); return; }
    try {
      await guild.emojis.create({ attachment: e.url, name: e.name, reason });
      result.added++;
    } catch (err) {
      result.failed.push({ name: e.name, reason: failReason(err) });
    }
  });
  return result;
}

async function createStickers(guild, list, reason, skipNames = new Set()) {
  const result = { added: 0, failed: [] };
  await pool(list ?? [], 3, async (s) => {
    if (skipNames.has(s.name)) { result.failed.push({ name: s.name, reason: "already exists" }); return; }
    try {
      await guild.stickers.create({
        file: s.url, name: s.name, tags: s.tags || s.name,
        description: s.description || undefined, reason,
      });
      result.added++;
    } catch (err) {
      result.failed.push({ name: s.name, reason: failReason(err) });
    }
  });
  return result;
}

async function applyTemplate(guild, tpl, modes = ["full"], owner = null) {
  // Accept a plain string for backwards compatibility with any old call sites.
  if (typeof modes === "string") modes = [modes];
  const reason = `Template load: ${tpl.name}`;

  // ── CLEAR old stuff — every category at the same time, items in parallel ──
  const clears = [];
  if (modeIncludes(modes, "channels")) {
    clears.push(pool([...guild.channels.cache.values()], 8, (ch) => ch.delete(reason).catch(() => {})));
  }
  if (modeIncludes(modes, "roles")) {
    clears.push(pool(
      [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && r.name !== "@everyone" && !r.managed),
      6, (r) => r.delete(reason).catch(() => {})
    ));
  }
  if (modeIncludes(modes, "emojis")) {
    clears.push(pool([...guild.emojis.cache.values()], 6, (e) => e.delete(reason).catch(() => {})));
  }
  if (modeIncludes(modes, "stickers")) {
    // never touch standard/Nitro pack stickers
    clears.push(pool([...guild.stickers.cache.values()].filter((s) => s.type === 2), 6, (s) => s.delete(reason).catch(() => {})));
  }
  await Promise.all(clears);

  // ── CREATE roles (order is fixed afterwards by setPositions, so go parallel) ──
  const roleMap = new Map(); // roleName → Role
  if (modeIncludes(modes, "roles") || modes.includes("bots")) {
    const made = await pool(tpl.roles ?? [], 5, (r) =>
      guild.roles.create({
        name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
        permissions: new PermissionsBitField(BigInt(r.permissions)),
        reason,
      }).catch(() => null)
    );
    (tpl.roles ?? []).forEach((r, i) => made[i] && roleMap.set(r.name, made[i]));

    // Normalised sequential ranks keep the relative order and stay under the bot's own ceiling.
    const positionData = [...(tpl.roles ?? [])]
      .sort((a, b) => a.position - b.position)
      .reduce((acc, r, idx) => {
        const role = roleMap.get(r.name);
        if (role) acc.push({ role: role.id, position: idx + 1 });
        return acc;
      }, []);
    if (positionData.length) await guild.roles.setPositions(positionData).catch(() => {});
  }

  // ── Channels, emojis, stickers and bot roles don't depend on each other: run together ──
  const missingBots = [];
  const jobs = {};

  if (modeIncludes(modes, "channels")) {
    jobs.channels = createChannels(guild, tpl, roleMap, reason);
  }
  if (modeIncludes(modes, "emojis") && tpl.emojis?.length) {
    jobs.emojis = createEmojis(guild, tpl.emojis, reason);
  }
  if (modeIncludes(modes, "stickers") && tpl.stickers?.length) {
    jobs.stickers = createStickers(guild, tpl.stickers, reason);
  }
  if (modeIncludes(modes, "bots") && tpl.botRoles?.length) {
    jobs.bots = (async () => {
      await guild.members.fetch();
      await pool(tpl.botRoles, 5, async (entry) => {
        const member = guild.members.cache.get(entry.botId);
        if (!member) { missingBots.push(entry); return; }
        const roles = entry.roles
          .map((name) => roleMap.get(name) ?? guild.roles.cache.find((r) => r.name === name))
          .filter(Boolean);
        if (roles.length) await member.roles.add(roles).catch(() => {});
      });
    })();
  }

  await Promise.all(Object.values(jobs));
  const emojiResult   = (await jobs.emojis)   ?? { added: 0, failed: [] };
  const stickerResult = (await jobs.stickers) ?? { added: 0, failed: [] };

  // ── DM owner when done ───────────────────────────────────────────────────
  if (owner) {
    const labelMap = { roles: "roles", channels: "channels", bots: "bot roles", emojis: "emojis", stickers: "stickers" };
    const modeLabel = modes.includes("full")
      ? "everything (roles, channels, bots, emojis & stickers)"
      : modes.map((m) => labelMap[m] ?? m).join(", ");

    let inviteSection = "";
    if (missingBots.length) {
      const links = missingBots.map((b) => `• **${b.botName}** → ${botInviteUrl(b.botId)}`).join("\n");
      inviteSection = `\n\n**⚠️ Missing bots — invite them manually:**\n${links}`;
    }

    const section = (icon, label, r) => {
      if (!r.added && !r.failed.length) return "";
      let s = `\n\n**${icon} ${label}:** ${r.added} added`;
      if (r.failed.length) s += `, ${r.failed.length} failed (${r.failed.map((f) => `${f.name}: ${f.reason}`).join(", ")})`;
      return s;
    };

    await owner.send({
      embeds: [{
        title:       "✅  Template Load Complete",
        description: `**${tpl.name}** finished loading on **${guild.name}**.\nLoaded: **${modeLabel}**${inviteSection}${section("😀", "Emojis", emojiResult)}${section("🏷️", "Stickers", stickerResult)}`,
        color:       0x57F287,
        timestamp:   new Date().toISOString(),
      }],
    }).catch(() => {});
  }

  return { missingBots, emojiResult, stickerResult };
}

// ── Additive apply — never deletes/touches anything currently in the server ──
// Only adds the template's items for the given categories on top of what's already there.
async function applyTemplateAdditive(guild, tpl, categories) {
  const results = {};
  const reason = `Template add: ${tpl.name}`;
  const jobs = [];

  // Roles first (channels need them for permission overwrites)
  if (categories.includes("roles")) {
    const existingNames = new Set(guild.roles.cache.map((r) => r.name));
    const failed = [];
    let added = 0;
    await pool(tpl.roles ?? [], 5, async (r) => {
      if (existingNames.has(r.name)) { failed.push({ name: r.name, reason: "already exists" }); return; }
      try {
        await guild.roles.create({
          name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
          permissions: new PermissionsBitField(BigInt(r.permissions)), reason,
        });
        added++;
      } catch { failed.push({ name: r.name, reason: "failed" }); }
    });
    results.roles = { added, failed };
  }

  if (categories.includes("channels")) {
    jobs.push((async () => {
      const roleMap = new Map(guild.roles.cache.map((r) => [r.name, r]));
      const { added, failed } = await createChannels(guild, tpl, roleMap, reason);
      results.channels = { added, failed };
    })());
  }

  if (categories.includes("bots")) {
    jobs.push((async () => {
      await guild.members.fetch();
      const roleMap = new Map(guild.roles.cache.map((r) => [r.name, r]));
      let added = 0;
      const failed = [];
      await pool(tpl.botRoles ?? [], 5, async (entry) => {
        const member = guild.members.cache.get(entry.botId);
        if (!member) { failed.push({ name: entry.botName, reason: "bot not in this server" }); return; }
        const roles = entry.roles.map((n) => roleMap.get(n)).filter((r) => r && !member.roles.cache.has(r.id));
        if (roles.length) { await member.roles.add(roles).catch(() => {}); added++; }
      });
      results.bots = { added, failed };
    })());
  }

  if (categories.includes("emojis")) {
    jobs.push(createEmojis(guild, tpl.emojis, reason, new Set(guild.emojis.cache.map((e) => e.name))).then((r) => { results.emojis = r; }));
  }
  if (categories.includes("stickers")) {
    jobs.push(createStickers(guild, tpl.stickers, reason, new Set(guild.stickers.cache.map((s) => s.name))).then((r) => { results.stickers = r; }));
  }

  await Promise.all(jobs);
  return results;
}

// Build a permission-overwrite array for a channel from saved data
function buildOverwrites(savedChannel, guild, roleMap) {
  if (!savedChannel.permissionOverwrites?.length) return [];

  const overwrites = [];
  for (const ow of savedChannel.permissionOverwrites) {
    if (ow.type !== 0) continue; // skip member overwrites (can't map cross-server)

    let targetId;
    if (ow.roleName === "@everyone") {
      targetId = guild.roles.everyone.id;
    } else if (ow.roleName) {
      const role = roleMap.get(ow.roleName)
        ?? guild.roles.cache.find((r) => r.name === ow.roleName);
      if (!role) continue;
      targetId = role.id;
    } else {
      continue;
    }

    overwrites.push({
      id:    targetId,
      allow: BigInt(ow.allow),
      deny:  BigInt(ow.deny),
    });
  }
  return overwrites;
}

async function loadTemplate(guild, userId, name, modes = ["full"], owner = null) {
  const tpl = findTemplate(userId, name)?.tpl;
  if (!tpl) throw new Error(`Template **${name}** not found in your account.`);
  const result = await applyTemplate(guild, tpl, modes, owner);
  return { tpl, ...result };
}

// Purely additive — never deletes/touches anything currently in the server.
async function addToServer(guild, userId, name, categories) {
  const tpl = findTemplate(userId, name)?.tpl;
  if (!tpl) throw new Error(`Template **${name}** not found in your account.`);
  const results = await applyTemplateAdditive(guild, tpl, categories);
  return { tpl, results };
}

// ── One-time share links ──────────────────────────────────────────────────────
function generateLink(userId, templateName) {
  const found = findTemplate(userId, templateName);
  if (!found) return null;
  templateName = found.name;
  const code  = crypto.randomBytes(6).toString("hex");
  const links = read(LINKS, {});
  links[code] = { userId, templateName, used: false, createdAt: Date.now() };
  write(LINKS, links);
  return code;
}

function useLink(code) {
  const links = read(LINKS, {});
  const entry = links[code];
  if (!entry)       return { error: "Invalid or expired link." };
  if (entry.used)   return { error: "This link has already been used." };
  const tpl = getTemplate(entry.userId, entry.templateName);
  if (!tpl)         return { error: "The template this link points to no longer exists." };
  links[code].used = true;
  write(LINKS, links);
  return { tpl };
}

function deleteTemplate(userId, name) {
  const all = getUser(STORE, userId, {});
  if (!all[name]) return false;
  delete all[name];
  setUser(STORE, userId, all);
  return true;
}

module.exports = {
  saveTemplate, loadTemplate, addToServer, listTemplates, getTemplate, findTemplate, deleteTemplate,
  generateLink, useLink, applyTemplate, applyTemplateAdditive, parseModeAndName, MODES,
};