const { EmbedBuilder } = require("discord.js");
const { getAliases, addAlias, removeAlias } = require("../../services/alias");
const { success, danger, warn, info } = require("../../util/embed");

module.exports = {
  name: "alias",
  async run(message, args) {
    if (!message.member.permissions.has(0x20n)) {
      return message.reply({ embeds: [danger("Missing Permission", "You need **Manage Server** to manage aliases.")] });
    }

    const sub = args[0]?.toLowerCase();

    // ,alias list
    if (!sub || sub === "list") {
      const aliases = getAliases(message.guild.id);
      const entries = Object.entries(aliases);
      if (!entries.length) {
        return message.reply({ embeds: [info("No Aliases", "No aliases set for this server.\n**Add one:** `,alias add <alias> <command>`")] });
      }
      const lines = entries.map(([a, cmd]) => `**,${a}** → \`,${cmd}\``).join("\n");
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📋  Server Aliases")
            .setDescription(lines)
            .setColor(0x5865f2)
            .setFooter({ text: `${entries.length} alias${entries.length !== 1 ? "es" : ""}` })
            .setTimestamp(),
        ],
      });
    }

    // ,alias add <alias> <command>
    if (sub === "add" || sub === "set") {
      const alias   = args[1]?.toLowerCase();
      const command = args.slice(2).join(" ").trim();
      if (!alias || !command) {
        return message.reply({ embeds: [warn("Usage", "**Usage:** `,alias add <alias> <command>`\n**Example:** `,alias add b ban`")] });
      }
      if (alias.length > 20) {
        return message.reply({ embeds: [warn("Too Long", "Alias must be 20 characters or fewer.")] });
      }
      const current = getAliases(message.guild.id);
      if (current[alias]) {
        return message.reply({ embeds: [warn("Already Exists", `The alias **,${alias}** already points to \`,${current[alias]}\`.\nRemove it first with \`,alias remove ${alias}\`.`)] });
      }
      addAlias(message.guild.id, alias, command);
      return message.reply({
        embeds: [success("Alias Added", `**,${alias}** will now run \`,${command}\``)],
      });
    }

    // ,alias remove <alias>
    if (sub === "remove" || sub === "delete") {
      const alias = args[1]?.toLowerCase();
      if (!alias) return message.reply({ embeds: [warn("Usage", "**Usage:** `,alias remove <alias>`")] });
      const removed = removeAlias(message.guild.id, alias);
      if (!removed) return message.reply({ embeds: [danger("Not Found", `No alias **,${alias}** exists in this server.`)] });
      return message.reply({ embeds: [success("Alias Removed", `The alias **,${alias}** has been removed.`)] });
    }

    return message.reply({
      embeds: [warn(
        "Usage",
        "`,alias add <alias> <command>` — create a shortcut\n**Example:** `,alias add help thelp` → now `,help` runs `,help`\n`,alias remove <alias>` — delete one\n`,alias list` — view all aliases"
      )],
    });
  },
};