// AI analyst: picks the strongest setups from the market, makes sure the
// contract is checked, and asks Claude for a structured verdict on each.
// The Anthropic key lives only in this browser.

import { P, STRATEGIES, TIERS, lateEntry, chainById, fmt } from "./engine.js?v=01c4dd2c";
import { store } from "./store.js?v=01c4dd2c";
import { keys, startOfDay } from "./wallets.js?v=01c4dd2c";
import { smart } from "./smartmoney.js?v=01c4dd2c";

const LS = "cryptoScanner.ai.v1";
export const MODELS = [
  { id: "claude-haiku-5-5", title: "Claude Haiku 5.5: быстрее и дешевле" },
  { id: "claude-sonnet-5-5", title: "Claude Sonnet 5.5: глубже анализ" },
  { id: "claude-opus-5-5", title: "Claude Opus 5.5: максимум качества, дороже всего" },
];
const BATCH = 6;
// Bump when the analysis rules change: older verdicts are dropped and re-analysed.
const PROMPT_V = 3;
const TTL = { candidate: 45 * 60e3, watch: 45 * 60e3, avoid: 3 * 3600e3 };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || "null");
    if (s && typeof s === "object") return { results: {}, day: null, calls: 0, inTok: 0, outTok: 0, totalIn: 0, totalOut: 0, ...s };
  } catch { /* ignore */ }
  return { results: {}, day: null, calls: 0, inTok: 0, outTok: 0, totalIn: 0, totalOut: 0 };
}

const SYSTEM = `You are an on-chain crypto analyst inside a DEX token screener. A trader reviews your output and decides himself whether to buy; he accepts the risk. Your job is to rank setups honestly using only the data given.

Judge every token within its own risk class. A brand-new memecoin is a high-risk trade and can still be a "candidate" when the setup is strong for a speculative entry; an established token is a low-risk trade and is a "candidate" when its trend and liquidity are healthy. Assign "risk" by the class of the trade (high: young or small-cap, thin liquidity, memecoins; medium: a few days to weeks old with decent liquidity; low: established, deep liquidity).

These tokens already passed hard filters (liquidity, contract scan, no exhausted pump, buyers not outnumbered), so they are the best of the current market. Your job is to rank them and pick the tradeable ones, not to look for perfection: every DEX trade carries risk and the trader has chosen to take it.

First give every token a "score" 0-100: the quality of the trade setup within its risk class (momentum health, buyer/seller balance, volume trend, liquidity vs market cap, contract, holder distribution, smart wallets).

Then decide:
- "candidate": among the best setups of this batch and without a disqualifying red flag. When the batch has anything tradeable, mark the best 1-3 tokens as candidates. Use zero only when every token has a disqualifying red flag.
- "watch": decent but clearly weaker than the candidates, or one concrete thing is missing. Say what would make it a candidate.
- "avoid": a disqualifying red flag: dangerous contract permissions, exhausted momentum with heavy selling, liquidity that can be pulled while holders are concentrated, signs of a rug or wash trading.

Rules:
- Treat a token that already rose several hundred percent as a late entry unless fresh volume and buyers clearly continue.
- Fading momentum (falling 5m and 1h price, sellers outnumbering buyers) is a strong negative.
- "confidence" (0-100) is how strong the evidence for your verdict is, not a probability of profit. A candidate normally has confidence 50 or higher.
- Never promise returns. No hype words.
- Write all text in Russian, concise, with concrete numbers from the data.`;

const TOOL = {
  name: "report",
  description: "Report the analysis of every token.",
  input_schema: {
    type: "object",
    properties: {
      analyses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "id of the token exactly as given" },
            verdict: { type: "string", enum: ["candidate", "watch", "avoid"] },
            score: { type: "integer", minimum: 0, maximum: 100, description: "setup quality within its risk class" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            risk: { type: "string", enum: ["high", "medium", "low"] },
            headline: { type: "string", description: "one line, up to 90 characters" },
            thesis: { type: "string", description: "2-3 sentences: what is happening and why it matters" },
            positives: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            timing: { type: "string", description: "is entering now reasonable or better to wait, and for what" },
            invalidation: { type: "string", description: "what would show the idea is wrong" },
          },
          required: ["id", "score", "verdict", "confidence", "risk", "headline", "thesis", "positives", "risks", "timing", "invalidation"],
        },
      },
    },
    required: ["analyses"],
  },
};

