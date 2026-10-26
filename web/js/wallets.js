// Wallet history, trade reconstruction, win-rate scoring and copy-trading feed.
// Data: Etherscan V2 (EVM, free tier chains) and Helius (Solana).
// Keys live only in this browser's localStorage.

import { dex } from "./api.js";
import { P } from "./engine.js";

// ---------- keys ----------

const KEYS = "cryptoScanner.keys.v1";
export const keys = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEYS) || "{}") || {}; } catch { return {}; }
  },
  set(k) {
    try { localStorage.setItem(KEYS, JSON.stringify(k)); } catch { /* ignore */ }
  },
};

// ---------- supported chains for wallet analysis ----------

export const WALLET_CHAINS = {
  solana: {
    id: "solana", name: "Solana", kind: "solana", native: "SOL", key: "helius",
    quotes: {
      So11111111111111111111111111111111111111112: "native",
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "usd",
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "usd",
    },
    wrapped: "So11111111111111111111111111111111111111112",
    explorer: "https://solscan.io/account/",
  },
  ethereum: {
    id: "ethereum", name: "Ethereum", kind: "evm", chainid: 1, native: "ETH", key: "etherscan",
    wrapped: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    quotes: {
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "native",
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "usd",
      "0xdac17f958d2ee523a2206206994597c13d831ec7": "usd",
      "0x6b175474e89094c44da98b954eedeac495271d0f": "usd",
    },
    explorer: "https://etherscan.io/address/",
  },
  arbitrum: {
    id: "arbitrum", name: "Arbitrum", kind: "evm", chainid: 42161, native: "ETH", key: "etherscan",
    wrapped: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    quotes: {
      "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": "native",
      "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "usd",
      "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": "usd",
      "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "usd",
    },
    explorer: "https://arbiscan.io/address/",
  },
  polygon: {
    id: "polygon", name: "Polygon", kind: "evm", chainid: 137, native: "POL", key: "etherscan",
    wrapped: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    quotes: {
      "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": "native",
      "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "usd",
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": "usd",
      "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "usd",
    },
    explorer: "https://polygonscan.com/address/",
  },
  sonic: {
    id: "sonic", name: "Sonic", kind: "evm", chainid: 146, native: "S", key: "etherscan",
    wrapped: "0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38",
    quotes: {
      "0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38": "native",
      "0x29219dd400f2bf60e5a23d13be72b486d4038894": "usd",
    },
    explorer: "https://sonicscan.org/address/",
  },
  hyperevm: {
    id: "hyperevm", name: "HyperEVM", kind: "evm", chainid: 999, native: "HYPE", key: "etherscan",
    wrapped: "0x5555555555555555555555555555555555555555",
    quotes: {
      "0x5555555555555555555555555555555555555555": "native",
      "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb": "usd",
    },
    explorer: "https://hyperevmscan.io/address/",
  },
};

export const UNSUPPORTED_WALLET_CHAINS = {
  bsc: "История кошельков BNB Chain доступна только на платном тарифе Etherscan.",
  base: "История кошельков Base доступна только на платном тарифе Etherscan.",
  optimism: "История кошельков Optimism доступна только на платном тарифе Etherscan.",
  avalanche: "История кошельков Avalanche доступна только на платном тарифе Etherscan.",
};

export function requireKey(chain) {
  const c = WALLET_CHAINS[chain];
  if (!c) throw new Error(UNSUPPORTED_WALLET_CHAINS[chain] || "Эта сеть пока не поддерживается для анализа кошельков.");
  const k = keys.get()[c.key];
  if (!k) {
    throw new Error(c.key === "helius"
      ? "Нужен ключ Helius для Solana. Добавь его в Настройках → API-ключи."
      : "Нужен ключ Etherscan. Добавь его в Настройках → API-ключи.");
  }
  return k;
}

// ---------- HTTP with pacing ----------

class Pacer {
  constructor(ms) { this.ms = ms; this.next = 0; }
  async wait() {
    const now = Date.now();
    const slot = Math.max(now, this.next);
    this.next = slot + this.ms;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }
}
const etherscanPacer = new Pacer(350);   // free tier: 3-5 calls per second
const heliusPacer = new Pacer(150);

