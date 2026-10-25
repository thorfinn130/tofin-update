// Things Tofin knows well. Instead of stuffing everything into every prompt (slow and
// expensive), we pick the 1–3 topics that match the message and inject only those.

const TOPICS = [
  {
    id: "setup",
    keys: /\b(set ?up|setup|build|generate|make|design|organi[sz]e|structure|layout|template)\b.*\b(server|guild|community)\b|\bserver (layout|structure|setup|template)\b|\bnew server\b/i,
    text: `SERVER SETUP BASICS
- Good servers have few categories with clear purpose: INFO (rules, announcements, roles), COMMUNITY (general, media, memes), the main topic (game/anime/study/music), VOICE, STAFF (private).
- Put rules + announcements at the top, read-only for @everyone. Keep staff channels private (deny View Channel for @everyone, allow for staff role).
- Roles from top to bottom: Owner, Admin, Mod, Staff/Helper, special/booster/vip, Member, then colour or ping roles. The bot's role must sit ABOVE any role it manages.
- Channel names: lowercase-with-dashes, optional emoji prefix. Use topics (descriptions) so people know what each channel is for.
- For big setups use create_server_layout with a preset (gaming, community, study, anime, music, creator, support, minimal) or a custom spec.`,
  },
  {
    id: "permissions",
    keys: /\b(permission|perms?|administrator|manage (roles?|channels?|server|messages)|can'?t see|cannot see|hidden channel|private channel|view channel|send messages)\b/i,
    text: `DISCORD PERMISSIONS
- Permission resolution: Administrator ignores everything. Otherwise: @everyone role + member's roles combine (any allow wins at role level), then channel overwrites apply: category overwrites → channel overwrites, role overwrites before member overwrites; a deny at channel level beats a role allow.
- Private channel = deny View Channel for @everyone, then allow it for the roles that should see it.
- Read-only channel = deny Send Messages (and Add Reactions, Create Threads) for @everyone.
- A role can only manage roles lower than its own highest role. A bot cannot assign roles above its own role.
- Dangerous permissions to keep away from members: Administrator, Manage Server, Manage Roles, Manage Webhooks, Mention Everyone, Ban/Kick Members.
- Timeout (Moderate Members) is the right tool for muting; max 28 days.`,
  },
  {
    id: "moderation",
    keys: /\b(mod(erat\w*)?|ban|kick|mute|timeout|warn|spam|raid|scam|troll|rules|automod|auto-?mod|verification|anti.?raid)\b/i,
    text: `MODERATION
- Escalation that works: warn → timeout (10m / 1h / 1d) → kick → ban. Always give a reason; it shows in the audit log.
- Turn on Discord AutoMod (Server Settings → Safety Setup / AutoMod): block mention spam, spam content, and custom word lists; set a log channel for it.
- Set verification level to Medium+ for public servers; require 2FA for moderators (Server Settings → Safety).
- Anti-raid: raise verification, pause invites (Server Settings → Invites → Pause), slowmode 30s+ in busy channels, ban the whole wave then clean up.
- Never DM-mod from your own account for serious things; keep a #mod-log channel.
- Scam links: delete, timeout the account, report to Discord if it is a compromised account.`,
  },
  {
    id: "community",
    keys: /\b(grow|growth|members?|engage\w*|active|dead server|boost|events?|giveaways?|partner\w*|promot\w*|invite|onboarding|welcome|community)\b/i,
    text: `GROWING / RUNNING A COMMUNITY
- Activity comes from habits: a weekly event (game night, movie night, challenge), daily prompts, a clear niche, and mods who actually talk.
- Onboarding: enable Community → Server Onboarding, pre-select 3-5 channels, add questions that assign interest roles. Add a short welcome post and a rules screen.
- Self-assign roles with the Roles/Channels & Roles (onboarding) page instead of reaction-role bots when possible.
- Use threads and forum channels for help/questions so general chat stays readable.
- Giveaways and polls are good for engagement; keep requirements simple.
- Server Boost perks: L1 emoji slots + 128kbps audio, L2 banner + 50MB uploads, L3 vanity URL + 100MB uploads.
- Invite tracking helps see what works; vanity URL needs L3.`,
  },
  {
    id: "bots",
    keys: /\b(bot|webhook|api|token|intents?|slash command|discord\.js|discord\.py|embed|oauth)\b/i,
    text: `BOTS & DEVELOPMENT (Discord)
- Bot token = password. Never post it; if leaked, reset it in the Developer Portal immediately.
- Privileged intents (Server Members, Message Content, Presence) must be enabled in the Developer Portal and in code.
- Slash commands register globally (up to ~1h to propagate) or per guild (instant). Guild commands are best while testing.
- Embeds: title 256, description 4096, 25 fields, field value 1024, total 6000 characters. Message content limit 2000 (4000 with Nitro). Max 10 embeds per message.
- Webhooks are the easiest way to post from outside Discord (CI, RSS, alerts).
- Rate limits: the library queues for you; respond to interactions within 3 seconds (defer if slower).
- discord.js v14: Client({ intents }), client.once("ready"), interaction.reply/deferReply/followUp, EmbedBuilder, ActionRowBuilder.`,
  },
  {
    id: "voice",
    keys: /\b(voice|vc|stage|music|call|mic|stream|screen ?share|go live)\b/i,
    text: `VOICE
- Make voice private with Connect/View denied for @everyone. Use "Priority Speaker" or Stage channels for events.
- Join-to-create VC: a trigger voice channel that spawns a personal channel (this bot supports /vcset for that).
- Bitrate is capped by boost level (64kbps default, 128/256/384 with boosts).
- Soundboard and Activities need Use Soundboard / Start Activities permissions.`,
  },
  {
    id: "tech",
    keys: /\b(code|coding|program\w*|javascript|python|node|bug|error|regex|html|css|sql|git|github|linux|windows|server (host|hosting)|vps|install|npm|pip)\b/i,
    text: `TECH HELP STYLE
- Give the fix first, then one line of why. Short code blocks in triple backticks only when code is needed.
- Ask for the exact error text if it is missing. Common Node errors: MODULE_NOT_FOUND → npm install / check path; EADDRINUSE → port taken; ERR_REQUIRE_ESM → package is ESM-only, use import() or an older version.
- Git basics: git status, git add -A, git commit -m "msg", git pull --rebase, git push; undo last commit but keep changes: git reset --soft HEAD~1.
- Never ask people to paste tokens/passwords.`,
  },
  {
    id: "writing",
    keys: /\b(announce\w*|rules|description|write|rewrite|caption|bio|topic|post|message for|template for)\b/i,
    text: `WRITING FOR DISCORD
- Announcements: one bold headline line, 2-4 short lines, a clear call to action, @role mention only if it matters.
- Rules: 5-8 numbered rules, each one line, most important first (be respectful, no spam, no NSFW outside marked channels, follow Discord ToS, listen to staff).
- Channel topics: under 100 characters, say what belongs there.
- Discord markdown: **bold**, *italic*, __underline__, ~~strike~~, \`code\`, > quote, # heading, - list, ||spoiler||, <t:UNIX:R> for live timestamps.`,
  },
];

function relevantKnowledge(text, max = 2) {
  if (!text) return "";
  const hits = TOPICS.filter((t) => t.keys.test(text)).slice(0, max);
  return hits.map((t) => t.text).join("\n\n");
}

// ── Server layout presets (used by create_server_layout) ────────────────────
// private: only roles listed in `roles` (+ staff) can see it. readonly: @everyone cannot send.
const STAFF = ["Admin", "Mod"];
const PRESETS = {
  minimal: {
    roles: [{ name: "Admin", color: 0xe74c3c, hoist: true }, { name: "Mod", color: 0x3498db, hoist: true }, { name: "Member", color: 0x95a5a6 }],
    categories: [
      { name: "info", channels: [{ name: "rules", readonly: true }, { name: "announcements", readonly: true }] },
      { name: "chat", channels: [{ name: "general" }, { name: "media" }, { name: "General", type: "voice" }] },
    ],
  },
  community: {
    roles: [
      { name: "Owner", color: 0xf1c40f, hoist: true }, { name: "Admin", color: 0xe74c3c, hoist: true },
      { name: "Mod", color: 0x3498db, hoist: true }, { name: "VIP", color: 0x9b59b6, hoist: true }, { name: "Member", color: 0x95a5a6 },
    ],
    categories: [
      { name: "📌 info", channels: [{ name: "welcome", readonly: true }, { name: "rules", readonly: true }, { name: "announcements", readonly: true }, { name: "roles", readonly: true }] },
      { name: "💬 community", channels: [{ name: "general" }, { name: "media" }, { name: "memes" }, { name: "bot-commands" }, { name: "suggestions" }] },
      { name: "🔊 voice", channels: [{ name: "Lounge", type: "voice" }, { name: "Chill", type: "voice" }, { name: "Music", type: "voice" }] },
      { name: "🛡️ staff", private: true, channels: [{ name: "staff-chat" }, { name: "mod-log" }, { name: "Staff VC", type: "voice" }] },
    ],
  },
  gaming: {
    roles: [
      { name: "Admin", color: 0xe74c3c, hoist: true }, { name: "Mod", color: 0x3498db, hoist: true },
      { name: "Gamer", color: 0x2ecc71 }, { name: "LFG", color: 0xe67e22 },
    ],
    categories: [
      { name: "📌 info", channels: [{ name: "rules", readonly: true }, { name: "announcements", readonly: true }, { name: "get-roles", readonly: true }] },
      { name: "💬 chat", channels: [{ name: "general" }, { name: "clips-and-highlights" }, { name: "memes" }, { name: "bot-commands" }] },
      { name: "🎮 gaming", channels: [{ name: "looking-for-group" }, { name: "game-discussion" }, { name: "tips-and-guides" }, { name: "tournaments" }] },
      { name: "🔊 voice", channels: [{ name: "Lobby", type: "voice" }, { name: "Squad 1", type: "voice" }, { name: "Squad 2", type: "voice" }, { name: "Squad 3", type: "voice" }, { name: "AFK", type: "voice" }] },
      { name: "🛡️ staff", private: true, channels: [{ name: "staff-chat" }, { name: "mod-log" }] },
    ],
  },
  study: {
    roles: [{ name: "Admin", color: 0xe74c3c, hoist: true }, { name: "Mod", color: 0x3498db, hoist: true }, { name: "Student", color: 0x1abc9c }, { name: "Tutor", color: 0xf39c12, hoist: true }],
    categories: [
      { name: "📌 info", channels: [{ name: "rules", readonly: true }, { name: "announcements", readonly: true }, { name: "resources", readonly: true }] },
      { name: "📚 study", channels: [{ name: "homework-help" }, { name: "math" }, { name: "science" }, { name: "languages" }, { name: "coding" }, { name: "exam-prep" }] },
      { name: "💬 social", channels: [{ name: "general" }, { name: "off-topic" }, { name: "study-buddies" }] },
      { name: "🔊 voice", channels: [{ name: "Silent Study", type: "voice" }, { name: "Group Study 1", type: "voice" }, { name: "Group Study 2", type: "voice" }, { name: "Chill", type: "voice" }] },
      { name: "🛡️ staff", private: true, channels: [{ name: "staff-chat" }, { name: "mod-log" }] },
    ],
  },
  anime: {
    roles: [{ name: "Admin", color: 0xe74c3c, hoist: true }, { name: "Mod", color: 0x3498db, hoist: true }, { name: "Otaku", color: 0xff69b4 }, { name: "Manga Reader", color: 0xf1c40f }],
    categories: [
      { name: "📌 info", channels: [{ name: "rules", readonly: true }, { name: "announcements", readonly: true }, { name: "get-roles", readonly: true }] },
      { name: "💬 chat", channels: [{ name: "general" }, { name: "memes" }, { name: "fanart" }, { name: "bot-commands" }] },
      { name: "📺 anime", channels: [{ name: "currently-watching" }, { name: "recommendations" }, { name: "seasonal-anime" }, { name: "manga" }, { name: "spoilers" }] },
      { name: "🔊 voice", channels: [{ name: "Watch Party", type: "voice" }, { name: "Lounge", type: "voice" }] },
      { name: "🛡️ staff", private: true, channels: [{ name: "staff-chat" }, { name: "mod-log" }] },
    ],
  },
  music: {
    roles: [{ name: "Admin", color: 0xe74c3c, hoist: true }, { name: "Mod", color: 0x3498db, hoist: true }, { name: "Artist", color: 0x9b59b6, hoist: true }, { name: "Listener", color: 0x1db954 }],
    categories: [
      { name: "📌 info", channels: [{ name: "rules", readonly: true }, { name: "announcements", readonly: true }] },
      { name: "🎵 music", channels: [{ name: "now-playing" }, { name: "song-recommendations" }, { name: "playlists" }, { name: "music-talk" }] },
      { name: "🎤 creators", channels: [{ name: "share-your-music" }, { name: "feedback" }, { name: "collabs" }] },
      { name: "🔊 voice", channels: [{ name: "Listening Room", type: "voice" }, { name: "Jam Session", type: "voice" }, { name: "Stage", type: "stage" }] },
      { name: "🛡️ staff", private: true, channels: [{ name: "staff-chat" }, { name: "mod-log" }] },
    ],
  },
  creator: {
    roles: [{ name: "Creator", color: 0xf1c40f, hoist: true }, { name: "Mod", color: 0x3498db, hoist: true }, { name: "Subscriber", color: 0xe91e63 }, { name: "Fan", color: 0x95a5a6 }],
    categories: [
      { name: "📌 info", channels: [{ name: "welcome", readonly: true }, { name: "rules", readonly: true }, { name: "announcements", readonly: true }, { name: "stream-notifications", readonly: true }] },
      { name: "💬 community", channels: [{ name: "general" }, { name: "fan-art" }, { name: "clips" }, { name: "memes" }] },
      { name: "🔊 voice", channels: [{ name: "Hangout", type: "voice" }, { name: "Stream Chat VC", type: "voice" }] },
      { name: "🛡️ staff", private: true, channels: [{ name: "staff-chat" }, { name: "mod-log" }] },
    ],
  },
  support: {
    roles: [{ name: "Admin", color: 0xe74c3c, hoist: true }, { name: "Support Team", color: 0x3498db, hoist: true }, { name: "Customer", color: 0x2ecc71 }],
    categories: [
      { name: "📌 info", channels: [{ name: "welcome", readonly: true }, { name: "rules", readonly: true }, { name: "announcements", readonly: true }, { name: "faq", readonly: true }] },
      { name: "🛟 support", channels: [{ name: "help" }, { name: "bug-reports" }, { name: "feature-requests" }] },
      { name: "💬 community", channels: [{ name: "general" }, { name: "showcase" }] },
      { name: "🛡️ staff", private: true, channels: [{ name: "staff-chat" }, { name: "tickets-log" }] },
    ],
  },
};

const PRESET_NAMES = Object.keys(PRESETS);
const STAFF_ROLE_NAMES = STAFF.concat(["Owner", "Support Team", "Creator"]);

module.exports = { TOPICS, relevantKnowledge, PRESETS, PRESET_NAMES, STAFF_ROLE_NAMES };
