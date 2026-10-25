const https = require("https");
const http = require("http");
const { saveGif } = require("./gifMemory");
const { download, uploadLimit, fitVideo } = require("../util/media");

const PINTEREST_REGEX = /https?:\/\/(?:[^\s\/]+\.)?pinterest\.com\/(?:pin|video)\/[0-9]+\/?|https?:\/\/pin\.it\/[a-zA-Z0-9]+/i;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractPinterestUrl(text) {
  const m = text.match(PINTEREST_REGEX);
  return m ? m[0] : null;
}

function resolveRedirect(url) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl, redirects = 0) => {
      if (redirects > 10) return reject(new Error("Too many redirects"));
      const proto = currentUrl.startsWith("https") ? https : http;
      const req = proto.get(currentUrl, { headers: { "User-Agent": BROWSER_UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          const location = res.headers.location;
          if (!location) return resolve(currentUrl);
          const nextUrl = location.startsWith("/") ? new URL(location, currentUrl).href : location;
          res.resume();
          return request(nextUrl, redirects + 1);
        }
        resolve(currentUrl);
        res.resume();
      });
      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error("Redirect timeout")); });
    };
    request(url);
  });
}

function fetchOEmbed(pinUrl) {
  return new Promise((resolve, reject) => {
    const oembedUrl = `https://www.pinterest.com/oembed?url=${encodeURIComponent(pinUrl)}`;
    https.get(oembedUrl, { headers: { "User-Agent": BROWSER_UA } }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function fetchPageHtml(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": BROWSER_UA } }, (res) => {
      let data = "";
      res.on("data", c => {
        if (data.length > 2 * 1024 * 1024) { res.destroy(); reject(new Error("Page too large")); }
        data += c;
      });
      res.on("end", () => resolve(data));
    });
    request.on("error", reject);
    request.setTimeout(15000, () => { request.destroy(); reject(new Error("Fetch timeout")); });
  });
}

// ── Extract additional metadata from HTML (likes, comments, author avatar, description) ──
function extractMetadataFromHtml(html) {
  const metadata = {
    authorName: null,
    authorAvatar: null,
    description: null,
    likes: null,
    comments: null,
  };

  // Try to find author name
  const authorMatch = html.match(/<a[^>]+data-test-id="[^"]*owner-name[^"]*"[^>]*>([^<]+)<\/a>/i)
    || html.match(/"owner"\s*:\s*{[^}]*"full_name"\s*:\s*"([^"]+)"/i)
    || html.match(/"username"\s*:\s*"([^"]+)"/i);
  if (authorMatch) metadata.authorName = authorMatch[1];

  // Try to find author avatar
  const avatarMatch = html.match(/<img[^>]+data-test-id="[^"]*owner-avatar[^"]*"[^>]+src="([^"]+)"/i)
    || html.match(/"image_small_url"\s*:\s*"([^"]+)"/i)
    || html.match(/"avatar_url"\s*:\s*"([^"]+)"/i);
  if (avatarMatch) metadata.authorAvatar = avatarMatch[1];

  // Try to find description
  const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
    || html.match(/"description"\s*:\s*"([^"]+)"/i);
  if (descMatch) metadata.description = descMatch[1];

  // Try to find likes count
  const likesMatch = html.match(/[^"]"like_count"\s*:\s*(\d+)/i)
    || html.match(/>\s*([\d,]+)\s*likes?\s*</i);
  if (likesMatch) {
    const raw = likesMatch[1].replace(/,/g, '');
    metadata.likes = parseInt(raw, 10);
  }

  // Try to find comments count
  const commentsMatch = html.match(/[^"]"comment_count"\s*:\s*(\d+)/i)
    || html.match(/>\s*([\d,]+)\s*comments?\s*</i);
  if (commentsMatch) {
    const raw = commentsMatch[1].replace(/,/g, '');
    metadata.comments = parseInt(raw, 10);
  }

  return metadata;
}

function extractMediaFromHtml(html) {
  // ── GIF detection ──
  const gifPatterns = [
    /"url"\s*:\s*"([^"]+\.gif[^"]*)"/i,
    /<meta[^>]+property="og:image"[^>]+content="([^"]+\.gif[^"]*)"/i,
    /<img[^>]+src="([^"]+\.gif[^"]*)"/i,
    /"images"\s*:\s*{[^}]*"originals"\s*:\s*{[^}]*"url"\s*:\s*"([^"]+\.gif[^"]*)"/i,
  ];
  for (const pattern of gifPatterns) {
    const match = html.match(pattern);
    if (match) {
      const url = match[1].replace(/\\/g, "").replace(/&amp;/g, "&");
      if (url.match(/\.gif/i)) return { url, type: "gif" };
    }
  }

  // ── Video URLs ──
  const videoPatterns = [
    /"video_list"\s*:\s*{[^}]*"V_H264_13MBPS"\s*:\s*{[^}]*"url"\s*:\s*"([^"]+)"/i,
    /"video_list"\s*:\s*{[^}]*"V_H264_6MBPS"\s*:\s*{[^}]*"url"\s*:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
    /<video[^>]+src="([^"]+\.mp4[^"]*)"/i,
    /"videoUrl"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+property="og:video"[^>]+content="([^"]+)"/i,
  ];
  for (const pattern of videoPatterns) {
    const match = html.match(pattern);
    if (match) return { url: match[1].replace(/\\/g, ""), type: "video" };
  }

  // ── Static images ──
  const imagePatterns = [
    /"images"\s*:\s*{[^}]*"originals"\s*:\s*{[^}]*"url"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*{[^}]*"url"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
    /"url"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
  ];
  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match) return { url: match[1].replace(/\\/g, ""), type: "image" };
  }

  return null;
}

