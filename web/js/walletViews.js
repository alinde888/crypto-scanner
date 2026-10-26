import { CHAINS, chainById, fmt } from "./engine.js";
import { $, esc, safeUrl, icon, toast, copyText, chainBadge, empty } from "./ui.js";
import {
  WALLET_CHAINS, UNSUPPORTED_WALLET_CHAINS, keys, analyzeWallet, findBuyers,
  watchlist, feed, pollAll, shortAddr, holdText,
} from "./wallets.js";

const emit = () => window.dispatchEvent(new Event("app:update"));
const openCheck = (chain, address) => window.dispatchEvent(new CustomEvent("app:check", { detail: { chain, address } }));

const GRADE = {
  strong: { t: "Сильный", cls: "good" },
  medium: { t: "Средний", cls: "warn" },
  weak: { t: "Слабый", cls: "muted" },
};

const usdSigned = (v) => `<span class="num ${v > 0 ? "good" : v < 0 ? "bad" : "muted"}">${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt.usd(Math.abs(v))}</span>`;
const pctSigned = (f) => `<span class="num ${f > 0 ? "good" : f < 0 ? "bad" : "muted"}">${fmt.pct(f * 100)}</span>`;
const timeAgo = (ts) => {
  const m = (Date.now() - ts) / 60000;
  if (m < 1) return "только что";
  if (m < 60) return `${Math.floor(m)} мин назад`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} ч назад`;
  return new Date(ts).toLocaleDateString("ru-RU");
};

function chainOptions(selected) {
  return CHAINS.map((c) => {
    const ok = !!WALLET_CHAINS[c.id];
    return `<option value="${c.id}" ${c.id === selected ? "selected" : ""} ${ok ? "" : "disabled"}>${c.name}${ok ? "" : " (платный Etherscan)"}</option>`;
  }).join("");
}

function keysNote() {
  const k = keys.get();
  const missing = [];
  if (!k.helius) missing.push("Helius (Solana)");
  if (!k.etherscan) missing.push("Etherscan (Ethereum, Arbitrum, Polygon, Sonic, HyperEVM)");
  if (!missing.length) return "";
  return `<p class="notice">${icon("key")}<span>Не хватает ключей: ${missing.join(", ")}. Добавь их в <a href="#settings">Настройках</a>, без них анализ в этих сетях не работает.</span></p>`;
}

// ---------- strong wallets ----------

const ws = {
  mode: "token",
  chain: "solana",
  input: "",
  running: false,
  status: "",
  progress: null,
  results: [],
  note: "",
  error: null,
  detail: null,
  cache: new Map(),
  runId: 0,
};

async function analyzeCached(chain, wallet) {
  const k = `${chain}:${wallet.toLowerCase()}`;
  const hit = ws.cache.get(k);
  if (hit && Date.now() - hit.analyzedAt < 15 * 60000) return hit;
  const a = await analyzeWallet(chain, wallet);
  ws.cache.set(k, a);
  return a;
}

export async function startTokenScan(chain, token) {
  const id = ++ws.runId;
  Object.assign(ws, { mode: "token", chain, input: token, running: true, results: [], detail: null, error: null, note: "", status: "Ищу первых покупателей токена…", progress: null });
  emit();
  try {
    const { buyers, early, pairs } = await findBuyers(chain, token);
    if (id !== ws.runId) return;
    const sym = pairs[0]?.baseToken?.symbol;
    if (!buyers.length) {
      ws.error = "Не нашёл покупателей этого токена. Проверь адрес и сеть.";
      return;
    }
    ws.note = early
      ? `Первые ${buyers.length} покупателей ${sym ? sym : "токена"} с момента запуска пары.`
      : `${buyers.length} самых ранних покупателей ${sym ? sym : "токена"} среди последних 400 сделок. Токен торгуется давно, до самого старта история не загружается.`;
    ws.progress = { done: 0, total: buyers.length };
    for (const b of buyers) {
      if (id !== ws.runId) return;
      ws.status = `Анализирую кошелёк ${shortAddr(b.wallet)}…`;
      emit();
      try {
        const a = await analyzeCached(chain, b.wallet);
        ws.results.push({ ...a, entryTs: b.ts });
      } catch (e) {
        ws.results.push({ chain, wallet: b.wallet, error: e.message, entryTs: b.ts });
        if (/ключ|Ключ|Лимит/.test(e.message)) { ws.error = e.message; break; }
      }
      ws.progress.done++;
      sortResults();
      emit();
    }
  } catch (e) {
    if (id === ws.runId) ws.error = e.message;
  } finally {
    if (id === ws.runId) { ws.running = false; ws.status = ""; emit(); }
  }
}

async function startWalletScan(chain, wallet) {
  const id = ++ws.runId;
  Object.assign(ws, { mode: "wallet", chain, input: wallet, running: true, results: [], detail: null, error: null, note: "", status: "Загружаю историю сделок…", progress: null });
  emit();
  try {
    const a = await analyzeCached(chain, wallet);
    if (id !== ws.runId) return;
    ws.results = [a];
    ws.detail = a;
  } catch (e) {
    if (id === ws.runId) ws.error = e.message;
  } finally {
    if (id === ws.runId) { ws.running = false; ws.status = ""; emit(); }
  }
}

function sortResults() {
  const rank = { strong: 0, medium: 1, weak: 2 };
  ws.results.sort((a, b) => {
    if (a.error || b.error) return a.error ? 1 : -1;
    return (rank[a.grade] - rank[b.grade]) || (b.pnl - a.pnl);
  });
}

function watchButton(chain, wallet, compact = false) {
  const on = watchlist.has(chain, wallet);
  return `<button class="btn ${on ? "" : "primary"} ${compact ? "sm" : ""}" data-action="watch-toggle" data-chain="${esc(chain)}" data-wallet="${esc(wallet)}">${icon("eye")}${on ? "Отслеживается" : "Следить"}</button>`;
}

function resultsTable() {
  return `<div class="tablescroll"><table class="grid">
    <thead><tr><th>Кошелёк</th><th>Оценка</th><th class="r">Винрейт</th><th class="r c-age">Токенов</th><th class="r">PnL</th><th class="r c-24">ROI</th><th class="r c-vol">Удержание</th><th></th></tr></thead>
    <tbody>${ws.results.map((r) => r.error ? `
      <tr><td><span class="mono">${esc(shortAddr(r.wallet))}</span></td><td colspan="7" class="muted">${esc(r.error)}</td></tr>` : `
      <tr data-action="wallet-open" data-wallet="${esc(r.wallet)}" tabindex="0">
        <td><span class="mono">${esc(shortAddr(r.wallet))}</span>${r.isBot ? ' <span class="pill muted">бот</span>' : ""}</td>
        <td><span class="pill ${GRADE[r.grade].cls}">${GRADE[r.grade].t}</span></td>
        <td class="r num">${r.tokens ? fmt.share(r.winRate) : "—"} <span class="muted">${r.wins}/${r.tokens}</span></td>
        <td class="r num c-age">${r.tokens}</td>
        <td class="r">${usdSigned(r.pnl)}</td>
        <td class="r c-24">${r.cost ? pctSigned(r.roi) : "—"}</td>
        <td class="r num c-vol">${holdText(r.medianHold)}</td>
        <td class="r">${watchButton(r.chain, r.wallet, true)}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

function detailView(a) {
  const c = WALLET_CHAINS[a.chain];
  const metric = (l, v) => `<div class="metric"><span>${l}</span><b class="num">${v}</b></div>`;
  return `
    <div class="wdetail">
      <div class="row between wrap">
        <button class="btn" data-action="wallet-back">${icon("back")}Назад к списку</button>
        <div class="row wrap">
          ${watchButton(a.chain, a.wallet)}
          <button class="btn" data-action="copy" data-value="${esc(a.wallet)}">${icon("doc")}Адрес</button>
          <a class="btn" href="${esc(c.explorer + a.wallet)}" target="_blank" rel="noopener">${icon("external")}Эксплорер</a>
        </div>
      </div>
      <div class="whead">
        <h2 class="mono">${esc(shortAddr(a.wallet))}</h2>
        ${chainBadge(a.chain)} <span class="pill ${GRADE[a.grade].cls}">${GRADE[a.grade].t}</span>
      </div>
      <section class="card">
        <div class="metrics four">
          ${metric("Винрейт", a.tokens ? `${fmt.share(a.winRate)} (${a.wins} из ${a.tokens})` : "—")}
          ${metric("Прибыль", usdSigned(a.pnl))}
          ${metric("ROI", a.cost ? pctSigned(a.roi) : "—")}
          ${metric("Вложено", fmt.usd(a.cost))}
          ${metric("Медиана удержания", holdText(a.medianHold))}
          ${metric("Сделок в день", a.tradesPerDay.toFixed(1))}
          ${metric("Сделок в выборке", a.trades)}
          ${metric("История с", a.since ? new Date(a.since).toLocaleDateString("ru-RU") : "—")}
        </div>
        ${a.flags.length ? `<ul class="flags">${a.flags.map((f) => `<li class="flag">${icon("warn", "warn")}<div><b>${esc(f)}</b></div></li>`).join("")}</ul>` : ""}
        <p class="fine">Прибыль считается по сделкам за ${c.native}, wrapped ${c.native} и стейблкоины без учёта комиссий сети. Незакрытые позиции оценены по текущей цене. Прошлые результаты кошелька не гарантируют будущих.</p>
      </section>
      ${a.positions.length ? `<div class="tablescroll"><table class="grid">
        <thead><tr><th>Токен</th><th class="r">Вложено</th><th class="r c-24">Получено</th><th class="r c-vol">Остаток</th><th class="r">PnL</th><th class="r c-age">Держал</th><th></th></tr></thead>
        <tbody>${a.positions.map((p) => `
          <tr>
            <td><div class="tok"><span class="tokicon" style="--s:24px">${safeUrl(p.image) ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<b>${esc((p.symbol || "?").slice(0, 1))}</b></span><div><b>${esc(p.symbol || shortAddr(p.token))}</b><span>${p.closed ? "закрыта" : "открыта"}</span></div></div></td>
            <td class="r num">${fmt.usd(p.cost)}</td>
            <td class="r num c-24">${fmt.usd(p.proceeds)}</td>
            <td class="r num c-vol">${fmt.usd(p.remainingUsd)}</td>
            <td class="r">${usdSigned(p.pnl)} <span class="muted c-24">${pctSigned(p.roi)}</span></td>
            <td class="r num c-age">${holdText(p.holdMs)}</td>
            <td class="r"><button class="btn sm" data-action="check-token" data-chain="${esc(a.chain)}" data-value="${esc(p.token)}">${icon("check")}Проверить</button></td>
          </tr>`).join("")}</tbody></table></div>` : empty("Нет сделок", "В загруженной истории нет покупок токенов за основную валюту сети или стейблкоины.")}
    </div>`;
}

export const walletViews = {
  wallets: {
    title: "Сильные кошельки",
    subtitle: () => "Винрейт и прибыль по реальной истории сделок",
    mount(el) {
      el.innerHTML = `
        <form class="checkbar" id="wForm">
          <div class="segmented" role="tablist" aria-label="Режим поиска">
            <button type="button" role="tab" data-action="wmode" data-value="token" aria-selected="${ws.mode === "token"}">По токену</button>
            <button type="button" role="tab" data-action="wmode" data-value="wallet" aria-selected="${ws.mode === "wallet"}">По кошельку</button>
          </div>
          <select id="wChain" aria-label="Сеть">${chainOptions(ws.chain)}</select>
          <input id="wInput" type="text" autocomplete="off" spellcheck="false" value="${esc(ws.input)}">
          <button class="btn primary" type="submit" id="wGo">${icon("search")}Найти</button>
        </form>
        <div id="wBody" class="checkresult"></div>`;
      $("#wForm", el).addEventListener("submit", (e) => {
        e.preventDefault();
        const chain = $("#wChain", el).value;
        const v = $("#wInput", el).value.trim();
        if (!v) return;
        if (ws.mode === "token") startTokenScan(chain, v);
        else startWalletScan(chain, v);
      });
      $("#wChain", el).addEventListener("change", (e) => { ws.chain = e.target.value; });
    },
    update(el) {
      el.querySelectorAll("[data-action='wmode']").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.value === ws.mode)));
      const input = $("#wInput", el);
      input.placeholder = ws.mode === "token" ? "Адрес контракта токена: найду его ранних покупателей" : "Адрес кошелька";
      if (document.activeElement !== input && input.value !== ws.input && ws.input) input.value = ws.input;
      if ($("#wChain", el).value !== ws.chain) $("#wChain", el).value = ws.chain;
      $("#wGo", el).disabled = ws.running;

      const body = $("#wBody", el);
      const scroll = body.querySelector(".tablescroll")?.scrollTop || 0;
      let html = keysNote();
      if (ws.detail) {
        html += detailView(ws.detail);
      } else {
        if (ws.running) {
          html += `<p class="row status"><span class="spinner sm"></span>${esc(ws.status)}${ws.progress ? ` <span class="muted num">${ws.progress.done} из ${ws.progress.total}</span>` : ""}</p>`;
        }
        if (ws.error) html += `<p class="notice bad">${icon("bad", "bad")}<span>${esc(ws.error)}</span></p>`;
        if (ws.note) html += `<p class="lead pad">${esc(ws.note)}</p>`;
        if (ws.results.length) html += resultsTable();
        else if (!ws.running && !ws.error) {
          html += empty("Как найти сильные кошельки",
            "Вставь адрес токена, который хорошо вырос: приложение найдёт его первых покупателей и посчитает по каждому реальный винрейт и прибыль на истории сделок. Сильные кошельки можно добавить в копи-трейдинг. Удобно запускать из карточки токена в скринере. Режим «По кошельку» разбирает один адрес.");
        }
      }
      body.innerHTML = html;
      const sc = body.querySelector(".tablescroll");
      if (sc && !ws.detail) sc.scrollTop = scroll;
    },
  },

  copy: {
    title: "Копи-трейдинг",
    subtitle: () => {
      const n = watchlist.all().length;
      return n ? `Отслеживается кошельков: ${n}${copyState.lastPoll ? ` · проверено в ${fmt.time(copyState.lastPoll)}` : ""}` : "Сделки отслеживаемых кошельков";
    },
    mount(el) {
      el.innerHTML = `<div id="cBody" class="checkresult"></div>`;
    },
    update(el) {
      const list = watchlist.all();
      const items = feed.all();
      const notif = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
      let html = keysNote();
      html += `
        <div class="copybar">
          <button class="btn primary" data-action="poll-now" ${copyState.polling || !list.length ? "disabled" : ""}>${copyState.polling ? '<span class="spinner sm"></span>Проверяю…' : `${icon("refresh")}Проверить сейчас`}</button>
          ${notif === "default" ? `<button class="btn" data-action="notify-on">${icon("bell")}Включить уведомления</button>` : ""}
          ${notif === "granted" ? `<span class="muted row">${icon("bell")}Уведомления включены</span>` : ""}
          <span class="fine">Кошельки проверяются каждые 2 минуты, пока сайт открыт.</span>
        </div>`;
      if (copyState.errors.length) {
        html += copyState.errors.map((e) => `<p class="notice bad">${icon("bad", "bad")}<span>${esc(e)}</span></p>`).join("");
      }
      html += `<div class="copygrid">
        <section class="group watch"><h3>Отслеживаемые кошельки</h3>
          ${list.length ? `<ul class="wlist">${list.map((w) => `
            <li>
              <div class="wl-main">
                <input class="wl-label" data-chain="${esc(w.chain)}" data-wallet="${esc(w.wallet)}" value="${esc(w.label || "")}" placeholder="${esc(shortAddr(w.wallet))}" aria-label="Название кошелька">
                <span class="row">${chainBadge(w.chain)}<span class="mono muted">${esc(shortAddr(w.wallet))}</span>${w.cursor ? "" : '<span class="fine">ждёт первой проверки</span>'}</span>
              </div>
              <button class="iconbtn" data-action="watch-open" data-chain="${esc(w.chain)}" data-wallet="${esc(w.wallet)}" title="Статистика кошелька">${icon("search")}</button>
              <button class="iconbtn" data-action="watch-remove" data-chain="${esc(w.chain)}" data-wallet="${esc(w.wallet)}" title="Перестать следить">${icon("trash")}</button>
            </li>`).join("")}</ul>` : '<p class="muted">Пока пусто. Найди кошельки в разделе «Сильные кошельки» и нажми «Следить», или добавь адрес вручную.</p>'}
          <form class="addwatch" id="addWatch">
            <select id="awChain" aria-label="Сеть">${chainOptions(copyState.addChain)}</select>
            <input id="awAddr" placeholder="Адрес кошелька" autocomplete="off" spellcheck="false">
            <button class="btn" type="submit">Добавить</button>
          </form>
        </section>
        <section class="feedcol">
          <div class="row between"><h3 class="h3">Лента сделок</h3>${items.length ? '<button class="link" data-action="feed-clear">Очистить</button>' : ""}</div>
          ${items.length ? `<ul class="feed">${items.map(feedItem).join("")}</ul>` : '<p class="muted">Новые покупки и продажи отслеживаемых кошельков появятся здесь. Первая проверка только запоминает их последнюю сделку, дальше в ленту попадает всё новое.</p>'}
        </section>
      </div>`;
      $("#cBody", el).innerHTML = html;
      $("#addWatch", el)?.addEventListener("submit", (e) => {
        e.preventDefault();
        const chain = $("#awChain", el).value;
        const addr = $("#awAddr", el).value.trim();
        if (!addr) return;
        copyState.addChain = chain;
        watchlist.add({ chain, wallet: addr, label: "" });
        toast("Кошелёк добавлен");
        startPolling();
        emit();
      });
    },
  },
};

function feedItem(t) {
  const label = t.label || shortAddr(t.wallet);
  const img = safeUrl(t.image);
  const dexUrl = `https://dexscreener.com/${t.chain}/${t.token}`;
  return `<li class="fitem">
    <span class="pill ${t.side === "buy" ? "good" : "bad"}">${t.side === "buy" ? "Покупка" : "Продажа"}</span>
    <span class="tokicon" style="--s:24px">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<b>${esc((t.symbol || "?").slice(0, 1))}</b></span>
    <div class="fmain"><b>${esc(t.symbol || shortAddr(t.token))}</b> <span class="num">${fmt.usd(t.usd)}</span>
      <span class="fine">${esc(label)} · ${chainBadge(t.chain)} · ${timeAgo(t.ts)}</span></div>
    <div class="factions">
      <button class="btn sm" data-action="check-token" data-chain="${esc(t.chain)}" data-value="${esc(t.token)}">${icon("check")}Проверить</button>
      <a class="btn sm" href="${esc(dexUrl)}" target="_blank" rel="noopener">${icon("external")}DEX</a>
    </div>
  </li>`;
}

// ---------- polling ----------

const copyState = { polling: false, lastPoll: null, errors: [], addChain: "solana", timer: null };

async function pollNow() {
  if (copyState.polling || !watchlist.all().length) return;
  copyState.polling = true;
  copyState.errors = [];
  emit();
  try {
    const errs = new Set();
    const added = await pollAll((w, e) => errs.add(`${shortAddr(w.wallet)}: ${e.message}`));
    copyState.errors = [...errs].slice(0, 3);
    copyState.lastPoll = new Date();
    const buys = added.filter((a) => a.side === "buy");
    if (buys.length && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const b of buys.slice(0, 3)) {
        try {
          new Notification(`${b.label || shortAddr(b.wallet)} купил ${b.symbol || "токен"}`, {
            body: `${fmt.usd(b.usd)} · ${chainById(b.chain)?.name || b.chain}`,
            tag: b.id,
          });
        } catch { /* notifications unavailable */ }
      }
    }
    if (added.length) toast(`Новых сделок: ${added.length}`);
  } finally {
    copyState.polling = false;
    emit();
  }
}

export function startPolling() {
  clearInterval(copyState.timer);
  if (!watchlist.all().length) return;
  copyState.timer = setInterval(pollNow, 120000);
  pollNow();
}

// ---------- events ----------

document.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const { chain, wallet, value } = a.dataset;
  switch (a.dataset.action) {
    case "wmode":
      ws.mode = a.dataset.value; ws.detail = null; emit(); break;
    case "wallet-open": {
      const r = ws.results.find((x) => x.wallet === wallet && !x.error);
      if (r) { ws.detail = r; emit(); $("#view")?.scrollTo(0, 0); }
      break;
    }
    case "wallet-back": ws.detail = null; emit(); break;
    case "watch-toggle":
      e.stopPropagation();
      if (watchlist.has(chain, wallet)) { watchlist.remove(chain, wallet); toast("Убрано из отслеживания"); }
      else { watchlist.add({ chain, wallet, label: "" }); toast("Добавлено в копи-трейдинг"); startPolling(); }
      emit();
      break;
    case "watch-remove": watchlist.remove(chain, wallet); toast("Убрано из отслеживания"); emit(); break;
    case "watch-open":
      location.hash = "#wallets";
      startWalletScan(chain, wallet);
      break;
    case "check-token": openCheck(chain, value); break;
    case "poll-now": pollNow(); break;
    case "feed-clear": feed.clear(); emit(); break;
    case "notify-on":
      try { await Notification.requestPermission(); } catch { /* ignore */ }
      emit();
      break;
  }
});

document.addEventListener("change", (e) => {
  const i = e.target.closest(".wl-label");
  if (!i) return;
  watchlist.update(i.dataset.chain, i.dataset.wallet, { label: i.value.trim() });
  toast("Сохранено");
});

