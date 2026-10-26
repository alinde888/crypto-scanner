// Market data model, scam analysis, risk tiers, strategies, formatting.

export const CHAINS = [
  { id: "solana", name: "Solana", short: "SOL", goplus: "solana", explorer: "https://solscan.io/token/", seed: "SOL" },
  { id: "ethereum", name: "Ethereum", short: "ETH", goplus: "1", explorer: "https://etherscan.io/token/", seed: "WETH" },
  { id: "bsc", name: "BNB Chain", short: "BNB", goplus: "56", explorer: "https://bscscan.com/token/", seed: "WBNB" },
  { id: "base", name: "Base", short: "BASE", goplus: "8453", explorer: "https://basescan.org/token/", seed: "base WETH" },
  { id: "arbitrum", name: "Arbitrum", short: "ARB", goplus: "42161", explorer: "https://arbiscan.io/token/", seed: "ARB" },
  { id: "polygon", name: "Polygon", short: "POL", goplus: "137", explorer: "https://polygonscan.com/token/", seed: "WPOL" },
  { id: "avalanche", name: "Avalanche", short: "AVAX", goplus: "43114", explorer: "https://snowscan.xyz/token/", seed: "WAVAX" },
  { id: "optimism", name: "Optimism", short: "OP", goplus: "10", explorer: "https://optimistic.etherscan.io/token/", seed: "OP" },
  { id: "sonic", name: "Sonic", short: "S", goplus: "146", explorer: "https://sonicscan.org/token/", seed: "wS" },
  { id: "hyperevm", name: "HyperEVM", short: "HYPE", goplus: "999", explorer: "https://hyperevmscan.io/token/", seed: "WHYPE" },
];

export const chainById = (id) => CHAINS.find((c) => c.id === id);

// ---------- Pair helpers ----------

export const P = {
  key: (p) => `${p.chainId}:${p.baseToken?.address}`,
  id: (p) => `${p.chainId}:${p.pairAddress}`,
  symbol: (p) => p.baseToken?.symbol || "?",
  name: (p) => p.baseToken?.name || p.baseToken?.symbol || "Без названия",
  price: (p) => (p.priceUsd ? Number(p.priceUsd) : null),
  liq: (p) => p.liquidity?.usd ?? 0,
  vol: (p, w) => p.volume?.[w] ?? 0,
  change: (p, w) => (p.priceChange && p.priceChange[w] != null ? p.priceChange[w] : null),
  buys: (p, w) => p.txns?.[w]?.buys ?? 0,
  sells: (p, w) => p.txns?.[w]?.sells ?? 0,
  cap: (p) => p.marketCap ?? p.fdv ?? null,
  ageHours: (p) => (p.pairCreatedAt > 0 ? (Date.now() - p.pairCreatedAt) / 3.6e6 : null),
  url: (p) => p.url || `https://dexscreener.com/${p.chainId}/${p.pairAddress}`,
};

// ---------- Formatting ----------

export const fmt = {
  usd(v) {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  },
  price(v) {
    if (v == null || !isFinite(v) || v <= 0) return "—";
    if (v >= 1000) return `$${v.toFixed(0)}`;
    if (v >= 1) return `$${v.toFixed(3)}`;
    if (v >= 0.01) return `$${v.toFixed(4)}`;
    // Small prices: $0.0₅1234 style (count of zeros as subscript)
    const s = v.toFixed(20);
    const m = s.match(/^0\.(0+)(\d{1,4})/);
    if (!m) return `$${v.toPrecision(3)}`;
    const zeros = m[1].length;
    if (zeros < 4) return `$0.${m[1]}${m[2]}`;
    const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[d]).join("");
    return `$0.0${sub}${m[2]}`;
  },
  pct(v) {
    if (v == null || !isFinite(v)) return "—";
    return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  },
  share(f) {
    return f == null ? "—" : `${(f * 100).toFixed(1)}%`;
  },
  age(h) {
    if (h == null || !isFinite(h)) return "—";
    if (h < 1) return `${Math.max(1, Math.floor(h * 60))} мин`;
    if (h < 48) return `${Math.floor(h)} ч`;
    const d = Math.floor(h / 24);
    if (d < 365) return `${d} дн`;
    return `${(d / 365).toFixed(1)} г`;
  },
  int(v) {
    return v == null ? "—" : Math.round(v).toLocaleString("ru-RU");
  },
  time(d) {
    return d ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
  },
};

