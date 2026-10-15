const { getUser, removeWallet, addWallet, fmt } = require("../../services/economy");
const { hasBuff } = require("../../services/buffs");
const { warn } = require("../../util/embed");
const { EmbedBuilder } = require("discord.js");
const { colors } = require("../../config");

const REDS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SPIN_FRAMES = ["🔴⚫🔴⚫🔴", "⚫🔴⚫🔴⚫", "🔴⚫🔴⚫🔴", "⚫🔴⚫🔴⚫", "🟢🔴⚫🔴⚫"];

module.exports = {
  name: "roulette",
  aliases: ["rou"],
  async run(message, args) {
    const userId = message.author.id;
    const bet = parseInt(args[0]);
    const pick = args[1]?.toLowerCase();

    if (isNaN(bet) || bet <= 0 || !pick) {
      return message.reply({ embeds: [warn("Invalid Bet", "**Usage:** `,roulette <amount> <red|black|green|0-36>`\n**Examples:**\n`,roulette 100 red` — 2x payout\n`,roulette 100 black` — 2x payout\n`,roulette 50 green` — 14x payout\n`,roulette 50 7` — 35x payout")] });
    }

    const user = getUser(userId);
    if (user.wallet < bet) {
      return message.reply({ embeds: [warn("Insufficient Funds", `You only have **${fmt(user.wallet)} TC** in your wallet.`)] });
    }

    const numPick = parseInt(pick);
    const validPick = pick === "red" || pick === "black" || pick === "green" || (!isNaN(numPick) && numPick >= 0 && numPick <= 36);
    if (!validPick) {
      return message.reply({ embeds: [warn("Invalid Choice", "Choose `red`, `black`, `green`, or a number `0-36`.")] });
    }

    removeWallet(userId, bet);

    const spinEmbed = new EmbedBuilder()
      .setTitle("🎡  Roulette — Spinning...")
      .setDescription(`${SPIN_FRAMES[0]}\n\n**Your pick:** ${pick.toUpperCase()}\n**Bet:** ${fmt(bet)} TC`)
      .setColor(0xc0392b)
      .setTimestamp();

    const msg = await message.reply({ embeds: [spinEmbed] });

    for (let i = 1; i < SPIN_FRAMES.length; i++) {
      await sleep(500);
      await msg.edit({ embeds: [spinEmbed.setDescription(`${SPIN_FRAMES[i]}\n\n**Your pick:** ${pick.toUpperCase()}\n**Bet:** ${fmt(bet)} TC`)] });
    }
    await sleep(600);

    const result = Math.floor(Math.random() * 37);
    const isRed = REDS.includes(result);
    const isGreen = result === 0;
    const isBlack = !isRed && !isGreen;
    const resultColor = isGreen ? "🟢 Green" : isRed ? "🔴 Red" : "⚫ Black";
    const resultEmoji = isGreen ? "🟢" : isRed ? "🔴" : "⚫";

    let mult = 0;
    if (pick === "red" && isRed) mult = 2;
    else if (pick === "black" && isBlack) mult = 2;
    else if (pick === "green" && isGreen) mult = 14;
    else if (!isNaN(numPick) && numPick === result) mult = 35;

    let winnings = Math.floor(bet * mult);
    const luckActive = winnings > 0 && hasBuff(message.guild.id, userId, "luck_potion");
    if (luckActive) winnings = Math.floor(winnings * 1.5);
    if (winnings > 0) addWallet(userId, winnings);
    const finalUser = getUser(userId);
    const net = winnings - bet;
    const won = winnings > 0;

    const resultEmbed = new EmbedBuilder()
      .setTitle(`🎡  Roulette — ${resultEmoji} **${result}** — ${resultColor}`)
      .setDescription(
        `**Your Pick:** ${pick.toUpperCase()}\n` +
        (won
          ? `💰  Won **${fmt(winnings)} TC** (${mult}x${luckActive ? " · 🧪 1.5×" : ""})\nNet: **+${fmt(net)} TC**`
          : `💸  Lost **${fmt(bet)} TC**\nNet: **-${fmt(bet)} TC**`)
      )
      .addFields({ name: "👛  New Wallet", value: `**${fmt(finalUser.wallet)} TC**`, inline: true })
      .setColor(won ? colors.success : colors.danger)
      .setFooter({ text: `Bet: ${fmt(bet)} TC • Tofin Coin Casino` })
      .setTimestamp();

    await msg.edit({ embeds: [resultEmbed] });
  },
};
