// Automatic smart-money discovery: takes tokens that already ran, finds their
// early buyers, scores them and keeps a leaderboard. Optionally follows the
// best wallets in the copy-trading feed. Runs only while the site is open.

import { P, chainById } from "./engine.js?v=01c4dd2c";
import { store } from "./store.js?v=01c4dd2c";
import { WALLET_CHAINS, keys, analyzeWallet, findBuyers, watchlist, feed, startOfDay, RateLimitError, gradeWallet } from "./wallets.js?v=01c4dd2c";

const LS = "cryptoScanner.smart.v1";
const BUDGET = { solana: 6, evm: 24 };          // token scans per day
const BUYERS_PER_TOKEN = 15;
const REANALYZE_MS = 24 * 3600e3;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || "null");
    if (s && typeof s === "object") return { scanned: {}, wallets: {}, day: null, used: { solana: 0, evm: 0 }, log: [], ...s };
  } catch { /* ignore */ }
  return { scanned: {}, wallets: {}, day: null, used: { solana: 0, evm: 0 }, log: [] };
}

export const smart = {
  state: load(),
  running: false,
  status: "",
  timer: null,

  save() {
    try { localStorage.setItem(LS, JSON.stringify(this.state)); } catch { /* ignore */ }
    window.dispatchEvent(new Event("app:update"));
  },

  settings() {
    return { auto: store.settings.smartAuto !== false, follow: store.settings.smartFollow ?? 10 };
  },

  resetDay() {
    const today = startOfDay();
    if (this.state.day !== today) { this.state.day = today; this.state.used = { solana: 0, evm: 0 }; }
  },

  budgetLeft(kind) {
    this.resetDay();
    return BUDGET[kind] - (this.state.used[kind] || 0);
  },

  // Tokens that already made a strong move: their early buyers are the
  // people worth studying.
  // Solana memecoins move far more than EVM tokens, so EVM chains get a
  // lower bar to keep every supported chain in the rotation.
  winners() {
    const k = keys.get();
    return store.pairs.filter((p) => {
      const c = WALLET_CHAINS[p.chainId];
      if (!c || !k[c.key]) return false;
      if (this.state.scanned[P.key(p)]) return false;
      if (store.security.get(P.key(p))?.verdict === "danger") return false;
      const age = P.ageHours(p);
      const ch24 = P.change(p, "h24") ?? 0, ch6 = P.change(p, "h6") ?? 0;
      const sol = c.kind === "solana";
      const minLiq = sol ? 30000 : 20000;
      const maxAge = sol ? 24 * 7 : 24 * 30;
      const moved = sol ? (ch24 >= 100 || ch6 >= 60) : (ch24 >= 40 || ch6 >= 25);
      return P.liq(p) >= minLiq && age != null && age <= maxAge && moved;
    }).sort((a, b) => (P.change(b, "h24") ?? 0) - (P.change(a, "h24") ?? 0));
  },

  // Rotates through chains: the chain scanned longest ago goes next.
  nextPick() {
    const last = this.state.lastChain || {};
    const byChain = new Map();
    for (const p of this.winners()) {
      const kind = WALLET_CHAINS[p.chainId].kind === "solana" ? "solana" : "evm";
      if (this.budgetLeft(kind) <= 0) continue;
      if (!byChain.has(p.chainId)) byChain.set(p.chainId, p);
    }
    const chains = [...byChain.keys()].sort((a, b) => (last[a] || 0) - (last[b] || 0));
    return chains.length ? byChain.get(chains[0]) : null;
  },

  // Grades are recomputed with the current rules so older entries follow them too.
  list() {
    const rank = { strong: 0, medium: 1, weak: 2 };
    return Object.values(this.state.wallets)
      .filter((w) => !w.error)
      .map((w) => ({ ...w, grade: gradeWallet(w) }))
      .sort((a, b) => (rank[a.grade] - rank[b.grade]) || (b.pnl - a.pnl) || (b.hits.length - a.hits.length));
  },

  smartList() {
    return this.list().filter((w) => w.grade === "strong");
  },

  get(chain, wallet) {
    const w = this.state.wallets[`${chain}:${wallet.toLowerCase()}`];
    return w ? { ...w, grade: gradeWallet(w) } : w;
  },

  async scanToken(p) {
    const c = WALLET_CHAINS[p.chainId];
    const kind = c.kind === "solana" ? "solana" : "evm";
    const key = P.key(p);
    this.state.scanned[key] = Date.now();
    this.state.used[kind] = (this.state.used[kind] || 0) + 1;
    this.status = `Ищу ранних покупателей ${P.symbol(p)} (${chainById(p.chainId)?.name})…`;
    this.save();
    const { buyers } = await findBuyers(p.chainId, p.baseToken.address, { max: BUYERS_PER_TOKEN });
    let i = 0;
    for (const b of buyers) {
      i++;
      const id = `${p.chainId}:${b.wallet.toLowerCase()}`;
      const hit = { token: key, symbol: P.symbol(p), ts: b.ts };
      const cur = this.state.wallets[id];
      if (cur && Date.now() - cur.analyzedAt < REANALYZE_MS) {
        if (!cur.hits.some((h) => h.token === key)) cur.hits.push(hit);
        continue;
      }
      this.status = `Анализирую покупателей ${P.symbol(p)}: ${i} из ${buyers.length}`;
      this.save();
      try {
        const a = await analyzeWallet(p.chainId, b.wallet);
        this.state.wallets[id] = {
          chain: p.chainId, wallet: b.wallet, grade: a.grade, winRate: a.winRate, wins: a.wins, tokens: a.tokens,
          pnl: a.pnl, roi: a.roi, topShare: a.topShare, isBot: a.isBot, medianHold: a.medianHold, flags: a.flags,
          hits: [...(cur?.hits || []).filter((h) => h.token !== key), hit], analyzedAt: Date.now(),
        };
      } catch (e) {
        if (e instanceof RateLimitError || /Ключ/.test(e.message)) throw e;
      }
    }
    this.state.log = [{ ts: Date.now(), token: key, symbol: P.symbol(p), chain: p.chainId, buyers: buyers.length }, ...this.state.log].slice(0, 30);
    this.trim();
    this.syncFollow();
  },

  trim() {
    const all = Object.entries(this.state.wallets);
    if (all.length <= 600) return;
    const rank = { strong: 0, medium: 1, weak: 2 };
    all.sort(([, a], [, b]) => (rank[a.grade] - rank[b.grade]) || (b.pnl - a.pnl));
    this.state.wallets = Object.fromEntries(all.slice(0, 600));
  },

  // Keeps the top N smart wallets in the copy-trading watchlist. Wallets the
  // user added by hand are never removed.
  syncFollow() {
    const n = this.settings().follow;
    const top = n > 0 ? this.smartList().slice(0, n) : [];
    const topIds = new Set(top.map((w) => `${w.chain}:${w.wallet.toLowerCase()}`));
    for (const w of watchlist.all()) {
      if (w.auto && !topIds.has(`${w.chain}:${w.wallet.toLowerCase()}`)) watchlist.remove(w.chain, w.wallet);
    }
    for (const w of top) {
      if (!watchlist.has(w.chain, w.wallet)) watchlist.add({ chain: w.chain, wallet: w.wallet, label: "", auto: true });
    }
  },

  async tick() {
    if (this.running || !this.settings().auto) return;
    if (this.pausedUntil && Date.now() < this.pausedUntil) return;
    this.notice = null;
    const k = keys.get();
    if (!k.etherscan && !k.helius) return;
    const pick = this.nextPick();
    if (!pick) return;
    this.state.lastChain = { ...(this.state.lastChain || {}), [pick.chainId]: Date.now() };
    this.running = true;
    this.error = null;
    try {
      await this.scanToken(pick);
    } catch (e) {
      if (e instanceof RateLimitError) {
        // Put the token back in the queue and refund the daily budget; the next tick retries.
        delete this.state.scanned[P.key(pick)];
        const kind = WALLET_CHAINS[pick.chainId].kind === "solana" ? "solana" : "evm";
        this.state.used[kind] = Math.max(0, (this.state.used[kind] || 1) - 1);
        this.pausedUntil = Date.now() + 3 * 60e3;
        this.notice = "Сервис данных попросил паузу, поиск продолжится через 3 минуты.";
      } else {
        this.error = e.message;
      }
    } finally {
      this.running = false;
      this.status = "";
      this.save();
      window.dispatchEvent(new Event("smart:updated"));
    }
  },

  start() {
    this.syncFollow();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 4 * 60e3);
    setTimeout(() => this.tick(), 20e3);
  },

  // Recent buys by tracked smart wallets, grouped by token.
  recentSmartBuys(hours = 6) {
    const since = Date.now() - hours * 3600e3;
    const map = new Map();
    for (const t of feed.all()) {
      if (t.side !== "buy" || t.ts < since) continue;
      const k = `${t.chain}:${t.token}`;
      const w = this.get(t.chain, t.wallet);
      const e = map.get(k) || { token: t.token, chain: t.chain, symbol: t.symbol, buys: [], usd: 0 };
      e.buys.push({ wallet: t.wallet, usd: t.usd, ts: t.ts, grade: w?.grade, winRate: w?.winRate, pnl: w?.pnl });
      e.usd += t.usd || 0;
      map.set(k, e);
    }
    return map;
  },
};
