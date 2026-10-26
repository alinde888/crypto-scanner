// DexScreener and GoPlus clients with request pacing.

class Pacer {
  constructor(intervalMs) { this.interval = intervalMs; this.next = 0; }
  async wait() {
    const now = Date.now();
    const slot = Math.max(now, this.next);
    this.next = slot + this.interval;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }
}

async function getJSON(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error(`Нет связи с ${new URL(url).host}. Проверь интернет или блокировки сети.`);
  }
  if (res.status === 429) throw new Error(`${new URL(url).host}: слишком много запросов, попробуй через минуту.`);
  if (!res.ok) throw new Error(`${new URL(url).host} ответил ошибкой ${res.status}.`);
  return res.json();
}

const DEX = "https://api.dexscreener.com";
const listPacer = new Pacer(1100);
const pairPacer = new Pacer(250);
const goplusPacer = new Pacer(2200);

const arr = (x) => (Array.isArray(x) ? x : []);
const validPair = (p) => p && p.chainId && p.pairAddress && p.baseToken && p.baseToken.address;

export const dex = {
  async list(path) {
    await listPacer.wait();
    return arr(await getJSON(DEX + path)).filter((t) => t && t.chainId && t.tokenAddress);
  },
  latestProfiles: () => dex.list("/token-profiles/latest/v1"),
  latestBoosts: () => dex.list("/token-boosts/latest/v1"),
  topBoosts: () => dex.list("/token-boosts/top/v1"),

  async pairs(chain, tokens) {
    if (!tokens.length) return [];
    await pairPacer.wait();
    return arr(await getJSON(`${DEX}/tokens/v1/${chain}/${tokens.slice(0, 30).join(",")}`)).filter(validPair);
  },
  async tokenPairs(chain, token) {
    await pairPacer.wait();
    return arr(await getJSON(`${DEX}/token-pairs/v1/${chain}/${encodeURIComponent(token)}`)).filter(validPair);
  },
  async search(q) {
    await pairPacer.wait();
    const r = await getJSON(`${DEX}/latest/dex/search?q=${encodeURIComponent(q)}`);
    return arr(r && r.pairs).filter(validPair);
  },
};

export async function goplusSecurity(chain, address) {
  if (!chain.goplus) throw new Error("GoPlus не проверяет токены в этой сети.");
  const url = chain.id === "solana"
    ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
    : `https://api.gopluslabs.io/api/v1/token_security/${chain.goplus}?contract_addresses=${address}`;
  await goplusPacer.wait();
  const env = await getJSON(url);
  if (env && env.code != null && Number(env.code) !== 1) {
    throw new Error(`GoPlus: ${env.message || "код " + env.code}`);
  }
  const result = env && env.result;
  if (!result || typeof result !== "object" || !Object.keys(result).length) {
    throw new Error("GoPlus: нет данных по этому токену, возможно он слишком новый.");
  }
  const key = Object.keys(result).find((k) => k.toLowerCase() === address.toLowerCase());
  return result[key ?? Object.keys(result)[0]];
}

// ---------- GeckoTerminal (public API, ~30 calls/min) ----------

const GT = "https://api.geckoterminal.com/api/v2";
const gtPacer = new Pacer(2200);
const num = (v) => (v == null || v === "" ? null : Number(v));

// Converts a GeckoTerminal pool into the DexScreener pair shape used everywhere.
function gtToPair(pool, tokens, chainId) {
  const a = pool.attributes || {};
  const baseId = pool.relationships?.base_token?.data?.id || "";
  const quoteId = pool.relationships?.quote_token?.data?.id || "";
  const t = tokens.get(baseId) || {};
  const baseAddr = t.address || baseId.slice(baseId.indexOf("_") + 1);
  const [baseSym, quoteSym] = String(a.name || "").split(" / ");
  const tx = a.transactions || {};
  const vol = a.volume_usd || {};
  const ch = a.price_change_percentage || {};
  const w = (o, k) => (o[k] == null ? undefined : num(o[k]));
  const txn = (k) => (tx[k] ? { buys: tx[k].buys ?? 0, sells: tx[k].sells ?? 0, buyers: tx[k].buyers, sellers: tx[k].sellers } : undefined);
  return {
    chainId,
    dexId: pool.relationships?.dex?.data?.id || null,
    url: `https://dexscreener.com/${chainId}/${a.address}`,
    pairAddress: a.address,
    baseToken: { address: baseAddr, name: t.name || baseSym, symbol: t.symbol || baseSym },
    quoteToken: { address: quoteId.slice(quoteId.indexOf("_") + 1), symbol: (quoteSym || "").trim() },
    priceUsd: a.base_token_price_usd,
    txns: { m5: txn("m5"), h1: txn("h1"), h6: txn("h6"), h24: txn("h24") },
    volume: { m5: w(vol, "m5"), h1: w(vol, "h1"), h6: w(vol, "h6"), h24: w(vol, "h24") },
    priceChange: { m5: w(ch, "m5"), h1: w(ch, "h1"), h6: w(ch, "h6"), h24: w(ch, "h24") },
    liquidity: { usd: num(a.reserve_in_usd) || 0 },
    fdv: num(a.fdv_usd),
    marketCap: num(a.market_cap_usd),
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : 0,
    info: t.image_url && /^https:/.test(t.image_url) ? { imageUrl: t.image_url } : undefined,
    source: "gt",
  };
}

export const gecko = {
  async pools(chain, kind) {
    await gtPacer.wait();
    const path = kind === "new" ? "new_pools" : "trending_pools";
    const r = await getJSON(`${GT}/networks/${chain.gt}/${path}?include=base_token&page=1`);
    const tokens = new Map();
    for (const inc of r?.included || []) if (inc.type === "token") tokens.set(inc.id, inc.attributes || {});
    return (r?.data || []).map((p) => gtToPair(p, tokens, chain.id)).filter((p) => p.pairAddress && p.baseToken.address);
  },
};
