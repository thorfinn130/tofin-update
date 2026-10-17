const { getUser, transfer, fmt } = require("../../services/economy");
const { memberFromArgs, roleFromArgs } = require("../../util/resolve");
const { success, warn } = require("../../util/embed");

module.exports = {
  name: "transfer",
  aliases: ["pay", "give"],
  async run(message, args) {
    const target = (await memberFromArgs(message, args, 0))?.user;
    if (!target || target.bot) return message.reply({ embeds: [warn("Missing User", "Mention a valid member to send TC to.\n**Usage:** `,transfer @user <amount>`")] });
    if (target.id === message.author.id) return message.reply({ embeds: [warn("Invalid", "You can't send TC to yourself.")] });
    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount <= 0) return message.reply({ embeds: [warn("Invalid Amount", "Provide a positive amount.\n**Usage:** `,transfer @user <amount>`")] });
    const result = transfer(message.author.id, target.id, amount);
    if (!result) {
      const u = getUser(message.author.id);
      return message.reply({ embeds: [warn("Insufficient Funds", `You only have **${fmt(u.wallet)} TC** in your wallet.`)] });
    }
    return message.reply({ embeds: [success("Transfer Sent", `💸  Sent **${fmt(amount)} TC** to ${target}.\nYour wallet: **${fmt(result.from.wallet)} TC`)] });
  },
};
