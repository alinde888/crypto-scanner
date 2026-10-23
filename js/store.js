// App state, persistence and data loading.
import { CHAINS, chainById, P, analyzeEvm, analyzeSolana, assessRisk, DEFAULT_PLANS } from "./engine.js";
import { dex, goplusSecurity } from "./api.js";

const LS = "cryptoScanner.settings.v1";

function loadSettings() {
  const defaults = {
    chains: CHAINS.map((c) => c.id),
    minLiquidity: 10000,
    hideDangerous: true,
    autoRefreshMin: 5,
    plans: structuredClone(DEFAULT_PLANS),
  };
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || "null");
    if (saved && typeof saved === "object") {
      return { ...defaults, ...saved, plans: { ...defaults.plans, ...(saved.plans || {}) } };
    }
  } catch { /* storage unavailable */ }
  return defaults;
}

const listeners = new Set();

export const store = {
  settings: loadSettings(),
  pairs: [],
  loading: false,
  lastUpdated: null,
  error: null,
  security: new Map(),     // tokenKey -> report
  secErrors: new Map(),    // tokenKey -> message
  checking: new Set(),

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { for (const fn of listeners) fn(); },

  saveSettings() {
    try { localStorage.setItem(LS, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.emit();
  },

  risk(p) { return assessRisk(p, this.security.get(P.key(p))); },

  matches(strategy) {
    const { chains, minLiquidity, hideDangerous } = this.settings;
    const on = new Set(chains);
    return this.pairs.filter((p) => {
      if (!on.has(p.chainId)) return false;
      if (P.liq(p) < minLiquidity) return false;
      if (hideDangerous && this.security.get(P.key(p))?.verdict === "danger") return false;
      return strategy.match(p);
    });
  },

  async refresh() {
    if (this.loading) return;
    const chains = CHAINS.filter((c) => this.settings.chains.includes(c.id));
    if (!chains.length) {
      this.error = "Не выбрано ни одной сети. Включи сети в настройках.";
      this.emit();
      return;
    }
    this.loading = true;
    this.error = null;
    this.emit();
    const failures = [];
    const on = new Set(chains.map((c) => c.id));
    try {
      let refs = [];
      for (const load of [dex.latestProfiles, dex.latestBoosts, dex.topBoosts]) {
        try { refs = refs.concat(await load()); } catch (e) { failures.push(e.message); }
      }
      const byChain = new Map();
      const seen = new Set();
      for (const r of refs) {
        if (!on.has(r.chainId)) continue;
        const k = `${r.chainId}:${r.tokenAddress}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!byChain.has(r.chainId)) byChain.set(r.chainId, []);
        byChain.get(r.chainId).push(r.tokenAddress);
      }
      let collected = [];
      for (const [chain, tokens] of byChain) {
        for (let i = 0; i < tokens.length; i += 30) {
          try { collected = collected.concat(await dex.pairs(chain, tokens.slice(i, i + 30))); }
          catch (e) { failures.push(e.message); }
        }
      }
      for (const c of chains) {
        try { collected = collected.concat((await dex.search(c.seed)).filter((p) => p.chainId === c.id)); }
        catch (e) { failures.push(e.message); }
      }
      const best = new Map();
      for (const p of collected) {
        const k = P.key(p);
        const cur = best.get(k);
        if (!cur || P.liq(p) > P.liq(cur)) best.set(k, p);
      }
      if (!best.size) {
        this.error = failures[0] || "DexScreener не вернул данных.";
      } else {
        this.pairs = [...best.values()];
        this.lastUpdated = new Date();
      }
    } finally {
      this.loading = false;
      this.emit();
    }
  },

  async checkSecurity(p, force = false) {
    const key = P.key(p);
    if (!force && this.security.has(key)) return;
    if (this.checking.has(key)) return;
    const chain = chainById(p.chainId);
    if (!chain) return;
    this.checking.add(key);
    this.emit();
    try {
      const raw = await goplusSecurity(chain, p.baseToken.address);
      this.security.set(key, chain.id === "solana" ? analyzeSolana(raw) : analyzeEvm(raw));
      this.secErrors.delete(key);
    } catch (e) {
      this.secErrors.set(key, e.message);
    } finally {
      this.checking.delete(key);
      this.emit();
    }
  },

  // Sequential background checks of a list, cancelled by a newer call.
  _batch: 0,
  async checkMany(list, limit = 25) {
    const id = ++this._batch;
    for (const p of list.slice(0, limit)) {
      if (id !== this._batch) return;
      const k = P.key(p);
      if (this.security.has(k) || this.secErrors.has(k)) continue;
      await this.checkSecurity(p);
    }
  },

  _timer: null,
  scheduleAutoRefresh() {
    clearInterval(this._timer);
    const m = this.settings.autoRefreshMin;
    if (m > 0) this._timer = setInterval(() => this.refresh(), m * 60000);
  },
};
