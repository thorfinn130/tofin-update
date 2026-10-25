const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuild, setGuild } = require("../../storage");

const STORE = "guild_settings";

function isAutoChannelsEnabled(guildId) {
  const s = getGuild(STORE, guildId, {});
  return s.autoChannels !== false; // default ON
}

function setAutoChannels(guildId, enabled) {
  const s = getGuild(STORE, guildId, {});
  s.autoChannels = enabled;
  setGuild(STORE, guildId, s);
}

module.exports = {
  name: "channeltoggle",
  aliases: ["ctoggle", "channelon", "channeloff"],
  isAutoChannelsEnabled,
  async run(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply({ content: "❌ Requires Administrator." });
    }

    const invoked = message.content.split(" ")[0].replace(",", "");
    const sub = args[0]?.toLowerCase();

    let enable;
    if (invoked === "channeloff") enable = false;
    else if (invoked === "channelon") enable = true;
    else if (sub === "off") enable = false;
    else if (sub === "on") enable = true;
    else {
      enable = !isAutoChannelsEnabled(message.guild.id);
    }

    setAutoChannels(message.guild.id, enable);

    const embed = new EmbedBuilder()
      .setColor(enable ? 0x2ECC71 : 0xE74C3C)
      .setTitle(enable ? "✅ Auto-Channels Enabled" : "❌ Auto-Channels Disabled")
      .setDescription(enable
        ? "Shop commands like `mine_category` and `mine_channel` can create channels again."
        : "Auto-channel creation is now **off**. Shop items that create categories/channels will be blocked on this server.")
      .setFooter({ text: `Changed by ${message.author.username}` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  },
};
