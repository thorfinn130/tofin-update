// Tools the AI can call to actually DO things on the server.
//
// Safety model (every tool follows it):
//  • The invoking user must hold the Discord permission for the action — the AI can never
//    do something the person couldn't do by hand.
//  • The bot itself must hold the permission too, and role hierarchy is respected.
//  • Destructive or bulk actions (delete, kick, ban, purge, whole-server layouts) are NOT run
//    straight away: the bot posts Confirm / Cancel buttons and only the invoker can press them.
//  • Tool results are plain strings the model reads back; errors come back as readable text.

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: P, PermissionsBitField,
} = require("discord.js");
const { resolveMember, resolveRole, resolveChannel } = require("../../util/resolve");
const { webSearch, calculate } = require("./web");
const { PRESETS, PRESET_NAMES, STAFF_ROLE_NAMES } = require("./knowledge");

// ── schemas ──────────────────────────────────────────────────────────────────
const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const S = (description) => ({ type: "string", description });
const N = (description) => ({ type: "number", description });
const B = (description) => ({ type: "boolean", description });

const CHANNEL_KINDS = ["text", "voice", "category", "forum", "announcement", "stage"];
const SERVER_TOOLS = [
  fn("create_channel", "Create ONE channel or category in this server.", {
    name: S("channel name"), type: { type: "string", enum: CHANNEL_KINDS, description: "default text" },
    category: S("existing category name to put it in (optional)"), topic: S("topic (text channels)"),
    private: B("hide from @everyone"), readonly: B("@everyone can read but not send"),
  }, ["name"]),
  fn("create_role", "Create a role.", {
    name: S("role name"), color: S("hex colour like #ff0000 or a colour name"), hoist: B("show separately in the member list"),
    mentionable: B("anyone can ping it"), permissions: { type: "array", items: { type: "string" }, description: "Discord permission names, e.g. KickMembers, ManageMessages" },
  }, ["name"]),
  fn("edit_channel", "Rename, set topic/slowmode, move, lock or unlock an existing channel.", {
    channel: S("channel name or mention"), name: S("new name"), topic: S("new topic"), slowmode_seconds: N("0-21600"),
    nsfw: B("set NSFW flag"), category: S("move into this category name"), lock: B("true = @everyone can't send, false = unlock"),
  }, ["channel"]),
  fn("member_role", "Add or remove a role from a member.", {
    member: S("member name or mention"), role: S("role name or mention"), action: { type: "string", enum: ["add", "remove"] },
  }, ["member", "role", "action"]),
  fn("set_nickname", "Change a member's nickname (empty string resets it).", { member: S("member"), nickname: S("new nickname") }, ["member", "nickname"]),
  fn("moderate_member", "Timeout, untimeout, kick, ban or unban someone. Kick/ban need button confirmation.", {
    member: S("member name/mention (or user ID for unban)"), action: { type: "string", enum: ["timeout", "untimeout", "kick", "ban", "unban"] },
    minutes: N("timeout length, default 10, max 40320"), reason: S("reason"),
  }, ["member", "action"]),
  fn("delete_item", "Delete a channel or role. Needs button confirmation.", {
    kind: { type: "string", enum: ["channel", "role"] }, target: S("name or mention"),
  }, ["kind", "target"]),
  fn("purge_messages", "Bulk-delete recent messages (max 100, newer than 14 days).", {
    count: N("1-100"), channel: S("channel (default: this one)"), member: S("only this member's messages (optional)"),
  }, ["count"]),
  fn("send_message", "Post a message in a channel (e.g. an announcement or rules text). Never pings anyone.", {
    channel: S("channel name or mention"), text: S("message text"),
  }, ["channel", "text"]),
  fn("create_server_layout", "Generate a whole set of roles + categories + channels for this server (additive: existing names are skipped, nothing is deleted). Use a preset or give a custom layout. Needs button confirmation.", {
    preset: { type: "string", enum: PRESET_NAMES, description: "ready-made layout; pick the closest to the request" },
    categories: {
      type: "array", description: "custom layout (overrides preset)", items: {
        type: "object", properties: {
          name: S("category name"), private: B("staff only"),
          channels: { type: "array", items: { type: "object", properties: { name: S("channel name"), type: { type: "string", enum: CHANNEL_KINDS.filter((k) => k !== "category") }, topic: S("topic"), readonly: B("read-only") }, required: ["name"] } },
        }, required: ["name", "channels"],
      },
    },
    roles: { type: "array", description: "custom roles", items: { type: "object", properties: { name: S("role"), color: S("hex colour"), hoist: B("hoist") }, required: ["name"] } },
  }),
  fn("server_info", "Look at this server: member count, roles, categories and channels. Use before changing things you aren't sure exist."),
  fn("list_commands", "List the bot's own prefix commands you can run with run_command."),
  fn("run_command", "Run one of the bot's own prefix commands for the user (as if they typed it). Their own permissions still apply.", {
    command: S("command name without the prefix"), args: S("arguments as one string"),
  }, ["command"]),
  fn("web_search", "Look something up on the web (current facts, news, definitions).", { query: S("search query") }, ["query"]),
  fn("calculate", "Evaluate a maths expression exactly.", { expression: S("e.g. (12*7)/3 + sqrt(49)") }, ["expression"]),
];
const TOOL_NAMES = new Set(SERVER_TOOLS.map((t) => t.function.name));
const FREE_TOOLS = ["web_search", "calculate"]; // usable without a guild (DMs)
const DM_TOOLS = SERVER_TOOLS.filter((t) => FREE_TOOLS.includes(t.function.name));

