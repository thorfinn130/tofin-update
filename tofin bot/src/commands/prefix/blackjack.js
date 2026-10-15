const { getUser, removeWallet, fmt } = require("../../services/economy");
const { hasBuff } = require("../../services/buffs");
const { warn } = require("../../util/embed");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { games } = require("../../services/blackjackState");

const SUITS = ["♠️", "♥️", "♦️", "♣️"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck.sort(() => Math.random() - 0.5);
}
function cardVal(card) {
  if (["J","Q","K"].includes(card.r)) return 10;
  if (card.r === "A") return 11;
  return parseInt(card.r);
}
function handVal(hand) {
  let t = hand.reduce((s,c) => s + cardVal(c), 0);
  let a = hand.filter(c => c.r === "A").length;
  while (t > 21 && a > 0) { t -= 10; a--; }
  return t;
}
function cardStr(hand) { return hand.map(c => `\`${c.r}${c.s}\``).join("  "); }

function bjEmbed(author, playerHand, dealerHand, bet, hideDealer = true, status = "playing", winnings = 0) {
  const pVal = handVal(playerHand);
  const dVal = hideDealer ? "?" : handVal(dealerHand);
  const dCards = hideDealer
    ? `${cardStr([dealerHand[0]])}  \`🂠\``
    : cardStr(dealerHand);

  const color = status === "win" || status === "bj" ? 0x57F287
    : status === "lose" ? 0xED4245
    : status === "push" ? 0xFEE75C
    : 0x5865F2;

  const title = {
    playing: "🃏  Blackjack — Your Turn",
    win: "🏆  You Win!",
    lose: "💀  Busted — You Lose!",
    bj: "🎉  BLACKJACK! Natural 21!",
    push: "🤝  Push — It's a Tie!",
    dlose: "🏆  Dealer Busts — You Win!",
  }[status] ?? "🃏  Blackjack";

  const e = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: `🏦  Dealer  (${dVal})`, value: dCards, inline: false },
      { name: `👤  ${author.username}  (${pVal})`, value: cardStr(playerHand), inline: false },
    )
    .setTimestamp();

  if (status !== "playing") {
    const net = winnings - bet;
    e.addFields({
      name: winnings > 0 ? "💰  Payout" : "💸  Lost",
      value: winnings > 0
        ? `Won **${fmt(winnings)} TC**\nNet: **+${fmt(net)} TC**`
        : `Lost **${fmt(bet)} TC**`,
      inline: true,
    });
  } else {
    e.setFooter({ text: `Bet: ${fmt(bet)} TC  ·  Double doubles your bet & draws one card` });
  }

  return e;
}

function gameButtons(userId, canDouble) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_hit:${userId}`)
      .setLabel("🃏  Hit")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bj_stand:${userId}`)
      .setLabel("🛑  Stand")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`bj_double:${userId}`)
      .setLabel("💰  Double Down")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canDouble),
  );
}

module.exports = {
  name: "blackjack",
  aliases: ["bj"],
  bjEmbed, cardStr, handVal, gameButtons,
  async run(message, args) {
    const userId = message.author.id;

    if (games.has(userId)) {
      return message.reply({ embeds: [warn("Active Game", "You already have a blackjack game running!\nClick Hit, Stand, or Double to continue.")] });
    }

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) {
      return message.reply({ embeds: [warn("Invalid Bet", "**Usage:** `,blackjack <amount>`\n**Example:** `,blackjack 500`")] });
    }

    const user = getUser(userId);
    if (user.wallet < bet) {
      return message.reply({ embeds: [warn("Insufficient Funds", `You only have **${fmt(user.wallet)} TC** in your wallet.`)] });
    }

    removeWallet(userId, bet);

    const deck = buildDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    // Natural blackjack
    if (handVal(playerHand) === 21) {
      const { addWallet } = require("../../services/economy");
      const winnings = Math.floor(bet * 2.5);
      addWallet(userId, winnings);
      const finalUser = getUser(userId);
      return message.reply({ embeds: [
        bjEmbed(message.author, playerHand, dealerHand, bet, false, "bj", winnings)
          .addFields({ name: "💳  New Wallet", value: `**${fmt(finalUser.wallet)} TC**`, inline: true }),
      ] });
    }

    games.set(userId, { deck, playerHand, dealerHand, bet, guildId: message.guild.id });

    const canDouble = user.wallet - bet >= bet; // already removed bet once
    const embed = bjEmbed(message.author, playerHand, dealerHand, bet);
    const row = gameButtons(userId, canDouble);

    await message.reply({ embeds: [embed], components: [row] });
  },
};
