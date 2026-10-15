const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const {
  makeStaticGif, makeCaptionedAnimatedGif, makeGifFromVideo,
  isGifBuffer, isVideoBuffer, fetchBuffer, parseTimeToSeconds,
} = require("../../util/gifMaker");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gif")
    .setDescription("Turn an image or video into a GIF, with an optional caption")
    .addAttachmentOption((opt) =>
      opt.setName("image").setDescription("Upload an image, GIF, or video").setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName("url").setDescription("Or paste an image/GIF/video URL instead").setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName("caption").setDescription("Optional caption shown above the image").setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName("start").setDescription("Start time for videos, e.g. 5 or 0:05 (default: beginning)").setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName("end").setDescription("End time for videos, e.g. 12 or 0:12 (default: end of video)").setRequired(false)
    ),

  async run(interaction) {
    const attachment = interaction.options.getAttachment("image");
    const url = interaction.options.getString("url");
    const caption = interaction.options.getString("caption");
    const startStr = interaction.options.getString("start");
    const endStr = interaction.options.getString("end");

    const sourceUrl = attachment?.url || url;
    if (!sourceUrl) {
      return interaction.reply({ content: "❌ Provide either an upload or a URL.", ephemeral: true });
    }

    const startSeconds = startStr ? parseTimeToSeconds(startStr) : null;
    const endSeconds = endStr ? parseTimeToSeconds(endStr) : null;

    if (startStr && startSeconds === null) {
      return interaction.reply({ content: "❌ Invalid start time. Use seconds (e.g. `5`) or `mm:ss` (e.g. `0:05`).", ephemeral: true });
    }
    if (endStr && endSeconds === null) {
      return interaction.reply({ content: "❌ Invalid end time. Use seconds (e.g. `12`) or `mm:ss` (e.g. `0:12`).", ephemeral: true });
    }
    if (startSeconds != null && endSeconds != null && endSeconds <= startSeconds) {
      return interaction.reply({ content: "❌ End time must be after start time.", ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const buf = await fetchBuffer(sourceUrl);

      let outBuf;
      if (isVideoBuffer(buf)) {
        outBuf = await makeGifFromVideo(sourceUrl, caption, startSeconds, endSeconds);
      } else if (isGifBuffer(buf)) {
        outBuf = await makeCaptionedAnimatedGif(sourceUrl, caption);
      } else {
        outBuf = await makeStaticGif(sourceUrl, caption);
      }

      const file = new AttachmentBuilder(outBuf, { name: "result.gif" });
      return interaction.editReply({ files: [file] });
    } catch (err) {
      console.error("[/gif]", err);
      return interaction.editReply({ content: "❌ Couldn't process that. Make sure the link/upload is a valid image, GIF, or video." });
    }
  },
};