// Commands the AI may never run for anyone (owner/admin-level or session-affecting).
const BLOCKED_COMMANDS = new Set([
  "restart", "giveownership", "execute", "grantowner", "grant", "ssl", "eval", "shutdown", "owner", "setowner",
  "aion", "aioff", "aimodel", "resetcooldown", "aiclear", "aimemory",
]);

// Belt and braces: even though each command checks permissions itself, the AI refuses up front
// when the person lacks what the command needs (commands not listed run with their own checks).
const COMMAND_PERMS = {
  ban: [P.BanMembers, "Ban Members"], unban: [P.BanMembers, "Ban Members"], kick: [P.KickMembers, "Kick Members"],
  mute: [P.ModerateMembers, "Timeout Members"], unmute: [P.ModerateMembers, "Timeout Members"], timeout: [P.ModerateMembers, "Timeout Members"],
  warn: [P.ModerateMembers, "Timeout Members"], unwarn: [P.ModerateMembers, "Timeout Members"], warnings: [P.ModerateMembers, "Timeout Members"],
  purge: [P.ManageMessages, "Manage Messages"], clear: [P.ManageMessages, "Manage Messages"], announce: [P.ManageMessages, "Manage Messages"],
  giveaway: [P.ManageMessages, "Manage Messages"], poll: [P.SendMessages, "Send Messages"],
  lock: [P.ManageChannels, "Manage Channels"], unlock: [P.ManageChannels, "Manage Channels"], slowmode: [P.ManageChannels, "Manage Channels"],
  role: [P.ManageRoles, "Manage Roles"], roleperm: [P.ManageRoles, "Manage Roles"], brole: [P.ManageRoles, "Manage Roles"], mrole: [P.ManageRoles, "Manage Roles"],
  nickname: [P.ManageNicknames, "Manage Nicknames"], nick: [P.ManageNicknames, "Manage Nicknames"],
  emoji: [P.ManageGuildExpressions, "Manage Expressions"],
  backup: [P.Administrator, "Administrator"], template: [P.Administrator, "Administrator"],
};

