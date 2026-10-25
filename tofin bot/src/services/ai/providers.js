// Multi-provider, multi-key chat completion with automatic failover.
//
// Every provider is spoken to through its OpenAI-compatible endpoint, so the same
// request (messages + tools) works everywhere. For each request we build a list of
// candidates = (provider × key × model) and walk it until one answers:
//   - rate limited      → that key/model cools down, move on to the next candidate
//   - bad / dead key    → key is parked for hours, move on
//   - timeout / 5xx     → short cooldown, move on
//   - slow (> HEDGE_MS) → start the next candidate in parallel, first good answer wins
//   - everything cold   → last-resort pass that ignores cooldowns, so we still try
//
// Add more keys with GROQ_API_KEY_2, GROQ_API_KEY_3 … or GROQ_API_KEYS=a,b,c
// (same pattern for GOOGLE_API_KEY / GEMINI_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, HF_API_KEY).

const HEDGE_MS = 4000;      // wait this long for the current attempt before racing the next one
const ATTEMPT_TIMEOUT = 20_000;
const MAX_PARALLEL = 2;

const PROVIDERS = [
  {
    id: "groq", label: "Groq (Llama 3.3)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    envKeys: ["GROQ_API_KEY"],
    models: [{ id: "llama-3.3-70b-versatile" }, { id: "llama-3.1-8b-instant", weak: true }],
  },
  {
    id: "gemini", label: "Gemini 2.0 Flash", vision: true,
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    models: [{ id: "gemini-2.0-flash" }, { id: "gemini-2.0-flash-lite", weak: true }],
  },
  {
    id: "mistral", label: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    envKeys: ["MISTRAL_API_KEY"],
    models: [{ id: "mistral-small-latest" }, { id: "open-mistral-nemo", weak: true }],
  },
  {
    id: "openrouter", label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    extraHeaders: { "HTTP-Referer": "https://tofin.bot", "X-Title": "Tofin Discord Bot" },
    envKeys: ["OPENROUTER_API_KEY"],
    models: [
      { id: "meta-llama/llama-3.3-70b-instruct:free" },
      { id: "mistralai/mistral-small-3.1-24b-instruct:free" },
      { id: "openai/gpt-oss-20b:free", weak: true },
      { id: "meta-llama/llama-3.2-3b-instruct:free", weak: true },
    ],
  },
  {
    id: "huggingface", label: "Hugging Face",
    url: "https://router.huggingface.co/v1/chat/completions",
    envKeys: ["HF_API_KEY"],
    models: [{ id: "meta-llama/Llama-3.3-70B-Instruct" }],
  },
];

// ── keys ─────────────────────────────────────────────────────────────────────
function keysFor(provider) {
  const found = [];
  for (const base of provider.envKeys) {
    if (process.env[base]) found.push(process.env[base]);
    for (let i = 2; i <= 9; i++) if (process.env[`${base}_${i}`]) found.push(process.env[`${base}_${i}`]);
    if (process.env[`${base}S`]) found.push(...process.env[`${base}S`].split(","));
  }
  return [...new Set(found.map((k) => k.trim()).filter(Boolean))];
}

// ── health state ─────────────────────────────────────────────────────────────
const coolUntil = new Map(); // "provider|keyIdx|model" → timestamp
const deadUntil = new Map(); // "provider|keyIdx"        → timestamp (bad key)
const slot = (c) => `${c.provider.id}|${c.keyIdx}|${c.model.id}`;
const keySlot = (c) => `${c.provider.id}|${c.keyIdx}`;
const now = () => Date.now();

function parseRetryMs(text, headerSeconds) {
  if (headerSeconds && Number.isFinite(+headerSeconds)) return Math.min(+headerSeconds, 3600) * 1000;
  const m = String(text).match(/(?:retry|try again)[^\d]{0,20}([\d.]+)\s*(ms|s|sec|seconds|m|min|minutes)?/i);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = (m[2] || "s").toLowerCase();
    if (unit === "ms") return Math.max(1000, n);
    if (unit.startsWith("m") && unit !== "ms") return Math.min(n * 60_000, 3_600_000);
    return Math.min(n * 1000, 3_600_000);
  }
  if (/per day|daily/i.test(text)) return 30 * 60_000;
  return 45_000;
}

class ProviderError extends Error {
  constructor(message, { status = 0, kind = "error", retryMs = 0 } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // "rate" | "auth" | "model" | "bad" | "timeout" | "error"
    this.retryMs = retryMs;
  }
}

