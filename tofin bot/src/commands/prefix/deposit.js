const { getUser, deposit, fmt } = require("../../services/economy");
const { success, warn } = require("../../util/embed");

module.exports = {
  name: "deposit",
  aliases: ["dep"],
  run(message, args) {
    const u = getUser(message.author.id);
    const raw = args[0]?.toLowerCase();
    if (!raw) return message.reply({ embeds: [warn("Missing Amount", "Provide an amount or `all`.\n**Usage:** `,deposit <amount|all>`")] });
    const amount = raw === "all" ? u.wallet : parseInt(raw);
    if (isNaN(amount) || amount <= 0) return message.reply({ embeds: [warn("Invalid Amount", "Provide a positive number or `all`.")] });
    const result = deposit(message.author.id, amount);
    if (!result) return message.reply({ embeds: [warn("Insufficient Funds", `You only have **${fmt(u.wallet)} TC** in your wallet.`)] });
    return message.reply({ embeds: [success("Deposited", `🏦  **${fmt(amount)} TC** moved to your bank.\nWallet: **${fmt(result.wallet)} TC** | Bank: **${fmt(result.bank)} TC`)] });
  },
};
