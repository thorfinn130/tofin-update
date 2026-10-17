const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MB = 1024 * 1024;

// ── Download a URL into a Buffer (follows redirects, checks status, size cap) ──
async function download(url, { headers = {}, maxBytes = 200 * MB, timeout = 60_000 } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error("File too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Empty download");
  if (buf.length > maxBytes) throw new Error("File too large");
  return buf;
}

async function getJson(url, { headers = {}, method = "GET", body, timeout = 20_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "User-Agent": UA, ...headers },
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`API error (HTTP ${res.status})`);
  return res.json();
}

// ── How many bytes can this guild (or a DM) upload? ──
function uploadLimit(guild) {
  const tier = guild?.premiumTier ?? 0;
  const mb = tier >= 3 ? 100 : tier === 2 ? 50 : 10;
  return mb * MB - 256 * 1024; // small safety margin for the multipart overhead
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "ignore", windowsHide: true });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

// ── Shrink a video until it fits under `limit` bytes (null if it can't) ──
async function compressVideo(buffer, limit) {
  const ffmpeg = require("ffmpeg-static");
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vid-"));
  const input = path.join(dir, "in.mp4");
  const output = path.join(dir, "out.mp4");
  try {
    await fs.promises.writeFile(input, buffer);
    for (const [crf, height] of [[26, 720], [30, 540], [35, 360]]) {
      await run(ffmpeg, [
        "-y", "-i", input,
        "-vf", `scale=-2:'min(${height},ih)'`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        output,
      ]);
      const out = await fs.promises.readFile(output);
      if (out.length <= limit) return out;
    }
    return null;
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Makes sure a video buffer fits Discord's limit; compresses when needed.
async function fitVideo(buffer, limit) {
  if (buffer.length <= limit) return buffer;
  try {
    return await compressVideo(buffer, limit);
  } catch (err) {
    console.error("[media] compress failed:", err.message);
    return null;
  }
}

module.exports = { download, getJson, uploadLimit, fitVideo, UA, MB };
