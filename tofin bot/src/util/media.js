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

function ffmpegBin() {
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return "ffmpeg"; // fall back to one installed on the system
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), ["-hide_banner", "-nostdin", ...args], { windowsHide: true });
    let stderr = "";
    p.stderr.on("data", (d) => { stderr = (stderr + d).slice(-20000); });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stderr }));
  });
}

function sniffExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return "jpg";
}

// TikTok photo post → vertical MP4: each photo on a blurred backdrop, song as the soundtrack.
async function makeSlideshow(images, audio, limit) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "slide-"));
  try {
    const files = [];
    for (const [i, buf] of images.entries()) {
      const f = path.join(dir, `img${i}.${sniffExt(buf)}`);
      await fs.promises.writeFile(f, buf);
      files.push(f);
    }

    let audioFile = null;
    let per = 3;
    if (audio?.length) {
      audioFile = path.join(dir, "audio.bin");
      await fs.promises.writeFile(audioFile, audio);
      const { stderr } = await runFfmpeg(["-i", audioFile]);
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) {
        const dur = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        per = Math.min(6, Math.max(2.5, dur / files.length)); // spread the song over the photos
      }
    }
    const total = per * files.length;

    const list = files.map((f) => `file '${f.replace(/'/g, "'\\''")}'\nduration ${per}`).join("\n")
      + `\nfile '${files[files.length - 1].replace(/'/g, "'\\''")}'\n`;
    const listFile = path.join(dir, "list.txt");
    await fs.promises.writeFile(listFile, list);

    const out = path.join(dir, "out.mp4");
    const W = 720, H = 1280;
    const graph =
      `[0:v]split[a][b];` +
      `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=25:5[bg];` +
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[v]`;

    const { code, stderr } = await runFfmpeg([
      "-y",
      "-f", "concat", "-safe", "0", "-i", listFile,
      ...(audioFile ? ["-i", audioFile] : []),
      "-filter_complex", graph,
      "-map", "[v]",
      ...(audioFile ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
      "-t", String(total),
      "-movflags", "+faststart",
      out,
    ]);
    if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.slice(-300)}`);

    const video = await fs.promises.readFile(out);
    return fitVideo(video, limit);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { download, getJson, uploadLimit, fitVideo, makeSlideshow, UA, MB };