// Models sometimes return arrays as JSON strings, omit fields or use
// unexpected values. Everything shown on the page goes through this.
function toList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "")).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    try { const j = JSON.parse(v); if (Array.isArray(j)) return toList(j); } catch { /* plain text */ }
    return v.split(/\n|;\s*/).map((x) => x.replace(/^[-•*\s]+/, "").trim()).filter(Boolean);
  }
  return [];
}
const toInt = (v, d = 0) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
const toText = (v) => (v == null ? "" : String(v));

// Finds the list of analyses wherever the model put it.
function extractAnalyses(body) {
  const parse = (v) => {
    if (typeof v === "string") { try { return parse(JSON.parse(v)); } catch { return null; } }
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      for (const k of ["analyses", "analysis", "tokens", "results", "items"]) {
        const r = parse(v[k]);
        if (r) return r;
      }
      if (v.id && v.verdict) return [v];
      const vals = Object.values(v);
      if (vals.length && vals.every((x) => x && typeof x === "object" && x.verdict)) return vals;
    }
    return null;
  };
  for (const c of body?.content || []) {
    if (c.type === "tool_use") { const r = parse(c.input); if (r?.length) return r; }
  }
  for (const c of body?.content || []) {
    if (c.type === "text" && c.text) {
      const m = c.text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (m) { const r = parse(m[0]); if (r?.length) return r; }
    }
  }
  return [];
}

export function normalize(a) {
  const v0 = String(a?.verdict || "").toLowerCase(), r0 = String(a?.risk || "").toLowerCase();
  const verdict = ["candidate", "watch", "avoid"].includes(v0) ? v0 : "watch";
  const risk = ["high", "medium", "low"].includes(r0) ? r0 : "high";
  return {
    ...a,
    verdict, risk,
    score: toInt(a?.score, null),
    confidence: toInt(a?.confidence, 0),
    headline: toText(a?.headline) || toText(a?.thesis).slice(0, 90),
    thesis: toText(a?.thesis),
    positives: toList(a?.positives),
    risks: toList(a?.risks),
    timing: toText(a?.timing),
    invalidation: toText(a?.invalidation),
  };
}

const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);

function describe(p, smartBuys) {
  const key = P.key(p);
  const sec = store.security.get(key);
  const risk = store.risk(p);
  const tx = (w) => (p.txns?.[w] ? { buys: p.txns[w].buys, sells: p.txns[w].sells, buyers: p.txns[w].buyers, sellers: p.txns[w].sellers } : null);
  const sb = smartBuys.get(`${p.chainId}:${p.baseToken.address.toLowerCase()}`);
  return {
    id: key,
    symbol: P.symbol(p), name: P.name(p), chain: chainById(p.chainId)?.name || p.chainId,
    age_hours: r1(P.ageHours(p)),
    price_usd: P.price(p),
    liquidity_usd: Math.round(P.liq(p)),
    market_cap_usd: P.cap(p) ? Math.round(P.cap(p)) : null,
    price_change_pct: { m5: r1(P.change(p, "m5")), h1: r1(P.change(p, "h1")), h6: r1(P.change(p, "h6")), h24: r1(P.change(p, "h24")) },
    volume_usd: { h1: Math.round(P.vol(p, "h1")), h6: Math.round(P.vol(p, "h6")), h24: Math.round(P.vol(p, "h24")) },
    txns: { m5: tx("m5"), h1: tx("h1"), h6: tx("h6"), h24: tx("h24") },
    matched_strategies: STRATEGIES.filter((s) => s.match(p)).map((s) => s.title),
    late_entry_flags: lateEntry(p, { maxPump: 300, skipFading: true }),
    screener_risk: risk.tier ? TIERS[risk.tier].title : "опасно",
    contract: sec ? {
      verdict: sec.verdict,
      flags: sec.flags.map((f) => f.title),
      buy_tax: sec.buyTax, sell_tax: sec.sellTax,
      holders: sec.holderCount, top10_share: sec.top10 != null ? r1(sec.top10 * 100) : null,
      lp_locked_share: sec.lpLocked != null ? r1(sec.lpLocked * 100) : null,
    } : "not checked",
    smart_wallets: sb ? {
      buys_last_6h: sb.buys.length,
      usd: Math.round(sb.usd),
      wallets: sb.buys.slice(0, 5).map((b) => ({ grade: b.grade || "unknown", win_rate_pct: b.winRate != null ? r1(b.winRate * 100) : null, pnl_usd: b.pnl != null ? Math.round(b.pnl) : null })),
    } : null,
  };
}