async function fetchJSON(url, init) {
  let res;
  try { res = await fetch(url, init); }
  catch { throw new Error(`Нет связи с ${new URL(url).host}.`); }
  if (res.status === 401 || res.status === 403) throw new Error("Ключ API не подходит. Проверь его в Настройках → API-ключи.");
  if (res.status === 429) throw new Error("Лимит запросов API исчерпан, подожди минуту.");
  if (!res.ok) throw new Error(`${new URL(url).host} ответил ошибкой ${res.status}.`);
  return res.json();
}

async function etherscan(chain, params) {
  const key = requireKey(chain);
  const c = WALLET_CHAINS[chain];
  const q = new URLSearchParams({ chainid: String(c.chainid), ...params, apikey: key });
  for (let attempt = 0; attempt < 3; attempt++) {
    await etherscanPacer.wait();
    const r = await fetchJSON(`https://api.etherscan.io/v2/api?${q}`);
    if (r.status === "1" && Array.isArray(r.result)) return r.result;
    const msg = typeof r.result === "string" ? r.result : r.message || "";
    if (/no transactions found|no records found/i.test(msg) || /no transactions found/i.test(r.message || "")) return [];
    if (/rate limit/i.test(msg)) { await new Promise((res) => setTimeout(res, 1200)); continue; }
    if (/invalid api key|missing/i.test(msg)) throw new Error("Ключ Etherscan не подходит. Проверь его в Настройках → API-ключи.");
    throw new Error(`Etherscan: ${msg || "неизвестная ошибка"}`);
  }
  throw new Error("Etherscan: лимит запросов, попробуй через минуту.");
}

async function heliusSwaps(address, { limit = 100, before } = {}) {
  const key = requireKey("solana");
  await heliusPacer.wait();
  const q = new URLSearchParams({ "api-key": key, type: "SWAP", limit: String(limit) });
  if (before) q.set("before", before);
  const r = await fetchJSON(`https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?${q}`);
  return Array.isArray(r) ? r : [];
}

async function heliusLatestSignature(address) {
  const key = requireKey("solana");
  await heliusPacer.wait();
  const r = await fetchJSON(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [address, { limit: 1 }] }),
  });
  return r?.result?.[0]?.signature || null;
}

// ---------- prices ----------

const priceCache = new Map(); // `${chain}:${addr}` -> {usd, native, symbol, name, image, at}

export async function tokenPrices(chain, addresses) {
  const out = new Map();
  const need = [];
  for (const a of addresses) {
    const k = `${chain}:${a.toLowerCase()}`;
    const c = priceCache.get(k);
    if (c && Date.now() - c.at < 120000) out.set(a.toLowerCase(), c);
    else need.push(a);
  }
  for (let i = 0; i < need.length; i += 30) {
    let pairs = [];
    try { pairs = await dex.pairs(chain, need.slice(i, i + 30)); } catch { /* prices optional */ }
    const best = new Map();
    for (const p of pairs) {
      const a = p.baseToken.address.toLowerCase();
      if (!best.has(a) || P.liq(p) > P.liq(best.get(a))) best.set(a, p);
    }
    for (const [a, p] of best) {
      const v = { usd: P.price(p) || 0, symbol: P.symbol(p), name: P.name(p), image: p.info?.imageUrl, pair: p, at: Date.now() };
      priceCache.set(`${chain}:${a}`, v);
      out.set(a, v);
    }
  }
  return out;
}

async function nativeUsd(chain) {
  const c = WALLET_CHAINS[chain];
  const m = await tokenPrices(chain, [c.wrapped]);
  return m.get(c.wrapped.toLowerCase())?.usd || 0;
}

// ---------- trade reconstruction ----------
// A "trade" is one transaction where the wallet's quote balance (native,
// wrapped native or a stablecoin) and exactly one other token moved in
// opposite directions.