// ── helpers ──────────────────────────────────────────────────────────────────
const COLORS = {
  red: 0xe74c3c, blue: 0x3498db, green: 0x2ecc71, yellow: 0xf1c40f, orange: 0xe67e22, purple: 0x9b59b6,
  pink: 0xe91e63, teal: 0x1abc9c, white: 0xffffff, black: 0x23272a, gray: 0x95a5a6, grey: 0x95a5a6, gold: 0xf1c40f,
};
function parseColor(v) {
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (COLORS[s]) return COLORS[s];
  const m = s.match(/^#?([0-9a-f]{6})$/);
  return m ? parseInt(m[1], 16) : undefined;
}

const KIND_TO_TYPE = {
  text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory,
  forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice,
};
const CATEGORY_TYPES = [ChannelType.GuildCategory];

function chanName(name, type) {
  const s = String(name || "").trim();
  if (type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice || type === ChannelType.GuildCategory) return s.slice(0, 100);
  return s.toLowerCase().replace(/[^\p{L}\p{N}\p{Extended_Pictographic}_\- ]/gu, "").trim().replace(/\s+/g, "-").slice(0, 100);
}

class ToolError extends Error {}

function translateError(err) {
  if (err instanceof ToolError) return err.message;
  const code = err?.code;
  if (code === 50013) return "Discord says I'm missing permission (or the role is above my highest role). Move my role higher / give me the permission.";
  if (code === 50001) return "I can't see that channel (Missing Access).";
  if (code === 30005) return "The server hit the maximum number of roles (250).";
  if (code === 30013 || code === 30015) return "The server hit a channel limit (500 channels / 50 per category).";
  if (code === 50035) return `Discord rejected the input: ${String(err.message).split("\n")[0].slice(0, 160)}`;
  if (code === 10007 || code === 10013) return "That user isn't in the server.";
  if (code === 10026) return "That user isn't banned.";
  return `Failed: ${String(err?.message || err).slice(0, 180)}`;
}

function hasPerm(member, perm) {
  return !!member?.permissions?.has(perm);
}

// invoker AND bot must hold the permission
function need(ctx, perm, label) {
  const channel = ctx.channel;
  const check = (m) => (channel?.permissionsFor ? channel.permissionsFor(m)?.has(perm) : m.permissions.has(perm));
  if (!hasPerm(ctx.member, perm) && !ctx.member.permissions.has(P.Administrator)) {
    throw new ToolError(`You need the "${label}" permission for that, so I can't do it for you.`);
  }
  if (!ctx.me.permissions.has(perm) && !ctx.me.permissions.has(P.Administrator)) {
    throw new ToolError(`I'm missing the "${label}" permission in this server — give it to my role first.`);
  }
  void check;
}

function isOwner(ctx) {
  return ctx.guild.ownerId === ctx.member.id;
}

// the invoker may only touch roles below their top role (server owner is exempt); same for the bot
function checkRoleHierarchy(ctx, role) {
  if (role.managed) throw new ToolError(`"${role.name}" is managed by an integration and can't be assigned manually.`);
  if (!isOwner(ctx) && ctx.member.roles.highest.comparePositionTo(role) <= 0) {
    throw new ToolError(`"${role.name}" is at or above your highest role, so you can't manage it.`);
  }
  if (ctx.me.roles.highest.comparePositionTo(role) <= 0) {
    throw new ToolError(`"${role.name}" is at or above my highest role — drag my role above it in Server Settings → Roles.`);
  }
}

function checkMemberHierarchy(ctx, target) {
  if (target.id === ctx.guild.ownerId) throw new ToolError("That's the server owner — nobody can do that to them.");
  if (target.id === ctx.me.id) throw new ToolError("I won't do that to myself.");
  if (!isOwner(ctx) && target.id !== ctx.member.id && ctx.member.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new ToolError(`${target.displayName} has a role equal to or above yours, so you can't do that to them.`);
  }
  if (ctx.me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new ToolError(`${target.displayName}'s top role is above mine, so I can't do that to them.`);
  }
}

const note = (hit, label) => (hit.guessed ? ` (matched your "${label}" to "${hit.name}")` : "");

async function findMember(ctx, input) {
  const hit = await resolveMember(ctx.guild, input);
  if (!hit) throw new ToolError(`I couldn't find a member like "${input}".`);
  return { member: hit.member, guessed: hit.guessed, name: hit.member.displayName };
}
function findRole(ctx, input) {
  const hit = resolveRole(ctx.guild, input);
  if (!hit) throw new ToolError(`I couldn't find a role like "${input}".`);
  return { role: hit.role, guessed: hit.guessed, name: hit.role.name };
}
function findChannel(ctx, input, types = null) {
  const hit = resolveChannel(ctx.guild, input, types);
  if (!hit) throw new ToolError(`I couldn't find a channel like "${input}".`);
  return { channel: hit.channel, guessed: hit.guessed, name: hit.channel.name };
}

// ── permission overwrite helpers ─────────────────────────────────────────────
function privateOverwrites(ctx, extraRoleNames = []) {
  const g = ctx.guild;
  const ow = [{ id: g.roles.everyone.id, deny: [P.ViewChannel] }, { id: ctx.me.id, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels] }];
  const names = new Set([...STAFF_ROLE_NAMES, ...extraRoleNames].map((n) => n.toLowerCase()));
  for (const r of g.roles.cache.values()) {
    if (r.id !== g.id && names.has(r.name.toLowerCase())) ow.push({ id: r.id, allow: [P.ViewChannel, P.SendMessages] });
  }
  // the person who asked always keeps access
  ow.push({ id: ctx.member.id, allow: [P.ViewChannel, P.SendMessages] });
  return ow;
}

