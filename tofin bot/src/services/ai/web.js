// Small, dependency-free helpers the AI can use: web search and a safe calculator.

const cache = new Map();
const TTL = 5 * 60_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const decode = (s) => s
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

async function instantAnswer(query) {
  const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const parts = [];
  if (j.Answer) parts.push(String(j.Answer));
  if (j.AbstractText) parts.push(j.AbstractText.slice(0, 400));
  if (j.Definition) parts.push(j.Definition.slice(0, 250));
  if (j.AbstractURL) parts.push(`Source: ${j.AbstractURL}`);
  return parts.length ? parts.join("\n") : null;
}

// Plain-HTML DuckDuckGo results: titles + snippets, no API key needed.
async function htmlResults(query) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const out = [];
  const re = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 4) {
    let url = m[1];
    const u = url.match(/uddg=([^&]+)/);
    if (u) { try { url = decodeURIComponent(u[1]); } catch {} }
    out.push(`• ${decode(m[2])} — ${decode(m[3]).slice(0, 220)} (${url})`);
  }
  return out.length ? out.join("\n") : null;
}

async function webSearch(query) {
  const key = query.toLowerCase().trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  let data = null;
  try { data = await instantAnswer(query); } catch {}
  if (!data) { try { data = await htmlResults(query); } catch {} }
  data = data ? data.slice(0, 1200) : null;
  cache.set(key, { data, at: Date.now() });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return data;
}

// ── calculator ───────────────────────────────────────────────────────────────
const FUNCS = new Set(["sqrt", "abs", "round", "floor", "ceil", "min", "max", "pow", "sin", "cos", "tan", "log", "log10", "exp"]);
const CONSTS = { pi: Math.PI, e: Math.E };

function calculate(expression) {
  const expr = String(expression || "").trim().toLowerCase().replace(/\^/g, "**").replace(/×/g, "*").replace(/÷/g, "/").replace(/,(?=\d{3}\b)/g, "");
  if (!expr || expr.length > 200) throw new Error("expression missing or too long");
  if (!/^[\d\s+\-*/().%,a-z_]*$/.test(expr)) throw new Error("only numbers, operators and basic math functions are allowed");
  for (const word of expr.match(/[a-z_]+/g) || []) {
    if (!FUNCS.has(word) && !(word in CONSTS)) throw new Error(`unknown word "${word}"`);
  }
  const names = [...FUNCS].concat(Object.keys(CONSTS));
  const values = [...FUNCS].map((f) => Math[f]).concat(Object.values(CONSTS));
  // eslint-disable-next-line no-new-func
  const result = new Function(...names, `"use strict"; return (${expr});`)(...values);
  if (typeof result !== "number" || !Number.isFinite(result)) throw new Error("that doesn't evaluate to a number");
  return Math.round(result * 1e10) / 1e10;
}

module.exports = { webSearch, calculate };