function buildTrades(groups, quoteUsd) {
  const trades = [];
  for (const g of groups) {
    const tokens = [...g.tokens.entries()].filter(([, d]) => Math.abs(d.amount) > 0);
    if (tokens.length !== 1) continue;
    const [token, d] = tokens[0];
    const usd = g.native * quoteUsd + g.usd;
    if (d.amount > 0 && usd < 0) trades.push({ side: "buy", token, symbol: d.symbol, amount: d.amount, usd: -usd, ts: g.ts, hash: g.hash });
    else if (d.amount < 0 && usd > 0) trades.push({ side: "sell", token, symbol: d.symbol, amount: -d.amount, usd, ts: g.ts, hash: g.hash });
  }
  return trades.sort((a, b) => a.ts - b.ts);
}

function evmGroups(chain, wallet, tokenTx, normalTx, internalTx) {
  const c = WALLET_CHAINS[chain];
  const w = wallet.toLowerCase();
  const groups = new Map();
  const g = (hash, ts) => {
    if (!groups.has(hash)) groups.set(hash, { hash, ts: Number(ts) * 1000, native: 0, usd: 0, tokens: new Map() });
    return groups.get(hash);
  };
  for (const t of tokenTx) {
    const from = (t.from || "").toLowerCase(), to = (t.to || "").toLowerCase();
    if (from !== w && to !== w) continue;
    const dec = Number(t.tokenDecimal || 18);
    const amt = Number(t.value) / 10 ** dec;
    if (!isFinite(amt) || amt === 0) continue;
    const sign = to === w ? 1 : -1;
    const ca = (t.contractAddress || "").toLowerCase();
    const grp = g(t.hash, t.timeStamp);
    const q = c.quotes[ca];
    if (q === "native") grp.native += sign * amt;
    else if (q === "usd") grp.usd += sign * amt;
    else {
      const cur = grp.tokens.get(ca) || { amount: 0, symbol: t.tokenSymbol };
      cur.amount += sign * amt;
      grp.tokens.set(ca, cur);
    }
  }
  for (const t of normalTx) {
    if (t.isError === "1" || !groups.has(t.hash)) continue;
    if ((t.from || "").toLowerCase() === w) groups.get(t.hash).native -= Number(t.value) / 1e18;
  }
  for (const t of internalTx) {
    if (t.isError === "1" || !groups.has(t.hash)) continue;
    if ((t.to || "").toLowerCase() === w) groups.get(t.hash).native += Number(t.value) / 1e18;
  }
  return [...groups.values()];
}

function solanaGroups(wallet, txs) {
  const c = WALLET_CHAINS.solana;
  const groups = [];
  for (const tx of txs) {
    if (tx.transactionError) continue;
    const grp = { hash: tx.signature, ts: (tx.timestamp || 0) * 1000, native: 0, usd: 0, tokens: new Map() };
    for (const n of tx.nativeTransfers || []) {
      const amt = (n.amount || 0) / 1e9;
      if (n.toUserAccount === wallet) grp.native += amt;
      if (n.fromUserAccount === wallet) grp.native -= amt;
    }
    for (const t of tx.tokenTransfers || []) {
      const amt = Number(t.tokenAmount) || 0;
      if (!amt) continue;
      let sign = 0;
      if (t.toUserAccount === wallet) sign = 1;
      else if (t.fromUserAccount === wallet) sign = -1;
      else continue;
      const q = c.quotes[t.mint];
      if (q === "native") grp.native += sign * amt;
      else if (q === "usd") grp.usd += sign * amt;
      else {
        const cur = grp.tokens.get(t.mint) || { amount: 0, symbol: "" };
        cur.amount += sign * amt;
        grp.tokens.set(t.mint, cur);
      }
    }
    groups.push(grp);
  }
  return groups;
}

// ---------- history loading ----------

