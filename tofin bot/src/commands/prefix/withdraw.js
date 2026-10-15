const { getUser, withdraw, fmt } = require("../../services/economy");
const { success, warn } = require("../../util/embed");

module.exports = {
  name: "withdraw",
  aliases: ["with"],
  run(message, args) {
    const u = getUser(message.author.id);
    const raw = args[0]?.toLowerCase();
    if (!raw) return message.reply({ embeds: [warn("Missing Amount", "Provide an amount or `all`.\n**Usage:** `,withdraw <amount|all>`")] });
    const amount = raw === "all" ? u.bank : parseInt(raw);
    if (isNaN(amount) || amount <= 0) return message.reply({ embeds: [warn("Invalid Amount", "Provide a positive number or `all`.")] });
    const result = withdraw(message.author.id, amount);
    if (!result) return message.reply({ embeds: [warn("Insufficient Funds", `You only have **${fmt(u.bank)} TC** in your bank.`)] });
    return message.reply({ embeds: [success("Withdrawn", `👛  **${fmt(amount)} TC** moved to your wallet.\nWallet: **${fmt(result.wallet)} TC** | Bank: **${fmt(result.bank)} TC`)] });
  },
};
