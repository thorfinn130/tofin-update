const { getWarnings } = require("../../services/moderation");
const { memberFromArgs, roleFromArgs } = require("../../util/resolve");
const { info } = require("../../util/embed");

module.exports = {
  name: "warnings",
  async run(message, args) {
    const user = (args[0] ? (await memberFromArgs(message, args, 0))?.user : null) ?? message.author;
    const list = getWarnings(message.guild.id, user.id);
    const desc = list.length
      ? list.map((w, i) => `**${i + 1}.** ${w.reason} — <@${w.by}>`).join("\n")
      : "_No warnings._";
    return message.reply({ embeds: [info(`Warnings for ${user.tag}`, desc)] });
  },
};
