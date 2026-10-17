const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

const CATEGORIES = {
  mod: {
    label: "🔨  Moderation",
    emoji: "🔨",
    color: 0xED4245,
    fields: [
      { name: "Mute / Ban", value: "`,mute @user <duration> [reason]` — temp mute\n`,ban @user [duration] [reason]` — ban (permanent if no duration)", inline: false },
      { name: "Warn / Manage", value: "`,warn @user <reason>` — warn & DM the user\n`,warnings @user` — view all warnings\n`,unwarn @user <id>` — remove a warning\n`,unmute @user` — lift a mute\n`,unban <userId>` — unban a user", inline: false },
      { name: "Channels", value: "`,lock` / `,unlock` — lock or unlock the channel\n`,slowmode <secs>` — set slowmode (0 = off)\n`,purge <amount>` — delete up to 100 messages", inline: false },
      { name: "Other", value: "`,nickname @user [name]` (`,tnick`) — change/reset nickname\n`,announce #channel <msg>` — send an announcement", inline: false },
      { name: "Jail System", value: "`,setup` — one-time setup: creates mute role, jail role/channel, mod category *(Admin)*\n`,jail @user [duration] [reason]` — jail a member, optional auto-release *(Admin)*\n`,unjail @user` — release & restore previous roles *(Admin)*\n`,jail channel #channel` / `,jail role @role` — reconfigure\n`,jail config` — view current setup", inline: false },
      { name: "Automod", value: "`,automod enable` / `,automod disable` — toggle the word filter *(Admin)*\n`,automod add <word>` / `,automod remove <word>` — manage blocked words\n`,automod list` — view current blocklist\n`,automod clear` — wipe the blocklist\n`,automod status` — current config", inline: false },
      { name: "Logging", value: "`,logs add #channel <events>` — send specific events to a channel *(Admin)*\n`,logs remove #channel <events>` — stop sending those events there\n`,logs list` — see configured log channels\n`,logs events` — list all loggable event types\n`,logs ignore @user/#channel` — exclude from logs", inline: false },
    ],
  },
  roles: {
    label: "👥  Roles & Info",
    emoji: "👥",
    color: 0x3498DB,
    fields: [
      { name: "Roles", value: "`,role <user> <role>` — give a role (or take it away if they have it). Names & typos are fine *(Manage Roles)*\n`,roleperm @role <preset>` — assign permission preset *(owner)*\nPresets: `trialmod_perm` · `mod_perm` · `admin_perm` · `coowner_perm`\n`,brole @role` — give to all bots\n`,mrole @role` — give to all members\n`,rc <name> [color]` — create a role, e.g. `,rc VIP gold` *(Manage Roles)*\n`,ec @role <color>` — change a role's color *(Manage Roles)*\n`,rf @role` — delete a role entirely *(Manage Roles)*", inline: false },
      { name: "Info", value: "`,userinfo [@user]` (`,ui`) — user details, roles & warnings\n`,serverinfo` (`,si`) — server stats\n`,roleinfo @role` (`,ri`) — role details (color, members, permissions)", inline: false },
      { name: "Status Roles", value: "`,status @role <text>` — auto-give a role when someone's custom status contains that text *(Manage Roles)*\n`,status list` — view active rules\n`,status remove @role` — stop tracking & strip the role from everyone\n> Removing the text from their status removes the role too", inline: false },
    ],
  },
  economy: {
    label: "💰  Economy",
    emoji: "💰",
    color: 0xF1C40F,
    fields: [
      { name: "Wallet & Bank", value: "`,balance [@user]` (`,bal`) — view wallet & bank\n`,deposit <amount|all>` (`,dep`) — wallet → bank\n`,withdraw <amount|all>` (`,with`) — bank → wallet\n`,transfer @user <amount>` (`,pay`) — send TC to someone", inline: false },
      { name: "Earn TC", value: "`,daily` — claim daily reward **(500 TC, 24h cooldown)**\n`,work` — earn TC every **1 hour**\n`,jobs list` — browse jobs for better pay\n`,jobs apply <id>` — apply for a job", inline: false },
    ],
  },
  casino: {
    label: "🎰  Casino",
    emoji: "🎰",
    color: 0xE67E22,
    fields: [
      { name: "Slots 🎰", value: "`,slots <bet>` — spin for 🍋🍒🔔💎7️⃣⭐\nThree of a kind = jackpot up to **25×**", inline: false },
      { name: "Blackjack 🃏", value: "`,blackjack <bet>` (`,bj`) — click **Hit / Stand / Double Down**\nNatural 21 = **2.5×** payout", inline: false },
      { name: "Roulette 🎡", value: "`,roulette <bet> <red|black|green|0-36>`\n🔴/⚫ = 2×  ·  🟢 = 14×  ·  Number = 35×", inline: false },
      { name: "Boosts", value: "`,shop buy luck_potion` — casino wins **1.5×** for 1h (500 TC)", inline: false },
    ],
  },
  shop: {
    label: "🛒  Shop & Mine",
    emoji: "🛒",
    color: 0x5865F2,
    fields: [
      { name: "Shop", value: "`,shop` — browse all items with a **select menu**\nQuick-buy directly from the menu!", inline: false },
      { name: "🎰 Boosts", value: "🧪 `luck_potion` **500 TC** — Casino 1.5× for 1h\n📜 `xp_scroll` **1,000 TC** — 2× XP for 30min\n💊 `stat_capsule` **2,500 TC** — +2 stat points", inline: false },
      { name: "⛏️ Mine System", value: "⛏️ `mine_category` **50,000 TC** — private mine category\n📺 `mine_channel` **8,000 TC** — add a channel\n🏭 `machine` **10,000 TC** — mining machine\n👷 `worker` **15,000 TC** — +25% boost per machine\n🤖 `auto_collector` **25,000 TC** — auto-collect every 6h", inline: false },
      { name: "Mine Commands", value: "`,addmachine <ch#>` — place a machine\n`,addworker <ch#>` — assign a worker\n`,addcollector <ch#>` — install auto collector", inline: false },
    ],
  },
  leveling: {
    label: "⭐  Leveling & Jobs",
    emoji: "⭐",
    color: 0x9B59B6,
    fields: [
      { name: "Profile & Stats", value: "`,profile [@user]` (`,prof`, `,rank`) — level card, stats, job & wealth\n`,stats` — view stats with **upgrade buttons**\n`,stats upgrade <str|int|cha|lck> [amt]` — spend points", inline: false },
      { name: "Stats Explained", value: "💪 **STR** — Driver, Security Guard jobs\n🧠 **INT** — Teacher, Programmer, Doctor, CEO\n🎭 **CHA** — Lawyer, Celebrity, CEO\n🍀 **LCK** — Casino odds & rare bonuses", inline: false },
      { name: "Jobs", value: "`,jobs list` — see all jobs and requirements\n`,jobs apply <id>` — apply for a job\nHigher jobs = more TC per `,work`", inline: false },
      { name: "Role Shop 🎭", value: "`,roleshop` — exclusive **Level 100** cosmetic roles\nRoles: 👑 King · ⚔️ Warlord · 🔮 Archmage · 💎 Diamond · 🔥 Inferno · 🌑 Shadow", inline: false },
    ],
  },
  fun: {
    label: "🎉  Fun & Engagement",
    emoji: "🎉",
    color: 0x2ECC71,
    fields: [
      { name: "Games & Fun", value: "`,8ball <question>` — magic 8-ball\n`,coinflip` — heads or tails\n`,joke` — random joke\n`,roast @user` — roast someone", inline: false },
      { name: "Server Events", value: "`,poll <question> | <opt1> | <opt2>` — reaction poll\n`,giveaway <duration> <prize>` (`,gw`) — timed giveaway\n`,randomwinner @role` (`,rw`) — pick a random winner\n`/giveaway create` — advanced giveaway with a **Join** button (not reactions)\n> If a required role/level is set, clicking Join is blocked with an explanation unless you qualify", inline: false },
      { name: "Emojis", value: "`,emoji list` — view all custom emojis\n`,emoji add <name> <url>` — add an emoji\n`,emoji remove <name>` — remove an emoji", inline: false },
      { name: "Confessions", value: "`,confessions setup #channel` — enable anonymous confessions *(Admin)*\n`,confessions disable` — turn it off\n`/confess` — submit an anonymous confession\n`,confessions blacklist @user` — block someone from confessing *(Admin)*\n`,confessions mute <id>` / `,confessions unmute <id>` — mute a confession thread\n`,confessions report <id> <reason>` — report a confession", inline: false },
    ],
  },
  server: {
    label: "💾  Server Tools",
    emoji: "💾",
    color: 0x95A5A6,
    fields: [
      { name: "Backups", value: "`,backup create [name]` — save server snapshot *(admin)*\n`,backup restore <id>` — restore a backup *(admin)*\n`,backup list` — list saved backups *(admin)*", inline: false },
      { name: "Templates", value: "`,template save <name>` — save server as template *(admin)*\n`,template load <name> [roles|channels|bots]` — load *(owner)*\n`,template list` — your saved templates\n`,template delete <name>` — delete a template\n`,templatelink <name|code>` — shareable one-time link *(owner)*", inline: false },
      { name: "Join-to-Create VC", value: "`/vcset add #channel` — joining that VC creates a private channel & moves you in *(Manage Channels)*\n`/vcset remove #channel` / `/vcset list` — manage trigger channels\n> The creator gets full channel permissions automatically (rename, lock, kick, limit, etc.) — just right-click the channel in Discord, no extra commands needed", inline: false },
      { name: "Owner Tools", value: "`,restart` — wipe all channels, roles & kick bots *(owner)*\n`,giveownership` — give bot full Administrator + highest role *(owner)*\n`,execute @role` — kick everyone (members & bots) with that role *(owner)*", inline: false },
      { name: "Invite Tracking", value: "`,invites [@user]` (`,invite`, `,inv`) — see how many people someone invited\nAutomatically tracks who invited each new member", inline: false },
    ],
  },
  serverlist: {
    label: "📜  Server List",
    emoji: "📜",
    color: 0x7289DA,
    fields: [
      { name: "View", value: "`,servers` — view the list of partnered/listed servers", inline: false },
      { name: "Manage", value: "`,servers add` — opens an interactive builder (pick server, set link/desc/banner/icon/color/tags/layout) *(if permitted)*\n`,servers remove <serverId>` — remove a server *(if permitted)*\n`,servers allowed` — see who's permitted to add servers", inline: false },
    ],
  },
  templateshop: {
    label: "🧱  Template Shop",
    emoji: "🧱",
    color: 0xD4AF37,
    fields: [
      { name: "Browse & Buy", value: "`,templateshop` (`,tplshop`) — browse listings with **◀ ▶** page buttons + **🛒 Quick Buy**\nEach page shows roles, channels, price & seller\n`,templateshop buy <listingId>` — buy directly without browsing", inline: false },
      { name: "Sell", value: "`,templateshop sell <template name> <price>` — list one of your saved templates for sale\n`,templateshop mine` — see your active listings\n`,templateshop unlist <listingId>` — take a listing down", inline: false },
      { name: "After Buying", value: "Purchased templates are copied into **your own** `,template` collection\nUse `,template load <name>` to apply it to a server you own", inline: false },
    ],
  },
  utilities: {
    label: "🛠️  Utilities",
    emoji: "🛠️",
    color: 0x1ABC9C,
    fields: [
      { name: "🏓 Ping", value: "`,ping` — bot & API latency with quality indicator", inline: false },
      { name: "🖼️ Avatar", value: "`,avatar [@user]` (`,av`, `,pfp`) — full-size avatar with download links\nShows server avatar vs global avatar when different", inline: false },
      { name: "🎬 GIF Maker", value: "`/gif` — upload an image or paste a URL, with an optional caption\n`,gif [caption]` — reply to an image/GIF with this to convert it (caption optional)\n`,caption gif <url> <caption>` — caption an animated GIF by URL\n> Captions appear as a white bar above the image, meme-style. Animated GIFs stay animated.", inline: false },
      { name: "🔍 Snipe", value: "`,snipe` (`,s`) — shows the last deleted message in this channel\n`,snipe 2`, `,snipe 3`, etc. — go back further (up to 100 stored per channel)\nIncludes author, content, attachments & how long ago it was deleted", inline: false },
      { name: "🎚️ Server Toggles", value: "`,levelon` / `,leveloff` — enable/disable XP & level-up messages *(Admin)*\n`,channelon` / `,channeloff` — enable/disable shop auto-channel creation *(Admin)*", inline: false },
      { name: "🤖 AI Chat — Toggle", value: "`,aion` — turn AI chat **ON** *(Manage Server)*\n`,aioff` — turn AI chat **OFF** *(Manage Server)*\n`,aistatus` — which AI provider is active *(Admin)*", inline: false },
      { name: "🤖 AI Chat — Commands", value: "`,aiask <question>` — one-off AI answer, no memory stored\n`,aiclear` — wipe bot memory for this channel *(Manage Messages)*\n`,aimemory` — see what bot remembers in this channel *(Manage Messages)*\n`,aimodel` — show current active AI provider\n`,resetcooldown <gemini|groq|openrouter|all>` — manually clear a rate-limited provider *(Admin)*", inline: false },
      { name: "📥 Social Media Downloader", value: "Paste any link and Tofin auto-downloads it:\n**TikTok** · **Instagram** · **Twitter/X** · **Reddit**\n**YouTube Shorts** · **Twitch Clips** · **Vimeo** · **Pinterest**\n> No command needed — just drop the link", inline: false },
      { name: "💤 AFK", value: "`,afk [reason]` — set yourself AFK\nAuto-clears when you talk again; pings you get a heads-up reply showing you're AFK", inline: false },
      { name: "🔤 Aliases", value: "`,alias add <shortcut> <command...>` — create a custom shortcut *(Manage Server)*\n`,alias remove <shortcut>` — delete one\n`,alias list` — view all custom aliases for this server", inline: false },
      { name: "🤖 Bot Info", value: "`,botinfo` (`,about`, `,bi`) — uptime, server/user counts, version info", inline: false },
      { name: "👥 Member Count", value: "`,membercount` (`,mc`, `,members`) — total members, humans vs bots, online count", inline: false },
      { name: "💬 Message Stats", value: "`,messages [@user]` (`,msgs`, `,msgcount`) — tracked message count for a user", inline: false },
      { name: "⏰ Reminders", value: "`,reminder <duration> <text>` (`,remind`, `,remindme`) — get pinged later\n**Example:** `,reminder 2h check the oven`", inline: false },
      { name: "🎭 Bot Reskin", value: "`,reskin setup` — start customizing the bot's name/avatar/banner for this server *(Admin)*\n`,reskin name <name>` · `,reskin avatar <url>` · `,reskin banner <url>` — customize\n`,reskin status` / `,reskin disable` / `,reskin reset` — manage\n`,reskinai <persona>` (`,ainame`, `,aipersona`) — give the bot an AI personality for this server", inline: false },
      { name: "🌐 Translate", value: "`,t <language> <text>` (`,translate`) — translate text into another language", inline: false },
    ],
  },
};

