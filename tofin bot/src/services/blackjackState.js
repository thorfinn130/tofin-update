// Shared in-memory game state for button-driven blackjack
// games: userId → { deck, playerHand, dealerHand, bet, guildId }
const games = new Map();
module.exports = { games };
