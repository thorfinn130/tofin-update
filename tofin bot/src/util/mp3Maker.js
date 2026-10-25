const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const MAX_DURATION_SECONDS = 600; // 10 minute safety ceiling per extraction

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

// Extracts the audio track from a video/audio buffer and returns it as an MP3 buffer.
function extractAudio(inputBuffer) {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputPath = path.join(tmpDir, `mp3in_${uid}`);
    const outputPath = path.join(tmpDir, `mp3out_${uid}.mp3`);

    fs.writeFileSync(inputPath, inputBuffer);

    const args = [
      "-y",
      "-i", inputPath,
      "-t", String(MAX_DURATION_SECONDS),
      "-vn",                 // drop video stream entirely
      "-acodec", "libmp3lame",
      "-b:a", "192k",
      outputPath,
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", (err) => { cleanup(); reject(err); });

    proc.on("close", (code) => {
      try {
        if (code !== 0) {
          cleanup();
          return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        }
        if (!fs.existsSync(outputPath)) {
          cleanup();
          return reject(new Error("No audio track could be extracted from that file."));
        }
        const outBuf = fs.readFileSync(outputPath);
        cleanup();
        resolve(outBuf);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    function cleanup() {
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(outputPath); } catch {}
    }
  });
}

module.exports = { fetchBuffer, extractAudio, MAX_DURATION_SECONDS };