// Hard gates: obvious non-trades never reach the AI.
function passesGates(p, smartBuys) {
  const sb = smartBuys.get(`${p.chainId}:${p.baseToken.address.toLowerCase()}`);
  if (P.liq(p) < Math.max(15000, store.settings.minLiquidity)) return false;
  if (store.security.get(P.key(p))?.verdict === "danger") return false;
  if (lateEntry(p, { maxPump: 300, skipFading: true }).length && !sb) return false;
  const b = P.buys(p, "h1"), sl = P.sells(p, "h1");
  if (b + sl >= 20 && b / (b + sl) < 0.5 && !sb) return false;
  const cap = P.cap(p);
  if (cap && P.liq(p) / cap < 0.03) return false;      // liquidity too thin to exit
  return true;
}

// Heuristic pre-ranking so the AI spends tokens on the most promising setups.
function preScore(p, profile, smartBuys) {
  const strategies = STRATEGIES.filter((s) => profile === "all" || s.risk === profile);
  const matched = strategies.filter((s) => s.match(p)).length;
  const sb = smartBuys.get(`${p.chainId}:${p.baseToken.address.toLowerCase()}`);
  // Strategy matches and smart-wallet buys weigh most, but healthy momentum
  // alone can also put a token in front of the AI.
  let s = matched * 2 + (sb ? 4 + Math.min(sb.buys.length, 4) * 2 : 0);
  if ((P.change(p, "h1") ?? 0) > 0 && (P.change(p, "m5") ?? 0) >= 0) s += 1;
  const b = P.buys(p, "h1"), sl = P.sells(p, "h1");
  if (b + sl > 20 && b / (b + sl) > 0.58) s += 2;
  const v1 = P.vol(p, "h1"), v6 = P.vol(p, "h6");
  if (v6 > 0 && v1 > (v6 / 6) * 1.5) s += 2;
  if (lateEntry(p, { maxPump: 300, skipFading: true }).length) s -= 5;
  if (P.liq(p) >= 50000) s += 1;
  const sec = store.security.get(P.key(p));
  if (sec?.verdict === "caution") s -= 1;
  return s;
}