async function loadHistory(chain, wallet, depth = 1000) {
  const c = WALLET_CHAINS[chain];
  if (c.kind === "solana") {
    let txs = [];
    let before;
    const pages = Math.max(1, Math.round(depth / 100));
    for (let i = 0; i < pages; i++) {
      const page = await heliusSwaps(wallet, { limit: 100, before });
      txs = txs.concat(page);
      if (page.length < 100) break;
      before = page[page.length - 1].signature;
    }
    return { groups: solanaGroups(wallet, txs), swaps: txs.length };
  }
  const base = { module: "account", address: wallet, page: "1", offset: String(depth), sort: "desc", startblock: "0", endblock: "99999999999" };
  const tokenTx = await etherscan(chain, { ...base, action: "tokentx" });
  let normalTx = [], internalTx = [];
  if (tokenTx.length) {
    const oldest = Math.min(...tokenTx.map((t) => Number(t.blockNumber)));
    const ranged = { ...base, startblock: String(oldest) };
    normalTx = await etherscan(chain, { ...ranged, action: "txlist" });
    internalTx = await etherscan(chain, { ...ranged, action: "txlistinternal" });
  }
  return { groups: evmGroups(chain, wallet, tokenTx, normalTx, internalTx), swaps: tokenTx.length, normalCount: normalTx.length };
}

// ---------- analysis ----------

export async function analyzeWallet(chain, wallet, { depth } = {}) {
  const c = WALLET_CHAINS[chain];
  if (!c) throw new Error(UNSUPPORTED_WALLET_CHAINS[chain] || "Сеть не поддерживается.");
  const hist = await loadHistory(chain, wallet, depth || (c.kind === "solana" ? 300 : 1000));
  const qUsd = await nativeUsd(chain);
  const trades = buildTrades(hist.groups, qUsd);

  const byToken = new Map();
  for (const t of trades) {
    const pos = byToken.get(t.token) || { token: t.token, symbol: t.symbol, cost: 0, proceeds: 0, bought: 0, sold: 0, buys: 0, sells: 0, firstBuy: null, lastSell: null };
    if (t.side === "buy") {
      pos.cost += t.usd; pos.bought += t.amount; pos.buys++;
      if (pos.firstBuy == null) pos.firstBuy = t.ts;
    } else {
      pos.proceeds += t.usd; pos.sold += t.amount; pos.sells++;
      pos.lastSell = t.ts;
    }
    if (!pos.symbol && t.symbol) pos.symbol = t.symbol;
    byToken.set(t.token, pos);
  }

  // Only positions opened inside the loaded window count.
  const positions = [...byToken.values()].filter((p) => p.buys > 0 && p.cost >= 5);
  const prices = await tokenPrices(chain, positions.map((p) => p.token));
  for (const p of positions) {
    const pr = prices.get(p.token.toLowerCase());
    if (pr) { p.symbol = p.symbol || pr.symbol; p.name = pr.name; p.image = pr.image; }
    const remaining = Math.max(0, p.bought - p.sold);
    p.remainingUsd = remaining * (pr?.usd || 0);
    p.pnl = p.proceeds + p.remainingUsd - p.cost;
    p.roi = p.cost ? p.pnl / p.cost : 0;
    p.closed = remaining <= p.bought * 0.02;
    p.holdMs = p.lastSell && p.firstBuy ? p.lastSell - p.firstBuy : null;
  }
  positions.sort((a, b) => b.pnl - a.pnl);

  const wins = positions.filter((p) => p.pnl > 0).length;
  const cost = positions.reduce((s, p) => s + p.cost, 0);
  const pnl = positions.reduce((s, p) => s + p.pnl, 0);
  const holds = positions.map((p) => p.holdMs).filter((h) => h != null).sort((a, b) => a - b);
  const medianHold = holds.length ? holds[Math.floor(holds.length / 2)] : null;
  const span = trades.length > 1 ? (trades[trades.length - 1].ts - trades[0].ts) : 0;
  const days = Math.max(1, span / 864e5);
  const tradesPerDay = trades.length / days;

  const flags = [];
  if (tradesPerDay > 60) flags.push("Похоже на бота: больше 60 сделок в день");
  if (medianHold != null && medianHold < 60000 && holds.length >= 5) flags.push("Похоже на бота: держит позиции меньше минуты");
  if (positions.length < 5) flags.push("Мало сделок для надёжной статистики");
  const topShare = pnl > 0 && positions.length ? Math.max(0, positions[0].pnl) / pnl : 0;
  if (positions.length >= 5 && topShare > 0.8) flags.push("Почти вся прибыль из одной сделки");

  const winRate = positions.length ? wins / positions.length : 0;
  const isBot = flags.some((f) => f.startsWith("Похоже на бота"));
  let grade = "weak";
  if (!isBot && positions.length >= 5 && winRate >= 0.55 && pnl > 0 && topShare <= 0.8) grade = "strong";
  else if (!isBot && positions.length >= 3 && pnl > 0) grade = "medium";

  return {
    chain, wallet, positions, trades: trades.length, tokens: positions.length, wins, winRate, cost, pnl,
    roi: cost ? pnl / cost : 0, medianHold, tradesPerDay, flags, isBot, grade,
    since: trades.length ? trades[0].ts : null, analyzedAt: Date.now(),
  };
}

