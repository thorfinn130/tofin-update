const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getConfig, setEnabled, addWord, removeWord, clearWords } = require("../../services/automod");
const { success, danger, warn, info } = require("../../util/embed");

const ADMIN = PermissionFlagsBits.ManageGuild;

module.exports = {
  name: "automod",
  async run(message, args) {
    if (!message.member.permissions.has(ADMIN)) {
      return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server** to configure automod.")] });
    }

    const sub = args[0]?.toLowerCase();
    const guildId = message.guild.id;

    // ,automod (no sub) — show status
    if (!sub || sub === "status") {
      const cfg = getConfig(guildId);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🛡️  Automod Settings")
            .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
            .addFields(
              { name: "Status",        value: cfg.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
              { name: "Blocked Words", value: `${cfg.words.length}`, inline: true },
              { name: "Word List",     value: cfg.words.length ? cfg.words.map(w => `\`${w}\``).join(", ") : "*None set*", inline: false },
            )
            .addFields({ name: "Commands", value: "`,automod enable` / `,automod disable`\n`,automod add <word>` — add a blocked word\n`,automod remove <word>` — remove a word\n`,automod list` — see all blocked words\n`,automod clear` — remove all words", inline: false })
            .setFooter({ text: "Custom word filter — bot deletes messages containing blocked words" })
            .setTimestamp(),
        ],
      });
    }

    if (sub === "enable" || sub === "on") {
      setEnabled(guildId, true);
      return message.reply({ embeds: [success("Automod Enabled", "The bot will now delete messages containing blocked words.")] });
    }

    if (sub === "disable" || sub === "off") {
      setEnabled(guildId, false);
      return message.reply({ embeds: [success("Automod Disabled", "Word filtering has been turned off.")] });
    }

    if (sub === "list") {
      const cfg = getConfig(guildId);
      if (!cfg.words.length) return message.reply({ embeds: [info("No Words", "No blocked words set. Use `,automod add <word>` to add one.")] });
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🚫  Blocked Words")
            .setDescription(cfg.words.map((w) => `\`${w}\``).join(", "))
            .setColor(0xed4245)
            .setFooter({ text: `${cfg.words.length} blocked word${cfg.words.length !== 1 ? "s" : ""}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === "add") {
      const word = args[1]?.toLowerCase();
      if (!word) return message.reply({ embeds: [warn("Missing Word", "**Usage:** `,automod add <word>`")] });
      const added = addWord(guildId, word);
      if (!added) return message.reply({ embeds: [warn("Already Added", `\`${word}\` is already in the blocked words list.`)] });
      return message.reply({ embeds: [success("Word Added", `\`${word}\` has been added to the blocked words list.`)] });
    }

    if (sub === "remove") {
      const word = args[1]?.toLowerCase();
      if (!word) return message.reply({ embeds: [warn("Missing Word", "**Usage:** `,automod remove <word>`")] });
      const removed = removeWord(guildId, word);
      if (!removed) return message.reply({ embeds: [danger("Not Found", `\`${word}\` is not in the blocked words list.`)] });
      return message.reply({ embeds: [success("Word Removed", `\`${word}\` has been removed from the blocked words list.`)] });
    }

    if (sub === "clear") {
      clearWords(guildId);
      return message.reply({ embeds: [success("List Cleared", "All blocked words have been removed.")] });
    }

    return message.reply({ embeds: [warn("Unknown Subcommand", "**Available:** `enable` · `disable` · `add` · `remove` · `list` · `clear` · `status`")] });
  },
};
