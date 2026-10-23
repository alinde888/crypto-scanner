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