// ── executors ────────────────────────────────────────────────────────────────
const EXEC = {
  async create_channel(a, ctx) {
    need(ctx, P.ManageChannels, "Manage Channels");
    const type = KIND_TO_TYPE[a.type || "text"] ?? ChannelType.GuildText;
    const name = chanName(a.name, type);
    if (!name) throw new ToolError("That channel name is empty after cleaning it up.");
    const opts = { name, type, reason: `AI: requested by ${ctx.member.user.tag}` };
    let catNote = "";
    if (a.category && type !== ChannelType.GuildCategory) {
      const cat = resolveChannel(ctx.guild, a.category, CATEGORY_TYPES);
      if (cat) { opts.parent = cat.channel.id; catNote = ` in **${cat.channel.name}**`; }
      else catNote = ` (category "${a.category}" not found, so it's at the top level)`;
    }
    if (a.topic && [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(type)) opts.topic = String(a.topic).slice(0, 1024);
    if (a.private) opts.permissionOverwrites = privateOverwrites(ctx);
    else if (a.readonly && type !== ChannelType.GuildCategory) opts.permissionOverwrites = [{ id: ctx.guild.roles.everyone.id, deny: [P.SendMessages] }];
    const ch = await ctx.guild.channels.create(opts);
    return `Created ${a.type || "text"} channel <#${ch.id}> (${ch.name})${catNote}${a.private ? ", private" : a.readonly ? ", read-only" : ""}.`;
  },

  async create_role(a, ctx) {
    need(ctx, P.ManageRoles, "Manage Roles");
    const name = String(a.name || "").trim().slice(0, 100);
    if (!name) throw new ToolError("Role name is empty.");
    if (ctx.guild.roles.cache.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new ToolError(`A role called "${name}" already exists.`);
    let perms = new PermissionsBitField();
    const skipped = [];
    for (const p of a.permissions || []) {
      const key = Object.keys(P).find((k) => k.toLowerCase() === String(p).replace(/[\s_]/g, "").toLowerCase());
      if (!key) { skipped.push(p); continue; }
      // can't hand out a permission the invoker (or the bot) doesn't have
      if (!ctx.member.permissions.has(P[key]) || !ctx.me.permissions.has(P[key])) { skipped.push(key); continue; }
      perms = perms.add(P[key]);
    }
    const role = await ctx.guild.roles.create({
      name, color: parseColor(a.color), hoist: !!a.hoist, mentionable: !!a.mentionable, permissions: perms,
      reason: `AI: requested by ${ctx.member.user.tag}`,
    });
    return `Created role <@&${role.id}> (${role.name}).${skipped.length ? ` Skipped permissions I couldn't grant: ${skipped.join(", ")}.` : ""}`;
  },

  async edit_channel(a, ctx) {
    need(ctx, P.ManageChannels, "Manage Channels");
    const f = findChannel(ctx, a.channel);
    const ch = f.channel;
    const out = [];
    const patch = {};
    if (a.name) patch.name = chanName(a.name, ch.type), out.push(`renamed to ${patch.name}`);
    if (a.topic !== undefined && "topic" in ch) patch.topic = String(a.topic).slice(0, 1024), out.push("topic updated");
    if (a.slowmode_seconds !== undefined && "rateLimitPerUser" in ch) {
      patch.rateLimitPerUser = Math.max(0, Math.min(21600, Math.floor(Number(a.slowmode_seconds) || 0)));
      out.push(`slowmode ${patch.rateLimitPerUser}s`);
    }
    if (a.nsfw !== undefined && "nsfw" in ch) patch.nsfw = !!a.nsfw, out.push(a.nsfw ? "marked NSFW" : "unmarked NSFW");
    if (a.category) {
      const cat = resolveChannel(ctx.guild, a.category, CATEGORY_TYPES);
      if (!cat) throw new ToolError(`I couldn't find a category like "${a.category}".`);
      patch.parent = cat.channel.id;
      out.push(`moved to ${cat.channel.name}`);
    }
    if (Object.keys(patch).length) await ch.edit({ ...patch, reason: `AI: requested by ${ctx.member.user.tag}` });
    if (a.lock !== undefined && ch.permissionOverwrites) {
      await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: a.lock ? false : null }, { reason: `AI: requested by ${ctx.member.user.tag}` });
      out.push(a.lock ? "locked" : "unlocked");
    }
    return out.length ? `Updated <#${ch.id}>${note(f, a.channel)}: ${out.join(", ")}.` : "Nothing to change was specified.";
  },

  async member_role(a, ctx) {
    need(ctx, P.ManageRoles, "Manage Roles");
    const m = await findMember(ctx, a.member);
    const r = findRole(ctx, a.role);
    checkRoleHierarchy(ctx, r.role);
    if (m.member.id !== ctx.member.id) checkMemberHierarchy(ctx, m.member);
    if (a.action === "remove") {
      if (!m.member.roles.cache.has(r.role.id)) return `${m.name} doesn't have ${r.role.name}.`;
      await m.member.roles.remove(r.role, `AI: requested by ${ctx.member.user.tag}`);
      return `Removed ${r.role.name} from ${m.name}.${note(m, a.member)}${note(r, a.role)}`;
    }
    if (m.member.roles.cache.has(r.role.id)) return `${m.name} already has ${r.role.name}.`;
    await m.member.roles.add(r.role, `AI: requested by ${ctx.member.user.tag}`);
    return `Gave ${r.role.name} to ${m.name}.${note(m, a.member)}${note(r, a.role)}`;
  },

  async set_nickname(a, ctx) {
    const self = String(a.member || "").toLowerCase() === "me";
    const m = self ? { member: ctx.member, name: ctx.member.displayName, guessed: false } : await findMember(ctx, a.member);
    const own = m.member.id === ctx.member.id;
    need(ctx, own ? P.ChangeNickname : P.ManageNicknames, own ? "Change Nickname" : "Manage Nicknames");
    if (!own) checkMemberHierarchy(ctx, m.member);
    await m.member.setNickname(String(a.nickname || "").slice(0, 32) || null, `AI: requested by ${ctx.member.user.tag}`);
    return a.nickname ? `Nickname of ${m.name} is now "${String(a.nickname).slice(0, 32)}".` : `Reset nickname of ${m.name}.`;
  },

  async moderate_member(a, ctx, { confirmed } = {}) {
    const action = a.action;
    if (action === "unban") {
      need(ctx, P.BanMembers, "Ban Members");
      const id = String(a.member).match(/\d{15,25}/)?.[0];
      let target = id;
      if (!target) {
        const bans = await ctx.guild.bans.fetch();
        const q = String(a.member).toLowerCase();
        target = bans.find((b) => b.user.username.toLowerCase() === q || b.user.tag.toLowerCase() === q)?.user.id;
      }
      if (!target) throw new ToolError("Give me the banned user's ID or exact username to unban.");
      await ctx.guild.bans.remove(target, a.reason || `AI: requested by ${ctx.member.user.tag}`);
      return `Unbanned <@${target}>.`;
    }
    const perm = { timeout: [P.ModerateMembers, "Timeout Members"], untimeout: [P.ModerateMembers, "Timeout Members"], kick: [P.KickMembers, "Kick Members"], ban: [P.BanMembers, "Ban Members"] }[action];
    if (!perm) throw new ToolError(`Unknown moderation action "${action}".`);
    need(ctx, perm[0], perm[1]);
    const m = await findMember(ctx, a.member);
    if (m.member.id === ctx.member.id) throw new ToolError("You can't do that to yourself.");
    checkMemberHierarchy(ctx, m.member);
    const reason = `${a.reason || "No reason given"} — via AI, requested by ${ctx.member.user.tag}`;
    if ((action === "kick" || action === "ban") && !confirmed) {
      return { confirm: `**${action === "ban" ? "Ban" : "Kick"} ${m.name}**${a.reason ? ` — ${a.reason}` : ""}${note(m, a.member)}` };
    }
    if (action === "timeout") {
      const mins = Math.max(1, Math.min(40320, Math.floor(Number(a.minutes) || 10)));
      await m.member.timeout(mins * 60_000, reason);
      return `Timed out ${m.name} for ${mins} minute(s).${note(m, a.member)}`;
    }
    if (action === "untimeout") { await m.member.timeout(null, reason); return `Removed ${m.name}'s timeout.`; }
    if (action === "kick") { await m.member.kick(reason); return `Kicked ${m.name}.`; }
    await ctx.guild.members.ban(m.member.id, { reason });
    return `Banned ${m.name}.`;
  },

  async delete_item(a, ctx, { confirmed } = {}) {
    if (a.kind === "role") {
      need(ctx, P.ManageRoles, "Manage Roles");
      const r = findRole(ctx, a.target);
      checkRoleHierarchy(ctx, r.role);
      if (!confirmed) return { confirm: `**Delete role** ${r.role.name}${note(r, a.target)}` };
      await r.role.delete(`AI: requested by ${ctx.member.user.tag}`);
      return `Deleted role "${r.role.name}".`;
    }
    need(ctx, P.ManageChannels, "Manage Channels");
    const f = findChannel(ctx, a.target);
    if (!f.channel.manageable && !ctx.me.permissions.has(P.Administrator)) throw new ToolError("I can't manage that channel.");
    if (!confirmed) {
      const kids = f.channel.type === ChannelType.GuildCategory ? " (the channels inside stay, they just lose the category)" : "";
      return { confirm: `**Delete channel** #${f.channel.name}${kids}${note(f, a.target)}` };
    }
    const nm = f.channel.name;
    await f.channel.delete(`AI: requested by ${ctx.member.user.tag}`);
    return `Deleted channel "${nm}".`;
  },

  async purge_messages(a, ctx, { confirmed } = {}) {
    const count = Math.max(1, Math.min(100, Math.floor(Number(a.count) || 0)));
    const target = a.channel ? findChannel(ctx, a.channel, [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread]).channel : ctx.channel;
    if (!target?.bulkDelete) throw new ToolError("I can only purge text channels.");
    const perms = (m) => target.permissionsFor(m);
    if (!perms(ctx.member)?.has(P.ManageMessages)) throw new ToolError("You need Manage Messages in that channel.");
    if (!perms(ctx.me)?.has(P.ManageMessages)) throw new ToolError("I need Manage Messages in that channel.");
    let who = null;
    if (a.member) who = (await findMember(ctx, a.member)).member;
    if (count > 10 && !confirmed) return { confirm: `**Delete up to ${count} messages**${who ? ` from ${who.displayName}` : ""} in #${target.name}` };
    let msgs = await target.messages.fetch({ limit: 100 });
    if (who) msgs = msgs.filter((m) => m.author.id === who.id);
    // the AI's own pending confirmation prompt and the user's request shouldn't count toward the total
    const list = [...msgs.values()].slice(0, count);
    const del = await target.bulkDelete(list, true);
    return `Deleted ${del.size} message(s) in #${target.name}${who ? ` from ${who.displayName}` : ""}.${del.size < list.length ? " (Messages older than 14 days can't be bulk-deleted.)" : ""}`;
  },

  async send_message(a, ctx) {
    const f = findChannel(ctx, a.channel, [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread]);
    const ch = f.channel;
    if (!ch.permissionsFor(ctx.member)?.has(P.SendMessages)) throw new ToolError("You can't send messages in that channel, so I won't either.");
    if (!ch.permissionsFor(ctx.me)?.has(P.SendMessages)) throw new ToolError("I can't send messages in that channel.");
    const text = String(a.text || "").trim().slice(0, 1900);
    if (!text) throw new ToolError("Message text is empty.");
    await ch.send({ content: text, allowedMentions: { parse: [] } });
    return `Sent the message in <#${ch.id}>.${note(f, a.channel)}`;
  },

  async create_server_layout(a, ctx, { confirmed } = {}) {
    need(ctx, P.ManageChannels, "Manage Channels");
    need(ctx, P.ManageRoles, "Manage Roles");
    let layout;
    if (Array.isArray(a.categories) && a.categories.length) {
      layout = { roles: Array.isArray(a.roles) ? a.roles : [], categories: a.categories };
    } else {
      const key = PRESET_NAMES.find((p) => p === String(a.preset || "").toLowerCase()) || "community";
      layout = PRESETS[key];
      layout = { roles: layout.roles, categories: layout.categories, preset: key };
    }
    const cats = layout.categories.slice(0, 10).map((c) => ({ ...c, channels: (c.channels || []).slice(0, 15) }));
    const roles = (layout.roles || []).slice(0, 15);
    let chanCount = 0;
    for (const c of cats) chanCount += c.channels.length;
    if (chanCount > 40) throw new ToolError("That layout has more than 40 channels — ask for something smaller, or for it in two parts.");
    const summary = `**Build ${layout.preset ? `the "${layout.preset}" layout` : "a custom layout"}**: ${roles.length} role(s), ${cats.length} categories, ${chanCount} channels.\n` +
      cats.map((c) => `• ${c.name}${c.private ? " 🔒" : ""}: ${c.channels.map((x) => x.name).join(", ")}`).join("\n").slice(0, 1200) +
      "\nExisting roles/channels with the same names are skipped; nothing is deleted.";
    if (!confirmed) return { confirm: summary, payload: { ...a, categories: cats, roles, preset: layout.preset } };
    return buildLayout(ctx, { roles, categories: cats });
  },

  async server_info(a, ctx) {
    const g = ctx.guild;
    const cats = [...g.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values()].sort((x, y) => x.position - y.position);
    const lines = [];
    for (const c of cats) {
      const kids = [...g.channels.cache.filter((k) => k.parentId === c.id).values()].sort((x, y) => x.position - y.position);
      lines.push(`${c.name}: ${kids.map((k) => (k.isVoiceBased() ? `🔊${k.name}` : `#${k.name}`)).join(", ") || "(empty)"}`);
    }
    const loose = [...g.channels.cache.filter((k) => !k.parentId && k.type !== ChannelType.GuildCategory).values()];
    if (loose.length) lines.push(`(no category): ${loose.map((k) => k.name).join(", ")}`);
    const roles = [...g.roles.cache.values()].filter((r) => r.id !== g.id).sort((x, y) => y.position - x.position).map((r) => r.name);
    return `Server "${g.name}" — ${g.memberCount} members, boost tier ${g.premiumTier}.\nRoles (top→bottom): ${roles.slice(0, 40).join(", ") || "none"}.\n${lines.join("\n").slice(0, 1500)}`;
  },

  async list_commands() {
    const { commandNames } = require("../../handlers/prefix");
    const names = commandNames().filter((n) => !BLOCKED_COMMANDS.has(n));
    return `Commands: ${names.join(", ")}`;
  },

  async run_command(a, ctx) {
    const { getCommand } = require("../../handlers/prefix");
    const name = String(a.command || "").replace(/^[^\w]+/, "").trim().toLowerCase();
    if (!name) throw new ToolError("No command given.");
    const cmd = getCommand(name);
    if (!cmd) {
      const { closest } = require("../../util/resolve");
      const { commandNames } = require("../../handlers/prefix");
      const c = closest(name, commandNames());
      throw new ToolError(`No command called "${name}".${c ? ` Did you mean "${c.value}"?` : ""}`);
    }
    if (BLOCKED_COMMANDS.has(name) || BLOCKED_COMMANDS.has(cmd.name)) throw new ToolError(`I'm not allowed to run "${cmd.name}" — you can run it yourself.`);
    if (!ctx.message) throw new ToolError("There's no message to run the command from.");
    for (const key of [name, cmd.name, ...(cmd.aliases || [])]) {
      const req = COMMAND_PERMS[String(key).toLowerCase()];
      if (req && !ctx.member.permissions.has(req[0])) throw new ToolError(`You need the "${req[1]}" permission to use ${cmd.name}, so I can't run it for you.`);
    }
    const args = String(a.args || "").trim().split(/\s+/).filter(Boolean);
    await cmd.run(ctx.message, args);
    return `Ran the command "${cmd.name}"${args.length ? ` with: ${args.join(" ")}` : ""}. Its output was posted in the channel.`;
  },

  async web_search(a) {
    const q = String(a.query || "").trim().slice(0, 200);
    if (!q) throw new ToolError("Empty query.");
    const r = await webSearch(q);
    return r || "No results found. Answer from what you know and say it may be out of date.";
  },

  async calculate(a) {
    try { return String(calculate(a.expression)); } catch (e) { throw new ToolError(`Can't calculate that: ${e.message}`); }
  },
};

// ── layout builder (additive) ────────────────────────────────────────────────
async function buildLayout(ctx, { roles, categories }) {
  const g = ctx.guild;
  const reason = `AI layout: requested by ${ctx.member.user.tag}`;
  const made = { roles: 0, cats: 0, chans: 0 };
  const skipped = [];
  const failed = [];
  const STAFF_PERMS = {
    admin: [P.ManageChannels, P.ManageMessages, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageNicknames],
    mod: [P.ManageMessages, P.KickMembers, P.ModerateMembers, P.ManageNicknames, P.MuteMembers],
  };

  for (const r of roles) {
    const name = String(r.name || "").trim().slice(0, 100);
    if (!name) continue;
    if (g.roles.cache.some((x) => x.name.toLowerCase() === name.toLowerCase())) { skipped.push(`role ${name}`); continue; }
    let perms = new PermissionsBitField();
    const lower = name.toLowerCase();
    const grant = STAFF_PERMS[lower] || (lower.includes("mod") || lower.includes("support") ? STAFF_PERMS.mod : null);
    for (const p of grant || []) if (ctx.member.permissions.has(p) && ctx.me.permissions.has(p)) perms = perms.add(p);
    try {
      await g.roles.create({ name, color: typeof r.color === "number" ? r.color : parseColor(r.color), hoist: !!r.hoist, permissions: perms, reason });
      made.roles++;
    } catch (e) { failed.push(`role ${name}: ${translateError(e)}`); if (e.code === 50013 || e.code === 30005) break; }
  }

  for (const c of categories) {
    const cname = chanName(c.name, ChannelType.GuildCategory);
    let cat = g.channels.cache.find((x) => x.type === ChannelType.GuildCategory && x.name.toLowerCase() === cname.toLowerCase());
    if (cat) skipped.push(`category ${cname}`);
    else {
      try {
        cat = await g.channels.create({
          name: cname, type: ChannelType.GuildCategory, reason,
          ...(c.private ? { permissionOverwrites: privateOverwrites(ctx) } : {}),
        });
        made.cats++;
      } catch (e) { failed.push(`category ${cname}: ${translateError(e)}`); if (e.code === 50013 || e.code === 30013) break; continue; }
    }
    for (const ch of c.channels || []) {
      const type = KIND_TO_TYPE[ch.type || "text"] ?? ChannelType.GuildText;
      const name = chanName(ch.name, type);
      if (!name) continue;
      if (g.channels.cache.some((x) => x.parentId === cat.id && x.name.toLowerCase() === name.toLowerCase())) { skipped.push(`#${name}`); continue; }
      try {
        await g.channels.create({
          name, type, parent: cat.id, reason,
          ...(ch.topic && type === ChannelType.GuildText ? { topic: String(ch.topic).slice(0, 1024) } : {}),
          ...(ch.readonly && !c.private ? { permissionOverwrites: [{ id: g.roles.everyone.id, deny: [P.SendMessages] }] } : {}),
        });
        made.chans++;
      } catch (e) { failed.push(`#${name}: ${translateError(e)}`); if (e.code === 50013 || e.code === 30013) return layoutReport(made, skipped, failed); }
    }
  }
  return layoutReport(made, skipped, failed);
}

function layoutReport(made, skipped, failed) {
  let s = `Done: created ${made.roles} role(s), ${made.cats} categor${made.cats === 1 ? "y" : "ies"} and ${made.chans} channel(s).`;
  if (skipped.length) s += ` Skipped ${skipped.length} that already existed.`;
  if (failed.length) s += ` Problems: ${failed.slice(0, 4).join("; ")}.`;
  return s;
}

// ── confirmation flow ────────────────────────────────────────────────────────
const pending = new Map(); // id → { userId, guildId, channelId, tool, args, expires }
let seq = 0;
const CONFIRM_TTL = 2 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pending) if (p.expires < now) pending.delete(id);
}, 60_000).unref?.();

