const https = require("https");

// Resolve Tenor / Giphy page URLs → direct media URLs usable in embeds.
async function resolveGifUrl(url) {
  if (!url) return url;

  // Already a direct media URL — works fine in embeds
  if (/\.(gif|png|jpe?g|webp)(\?.*)?$/i.test(url)) return url;
  if (url.includes("media.tenor.com") || url.includes("media.giphy.com") ||
      url.includes("i.imgur.com") || url.includes("cdn.discordapp.com")) return url;

  // Tenor page URL: https://tenor.com/view/some-slug-GIFID
  const tenorMatch = url.match(/tenor\.com\/view\/[^/?#]+-(\d+)/i);
  if (tenorMatch) {
    try {
      const data = await new Promise((resolve, reject) => {
        https.get(
          `https://api.tenor.com/v1/gifs?ids=${tenorMatch[1]}&key=LIVDSRZULELA&media_filter=minimal`,
          { headers: { "User-Agent": "TofinBot/1.0" } },
          (res) => {
            let d = "";
            res.on("data", c => (d += c));
            res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
          }
        ).on("error", reject);
      });
      const mediaUrl = data.results?.[0]?.media?.[0]?.gif?.url;
      if (mediaUrl) return mediaUrl;
    } catch { /* fall through and return original */ }
  }

  // Giphy page URL: https://giphy.com/gifs/something-GIFID
  const giphyMatch = url.match(/giphy\.com\/gifs\/(?:[^/]+-)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/i);
  if (giphyMatch) {
    return `https://media.giphy.com/media/${giphyMatch[1]}/giphy.gif`;
  }

  return url; // unknown format — pass through unchanged
}

module.exports = { resolveGifUrl };