function classify(status, text, retryAfter) {
  let msg = text;
  try { const j = JSON.parse(text); msg = j.error?.message || j.message || (Array.isArray(j) ? j[0]?.error?.message : "") || text; } catch {}
  msg = String(msg).slice(0, 300);
  if (status === 429 || /rate.?limit|quota|exhausted|too many requests|capacity/i.test(msg)) {
    return new ProviderError(msg, { status, kind: "rate", retryMs: parseRetryMs(msg, retryAfter) });
  }
  if (status === 401 || status === 403 || /api key|unauthori[sz]ed|invalid.*key|permission/i.test(msg)) {
    return new ProviderError(msg, { status, kind: "auth" });
  }
  if (status === 404 || /model.*(not found|does not exist|unavailable)|no endpoints found/i.test(msg)) {
    return new ProviderError(msg, { status, kind: "model" });
  }
  if (status === 400 && /tool_use_failed|failed_generation|function/i.test(msg)) {
    return new ProviderError(msg, { status, kind: "bad" }); // model fumbled the tool call → try another
  }
  if (status >= 500) return new ProviderError(msg, { status, kind: "timeout", retryMs: 20_000 });
  return new ProviderError(msg || `HTTP ${status}`, { status, kind: "error", retryMs: 15_000 });
}

function penalise(c, err) {
  switch (err.kind) {
    case "rate":  coolUntil.set(slot(c), now() + (err.retryMs || 45_000)); break;
    case "auth":  deadUntil.set(keySlot(c), now() + 6 * 3600_000); break;
    case "model": coolUntil.set(slot(c), now() + 3600_000); break;
    case "bad":   coolUntil.set(slot(c), now() + 30_000); break;
    default:      coolUntil.set(slot(c), now() + (err.retryMs || 15_000));
  }
}

// ── candidates ───────────────────────────────────────────────────────────────
function allCandidates({ vision = false } = {}) {
  const out = [];
  for (const provider of PROVIDERS) {
    if (vision && !provider.vision) continue;
    const keys = keysFor(provider);
    for (const model of provider.models) {
      keys.forEach((key, keyIdx) => out.push({ provider, model, key, keyIdx }));
    }
  }
  return out;
}

function orderCandidates(list, { tools = false } = {}) {
  const alive = list.filter((c) => (deadUntil.get(keySlot(c)) ?? 0) <= now());
  const rank = (c) => (tools && c.model.weak ? 1 : 0); // weak models last when tools are involved
  const stable = alive.map((c, i) => ({ c, i }));
  stable.sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
  const ordered = stable.map((x) => x.c);
  const ready = ordered.filter((c) => (coolUntil.get(slot(c)) ?? 0) <= now());
  if (ready.length) return ready;
  // Everything is cooling down: still try, soonest-to-recover first.
  return [...ordered].sort((a, b) => (coolUntil.get(slot(a)) ?? 0) - (coolUntil.get(slot(b)) ?? 0));
}

// ── message plumbing ─────────────────────────────────────────────────────────
// Some providers reject two messages with the same role in a row; merge them.
function normaliseMessages(messages) {
  const out = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && m.role !== "tool" && !prev.tool_calls && !m.tool_calls
        && typeof prev.content === "string" && typeof m.content === "string") {
      prev.content += "\n" + m.content;
    } else {
      out.push({ ...m });
    }
  }
  return out;
}

