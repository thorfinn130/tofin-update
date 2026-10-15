const { getUser, removeWallet, addWallet, fmt } = require("../../services/economy");
const { hasBuff } = require("../../services/buffs");
const { warn } = require("../../util/embed");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const SYMBOLS = [
  { e: "🍋", name: "Lemon",   weight: 35, mult: 1.5 },
  { e: "🍒", name: "Cherry",  weight: 30, mult: 2   },
  { e: "🔔", name: "Bell",    weight: 20, mult: 3   },
  { e: "💎", name: "Diamond", weight: 10, mult: 5   },
  { e: "7️⃣",  name: "Seven",   weight: 4,  mult: 10  },
  { e: "⭐", name: "Star",    weight: 1,  mult: 25  },
];

function spin() {
  const total = SYMBOLS.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const s of SYMBOLS) { if (r < s.weight) return s; r -= s.weight; }
  return SYMBOLS[0];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function spinFrame(r1, r2, r3, title, footer) {
  return new EmbedBuilder()
    .setTitle(title ?? "🎰  Slot Machine")
    .setDescription(
      `╔══════════════════╗\n` +
      `║   ${r1}  ┃  ${r2}  ┃  ${r3}   ║\n` +
      `╚══════════════════╝`
    )
    .setColor(0xF1C40F)
    .setFooter({ text: footer ?? "Tofin Casino" })
    .setTimestamp();
}

async function doSpin(userId, guildId, bet, replyFn) {
  const user = getUser(userId);
  if (user.wallet < bet) {
    return replyFn({ embeds: [warn("Insufficient Funds", `You only have **${fmt(user.wallet)} TC** in your wallet.`)], components: [] });
  }

  removeWallet(userId, bet);

  const msg = await replyFn({ embeds: [spinFrame("🌀", "🌀", "🌀", "🎰  Spinning...", `Bet: ${fmt(bet)} TC`)], components: [] });

  await sleep(600);
  const r1 = spin();
  await msg.edit({ embeds: [spinFrame(r1.e, "🌀", "🌀", "🎰  Spinning...", `Bet: ${fmt(bet)} TC`)] });

  await sleep(650);
  const r2 = spin();
  await msg.edit({ embeds: [spinFrame(r1.e, r2.e, "🌀", "🎰  Spinning...", `Bet: ${fmt(bet)} TC`)] });

  await sleep(700);
  const r3 = spin();

  const allSame = r1.e === r2.e && r2.e === r3.e;
  const twoSame = r1.e === r2.e || r2.e === r3.e || r1.e === r3.e;

  let winnings = 0;
  let resultTitle, resultColor;

  if (allSame) {
    winnings = Math.floor(bet * r1.mult);
    resultTitle = `🎉  JACKPOT!  ${r1.e} ${r1.e} ${r1.e}  —  ${r1.mult}×`;
    resultColor = 0xFFD700;
  } else if (twoSame) {
    winnings = Math.floor(bet * 1.2);
    resultTitle = "✨  Two of a Kind  —  1.2×";
    resultColor = 0xFEE75C;
  } else {
    resultTitle = "💀  No Match";
    resultColor = 0xED4245;
  }

  const luckActive = winnings > 0 && hasBuff(guildId, userId, "luck_potion");
  if (luckActive) winnings = Math.floor(winnings * 1.5);
  if (winnings > 0) addWallet(userId, winnings);

  const finalUser = getUser(userId);
  const net = winnings - bet;

  const again = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`slots_again:${userId}:${bet}`)
      .setLabel(`🔄  Spin Again  (${fmt(bet)} TC)`)
      .setStyle(ButtonStyle.Secondary),
  );

  await msg.edit({
    embeds: [
      new EmbedBuilder()
        .setTitle(resultTitle)
        .setDescription(
          `╔══════════════════╗\n` +
          `║   ${r1.e}  ┃  ${r2.e}  ┃  ${r3.e}   ║\n` +
          `╚══════════════════╝\n\n` +
          (winnings > 0
            ? `> 💰  Won **${fmt(winnings)} TC**${luckActive ? "  🧪 ×1.5" : ""}\n> 📈  Net: **+${fmt(net)} TC**`
            : `> 💸  Lost **${fmt(bet)} TC**\n> 📉  Net: **-${fmt(bet)} TC**`)
        )
        .addFields({ name: "💳  Wallet", value: `**${fmt(finalUser.wallet)} TC**`, inline: true })
        .setColor(resultColor)
        .setFooter({ text: `Bet: ${fmt(bet)} TC  ·  Tofin Casino` })
        .setTimestamp(),
    ],
    components: [again],
  });

  return msg;
}

module.exports = {
  name: "slots",
  doSpin,
  async run(message, args) {
    const userId = message.author.id;
    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) {
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle("🎰  Slot Machine")
          .setDescription("**Usage:** `,slots <bet>`\n\n**Payouts:**\n🍋 Lemon — 1.5×\n🍒 Cherry — 2×\n🔔 Bell — 3×\n💎 Diamond — 5×\n7️⃣ Seven — 10×\n⭐ Star — **25×**\n\n*Two of a kind pays 1.2×*\n*Use 🧪 Luck Potion for 1.5× on wins!*")
          .setColor(0xF1C40F)
          .setTimestamp(),
      ] });
    }

    const user = getUser(userId);
    if (user.wallet < bet) {
      return message.reply({ embeds: [warn("Insufficient Funds", `You only have **${fmt(user.wallet)} TC** in your wallet.`)] });
    }

    await doSpin(userId, message.guild.id, bet, (opts) => message.reply(opts));
  },
};
