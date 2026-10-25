const { AttachmentBuilder } = require("discord.js");
const {
  makeStaticGif, makeCaptionedAnimatedGif, makeGifFromVideo,
  isGifBuffer, isVideoBuffer, fetchBuffer, parseTimeToSeconds,
} = require("../../util/gifMaker");
const { uploadLimit } = require("../../util/media");

module.exports = {
  name: "gif",
  async run(message, args) {
    // ,gif <url> [start] [end] [caption] — URL passed directly as the first argument.
    // start/end are optional timestamps (e.g. 5, 0:05, 1:23) and only apply to videos.
    let sourceUrl = null;
    let rest = args;

    if (args[0] && /^https?:\/\//i.test(args[0])) {
      sourceUrl = args[0];
      rest = args.slice(1);
    }

    // Greedily consume up to 2 leading time-like tokens as start/end
    let startSeconds = null;
    let endSeconds = null;

    if (rest[0] != null && parseTimeToSeconds(rest[0]) !== null) {
      startSeconds = parseTimeToSeconds(rest[0]);
      rest = rest.slice(1);

      if (rest[0] != null && parseTimeToSeconds(rest[0]) !== null) {
        endSeconds = parseTimeToSeconds(rest[0]);
        rest = rest.slice(1);
      }
    }

    const caption = rest.join(" ").trim() || null;

    // Otherwise: image/video attached directly to this message, or on the message being replied to
    if (!sourceUrl) sourceUrl = message.attachments.first()?.url || null;

    if (!sourceUrl && message.reference) {
      const replied = await message.fetchReference().catch(() => null);
      sourceUrl = replied?.attachments.first()?.url || null;

      // Also allow replying to a message that's just a plain image/gif/video link
      if (!sourceUrl && replied?.content) {
        const match = replied.content.match(/https?:\/\/\S+/i);
        if (match) sourceUrl = match[0];
      }
    }

    if (!sourceUrl) {
      return message.reply({
        content: "❌ Give a URL, reply to a message with an image/GIF/video, or attach one directly.\n**Usage:** `,gif <url> [start] [end] [caption]` or reply with `,gif [start] [end] [caption]`.\n**Example:** `,gif https://example.com/clip.mp4 0:05 0:12 lol nice`",
      });
    }

    if (startSeconds != null && endSeconds != null && endSeconds <= startSeconds) {
      return message.reply({ content: "❌ End time must be after start time." });
    }

    await message.channel.sendTyping().catch(() => {});

    const limit = uploadLimit(message.guild);
    try {
      const buf = await fetchBuffer(sourceUrl);

      let outBuf;
      if (isVideoBuffer(buf)) {
        outBuf = await makeGifFromVideo(sourceUrl, caption, startSeconds, endSeconds, limit);
      } else if (isGifBuffer(buf)) {
        outBuf = await makeCaptionedAnimatedGif(sourceUrl, caption, limit);
      } else {
        outBuf = await makeStaticGif(sourceUrl, caption);
      }

      const file = new AttachmentBuilder(outBuf, { name: "result.gif" });
      // Per the request: respond with nothing but the gif, no extra message text
      return message.reply({ files: [file] });
    } catch (err) {
      console.error("[,gif]", err);
      if (err.message === "GIF_TOO_LARGE") {
        return message.reply({ content: "❌ That clip is too long to fit in a GIF. Trim it: `,gif <url> <start> <end>`." });
      }
            return message.reply({ content: "❌ Couldn't process that. Make sure it's a valid image, GIF, or video." });
    }
  },
};