const { read, write } = require("../storage");

const STORE_NAME = "server_links"; // data/server_links.json
const BOT_OWNER_ID = "1276884559467643042"; // same bot-wide owner ID used in tadmin.js

const DEFAULT_LAYOUT = {
  banner: "full",       // "full" | "none"
  stats: "show",         // "show" | "hide"
  tagsStyle: "pills",    // "pills" | "description" | "hidden"
  density: "expanded",   // "compact" | "expanded"
  titleEmoji: "",        // optional emoji prefix
  footerText: "",        // optional custom footer
  fieldOrder: "stats_first", // "stats_first" | "desc_first"
};

function load() {
  // shape: { entries: [{ guildId, link, description, banner, icon, color, tags, layout, votes, addedBy, addedAt }], allowedAdders: [userId, ...] }
  return read(STORE_NAME, { entries: [], allowedAdders: [] });
}

function save(data) {
  write(STORE_NAME, data);
}

function isBotOwner(userId) {
  return userId === BOT_OWNER_ID;
}

function canAdd(userId) {
  if (isBotOwner(userId)) return true;
  const data = load();
  return data.allowedAdders.includes(userId);
}

function grantAccess(userId) {
  const data = load();
  if (!data.allowedAdders.includes(userId)) {
    data.allowedAdders.push(userId);
    save(data);
  }
  return data;
}

function revokeAccess(userId) {
  const data = load();
  data.allowedAdders = data.allowedAdders.filter((id) => id !== userId);
  save(data);
  return data;
}

function findByGuildId(guildId) {
  const data = load();
  return data.entries.find((e) => e.guildId === guildId);
}

function addServer({ guildId, link, description, banner, icon, color, tags, layout, addedBy }) {
  const data = load();
  if (findByGuildId(guildId)) return { ok: false, reason: "duplicate" };

  data.entries.push({
    guildId,
    link,
    description,
    banner: banner || null,
    icon: icon || null,
    color: color || null,
    tags: tags || [],
    layout: { ...DEFAULT_LAYOUT, ...(layout || {}) },
    votes: [], // array of userIds who upvoted
    addedBy,
    addedAt: Date.now(),
  });
  save(data);
  return { ok: true };
}

function removeServer(guildId) {
  const data = load();
  const before = data.entries.length;
  data.entries = data.entries.filter((e) => e.guildId !== guildId);
  save(data);
  return before !== data.entries.length;
}

function listServers() {
  // Ensure older entries without votes/layout still work
  const entries = load().entries.map((e) => ({
    ...e,
    votes: e.votes || [],
    layout: { ...DEFAULT_LAYOUT, ...(e.layout || {}) },
  }));

  // Most-upvoted first; ties broken by whichever was added earlier
  return entries.sort((a, b) => {
    const voteDiff = (b.votes?.length || 0) - (a.votes?.length || 0);
    if (voteDiff !== 0) return voteDiff;
    return (a.addedAt || 0) - (b.addedAt || 0);
  });
}

function listAllowedAdders() {
  return load().allowedAdders;
}

// ── Voting ─────────────────────────────────────────────────────────────────
function toggleVote(guildId, userId) {
  const data = load();
  const entry = data.entries.find((e) => e.guildId === guildId);
  if (!entry) return null;
  if (!entry.votes) entry.votes = [];

  const hadVoted = entry.votes.includes(userId);
  if (hadVoted) {
    entry.votes = entry.votes.filter((id) => id !== userId);
  } else {
    entry.votes.push(userId);
  }
  save(data);
  return { voted: !hadVoted, total: entry.votes.length };
}

function getTopGuildIds(count = 3) {
  const entries = listServers();
  return [...entries]
    .sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0))
    .filter((e) => (e.votes?.length || 0) > 0)
    .slice(0, count)
    .map((e) => e.guildId);
}

// ── In-memory drafts for the interactive ,servers add builder ────────────────
// Not persisted to disk — these are just "in progress" entries being built.
const drafts = new Map(); // userId -> { guildId, link, description, banner, icon, color, tags, layout, activeTab }

function getDraft(userId) {
  if (!drafts.has(userId)) {
    drafts.set(userId, {
      guildId: "", link: "", description: "", banner: "", icon: "", color: "", tags: "",
      layout: { ...DEFAULT_LAYOUT },
      activeTab: "content", // "content" | "layout"
    });
  }
  return drafts.get(userId);
}

function updateDraft(userId, patch) {
  const draft = getDraft(userId);
  Object.assign(draft, patch);
  return draft;
}

function updateDraftLayout(userId, patch) {
  const draft = getDraft(userId);
  draft.layout = { ...draft.layout, ...patch };
  return draft;
}

function clearDraft(userId) {
  drafts.delete(userId);
}

function parseHexColor(hex) {
  if (!hex) return null;
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return parseInt(cleaned, 16);
}

// Builds a plain-data description of how the card should look, given content + layout.
// The actual EmbedBuilder construction happens in buttons.js (needs discord.js classes),
// but all the "what goes where" logic lives here so it's consistent everywhere it's used.
function describeCard({ content, layout, guildInfo, isTop3 }) {
  const tagList = (content.tags || []).filter(Boolean);
  const lay = { ...DEFAULT_LAYOUT, ...(layout || {}) };

  const titlePrefix = lay.titleEmoji ? `${lay.titleEmoji}  ` : "";
  const topBadge = isTop3 ? ["🥇", "🥈", "🥉"][isTop3 - 1] + "  " : "";

  const title = `${topBadge}${titlePrefix}${guildInfo?.name || content.name || "Untitled Server"}`;

  const showBanner = lay.banner !== "none";
  const showStats = lay.stats !== "hide";
  const tagsInline = lay.tagsStyle === "pills";
  const tagsInDesc = lay.tagsStyle === "description";
  const compact = lay.density === "compact";
  const statsFirst = lay.fieldOrder !== "desc_first";

  let description = content.description || "No description";
  if (tagsInDesc && tagList.length) {
    description += `\n\n${tagList.map((t) => `\`${t}\``).join(" ")}`;
  }

  return {
    title,
    description,
    showBanner: showBanner && !compact,
    showStats: showStats && !compact,
    showTagsPills: tagsInline && !compact && tagList.length > 0,
    tagList,
    statsFirst,
    footerText: lay.footerText || (compact ? null : "Server List"),
    compact,
  };
}

module.exports = {
  DEFAULT_LAYOUT,
  isBotOwner,
  canAdd,
  grantAccess,
  revokeAccess,
  addServer,
  removeServer,
  listServers,
  listAllowedAdders,
  findByGuildId,
  toggleVote,
  getTopGuildIds,
  parseHexColor,
  describeCard,
  getDraft,
  updateDraft,
  updateDraftLayout,
  clearDraft,
};