// ---------- Security analysis (GoPlus) ----------

const flag = (v) => {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "1" || s === "true") return true;
    if (s === "0" || s === "false") return false;
  }
  return null;
};
const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const isBurn = (a) => {
  a = (a || "").toLowerCase();
  return a.startsWith("0x000000000000000000000000000000000000") ||
    a === "1nc1nerator11111111111111111111111111111111" || a === "11111111111111111111111111111111";
};

export const SEV = { ok: 0, info: 1, warning: 2, critical: 3 };

function verdictOf(flags) {
  if (flags.some((f) => f.sev === SEV.critical)) return "danger";
  if (flags.some((f) => f.sev === SEV.warning)) return "caution";
  return "clean";
}

function taxFlag(tax, kind, add) {
  if (tax == null || tax <= 0) return;
  const t = `Налог на ${kind} ${fmt.share(tax)}`;
  if (tax >= 0.3) add(SEV.critical, t, "Такой налог съедает почти всю сделку.");
  else if (tax >= 0.1) add(SEV.warning, t, "Высокий налог, учитывай его при расчёте прибыли.");
  else add(SEV.info, t, "Небольшой налог контракта.");
}

export function analyzeEvm(j) {
  const r = { flags: [], buyTax: null, sellTax: null, holderCount: null, top10: null, lpLocked: null, checkedAt: new Date() };
  const on = (k) => flag(j[k]) === true;
  const add = (sev, title, detail) => r.flags.push({ sev, title, detail });

  if (on("is_honeypot")) add(SEV.critical, "Honeypot", "Симуляция показала, что купленный токен продать нельзя.");
  if (on("cannot_sell_all")) add(SEV.critical, "Нельзя продать весь баланс", "Контракт не даёт продать все токены разом.");
  if (on("owner_change_balance")) add(SEV.critical, "Владелец меняет балансы", "Владелец может изменить баланс любого кошелька, включая твой.");
  if (on("hidden_owner")) add(SEV.critical, "Скрытый владелец", "У контракта есть скрытый управляющий адрес.");
  if (on("can_take_back_ownership")) add(SEV.critical, "Права владельца можно вернуть", "Отказ от прав владельца можно отменить.");
  if (on("selfdestruct")) add(SEV.critical, "Самоуничтожение", "Контракт можно уничтожить вместе с балансами.");
  if (on("is_airdrop_scam")) add(SEV.critical, "Скам-аирдроп", "Токен помечен как мошеннический аирдроп.");
  if (on("cannot_buy")) add(SEV.warning, "Покупка невозможна", "Контракт сейчас не даёт купить токен.");

  if (flag(j.is_open_source) === false) add(SEV.warning, "Код не верифицирован", "Исходный код закрыт, проверить логику контракта нельзя.");
  if (on("is_proxy")) add(SEV.warning, "Прокси-контракт", "Логику контракта можно заменить уже после твоей покупки.");
  if (on("is_mintable")) add(SEV.warning, "Допечатка токенов", "Владелец может выпустить новые токены и обесценить твои.");
  if (on("transfer_pausable")) add(SEV.warning, "Переводы можно остановить", "Владелец может заблокировать все переводы и продажи.");
  if (on("is_blacklisted")) add(SEV.warning, "Чёрный список", "Владелец может запретить продажу отдельным кошелькам.");
  if (on("slippage_modifiable")) add(SEV.warning, "Налог можно изменить", "Владелец может поднять налог на покупку или продажу.");
  if (on("personal_slippage_modifiable")) add(SEV.warning, "Персональный налог", "Владелец может назначить отдельный налог конкретному кошельку.");
  if (on("trading_cooldown")) add(SEV.info, "Пауза между сделками", "Контракт ограничивает частоту сделок с одного кошелька.");
  if (on("anti_whale_modifiable")) add(SEV.info, "Лимиты на сделку меняются", "Владелец может изменить максимальный размер сделки.");
  if (on("external_call")) add(SEV.info, "Внешние вызовы", "Контракт вызывает другие контракты при переводе.");
  if (on("trust_list")) add(SEV.ok, "В доверенном списке GoPlus", "Известный и проверенный токен.");

  r.buyTax = num(j.buy_tax);
  r.sellTax = num(j.sell_tax);
  taxFlag(r.sellTax, "продажу", add);
  taxFlag(r.buyTax, "покупку", add);

  const owner = j.owner_address || "";
  if (!owner || isBurn(owner)) add(SEV.ok, "Нет активного владельца", "Права владельца сожжены или отсутствуют.");

  const pools = new Set((j.dex || []).map((d) => (d.pair || "").toLowerCase()));
  const holders = j.holders || [];
  if (holders.length) {
    const real = holders.filter((h) => {
      const a = (h.address || "").toLowerCase();
      return !pools.has(a) && !isBurn(a) && flag(h.is_locked) !== true;
    });
    r.top10 = real.slice(0, 10).reduce((s, h) => s + (num(h.percent) || 0), 0);
    if (r.top10 > 0.5) add(SEV.warning, "Высокая концентрация", `У 10 крупнейших кошельков ${fmt.share(r.top10)} токенов. Их продажа обвалит цену.`);
  }
  r.holderCount = num(j.holder_count);
  const creator = num(j.creator_percent);
  if (creator != null && creator > 0.05) add(SEV.warning, "Много токенов у создателя", `Создатель держит ${fmt.share(creator)} токенов.`);

  const lp = j.lp_holders || [];
  if (lp.length) {
    r.lpLocked = lp.filter((h) => flag(h.is_locked) === true || isBurn(h.address)).reduce((s, h) => s + (num(h.percent) || 0), 0);
    if (r.lpLocked < 0.5) add(SEV.warning, "Ликвидность не заблокирована", `Заблокировано или сожжено ${fmt.share(r.lpLocked)} LP. Создатель может забрать ликвидность.`);
    else add(SEV.ok, "Ликвидность заблокирована", `Заблокировано или сожжено ${fmt.share(r.lpLocked)} LP.`);
  }
  r.verdict = verdictOf(r.flags);
  return r;
}

