const { saveGif } = require("./gifMemory");
const { download, getJson, uploadLimit, fitVideo, makeSlideshow } = require("../util/media");

const TIKTOK_REGEX = /https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/[^\s]+/i;

function extractTikTokUrl(text) {
  const m = text.match(TIKTOK_REGEX);
  return m ? m[0].replace(/[.,!?)]+$/, "") : null;
}

async function lookup(url) {
  const body = `url=${encodeURIComponent(url)}&hd=0`;
  const json = await getJson("https://www.tikwm.com/api/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (json.code !== 0 || !json.data) throw new Error(json.msg || "TikTok API error");
  return json.data;
}

// Returns { buffer, fileName, mediaUrl, isGif } or { link } when it can't be uploaded.
async function fetchTikTokResult(url, limit = uploadLimit(null)) {
  const data = await lookup(url);

  // Photo post ("image with a song"): turn the photos + the sound into one MP4.
  if (Array.isArray(data.images) && data.images.length) {
    const absolute = (u) => (u?.startsWith("/") ? `https://www.tikwm.com${u}` : u);
    const imgs = await Promise.all(data.images.slice(0, 35).map((u) => download(absolute(u))));
    const soundUrl = absolute(data.music_info?.play || data.music);
    const sound = soundUrl ? await download(soundUrl).catch(() => null) : null;
    const video = await makeSlideshow(imgs, sound, limit);
    if (!video) return { link: url, isGif: false };
    return { buffer: video, fileName: "tiktok.mp4", isGif: false };
  }

  let videoUrl = data.play || data.hdplay;
  if (!videoUrl) throw new Error("This TikTok has no video (photo slideshow?)");
  if (videoUrl.startsWith("/")) videoUrl = `https://www.tikwm.com${videoUrl}`;

  const isGif = videoUrl.includes(".gif") || !!data.is_gif;

  let buffer = await download(videoUrl);
  buffer = await fitVideo(buffer, limit);
  if (!buffer) return { link: videoUrl, isGif, mediaUrl: videoUrl };

  return { buffer, fileName: "tiktok.mp4", isGif, mediaUrl: videoUrl };
}

async function handleTikTok(message) {
  const url = extractTikTokUrl(message.content);
  if (!url) return false;

  try {
    await message.channel.sendTyping();
    const result = await fetchTikTokResult(url, uploadLimit(message.guild));

    if (result.isGif && message.guild) saveGif(message.guild.id, result.mediaUrl);

    await message.reply({
      files: result.buffer ? [{ attachment: result.buffer, name: result.fileName }] : [],
      content: result.buffer ? undefined : result.link,
      allowedMentions: { repliedUser: false },
    });

    message.suppressEmbeds(true).catch(() => {});
    return true;
  } catch (err) {
    console.error("[tiktok]", err.message);
    return false;
  }
}

module.exports = { handleTikTok, extractTikTokUrl, fetchTikTokResult };