async function attempt(c, req, signal) {
  const body = {
    model: c.model.id,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 450,
    temperature: req.temperature ?? 0.8,
  };
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = "auto"; }

  const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT);
  let res;
  try {
    res = await fetch(c.provider.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}`, ...(c.provider.extraHeaders || {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (e) {
    if (signal.aborted) throw e; // we cancelled it ourselves
    throw new ProviderError(e.name === "TimeoutError" ? "timeout" : e.message, { kind: "timeout", retryMs: 20_000 });
  }

  const text = await res.text();
  if (!res.ok) throw classify(res.status, text, res.headers.get("retry-after"));

  let json;
  try { json = JSON.parse(text); } catch { throw new ProviderError("invalid JSON from provider", { kind: "bad" }); }
  if (json.error) throw classify(res.status, JSON.stringify(json), null);

  const msg = json.choices?.[0]?.message;
  if (!msg) throw new ProviderError("empty response", { kind: "bad" });

  const toolCalls = [];
  for (const tc of msg.tool_calls || []) {
    let args = {};
    try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; }
    catch { throw new ProviderError("tool call had invalid JSON arguments", { kind: "bad" }); }
    if (!tc.function?.name) throw new ProviderError("tool call without a name", { kind: "bad" });
    toolCalls.push({ id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: tc.function.name, args });
  }
  const content = (typeof msg.content === "string" ? msg.content : "").trim();
  if (!content && !toolCalls.length) throw new ProviderError("model returned nothing", { kind: "bad" });

  return { content, toolCalls, provider: c.provider.label, model: c.model.id };
}

// ── public API ───────────────────────────────────────────────────────────────
// req: { messages, tools?, maxTokens?, temperature?, vision? }
// resolves { content, toolCalls, provider, model } — rejects only when every candidate failed.
function complete(req) {
  const messages = normaliseMessages(req.messages);
  const run = (vision) => runCandidates({ ...req, messages }, orderCandidates(allCandidates({ vision }), { tools: !!req.tools?.length }));
  return run(!!req.vision).catch((err) => {
    if (!req.vision) throw err;
    // No vision-capable provider answered: retry as plain text so the user still gets a reply.
    const stripped = messages.map((m) => (Array.isArray(m.content)
      ? { ...m, content: m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") }
      : m));
    return runCandidates({ ...req, messages: stripped }, orderCandidates(allCandidates({}), { tools: !!req.tools?.length }));
  });
}

function runCandidates(req, candidates) {
  return new Promise((resolve, reject) => {
    if (!candidates.length) return reject(new Error("no API keys configured"));

    let next = 0;
    let settled = false;
    const running = new Map(); // controller → timer
    const errors = [];

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      for (const [ctrl, timer] of running) { clearTimeout(timer); ctrl.abort(); }
      running.clear();
      fn(value);
    };

    const launch = () => {
      if (settled || next >= candidates.length) return false;
      const c = candidates[next++];
      const ctrl = new AbortController();
      running.set(ctrl, setTimeout(() => { if (running.size < MAX_PARALLEL) launch(); }, HEDGE_MS)); // hedge

      attempt(c, req, ctrl.signal).then(
        (result) => finish(resolve, result),
        (err) => {
          clearTimeout(running.get(ctrl));
          running.delete(ctrl);
          if (settled) return;
          const e = err instanceof ProviderError ? err : new ProviderError(err.message || String(err));
          penalise(c, e);
          errors.push(`${c.provider.id}/${c.model.id}: ${e.kind} ${e.message.slice(0, 80)}`);
          console.warn(`[ai] ${c.provider.id}/${c.model.id} key#${c.keyIdx + 1} failed (${e.kind}): ${e.message.slice(0, 100)}`);
          if (!launch() && running.size === 0) finish(reject, new Error(`all providers failed → ${errors.slice(-4).join(" | ")}`));
        },
      );
      return true;
    };

    launch();
  });
}

// ── status / admin ───────────────────────────────────────────────────────────
function status() {
  return PROVIDERS.map((p) => {
    const keys = keysFor(p);
    const slots = [];
    for (const m of p.models) keys.forEach((_, i) => slots.push({ cool: coolUntil.get(`${p.id}|${i}|${m.id}`) ?? 0, dead: deadUntil.get(`${p.id}|${i}`) ?? 0 }));
    const usable = slots.filter((s) => s.cool <= now() && s.dead <= now());
    const soonest = slots.length ? Math.min(...slots.map((s) => Math.max(s.cool, s.dead))) : 0;
    return {
      id: p.id,
      name: p.label,
      hasKey: keys.length > 0,
      keyCount: keys.length,
      onCooldown: keys.length > 0 && usable.length === 0,
      failed: keys.length > 0 && slots.every((s) => s.dead > now()),
      resumesAt: soonest,
    };
  });
}

function resetCooldowns(target = "all") {
  const ids = target === "all" ? PROVIDERS.map((p) => p.id) : [target];
  for (const map of [coolUntil, deadUntil]) {
    for (const k of [...map.keys()]) if (ids.includes(k.split("|")[0])) map.delete(k);
  }
  return ids;
}

module.exports = { complete, status, resetCooldowns, keysFor, PROVIDERS, _internals: { orderCandidates, allCandidates, normaliseMessages, coolUntil, deadUntil } };
