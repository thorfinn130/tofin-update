module.exports = {
  name: "coinflip",
  aliases: ["cf"],
  run: (message) => message.reply(`🪙 **${Math.random() < 0.5 ? "Heads" : "Tails"}**`),
};
