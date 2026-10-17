const { saveGif } = require("./gifMemory");
const { download, getJson, uploadLimit, fitVideo } = require("../util/media");

const TWITTER_REGEX = /https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status(?:es)?\/(\d+)/i;

function extractTwitterUrl(text) {
  const m = text.match(TWITTER_REGEX);
  return m ? m[0] : null;
}

// ── Normalise media from either API into [{ type: "video"|"gif"|"image", url }] ──
function fromFx(json) {
  const tweet = json?.tweet;
  if (!tweet) return null;
  const pick = (t) =>
    (t?.media?.all || []).map((m) => ({
      type: m.type === "photo" ? "image" : m.type === "gif" ? "gif" : "video",
      url: m.url,
    }));
  const own = pick(tweet);
  return own.length ? own : pick(tweet.quote);
}

function fromVx(json) {
  const list = json?.media_extended;
  if (!Array.isArray(list)) return null;
  return list.map((m) => ({
    type: m.type === "image" ? "image" : m.type === "gif" ? "gif" : "video",
    url: m.url,
  }));
}

async function lookupMedia(tweetId) {
  const errors = [];

  try {
    const media = fromFx(await getJson(`https://api.fxtwitter.com/status/${tweetId}`));
    if (media) return media;
  } catch (e) { errors.push(`fx: ${e.message}`); }

  try {
    const media = fromVx(await getJson(`https://api.vxtwitter.com/status/${tweetId}`));
    if (media) return media;
  } catch (e) { errors.push(`vx: ${e.message}`); }

  throw new Error(errors.join(" | ") || "Tweet not found");
}

// Returns { buffers: [{ buffer, fileName }], isGif, mediaUrl } or { link } when too big.
async function fetchTwitterResult(url, limit = uploadLimit(null)) {
  const tweetId = url.match(/status(?:es)?\/(\d+)/i)?.[1];
  if (!tweetId) throw new Error("Could not read a tweet ID from that link.");

  const media = (await lookupMedia(tweetId)).filter((m) => m.url);
  if (!media.length) throw new Error("That tweet has no video or image.");

  // Video / GIF wins; otherwise send up to 4 images.
  const clip = media.find((m) => m.type === "video") || media.find((m) => m.type === "gif");
  const chosen = clip ? [clip] : media.filter((m) => m.type === "image").slice(0, 4);

  const files = [];
  let total = 0;
  for (const [i, item] of chosen.entries()) {
    const mediaUrl = item.url.replace(/&amp;/g, "&");
    let buffer = await download(mediaUrl, { headers: { Referer: "https://x.com/" } });

    if (item.type !== "image") {
      buffer = await fitVideo(buffer, limit);
      if (!buffer) return { link: mediaUrl, isGif: item.type === "gif", mediaUrl };
    }

    total += buffer.length;
    if (total > limit) return { link: mediaUrl, isGif: false, mediaUrl };

    const ext = item.type === "image" ? (mediaUrl.match(/\.(png|webp)/i)?.[1] || "jpg").toLowerCase() : "mp4";
    files.push({ buffer, fileName: `twitter${chosen.length > 1 ? `-${i + 1}` : ""}.${ext}` });
  }

  return {
    files,
    isGif: clip?.type === "gif",
    mediaUrl: clip?.url,
  };
}

async function handleTwitter(message) {
  const url = extractTwitterUrl(message.content);
  if (!url) return false;

  try {
    await message.channel.sendTyping();
    const result = await fetchTwitterResult(url, uploadLimit(message.guild));

    if (result.isGif && message.guild) saveGif(message.guild.id, result.mediaUrl);

    await message.reply({
      files: result.files?.map((f) => ({ attachment: f.buffer, name: f.fileName })) ?? [],
      content: result.files ? undefined : result.link,
      allowedMentions: { repliedUser: false },
    });

    message.suppressEmbeds(true).catch(() => {});
    return true;
  } catch (err) {
    // Text-only tweets etc: stay quiet and let Discord show its normal preview.
    console.error("[twitter]", err.message);
    return false;
  }
}

module.exports = { handleTwitter, extractTwitterUrl, fetchTwitterResult };
