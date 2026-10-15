const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { parseGIF, decompressFrames } = require("gifuct-js");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const https = require("https");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const CAPTION_BAR_RATIO = 0.22; // caption bar height as a fraction of image width
const MIN_BAR_HEIGHT = 60;
const MAX_BAR_HEIGHT = 220;
const MAX_FRAMES = 300; // hard safety ceiling so an extreme video/gif can't hang the bot or blow up memory
const VIDEO_OUTPUT_FPS = 10; // frames per second sampled from the source video
const MAX_VIDEO_SECONDS = 60; // safety ceiling on conversion length — full video is used by default, capped here

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
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

// Extracts frames from a video file (buffer) as a list of raw PNG buffers, using ffmpeg.
// Writes the input to a temp file since ffmpeg needs a seekable file path for most containers.
// startSeconds/endSeconds are optional — if omitted, converts from the start / to the end (capped by MAX_VIDEO_SECONDS).
function extractVideoFrames(videoBuffer, startSeconds = null, endSeconds = null) {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `gifmaker_in_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
    const outputPattern = path.join(tmpDir, `gifmaker_frame_${Date.now()}_${Math.random().toString(36).slice(2)}_%03d.png`);

    fs.writeFileSync(inputPath, videoBuffer);

    const start = startSeconds ?? 0;
    // If an end time is given, use exactly that range. Otherwise convert up to MAX_VIDEO_SECONDS from the start point.
    const duration = endSeconds != null
      ? Math.max(0.1, endSeconds - start)
      : MAX_VIDEO_SECONDS;
    const cappedDuration = Math.min(duration, MAX_VIDEO_SECONDS);

    const args = [
      "-y",
      ...(start > 0 ? ["-ss", String(start)] : []),
      "-i", inputPath,
      "-t", String(cappedDuration),
      "-vf", `fps=${VIDEO_OUTPUT_FPS}`,
      "-frames:v", String(MAX_FRAMES),
      outputPattern,
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });

    proc.on("close", (code) => {
      try {
        if (code !== 0) {
          cleanup();
          return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        }

        const dir = path.dirname(outputPattern);
        const uniquePrefix = path.basename(outputPattern).split("%03d")[0];
        const frameFiles = fs.readdirSync(dir)
          .filter((f) => f.startsWith(uniquePrefix))
          .sort();

        const frameBuffers = frameFiles.map((f) => fs.readFileSync(path.join(dir, f)));

        // Cleanup temp files
        frameFiles.forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch {} });
        cleanup();

        if (!frameBuffers.length) {
          return reject(new Error("No frames could be extracted from that video."));
        }
        resolve(frameBuffers);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    function cleanup() {
      try { fs.unlinkSync(inputPath); } catch {}
    }
  });
}

// ── Video (MP4, WebM, MOV, etc.) → captioned animated GIF ─────────────────────
// startSeconds/endSeconds are optional trim points; omit either (or both) to use the full video.
async function makeGifFromVideo(videoUrl, caption, startSeconds = null, endSeconds = null) {
  const buf = await fetchBuffer(videoUrl);
  const frameBuffers = await extractVideoFrames(buf, startSeconds, endSeconds);

  const firstFrame = await loadImage(frameBuffers[0]);
  const barHeight = caption ? barHeightFor(firstFrame.width) : 0;
  const outWidth = firstFrame.width;
  const outHeight = firstFrame.height + barHeight;

  let captionCanvas = null;
  if (caption) {
    captionCanvas = createCanvas(outWidth, barHeight);
    drawCaptionBar(captionCanvas.getContext("2d"), outWidth, barHeight, caption);
  }

  const gif = GIFEncoder();
  const canvas = createCanvas(outWidth, outHeight);
  const ctx = canvas.getContext("2d");
  const delayMs = Math.round(1000 / VIDEO_OUTPUT_FPS);

  for (const frameBuf of frameBuffers) {
    const img = await loadImage(frameBuf);
    ctx.clearRect(0, 0, outWidth, outHeight);
    if (captionCanvas) ctx.drawImage(captionCanvas, 0, 0);
    ctx.drawImage(img, 0, barHeight, outWidth, firstFrame.height);

    const { data } = ctx.getImageData(0, 0, outWidth, outHeight);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, outWidth, outHeight, { palette, delay: delayMs });
  }

  gif.finish();
  return Buffer.from(gif.bytes());
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
async function makeCaptionedAnimatedGif(imageUrl, caption) {
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

module.exports = { makeStaticGif, makeCaptionedAnimatedGif, makeGifFromVideo, isGifBuffer, isVideoBuffer, fetchBuffer, parseTimeToSeconds };