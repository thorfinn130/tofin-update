const { EmbedBuilder } = require("discord.js");
const { getAiPersona, setAiPersona, clearAiPersona } = require("../../services/reskin");
const { success, danger } = require("../../util/embed");

module.exports = {
  name: "reskinai",
  aliases: ["ainame", "aipersona"],
  async run(message, args) {
    const sub = args[0]?.toLowerCase();

    // ,reskinai clear / off — remove persona
    if (sub === "clear" || sub === "reset" || sub === "off" || sub === "remove") {
      const current = getAiPersona(message.author.id);
      if (!current) return message.reply({ embeds: [danger("Not Set", "You don't have an AI persona set.")] });
      clearAiPersona(message.author.id);
      return message.reply({ embeds: [success("Removed", "The AI will now respond as **tofin** to your messages again.")] });
    }

    // ,reskinai — show current
    if (!args.length || sub === "status" || sub === "help") {
      const current = getAiPersona(message.author.id);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🤖  AI Persona")
            .setColor(0x5865f2)
            .setDescription(
              current
                ? `When I respond to your messages, I send as **${current.name}** via webhook — not as tofin.\n\n> Use \`,reskinai clear\` to go back to default.`
                : `No custom AI persona set.\n\n**Usage:** \`,reskinai <name>\`\n\nWhen set, instead of responding as **tofin**, I'll send my reply via a webhook appearing as your chosen name — the AI personality stays the same, only the name shown changes.`
            )
            .setFooter({ text: ",reskinai <name>  ·  ,reskinai clear" }),
        ],
      });
    }

    // ,reskinai <name> — set
    const name = args.join(" ").trim();
    if (name.length < 1 || name.length > 80) {
      return message.reply({ embeds: [danger("Invalid Name", "Name must be 1–80 characters.")] });
    }

    setAiPersona(message.author.id, name);

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅  AI Persona Set")
          .setColor(0x57f287)
          .setDescription(
            `When I respond to **your** messages, my reply will be sent via webhook appearing as **${name}** instead of tofin.\n\n> The AI personality is unchanged — only the name shown in chat changes.\n> Use \`,reskinai clear\` to go back to default.`
          )
          .setFooter({ text: "Works in any channel where I can manage webhooks" }),
      ],
    });
  },
};