export function analyzeSolana(j) {
  const r = { flags: [], buyTax: null, sellTax: null, holderCount: null, top10: null, lpLocked: null, checkedAt: new Date() };
  const status = (k) => {
    const v = j[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return flag(v.status);
    return flag(v);
  };
  const add = (sev, title, detail) => r.flags.push({ sev, title, detail });
  const mintable = status("mintable");
  const freezable = status("freezable");

  if (freezable === true) add(SEV.critical, "Freeze authority активна", "Создатель может заморозить токены на твоём кошельке, и продать их будет нельзя.");
  if (status("balance_mutable_authority") === true) add(SEV.critical, "Балансы можно изменить", "Есть права, позволяющие менять балансы держателей.");
  if (status("non_transferable") === true) add(SEV.critical, "Токен нельзя переводить", "Токен заблокирован для переводов.");
  if (mintable === true) add(SEV.warning, "Mint authority активна", "Создатель может выпустить новые токены и обесценить твои.");
  if (status("closable") === true) add(SEV.warning, "Токен можно закрыть", "Есть права на закрытие аккаунтов токена.");
  if (Array.isArray(j.transfer_hook) && j.transfer_hook.length) add(SEV.warning, "Transfer hook", "При каждом переводе вызывается сторонняя программа.");
  if (status("metadata_mutable") === true) add(SEV.info, "Метаданные можно менять", "Название и картинку токена можно изменить.");
  if (flag(j.trusted_token) === true) add(SEV.ok, "В доверенном списке GoPlus", "Известный и проверенный токен.");
  if (mintable === false && freezable === false) add(SEV.ok, "Mint и freeze отключены", "Новые токены выпустить нельзя, заморозить твои тоже.");

  const holders = j.holders || [];
  if (holders.length) {
    const real = holders.filter((h) => !(h.tag || "") && flag(h.is_locked) !== true && !isBurn(h.account));
    r.top10 = real.slice(0, 10).reduce((s, h) => s + (num(h.percent) || 0), 0);
    if (r.top10 > 0.5) add(SEV.warning, "Высокая концентрация", `У 10 крупнейших кошельков ${fmt.share(r.top10)} токенов. Их продажа обвалит цену.`);
  }
  r.holderCount = num(j.holder_count);
  r.verdict = verdictOf(r.flags);
  return r;
}

export const VERDICT = {
  clean: { title: "Явных угроз не найдено", cls: "good" },
  caution: { title: "Есть риски", cls: "warn" },
  danger: { title: "Опасный контракт", cls: "bad" },
};

// ---------- Risk tiers ----------

export const TIERS = {
  high: { title: "Высокий риск", short: "Высокий", cls: "bad" },
  medium: { title: "Средний риск", short: "Средний", cls: "warn" },
  low: { title: "Низкий риск", short: "Низкий", cls: "good" },
};

export function assessRisk(p, sec) {
  if (sec && sec.verdict === "danger") {
    return { tier: null, factors: sec.flags.filter((f) => f.sev === SEV.critical).map((f) => f.title), checked: true };
  }
  let score = 0;
  const f = [];
  const liq = P.liq(p);
  if (liq < 50e3) { score += 3; f.push(`Очень тонкая ликвидность (${fmt.usd(liq)})`); }
  else if (liq < 250e3) { score += 2; f.push(`Небольшая ликвидность (${fmt.usd(liq)})`); }
  else if (liq < 1e6) { score += 1; f.push(`Средняя ликвидность (${fmt.usd(liq)})`); }

  const age = P.ageHours(p);
  if (age == null) { score += 2; f.push("Возраст пары неизвестен"); }
  else if (age < 24) { score += 3; f.push("Пара моложе суток"); }
  else if (age < 24 * 7) { score += 2; f.push("Пара моложе недели"); }
  else if (age < 24 * 30) { score += 1; f.push("Пара моложе месяца"); }

  const cap = P.cap(p) || 0;
  if (cap > 0 && cap < 1e6) { score += 2; f.push("Капитализация ниже $1M"); }
  else if (cap > 0 && cap < 10e6) { score += 1; f.push("Капитализация ниже $10M"); }

  const up = runUp(p);
  if (up != null && up > 300) { score += 2; f.push(`Уже вырос на ${fmt.pct(up)}: поздний вход, высок риск разворота`); }
  if (isFading(p)) { score += 1; f.push("Импульс угасает: цена снижается или продавцов больше"); }

  const ch = P.change(p, "h24");
  if (ch != null) {
    if (Math.abs(ch) > 50) { score += 2; f.push(`Движение цены за сутки ${fmt.pct(ch)}`); }
    else if (Math.abs(ch) > 20) { score += 1; f.push(`Заметная волатильность за сутки (${fmt.pct(ch)})`); }
  }
  if (sec) {
    if (sec.top10 != null) {
      if (sec.top10 > 0.5) { score += 2; f.push(`Топ-10 кошельков держат ${fmt.share(sec.top10)}`); }
      else if (sec.top10 > 0.3) { score += 1; f.push(`Топ-10 кошельков держат ${fmt.share(sec.top10)}`); }
    }
    const w = sec.flags.filter((x) => x.sev === SEV.warning).length;
    if (w) { score += Math.min(w, 3); f.push(`Предупреждений по контракту: ${w}`); }
  }
  const tier = score >= 7 ? "high" : score >= 3 ? "medium" : "low";
  if (!f.length) f.push("Крупная ликвидность, давняя пара, умеренная волатильность");
  return { tier, factors: f, checked: !!sec };
}

// ---------- Late-entry ("don't chase the pump") filter ----------

// Growth already behind the token: the larger of the 6 h and 24 h moves.
export function runUp(p) {
  const v = [P.change(p, "h6"), P.change(p, "h24")].filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

// Momentum is fading: price falls on both 5 min and 1 h, or sellers clearly
// outnumber buyers in the last 5 minutes.
export function isFading(p) {
  const m5 = P.change(p, "m5"), h1 = P.change(p, "h1");
  const b = P.buys(p, "m5"), sl = P.sells(p, "m5");
  return (m5 != null && h1 != null && m5 < 0 && h1 < 0) || (sl >= 5 && sl > b * 1.5);
}

export function lateEntry(p, { maxPump, skipFading }) {
  const reasons = [];
  const up = runUp(p);
  if (maxPump > 0 && up != null && up > maxPump) reasons.push(`уже вырос на ${fmt.pct(up)}`);
  if (skipFading && isFading(p)) reasons.push("импульс угасает");
  return reasons;
}

// ---------- Strategies ----------

export const STRATEGIES = [
  {
    id: "earlyPairs", title: "Ранний вход", risk: "high", icon: "sparkle", antiPump: true,
    summary: "Новые пары в первые сутки, где покупателей больше, чем продавцов. Самая высокая доля скамов, поэтому скам-проверка здесь обязательна.",
    rules: ["Возраст ≤ 24 ч", "Ликвидность ≥ $10K", "Покупок за 1 ч больше, чем продаж", "Объём за 1 ч ≥ $5K"],
    match: (p) => { const a = P.ageHours(p); return a != null && a <= 24 && P.liq(p) >= 10e3 && P.buys(p, "h1") > P.sells(p, "h1") && P.vol(p, "h1") >= 5e3; },
  },
  {
    id: "volumeSpike", title: "Всплеск объёма", risk: "high", icon: "pulse", antiPump: true,
    summary: "Токены, у которых объём за последний час в разы выше среднего и цена растёт. Ловит начало движения, но легко попасть на вершину.",
    rules: ["Объём 1 ч ≥ 2× среднего часа за сутки", "Цена 1 ч ≥ +3%", "Ликвидность ≥ $50K", "Возраст ≥ 6 ч"],
    match: (p) => { const a = P.ageHours(p); const avg = P.vol(p, "h24") / 24; return a != null && a >= 6 && P.liq(p) >= 50e3 && avg > 0 && P.vol(p, "h1") >= avg * 2 && (P.change(p, "h1") ?? 0) >= 3; },
  },
  {
    id: "dipRebound", title: "Отскок после падения", risk: "medium", icon: "rebound",
    summary: "Токены, которые сильно упали за сутки и начали разворачиваться в последний час на достаточной ликвидности.",
    rules: ["Цена 24 ч ≤ −25%", "Цена 1 ч > 0%", "Покупок за 1 ч не меньше продаж", "Ликвидность ≥ $100K", "Возраст ≥ 3 дн"],
    match: (p) => { const a = P.ageHours(p); return a != null && a >= 72 && P.liq(p) >= 100e3 && (P.change(p, "h24") ?? 0) <= -25 && (P.change(p, "h1") ?? 0) > 0 && P.buys(p, "h1") >= P.sells(p, "h1"); },
  },
  {
    id: "steadyGrowth", title: "Устойчивый рост", risk: "low", icon: "trend",
    summary: "Пары старше двух недель с хорошей ликвидностью и умеренным ростом без резких скачков.",
    rules: ["Возраст ≥ 14 дн", "Ликвидность ≥ $500K", "Цена 24 ч от +2% до +25%", "Цена 6 ч > 0%", "Объём 24 ч ≥ $250K"],
    match: (p) => { const a = P.ageHours(p); const c = P.change(p, "h24") ?? 0; return a != null && a >= 24 * 14 && P.liq(p) >= 500e3 && c >= 2 && c <= 25 && (P.change(p, "h6") ?? 0) > 0 && P.vol(p, "h24") >= 250e3; },
  },
  {
    id: "blueChips", title: "Крупные активы", risk: "low", icon: "columns",
    summary: "Крупные и давно торгующиеся активы с глубокой ликвидностью.",
    rules: ["Возраст ≥ 90 дн", "Ликвидность ≥ $5M", "Капитализация ≥ $100M"],
    match: (p) => { const a = P.ageHours(p); return a != null && a >= 24 * 90 && P.liq(p) >= 5e6 && (P.cap(p) || 0) >= 100e6; },
  },
];

export const DEFAULT_PLANS = {
  high: { stopLoss: 30, tp1: 50, tp2: 150, position: 1 },
  medium: { stopLoss: 15, tp1: 25, tp2: 60, position: 3 },
  low: { stopLoss: 8, tp1: 12, tp2: 30, position: 5 },
};
