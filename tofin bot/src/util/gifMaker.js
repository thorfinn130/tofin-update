const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { parseGIF, decompressFrames } = require("gifuct-js");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { download } = require("./media");

const CAPTION_BAR_RATIO = 0.22; // caption bar height as a fraction of image width
const MIN_BAR_HEIGHT = 60;
const MAX_BAR_HEIGHT = 220;
const MAX_FRAMES = 300; // hard safety ceiling so an extreme video/gif can't hang the bot or blow up memory
const VIDEO_OUTPUT_FPS = 10; // frames per second sampled from the source video
const MAX_VIDEO_SECONDS = 60; // safety ceiling on conversion length — full video is used by default, capped here

const cache = new Map(); // url → { buf, at } — the command and the maker both fetch the same file
async function fetchBuffer(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 60_000) return hit.buf;
  const buf = await download(url, { maxBytes: 100 * 1024 * 1024 });
  cache.set(url, { buf, at: Date.now() });
  if (cache.size > 4) cache.delete(cache.keys().next().value);
  return buf;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCaptionBar(ctx, width, barHeight, caption) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, barHeight);

  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let fontSize = Math.floor(barHeight * 0.4);
  ctx.font = `bold ${fontSize}px sans-serif`;

  let lines = wrapText(ctx, caption, width * 0.92);
  while (lines.length * (fontSize * 1.15) > barHeight * 0.9 && fontSize > 14) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = wrapText(ctx, caption, width * 0.92);
  }

  const lineHeight = fontSize * 1.15;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (barHeight - totalTextHeight) / 2 + lineHeight / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, startY + i * lineHeight);
  });
}

function barHeightFor(width) {
  return Math.max(MIN_BAR_HEIGHT, Math.min(MAX_BAR_HEIGHT, Math.round(width * CAPTION_BAR_RATIO)));
}

// Detects animated GIF by magic bytes ("GIF87a" / "GIF89a")
function isGifBuffer(buf) {
  return buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF";
}

// Detects common video containers by magic bytes / signature so we know to route through ffmpeg.
function isVideoBuffer(buf) {
  if (buf.length < 12) return false;
  // MP4/MOV: bytes 4-8 are "ftyp"
  if (buf.toString("ascii", 4, 8) === "ftyp") return true;
  // WebM/MKV (Matroska): starts with EBML header 0x1A45DFA3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;
  return false;
}

// ── ffmpeg GIF engine ─────────────────────────────────────────────────────────
// ffmpeg does decoding, scaling, caption overlay and a single shared high-quality
// palette natively — far faster and cleaner than per-frame JS quantizing.
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

async function probeMedia(file) {
  const { stderr } = await runFfmpeg(["-i", file]);
  const size = stderr.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
  };
}

// Biggest-first; steps down until the GIF fits under `limit` bytes.
const GIF_TIERS = [
  { width: 540, fps: 20 },
  { width: 480, fps: 15 },
  { width: 400, fps: 12 },
  { width: 320, fps: 10 },
  { width: 240, fps: 8 },
];

