const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { extractTikTokUrl, fetchTikTokResult } = require("../../services/tiktok");
const { saveGif } = require("../../services/gifMemory");
const { uploadLimit } = require("../../util/media");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tiktok")
    .setDescription("Download a TikTok video")
    .addStringOption((opt) =>
      opt.setName("url").setDescription("The TikTok link").setRequired(true)
    )
    .setContexts(0, 1, 2)
    .setIntegrationTypes(0, 1),

  async run(interaction) {
    const input = interaction.options.getString("url");
    const url = extractTikTokUrl(input) || input;

    await interaction.deferReply();

    try {
      const result = await fetchTikTokResult(url, uploadLimit(interaction.guild));

      if (result.isGif && result.mediaUrl && interaction.guild) {
        saveGif(interaction.guild.id, result.mediaUrl);
      }

      const files = result.files
        ? result.files.map((f) => new AttachmentBuilder(f.buffer, { name: f.fileName }))
        : result.buffer
          ? [new AttachmentBuilder(result.buffer, { name: result.fileName })]
          : [];

      if (files.length) return interaction.editReply({ files });
      return interaction.editReply({ content: result.link });
    } catch (err) {
      console.error("[/tiktok]", err.message);
      return interaction.editReply({ content: "❌ Couldn't fetch that. Check the link and try again." });
    }
  },
};