// ---------- discovering wallets from a token ----------

export async function findBuyers(chain, token, { max = 20 } = {}) {
  const c = WALLET_CHAINS[chain];
  if (!c) throw new Error(UNSUPPORTED_WALLET_CHAINS[chain] || "Сеть не поддерживается.");
  const pairs = await dex.tokenPairs(chain, token);
  const pools = new Set(pairs.map((p) => p.pairAddress.toLowerCase()));
  const buyers = [];
  const seen = new Set();

  if (c.kind === "evm") {
    const tx = await etherscan(chain, { module: "account", action: "tokentx", contractaddress: token, page: "1", offset: "1000", sort: "asc" });
    const skip = new Set([...pools, "0x0000000000000000000000000000000000000000", token.toLowerCase()]);
    for (const t of tx) {
      const from = (t.from || "").toLowerCase(), to = (t.to || "").toLowerCase();
      if (!pools.has(from) || skip.has(to) || seen.has(to)) continue;
      seen.add(to);
      buyers.push({ wallet: to, ts: Number(t.timeStamp) * 1000 });
      if (buyers.length >= max) break;
    }
    return { buyers, early: true, pairs };
  }

  // Solana: Helius returns newest first, so walk back a few pages and take
  // the oldest buyers found.
  let txs = [];
  let before;
  for (let i = 0; i < 4; i++) {
    const page = await heliusSwaps(token, { limit: 100, before });
    txs = txs.concat(page);
    if (page.length < 100) break;
    before = page[page.length - 1].signature;
  }
  const reachedStart = txs.length < 400;
  txs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const tx of txs) {
    const w = tx.feePayer;
    if (!w || seen.has(w) || pools.has(w.toLowerCase())) continue;
    const got = (tx.tokenTransfers || []).some((t) => t.mint === token && t.toUserAccount === w && Number(t.tokenAmount) > 0);
    if (!got) continue;
    seen.add(w);
    buyers.push({ wallet: w, ts: (tx.timestamp || 0) * 1000 });
    if (buyers.length >= max) break;
  }
  return { buyers, early: reachedStart, pairs };
}

// ---------- watchlist & copy-trading feed ----------

const WATCH = "cryptoScanner.watch.v1";
const FEED = "cryptoScanner.feed.v1";

export const watchlist = {
  all() {
    try { return JSON.parse(localStorage.getItem(WATCH) || "[]") || []; } catch { return []; }
  },
  save(list) { try { localStorage.setItem(WATCH, JSON.stringify(list)); } catch { /* ignore */ } },
  has(chain, wallet) { return this.all().some((w) => w.chain === chain && w.wallet.toLowerCase() === wallet.toLowerCase()); },
  add(entry) {
    const list = this.all();
    if (!list.some((w) => w.chain === entry.chain && w.wallet.toLowerCase() === entry.wallet.toLowerCase())) {
      list.push({ ...entry, addedAt: Date.now(), cursor: null });
      this.save(list);
    }
  },
  remove(chain, wallet) { this.save(this.all().filter((w) => !(w.chain === chain && w.wallet.toLowerCase() === wallet.toLowerCase()))); },
  update(chain, wallet, patch) {
    this.save(this.all().map((w) => (w.chain === chain && w.wallet.toLowerCase() === wallet.toLowerCase() ? { ...w, ...patch } : w)));
  },
};