// Resolve a pin link into media. Returns { buffer, fileName, isGif, mediaUrl } or { link }.
async function fetchPinterestResult(rawUrl, limit = uploadLimit(null)) {
  const url = await resolveRedirect(rawUrl);
  if (!url.includes("pinterest.com/pin/") && !url.includes("pinterest.com/video/")) {
    return { link: url };
  }

  let mediaUrl = null;
  let mediaType = "image";

  try {
    const media = extractMediaFromHtml(await fetchPageHtml(url));
    if (media) { mediaUrl = media.url; mediaType = media.type; }
  } catch {}

  if (!mediaUrl) {
    try {
      const oembed = await fetchOEmbed(url);
      if (oembed?.url) mediaUrl = oembed.url;
    } catch {}
  }
  if (!mediaUrl) return { link: url };

  mediaUrl = mediaUrl.replace(/\\/g, "").replace(/&amp;/g, "&");
  const isGif = mediaType === "gif" || /\.gif/i.test(mediaUrl);
  const isVideo = mediaType === "video" || /\.mp4/i.test(mediaUrl);

  let buffer = await download(mediaUrl);
  if (isVideo) {
    buffer = await fitVideo(buffer, limit);
    if (!buffer) return { link: mediaUrl, isGif, mediaUrl };
  } else if (buffer.length > limit) {
    return { link: mediaUrl, isGif, mediaUrl };
  }

  const ext = isVideo ? "mp4" : isGif ? "gif" : (mediaUrl.match(/\.(png|webp)/i)?.[1] || "jpg").toLowerCase();
  return { buffer, fileName: `pinterest.${ext}`, isGif, mediaUrl };
}

async function handlePinterest(message) {
  const found = extractPinterestUrl(message.content);
  if (!found) return false;

  try {
    await message.channel.sendTyping();
    const result = await fetchPinterestResult(found, uploadLimit(message.guild));

    if (result.isGif && result.mediaUrl && message.guild) saveGif(message.guild.id, result.mediaUrl);

    await message.reply({
      files: result.buffer ? [{ attachment: result.buffer, name: result.fileName }] : [],
      content: result.buffer ? undefined : result.link,
      allowedMentions: { repliedUser: false },
    });
    message.suppressEmbeds(true).catch(() => {});
    return true;
  } catch (err) {
    console.error("[pinterest]", err.message);
    return false;
  }
}

module.exports = { handlePinterest, extractPinterestUrl, fetchPinterestResult };
