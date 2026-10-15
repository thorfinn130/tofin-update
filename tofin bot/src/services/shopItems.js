const ITEMS = [
  {
    id: "luck_potion",
    name: "Luck Potion",
    emoji: "🧪",
    price: 500,
    desc: "Casino wins pay **1.5×** for **1 hour**",
    detail: "Applies to slots, blackjack, and roulette.",
  },
  {
    id: "xp_scroll",
    name: "XP Scroll",
    emoji: "📜",
    price: 1_000,
    desc: "**2× XP** from messages for **30 minutes**",
    detail: "Stacks with your natural XP gain.",
  },
  {
    id: "stat_capsule",
    name: "Stat Capsule",
    emoji: "💊",
    price: 2_500,
    desc: "Instantly grants **+2 stat points**",
    detail: "Use with `,stats upgrade` to spend them.",
  },
  {
    id: "mine_category",
    name: "Mine Category",
    emoji: "⛏️",
    price: 50_000,
    desc: "Creates your **private mine category** on this server",
    detail: "One-time per server. Required before buying channels.",
  },
  {
    id: "mine_channel",
    name: "Mine Channel",
    emoji: "📺",
    price: 8_000,
    desc: "Adds a **new channel** inside your mine category",
    detail: "Requires a Mine Category. Each channel holds 1 machine.",
  },
  {
    id: "machine",
    name: "Mining Machine",
    emoji: "🏭",
    price: 10_000,
    desc: "Adds **1 machine** to your inventory — use `,addmachine <ch#>` to place it",
    detail: "Max level 30. One machine per channel. Works across all servers.",
  },
  {
    id: "worker",
    name: "Worker",
    emoji: "👷",
    price: 15_000,
    desc: "Boosts one channel's machine earnings by **+25%** per worker",
    detail: "Max 3 workers per channel. Use `,addworker <ch#>` to assign.",
  },
  {
    id: "auto_collector",
    name: "Auto Collector",
    emoji: "🤖",
    price: 25_000,
    desc: "Automatically collects TC from a channel every **6 hours**",
    detail: "One per channel. Use `,addcollector <ch#>` to assign.",
  },
];

function getItem(id) { return ITEMS.find(i => i.id === id); }

module.exports = { ITEMS, getItem };