function overviewEmbed(author) {
  return new EmbedBuilder()
    .setAuthor({ name: "Tofin Bot", iconURL: "https://cdn.discordapp.com/embed/avatars/0.png" })
    .setTitle("<:tools:1519108058507120691>  Command Help")
    .setDescription(
      `> Use the **menu below** to browse command categories!\n\n` +
      `**<:moderation:1519184871136825395>  Moderation** — mute, ban, warn, purge\n` +
      `**<:informationbutton:1519185565222830191>  Roles & Info** — role management, userinfo\n` +
      `**<:circulareconomy:1519185825617936404>  Economy** — balance, daily, work, transfer\n` +
      `**🎰  Casino** — slots, blackjack, roulette\n` +
      `**🛒  Shop & Mine** — buy items, mine system\n` +
      `**⭐  Leveling & Jobs** — stats, profile, role shop\n` +
      `**🎉  Fun** — polls, giveaways, games\n` +
      `**💾  Server Tools** — backups, templates, owner tools\n` +
      `**📜  Server List** — view & manage listed servers\n` +
      `**🧱  Template Shop** — buy & sell server templates\n` +
      `**🛠️  Utilities** — AI toggle & tools`
    )
    .setColor(0x5865F2)
    .setFooter({ text: `Requested by ${author.username}  ·  All commands use the , prefix` })
    .setTimestamp();
}

function categoryEmbed(key, author) {
  const cat = CATEGORIES[key];
  return new EmbedBuilder()
    .setTitle(`${cat.emoji}  ${cat.label.trim()}`)
    .addFields(cat.fields)
    .setColor(cat.color)
    .setFooter({ text: `Requested by ${author.username}  ·  Use the menu to switch categories` })
    .setTimestamp();
}

function buildMenu(userId, selected = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`help_cat:${userId}`)
    .setPlaceholder("📂  Select a category...")
    .addOptions(
      Object.entries(CATEGORIES).map(([key, cat]) => ({
        label: cat.label.trim(),
        value: key,
        emoji: cat.emoji,
        default: key === selected,
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  name: "help",
  aliases: ["thelp"],
  CATEGORIES, categoryEmbed, buildMenu,
  run(message) {
    const userId = message.author.id;
    return message.reply({
      embeds: [overviewEmbed(message.author)],
      components: [buildMenu(userId)],
    });
  },
};