async function askConfirm(ctx, tool, args, text) {
  const id = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  pending.set(id, { userId: ctx.member.id, guildId: ctx.guild.id, channelId: ctx.channel.id, tool, args, expires: Date.now() + CONFIRM_TTL });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`aiconf_yes:${id}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`aiconf_no:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  const target = ctx.message?.reply ? ctx.message : ctx.channel;
  await target.reply?.({ content: `⚠️ <@${ctx.member.id}> please confirm:\n${text}`.slice(0, 1900), components: [row], allowedMentions: { users: [ctx.member.id], repliedUser: false } })
    ?? ctx.channel.send({ content: `⚠️ <@${ctx.member.id}> please confirm:\n${text}`.slice(0, 1900), components: [row], allowedMentions: { users: [ctx.member.id] } });
  return `Asked the user to confirm with buttons (expires in 2 minutes). Tell them briefly that the action is waiting for their confirmation. Do NOT claim it is done.`;
}

async function handleConfirmButton(interaction) {
  const [action, id] = interaction.customId.split(":");
  const p = pending.get(id);
  if (!p) {
    return interaction.update({ content: "⌛ That confirmation expired. Ask me again.", components: [] }).catch(() => {});
  }
  if (interaction.user.id !== p.userId) {
    return interaction.reply({ content: "❌ Only the person who asked can confirm this.", ephemeral: true });
  }
  pending.delete(id);
  if (action === "aiconf_no") {
    return interaction.update({ content: "🚫 Cancelled.", components: [] });
  }
  await interaction.update({ content: "⏳ Working on it...", components: [] });
  let result;
  try {
    const guild = interaction.guild || interaction.client.guilds.cache.get(p.guildId);
    const member = await guild.members.fetch(p.userId);
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const channel = guild.channels.cache.get(p.channelId) ?? interaction.channel;
    result = await EXEC[p.tool](p.args, { guild, member, me, channel, message: null }, { confirmed: true });
    if (typeof result !== "string") result = "Done.";
  } catch (e) {
    result = `❌ ${translateError(e)}`;
  }
  return interaction.editReply({ content: `${result.startsWith("❌") ? "" : "✅ "}${result}`.slice(0, 1900), components: [] }).catch(() => {});
}

// ── public entry ─────────────────────────────────────────────────────────────
function toolsFor(ctx) {
  return ctx?.guild ? SERVER_TOOLS : DM_TOOLS;
}

// Runs one tool call and always returns a string for the model.
async function runTool(name, args, ctx) {
  if (!TOOL_NAMES.has(name)) return `Unknown tool "${name}".`;
  if (!ctx?.guild && !FREE_TOOLS.includes(name)) return "That only works inside a server.";
  try {
    const out = await EXEC[name](args && typeof args === "object" ? args : {}, ctx, { confirmed: false });
    if (out && typeof out === "object" && out.confirm) {
      return await askConfirm(ctx, name, out.payload || args, out.confirm);
    }
    return String(out).slice(0, 1500);
  } catch (e) {
    if (!(e instanceof ToolError)) console.error(`[ai-tool:${name}]`, e?.message || e);
    return `Error: ${translateError(e)}`;
  }
}

module.exports = { toolsFor, runTool, handleConfirmButton, SERVER_TOOLS, BLOCKED_COMMANDS, _internals: { EXEC, pending, parseColor, chanName } };