async function ffmpegToGif(buffer, { caption = null, start = null, end = null, limit = 10 * 1024 * 1024 } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gif-"));
  const input = path.join(dir, "input.bin");
  const capPng = path.join(dir, "caption.png");
  const output = path.join(dir, "out.gif");
  try {
    await fs.promises.writeFile(input, buffer);
    const info = await probeMedia(input);
    if (!info.width) throw new Error("Could not read that video.");

    const from = start ?? 0;
    let length = end != null ? Math.max(0.1, end - from) : (info.duration != null ? Math.max(0.1, info.duration - from) : MAX_VIDEO_SECONDS);
    length = Math.min(length, MAX_VIDEO_SECONDS);

    // Longer clips start on a smaller tier so we don't waste passes on sizes that can't fit.
    const startTier = length > 30 ? 3 : length > 15 ? 2 : length > 8 ? 1 : 0;
    const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

    let last = null;
    for (const tier of GIF_TIERS.slice(startTier)) {
      const W = even(Math.min(info.width, tier.width));
      const BH = caption ? barHeightFor(W) : 0;

      if (caption) {
        const c = createCanvas(W, BH);
        drawCaptionBar(c.getContext("2d"), W, BH, caption);
        await fs.promises.writeFile(capPng, c.toBuffer("image/png"));
      }

      const scaled = `[0:v]fps=${tier.fps},scale=${W}:-2:flags=lanczos`;
      const palette = "split[a][b];[a]palettegen=stats_mode=diff[pal];[b][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
      const graph = caption
        ? `${scaled},pad=${W}:ih+${BH}:0:${BH}:color=white[v];[v][1:v]overlay=0:0,${palette}`
        : `${scaled},${palette}`;

      const { code, stderr } = await runFfmpeg([
        "-y",
        ...(from > 0 ? ["-ss", String(from)] : []),
        "-t", String(length),
        "-i", input,
        ...(caption ? ["-i", capPng] : []),
        "-filter_complex", graph,
        "-frames:v", String(MAX_FRAMES * 2),
        "-loop", "0",
        output,
      ]);
      if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.slice(-300)}`);

      last = await fs.promises.readFile(output);
      if (last.length <= limit) return last;
    }
    throw new Error("GIF_TOO_LARGE");
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Video (MP4, WebM, MOV, etc.) → captioned animated GIF ─────────────────────
// start/end are optional trim points in seconds; omit either (or both) for the full video.
async function makeGifFromVideo(videoUrl, caption, startSeconds = null, endSeconds = null, limit) {
  const buf = await fetchBuffer(videoUrl);
  return ffmpegToGif(buf, { caption, start: startSeconds, end: endSeconds, limit });
}

// ── Static image (or single-frame treatment) → single-frame GIF, optional caption ─
async function makeStaticGif(imageUrl, caption) {
  const buf = await fetchBuffer(imageUrl);
  const img = await loadImage(buf);

  const barHeight = caption ? barHeightFor(img.width) : 0;
  const canvas = createCanvas(img.width, img.height + barHeight);
  const ctx = canvas.getContext("2d");

  if (caption) drawCaptionBar(ctx, img.width, barHeight, caption);
  ctx.drawImage(img, 0, barHeight, img.width, img.height);

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const palette = quantize(data, 256);
  const index = applyPalette(data, palette);

  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, { palette });
  gif.finish();
  return Buffer.from(gif.bytes());
}

// ── Animated GIF → re-encoded animated GIF, optional caption bar on every frame ─
async function makeCaptionedAnimatedGifJs(imageUrl, caption) {
  const buf = await fetchBuffer(imageUrl);

  if (!isGifBuffer(buf)) {
    throw new Error("NOT_A_GIF");
  }

  const parsed = parseGIF(buf);
  const frames = decompressFrames(parsed, true); // true = build full RGBA patch per frame

  if (!frames.length) throw new Error("Could not decode any frames from that GIF.");

  const { width, height } = parsed.lsd ?? { width: frames[0].dims.width, height: frames[0].dims.height };
  const barHeight = caption ? barHeightFor(width) : 0;
  const outWidth = width;
  const outHeight = height + barHeight;

  let captionCanvas = null;
  if (caption) {
    captionCanvas = createCanvas(outWidth, barHeight);
    drawCaptionBar(captionCanvas.getContext("2d"), outWidth, barHeight, caption);
  }

  const gif = GIFEncoder();
  const canvas = createCanvas(outWidth, outHeight);
  const ctx = canvas.getContext("2d");

  const frameList = frames.slice(0, MAX_FRAMES);

  // gifuct-js gives each frame's patch already composited as RGBA at frame.dims (x, y, width, height)
  for (const frame of frameList) {
    ctx.clearRect(0, 0, outWidth, outHeight);
    if (captionCanvas) ctx.drawImage(captionCanvas, 0, 0);

    const frameCanvas = createCanvas(frame.dims.width, frame.dims.height);
    const frameCtx = frameCanvas.getContext("2d");
    const imageData = frameCtx.createImageData(frame.dims.width, frame.dims.height);
    imageData.data.set(frame.patch);
    frameCtx.putImageData(imageData, 0, 0);

    ctx.drawImage(frameCanvas, frame.dims.left, frame.dims.top + barHeight, frame.dims.width, frame.dims.height);

    const { data } = ctx.getImageData(0, 0, outWidth, outHeight);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    const delayMs = Math.max(20, (frame.delay ?? 10) * 10); // gifuct-js delay is in 1/100ths of a second

    gif.writeFrame(index, outWidth, outHeight, { palette, delay: delayMs });
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

async function makeCaptionedAnimatedGif(imageUrl, caption, limit) {
  const buf = await fetchBuffer(imageUrl);
  if (!isGifBuffer(buf)) throw new Error("NOT_A_GIF");
  try {
    return await ffmpegToGif(buf, { caption, limit });
  } catch (err) {
    if (err.code !== "ENOENT") throw err; // ffmpeg missing on this machine → use the slower JS path
    return makeCaptionedAnimatedGifJs(imageUrl, caption);
  }
}

// Parses "5", "0:05", "1:23", "1:02:03" into seconds. Returns null if not a valid time format.
function parseTimeToSeconds(str) {
  if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str); // plain seconds, e.g. "5" or "5.5"

  const parts = str.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;

  const nums = parts.map(Number);
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

module.exports = { ffmpegToGif, makeStaticGif, makeCaptionedAnimatedGif, makeGifFromVideo, isGifBuffer, isVideoBuffer, fetchBuffer, parseTimeToSeconds };