export const feed = {
  all() { try { return JSON.parse(localStorage.getItem(FEED) || "[]") || []; } catch { return []; } },
  save(items) { try { localStorage.setItem(FEED, JSON.stringify(items.slice(0, 300))); } catch { /* ignore */ } },
  clear() { this.save([]); },
};

// Returns new trades of one watched wallet since its cursor (newest first).
async function pollWallet(w) {
  const c = WALLET_CHAINS[w.chain];
  if (!c) return [];
  if (c.kind === "solana") {
    const latest = await heliusLatestSignature(w.wallet);
    if (!latest || latest === w.cursor) return [];
    const txs = await heliusSwaps(w.wallet, { limit: 30 });
    const fresh = [];
    for (const tx of txs) { if (tx.signature === w.cursor) break; fresh.push(tx); }
    watchlist.update(w.chain, w.wallet, { cursor: latest });
    if (!w.cursor) return []; // first poll only sets the starting point
    const qUsd = await nativeUsd(w.chain);
    return buildTrades(solanaGroups(w.wallet, fresh), qUsd);
  }
  const tx = await etherscan(w.chain, { module: "account", action: "tokentx", address: w.wallet, page: "1", offset: "50", sort: "desc" });
  if (!tx.length) return [];
  const newest = Number(tx[0].blockNumber);
  const cursor = w.cursor ? Number(w.cursor) : null;
  watchlist.update(w.chain, w.wallet, { cursor: String(newest) });
  if (cursor == null || newest <= cursor) return [];
  const fresh = tx.filter((t) => Number(t.blockNumber) > cursor);
  const start = Math.min(...fresh.map((t) => Number(t.blockNumber)));
  const ranged = { module: "account", address: w.wallet, page: "1", offset: "100", sort: "desc", startblock: String(start), endblock: "99999999999" };
  const normalTx = await etherscan(w.chain, { ...ranged, action: "txlist" });
  const internalTx = await etherscan(w.chain, { ...ranged, action: "txlistinternal" });
  const qUsd = await nativeUsd(w.chain);
  return buildTrades(evmGroups(w.chain, w.wallet, fresh, normalTx, internalTx), qUsd);
}

export async function pollAll(onError) {
  const list = watchlist.all();
  const added = [];
  for (const w of list) {
    try {
      const trades = await pollWallet(w);
      for (const t of trades) added.push({ ...t, chain: w.chain, wallet: w.wallet, label: w.label || "", id: `${w.chain}:${t.hash}:${t.token}:${t.side}` });
    } catch (e) {
      onError?.(w, e);
    }
  }
  if (added.length) {
    const prices = new Map();
    const byChain = new Map();
    for (const a of added) {
      if (!byChain.has(a.chain)) byChain.set(a.chain, new Set());
      byChain.get(a.chain).add(a.token);
    }
    for (const [chain, set] of byChain) {
      const m = await tokenPrices(chain, [...set]);
      for (const [k, v] of m) prices.set(`${chain}:${k}`, v);
    }
    for (const a of added) {
      const pr = prices.get(`${a.chain}:${a.token.toLowerCase()}`);
      if (pr) { a.symbol = a.symbol || pr.symbol; a.name = pr.name; a.image = pr.image; }
    }
    const old = feed.all();
    const ids = new Set(old.map((x) => x.id));
    feed.save([...added.filter((a) => !ids.has(a.id)).sort((x, y) => y.ts - x.ts), ...old]);
  }
  return added;
}

export const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");

export function holdText(ms) {
  if (ms == null) return "—";
  const m = ms / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} мин`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)} ч`;
  return `${Math.round(h / 24)} дн`;
}
export const _internals = { buildTrades, evmGroups, solanaGroups };