export const ai = {
  state: load(),
  running: false,
  status: "",
  error: null,
  lastRun: null,
  timer: null,

  save() {
    try { localStorage.setItem(LS, JSON.stringify(this.state)); } catch { /* ignore */ }
    window.dispatchEvent(new Event("app:update"));
  },

  cfg() {
    const s = store.settings;
    return {
      enabled: s.aiEnabled !== false,
      model: s.aiModel || MODELS[0].id,
      dailyCalls: s.aiDailyCalls ?? 40,
      profile: s.riskProfile || "all",
    };
  },

  resetDay() {
    const d = startOfDay();
    if (this.state.day !== d) Object.assign(this.state, { day: d, calls: 0, inTok: 0, outTok: 0 });
  },

  callsLeft() {
    this.resetDay();
    return Math.max(0, this.cfg().dailyCalls - this.state.calls);
  },

  results() {
    return Object.values(this.state.results).filter((r) => r && r.v === PROMPT_V && r.pair && r.pair.baseToken).map(normalize);
  },

  pending(profile) {
    const smartBuys = smart.recentSmartBuys();
    const now = Date.now();
    const base = store.pairs.filter((p) => {
      if (!store.settings.chains.includes(p.chainId)) return false;
      if (!passesGates(p, smartBuys)) return false;
      if (store.security.get(P.key(p))?.verdict === "danger") return false;
      const prev = this.state.results[P.key(p)];
      if (prev && prev.v !== PROMPT_V) return true;
      if (prev && now - prev.at < (TTL[prev.verdict] || TTL.watch)) return false;
      return true;
    });
    return base
      .map((p) => ({ p, s: preScore(p, profile, smartBuys) }))
      .filter((x) => x.s >= 2)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
  },

  async run({ manual = false } = {}) {
    if (this.running) return;
    const key = keys.get().anthropic;
    const cfg = this.cfg();
    if (!key) { if (manual) { this.error = "Добавь ключ Anthropic API в Настройках."; this.save(); } return; }
    if (!cfg.enabled && !manual) return;
    if (this.callsLeft() <= 0) { this.error = `Дневной лимит анализов (${cfg.dailyCalls}) исчерпан. Его можно поднять в настройках.`; this.save(); return; }
    const list = this.pending(cfg.profile).slice(0, this.batch || BATCH);
    this.lastPending = list.length;
    if (!list.length) { this.status = "Новых токенов, прошедших фильтр, пока нет. Проверю после следующего обновления рынка."; this.save(); return; }

    this.running = true;
    this.error = null;
    try {
      this.status = "Проверяю контракты кандидатов…";
      this.save();
      for (const p of list) await store.checkSecurity(p);
      const clean = list.filter((p) => store.security.get(P.key(p))?.verdict !== "danger");
      if (!clean.length) return;

      this.status = `ИИ анализирует ${clean.length} токен(ов)…`;
      this.save();
      const smartBuys = smart.recentSmartBuys();
      const plans = store.settings.plans;
      const payload = {
        trader_profile: { risk_appetite: cfg.profile === "all" ? "any" : cfg.profile, exit_rules_pct: plans },
        tokens: clean.map((p) => describe(p, smartBuys)),
      };
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 8000,
          system: SYSTEM,
          tools: [TOOL],
          tool_choice: { type: "tool", name: "report" },
          messages: [{ role: "user", content: `Analyse these tokens. Data snapshot taken ${new Date().toISOString()}.\n\n${JSON.stringify(payload)}` }],
        }),
      }).catch(() => { throw new Error("Нет связи с API Anthropic."); });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body?.error?.message || `ошибка ${res.status}`;
        if (res.status === 401) throw new Error("Ключ Anthropic не подходит. Проверь его в Настройках.");
        if (res.status === 429) throw new Error("API Anthropic: лимит запросов, следующая попытка позже.");
        if (/credit|billing/i.test(msg)) throw new Error("На балансе Anthropic API закончились средства. Пополни его в console.anthropic.com.");
        throw new Error(`API Anthropic: ${msg}`);
      }
      this.resetDay();
      this.state.calls++;
      const u = body.usage || {};
      this.state.inTok += u.input_tokens || 0;
      this.state.outTok += u.output_tokens || 0;
      this.state.totalIn += u.input_tokens || 0;
      this.state.totalOut += u.output_tokens || 0;

      this.lastRaw = JSON.stringify({ stop_reason: body.stop_reason, content: body.content }).slice(0, 6000);
      let out = extractAnalyses(body);
      out = out.filter((a) => a && typeof a === "object").map(normalize);
      if (!out.length) {
        if (body.stop_reason === "max_tokens") {
          this.batch = Math.max(3, (this.batch || BATCH) - 2);
          throw new Error("Ответ ИИ обрезался по длине. Следующий анализ возьмёт меньше токенов за раз.");
        }
        throw new Error("ИИ вернул ответ в неожиданном формате. Повторю при следующем анализе.");
      }
      this.lastRaw = null;
      const byId = new Map(clean.map((p) => [P.key(p), p]));
      for (const a of out) {
        const p = byId.get(a.id);
        if (!p) continue;
        this.state.results[a.id] = {
          ...a,
          v: PROMPT_V,
          at: Date.now(),
          model: cfg.model,
          pair: p,
          priceAt: P.price(p),
          smartBuys: smartBuys.get(`${p.chainId}:${p.baseToken.address.toLowerCase()}`)?.buys.length || 0,
        };
      }
      this.prune();
      this.lastRun = new Date();
      window.dispatchEvent(new CustomEvent("ai:results", { detail: out.filter((a) => a.verdict === "candidate") }));
    } catch (e) {
      this.error = e.message;
    } finally {
      this.running = false;
      this.status = "";
      this.save();
    }
  },

  prune() {
    const cutoff = Date.now() - 24 * 3600e3;
    for (const [k, v] of Object.entries(this.state.results)) if (v.at < cutoff) delete this.state.results[k];
  },

  clear() {
    this.state.results = {};
    this.save();
  },

  start() {
    store.onRefreshed(() => this.run());
    // First pass as soon as the fast DexScreener data is in, without waiting
    // for the slower GeckoTerminal sweep.
    const first = setInterval(() => {
      if (store.pairs.length) { clearInterval(first); setTimeout(() => this.run(), 3000); }
    }, 2000);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.run(), 6 * 60e3);
  },

  // Fresh market data for a stored result, if the token is still in the market list.
  live(r) {
    return store.pairs.find((p) => P.key(p) === P.key(r.pair)) || r.pair;
  },
};

export const VERDICT_UI = {
  candidate: { t: "Кандидат на покупку", cls: "good" },
  watch: { t: "Наблюдать", cls: "warn" },
  avoid: { t: "Избегать", cls: "bad" },
};

export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
export { fmt };
