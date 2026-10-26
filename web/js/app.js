import { CHAINS, chainById, P, fmt, SEV, VERDICT, TIERS, STRATEGIES, DEFAULT_PLANS } from "./engine.js";
import { dex } from "./api.js";
import { store } from "./store.js";
import { $, esc, safeUrl, icon, toast, copyText, chainBadge, change, tokenIcon, empty } from "./ui.js";
import { walletViews, startTokenScan, startPolling } from "./walletViews.js";
import { WALLET_CHAINS, keys } from "./wallets.js";
import { picksView } from "./picksView.js";
import { ai, MODELS } from "./ai.js";
import { smart } from "./smartmoney.js";

// ---------- helpers ----------


const SEV_UI = {
  [SEV.critical]: { icon: "bad", cls: "bad" },
  [SEV.warning]: { icon: "warn", cls: "warn" },
  [SEV.info]: { icon: "info", cls: "muted" },
  [SEV.ok]: { icon: "ok", cls: "good" },
};



function riskBadge(p) {
  const r = store.risk(p);
  const key = P.key(p);
  const extra = store.checking.has(key)
    ? '<span class="spinner sm" title="Проверяю контракт"></span>'
    : !r.checked ? '<span class="unchecked" title="Контракт ещё не проверен">не проверен</span>' : "";
  if (!r.tier) return `<span class="risk bad">${icon("bad")}Опасно</span>`;
  return `<span class="risk ${TIERS[r.tier].cls}"><i class="dot"></i>${TIERS[r.tier].short}${extra}</span>`;
}

// ---------- detail panel ----------

function detailHTML(p, { closable = true } = {}) {
  const key = P.key(p);
  const sec = store.security.get(key);
  const risk = store.risk(p);
  const price = P.price(p);
  const chain = chainById(p.chainId);

  const metric = (label, value) => `<div class="metric"><span>${label}</span><b class="num">${value}</b></div>`;

  let secHTML;
  if (store.checking.has(key) && !sec) {
    secHTML = '<p class="row muted"><span class="spinner sm"></span>Проверяю контракт…</p>';
  } else if (sec) {
    const v = VERDICT[sec.verdict];
    const flags = [...sec.flags].sort((a, b) => b.sev - a.sev).map((f) => `
      <li class="flag">${icon(SEV_UI[f.sev].icon, SEV_UI[f.sev].cls)}
        <div><b>${esc(f.title)}</b>${f.detail ? `<span>${esc(f.detail)}</span>` : ""}</div></li>`).join("");
    secHTML = `
      <div class="row between"><span class="verdict ${v.cls}">${icon(v.cls === "good" ? "ok" : v.cls === "warn" ? "warn" : "bad")}${v.title}</span>
        <button class="iconbtn" data-action="recheck" title="Проверить заново">${icon("refresh")}</button></div>
      <div class="metrics">
        ${metric("Налог покупка", sec.buyTax == null ? "—" : fmt.share(sec.buyTax))}
        ${metric("Налог продажа", sec.sellTax == null ? "—" : fmt.share(sec.sellTax))}
        ${metric("Держателей", fmt.int(sec.holderCount))}
        ${metric("Топ-10 держат", fmt.share(sec.top10))}
      </div>
      <ul class="flags">${flags || '<li class="muted">Флагов нет</li>'}</ul>
      <p class="fine">Источник: GoPlus Security, ${fmt.time(sec.checkedAt)}</p>`;
  } else if (store.secErrors.has(key)) {
    secHTML = `<p class="warn">${esc(store.secErrors.get(key))}</p><button class="btn" data-action="recheck">Повторить проверку</button>`;
  } else {
    secHTML = '<button class="btn" data-action="recheck">Проверить контракт</button>';
  }

  let riskHTML;
  if (risk.tier) {
    riskHTML = `<p class="tier ${TIERS[risk.tier].cls}"><i class="dot"></i>${TIERS[risk.tier].title}</p>`;
  } else {
    riskHTML = `<p class="tier bad">${icon("bad")}Опасно: не торговать</p>`;
  }
  riskHTML += `<ul class="factors">${risk.factors.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
  if (!risk.checked) riskHTML += '<p class="fine">Категория уточнится после проверки контракта.</p>';

  let planHTML;
  if (risk.tier && price) {
    const plan = store.settings.plans[risk.tier] || DEFAULT_PLANS[risk.tier];
    const lvl = (label, pct, cls) => `<tr><td>${label}</td><td class="num ${cls}">${fmt.pct(pct)}</td><td class="num sel">${fmt.price(price * (1 + pct / 100))}</td></tr>`;
    planHTML = `
      <table class="levels"><tbody>
        ${lvl("Стоп-лосс", -plan.stopLoss, "bad")}
        ${lvl("Тейк-профит 1", plan.tp1, "good")}
        ${lvl("Тейк-профит 2", plan.tp2, "good")}
      </tbody></table>
      <p>Размер позиции: до <b>${plan.position}%</b> депозита</p>
      <p class="fine">Уровни посчитаны от текущей цены по твоим правилам для категории «${TIERS[risk.tier].title.toLowerCase()}». Изменить их можно в разделе «Мои правила».</p>`;
  } else if (!risk.tier) {
    planHTML = '<p class="muted">Контракт опасный, уровни не рассчитываются.</p>';
  } else {
    planHTML = '<p class="muted">Нет цены для расчёта уровней.</p>';
  }

  const explorer = chain ? chain.explorer + p.baseToken.address : null;

  return `
    <div class="detail" data-key="${esc(key)}">
      <header class="dhead">
        ${tokenIcon(p, 44)}
        <div class="dtitle"><h2>${esc(P.symbol(p))}</h2><span>${esc(P.name(p))}</span></div>
        ${chainBadge(p.chainId)}
        ${closable ? `<button class="iconbtn" data-action="close-detail" title="Закрыть">${icon("close")}</button>` : ""}
      </header>
      <div class="price num">${fmt.price(price)}</div>
      <div class="changes">
        ${["m5", "h1", "h6", "h24"].map((w, i) => `<div><span>${["5 мин", "1 ч", "6 ч", "24 ч"][i]}</span>${change(P.change(p, w))}</div>`).join("")}
      </div>

      <section class="card"><h3>Рынок</h3>
        <div class="metrics">
          ${metric("Ликвидность", fmt.usd(P.liq(p)))}
          ${metric("Капитализация", fmt.usd(P.cap(p)))}
          ${metric("Объём 1 ч", fmt.usd(P.vol(p, "h1")))}
          ${metric("Объём 24 ч", fmt.usd(P.vol(p, "h24")))}
          ${metric("Покупки / продажи 1 ч", `${P.buys(p, "h1")} / ${P.sells(p, "h1")}`)}
          ${metric("Возраст пары", fmt.age(P.ageHours(p)))}
          ${metric("Биржа", esc(p.dexId || "—"))}
          ${metric("Котируется к", esc(p.quoteToken?.symbol || "—"))}
        </div>
      </section>

      <section class="card"><h3>Уровень риска</h3>${riskHTML}</section>
      <section class="card"><h3>Скам-проверка</h3>${secHTML}</section>
      <section class="card"><h3>Мои уровни</h3>${planHTML}</section>

      <div class="actions">
        <a class="btn primary" href="${esc(P.url(p))}" target="_blank" rel="noopener">${icon("external")}Открыть на DexScreener</a>
        ${explorer ? `<a class="btn" href="${esc(explorer)}" target="_blank" rel="noopener">${icon("search")}Эксплорер</a>` : ""}
        <button class="btn" data-action="copy" data-value="${esc(p.baseToken.address)}">${icon("doc")}Скопировать адрес</button>
        ${WALLET_CHAINS[p.chainId] ? `<button class="btn" data-action="find-buyers" data-chain="${esc(p.chainId)}" data-value="${esc(p.baseToken.address)}">${icon("wallets")}Найти сильных покупателей</button>` : ""}
      </div>
      <p class="addr sel">${esc(p.baseToken.address)}</p>
      <p class="fine">Оценки описывают риск актива по данным рынка и контракта и не предсказывают цену. Решение о сделке и её размере принимаешь ты.</p>
    </div>`;
}

// ---------- views ----------

const ui = {
  risk: "all",
  strategy: "earlyPairs",
  sort: { key: "vol1h", dir: -1 },
  selected: null,       // pair id in screener
  checkPair: null,      // pair found in token check
  checkError: null,
  checkLoading: false,
  batchSig: "",
};

try {
  const saved = JSON.parse(localStorage.getItem("cryptoScanner.ui.v1") || "null");
  if (saved) Object.assign(ui, { risk: saved.risk || "all", strategy: saved.strategy || "earlyPairs" });
} catch { /* ignore */ }
const saveUI = () => { try { localStorage.setItem("cryptoScanner.ui.v1", JSON.stringify({ risk: ui.risk, strategy: ui.strategy })); } catch { /* ignore */ } };

const SORTS = {
  symbol: (p) => P.symbol(p).toLowerCase(),
  chain: (p) => p.chainId,
  price: (p) => P.price(p) ?? 0,
  ch1h: (p) => P.change(p, "h1") ?? -Infinity,
  ch24h: (p) => P.change(p, "h24") ?? -Infinity,
  liq: (p) => P.liq(p),
  vol1h: (p) => P.vol(p, "h1"),
  age: (p) => P.ageHours(p) ?? Infinity,
};

const COLS = [
  ["symbol", "Токен", ""],
  ["chain", "Сеть", "c-chain"],
  ["price", "Цена", "r"],
  ["ch1h", "1 ч", "r"],
  ["ch24h", "24 ч", "r c-24"],
  ["liq", "Ликвидность", "r c-liq"],
  ["vol1h", "Объём 1 ч", "r c-vol"],
  ["age", "Возраст", "r c-age"],
  [null, "Риск", ""],
];

function visibleStrategies() {
  return ui.risk === "all" ? STRATEGIES : STRATEGIES.filter((s) => s.risk === ui.risk);
}
function currentStrategy() {
  return STRATEGIES.find((s) => s.id === ui.strategy) || STRATEGIES[0];
}
function screenerRows() {
  const fn = SORTS[ui.sort.key] || SORTS.vol1h;
  return store.matches(currentStrategy()).sort((a, b) => {
    const x = fn(a), y = fn(b);
    return (x < y ? -1 : x > y ? 1 : 0) * ui.sort.dir;
  });
}

const views = {
  screener: {
    title: "Скринер",
    mount(el) {
      el.innerHTML = `
        <div class="controls">
          <div class="segmented" role="tablist" aria-label="Уровень риска" id="riskSeg"></div>
          <div class="chips" id="chips"></div>
          <div class="summary" id="summary"></div>
        </div>
        <div class="tablewrap" id="tablewrap"></div>`;
    },
    update(el) {
      const seg = [["all", "Все"], ["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]];
      $("#riskSeg", el).innerHTML = seg.map(([k, t]) => `<button role="tab" aria-selected="${ui.risk === k}" data-action="risk" data-value="${k}">${t}</button>`).join("");

      const vs = visibleStrategies();
      if (!vs.some((s) => s.id === ui.strategy)) ui.strategy = vs[0].id;
      $("#chips", el).innerHTML = vs.map((s) => `
        <button class="chip ${s.id === ui.strategy ? "on" : ""}" data-action="strategy" data-value="${s.id}">
          ${icon(s.icon)}<span>${s.title}</span><em class="num">${store.matches(s).length}</em><i class="dot ${TIERS[s.risk].cls}" title="${TIERS[s.risk].title}"></i>
        </button>`).join("");

      const s = currentStrategy();
      const st = store.settings;
      const extra = [];
      if (s.antiPump && st.maxPump > 0) extra.push(`Рост за 6–24 ч ≤ +${st.maxPump}%`);
      if (s.antiPump && st.skipFading) extra.push("Импульс не угасает");
      const late = store.hiddenAsLate(s).length;
      $("#summary", el).innerHTML = `<p>${s.summary}</p>
        <div class="rules">${s.rules.map((r) => `<span>${r}</span>`).join("")}${extra.map((r) => `<span class="rule-guard">${r}</span>`).join("")}</div>
        ${late ? `<p class="fine">Скрыто как поздний вход: ${late}. Порог меняется в настройках.</p>` : ""}`;

      const wrap = $("#tablewrap", el);
      const rows = screenerRows();
      if (store.error && !store.pairs.length) {
        wrap.innerHTML = empty("Не удалось загрузить рынок", store.error, '<button class="btn primary" data-action="refresh">Повторить</button>');
      } else if (!store.pairs.length) {
        wrap.innerHTML = '<div class="empty"><span class="spinner"></span><p>Загружаю рынок…</p><p class="fine">Первая загрузка занимает 20–40 секунд.</p></div>';
      } else if (!rows.length) {
        wrap.innerHTML = empty("Нет совпадений", `Сейчас ни один токен не проходит условия стратегии «${s.title}». Данные обновляются автоматически, можно выбрать другую стратегию или снизить минимальную ликвидность в настройках.`);
      } else {
        const scroll = wrap.querySelector(".tablescroll")?.scrollTop || 0;
        wrap.innerHTML = `<div class="tablescroll"><table class="grid">
          <thead><tr>${COLS.map(([k, t, c]) => k
            ? `<th class="${c}"><button data-action="sort" data-value="${k}">${t}${ui.sort.key === k ? (ui.sort.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`
            : `<th class="${c}">${t}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((p) => `
            <tr data-action="select" data-value="${esc(P.id(p))}" class="${ui.selected === P.id(p) ? "sel-row" : ""}" tabindex="0">
              <td><div class="tok">${tokenIcon(p)}<div><b>${esc(P.symbol(p))}</b><span>${esc(P.name(p))}</span></div></div></td>
              <td class="c-chain">${chainBadge(p.chainId)}</td>
              <td class="r num">${fmt.price(P.price(p))}</td>
              <td class="r">${change(P.change(p, "h1"))}</td>
              <td class="r c-24">${change(P.change(p, "h24"))}</td>
              <td class="r num c-liq">${fmt.usd(P.liq(p))}</td>
              <td class="r num c-vol">${fmt.usd(P.vol(p, "h1"))}</td>
              <td class="r num c-age">${fmt.age(P.ageHours(p))}</td>
              <td>${riskBadge(p)}</td>
            </tr>`).join("")}</tbody></table></div>`;
        wrap.querySelector(".tablescroll").scrollTop = scroll;
        const sig = rows.slice(0, 25).map(P.key).join("|");
        if (sig !== ui.batchSig) { ui.batchSig = sig; store.checkMany(rows); }
      }
    },
    subtitle() {
      if (store.lastUpdated) return `Обновлено в ${fmt.time(store.lastUpdated)} · токенов в базе: ${store.pairs.length}`;
      return store.loading ? "Загружаю рынок…" : "Нет данных";
    },
  },

  check: {
    title: "Проверка токена",
    mount(el) {
      el.innerHTML = `
        <form class="checkbar" id="checkForm">
          <select id="checkChain" aria-label="Сеть">${CHAINS.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
          <input id="checkAddr" type="text" placeholder="Адрес контракта токена" autocomplete="off" spellcheck="false">
          <button class="btn primary" type="submit">${icon("check")}Проверить</button>
        </form>
        <div id="checkResult" class="checkresult"></div>`;
      $("#checkForm", el).addEventListener("submit", (e) => { e.preventDefault(); runCheck(); });
    },
    update(el) {
      const r = $("#checkResult", el);
      if (ui.checkLoading) r.innerHTML = '<div class="empty"><span class="spinner"></span><p>Ищу токен на DEX…</p></div>';
      else if (ui.checkPair) r.innerHTML = detailHTML(ui.checkPair, { closable: false });
      else if (ui.checkError) r.innerHTML = empty("Токен не найден", ui.checkError);
      else r.innerHTML = empty("Проверка любого токена", "Вставь адрес контракта и выбери сеть. Приложение найдёт самую ликвидную пару, проверит контракт на скам и покажет уровень риска.");
    },
    subtitle: () => "Скам-проверка и риск по адресу контракта",
  },

  picks: picksView,
  ...walletViews,

  rules: {
    title: "Мои правила",
    mount(el) {
      const field = (tier, key, label, min, max, step) => `
        <label class="field"><span>${label}</span>
          <input type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" data-tier="${tier}" data-key="${key}" value="${store.settings.plans[tier][key]}"></label>`;
      el.innerHTML = `
        <div class="form">
          <p class="lead">Правила выхода и размер позиции для каждой категории риска. По ним приложение считает уровни стоп-лосса и тейк-профита для любого токена.</p>
          ${Object.keys(TIERS).map((t) => `
            <section class="group">
              <h3><i class="dot ${TIERS[t].cls}"></i>${TIERS[t].title}</h3>
              ${field(t, "stopLoss", "Стоп-лосс, % ниже входа", 1, 95, 1)}
              ${field(t, "tp1", "Тейк-профит 1, % выше входа", 1, 10000, 1)}
              ${field(t, "tp2", "Тейк-профит 2, % выше входа", 1, 10000, 1)}
              ${field(t, "position", "Размер позиции, % депозита", 0.1, 100, 0.5)}
              <button class="link" data-action="reset-plan" data-value="${t}">Вернуть значения по умолчанию</button>
            </section>`).join("")}
        </div>`;
      el.addEventListener("change", (e) => {
        const i = e.target.closest("input[data-tier]");
        if (!i) return;
        const v = Number(i.value);
        if (!isFinite(v)) return;
        const clamped = Math.min(Number(i.max), Math.max(Number(i.min), v));
        i.value = clamped;
        store.settings.plans[i.dataset.tier][i.dataset.key] = clamped;
        store.saveSettings();
        toast("Сохранено");
      });
    },
    update() {},
    subtitle: () => "Стопы, тейки и размер позиции",
  },

  settings: {
    title: "Настройки",
    mount(el) {
      const s = store.settings;
      const liqOpts = [0, 5000, 10000, 25000, 50000, 100000, 250000];
      const refOpts = [0, 1, 2, 5, 10, 15, 30];
      el.innerHTML = `
        <div class="form">
          <a class="group linkrow" href="#rules">${icon("rules")}<span>Мои правила: стопы, тейки, размер позиции</span><span class="muted">›</span></a>
          <a class="group linkrow" href="#check">${icon("check")}<span>Проверка токена по адресу</span><span class="muted">›</span></a>
          <section class="group"><h3>API-ключи</h3>
            <label class="field"><span>Anthropic API<small>ИИ-аналитик</small></span>
              <input id="keyAnthropic" type="password" autocomplete="off" spellcheck="false" value="${esc(keys.get().anthropic || "")}" placeholder="sk-ant-…"></label>
            <label class="field"><span>Etherscan<small>Ethereum, Arbitrum, Polygon, Sonic, HyperEVM</small></span>
              <input id="keyEtherscan" type="password" autocomplete="off" spellcheck="false" value="${esc(keys.get().etherscan || "")}" placeholder="Вставь ключ"></label>
            <label class="field"><span>Helius<small>Solana</small></span>
              <input id="keyHelius" type="password" autocomplete="off" spellcheck="false" value="${esc(keys.get().helius || "")}" placeholder="Вставь ключ"></label>
            <div class="row wrap"><button class="btn primary" data-action="save-keys">Сохранить ключи</button>
              <a class="btn" href="https://etherscan.io/apidashboard" target="_blank" rel="noopener">${icon("external")}Ключ Etherscan</a>
              <a class="btn" href="https://dashboard.helius.dev" target="_blank" rel="noopener">${icon("external")}Ключ Helius</a>
              <a class="btn" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">${icon("external")}Ключ Anthropic</a></div>
            <p class="fine">Ключи хранятся только в этом браузере и отправляются только в свои сервисы: Anthropic, Etherscan и Helius. Не сохраняй их на чужом или общем компьютере. Использование API Anthropic оплачивается отдельно в console.anthropic.com.</p>
          </section>
          <section class="group"><h3>ИИ-аналитик</h3>
            <label class="toggle"><span>Автоматический анализ после каждого обновления рынка</span>
              <input type="checkbox" role="switch" data-setting="aiEnabled" ${s.aiEnabled !== false ? "checked" : ""}></label>
            <label class="field"><span>Модель</span>
              <select data-setting="aiModel">${MODELS.map((m) => `<option value="${m.id}" ${(s.aiModel || MODELS[0].id) === m.id ? "selected" : ""}>${m.title}</option>`).join("")}</select></label>
            <label class="field"><span>Лимит анализов в день<small>один анализ разбирает до 8 токенов</small></span>
              <select data-setting="aiDailyCalls">${[10, 20, 40, 80, 150].map((v) => `<option value="${v}" ${(s.aiDailyCalls ?? 40) === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
            <p class="fine">Расход токенов виден на странице «Подборка». Сверь его с ценами модели в console.anthropic.com, чтобы понимать стоимость. Если ИИ выключен, подборка показывает кандидатов по стратегиям без анализа.</p>
          </section>
          <section class="group"><h3>Сильные кошельки</h3>
            <label class="toggle"><span>Автоматически искать сильные кошельки</span>
              <input type="checkbox" role="switch" data-setting="smartAuto" ${s.smartAuto !== false ? "checked" : ""}></label>
            <label class="field"><span>Автоматически следить за лучшими</span>
              <select data-setting="smartFollow">${[0, 5, 10, 20].map((v) => `<option value="${v}" ${(s.smartFollow ?? 10) === v ? "selected" : ""}>${v ? `Топ-${v}` : "Не следить"}</option>`).join("")}</select></label>
            <p class="fine">Поиск берёт токены, которые выросли больше чем на 100% за сутки, находит их ранних покупателей и считает им винрейт. Лимит: 6 токенов в день на Solana и 24 в EVM-сетях, чтобы не выйти за бесплатные тарифы. Покупки отслеживаемых кошельков попадают в копи-трейдинг и учитываются ИИ.</p>
          </section>
          <section class="group"><h3>Сети</h3>
            ${CHAINS.map((c) => `<label class="toggle"><span>${c.name} ${chainBadge(c.id)}</span>
              <input type="checkbox" role="switch" data-setting="chain" value="${c.id}" ${s.chains.includes(c.id) ? "checked" : ""}></label>`).join("")}
            <p class="fine">Скринер ищет токены только во включённых сетях.</p>
          </section>
          <section class="group"><h3>Скринер</h3>
            <label class="field"><span>Минимальная ликвидность</span>
              <select data-setting="minLiquidity">${liqOpts.map((v) => `<option value="${v}" ${s.minLiquidity === v ? "selected" : ""}>${v ? fmt.usd(v) : "Без ограничения"}</option>`).join("")}</select></label>
            <label class="field"><span>Автообновление</span>
              <select data-setting="autoRefreshMin">${refOpts.map((v) => `<option value="${v}" ${s.autoRefreshMin === v ? "selected" : ""}>${v ? `Каждые ${v} мин` : "Выключено"}</option>`).join("")}</select></label>
            <label class="field"><span>Не догонять памп: скрывать выросшие больше чем на</span>
              <select data-setting="maxPump">${[0, 100, 200, 300, 500, 1000].map((v) => `<option value="${v}" ${s.maxPump === v ? "selected" : ""}>${v ? `+${v}%` : "Не скрывать"}</option>`).join("")}</select></label>
            <label class="toggle"><span>Скрывать токены с угасающим импульсом</span>
              <input type="checkbox" role="switch" data-setting="skipFading" ${s.skipFading ? "checked" : ""}></label>
            <label class="toggle"><span>Скрывать токены с опасным контрактом</span>
              <input type="checkbox" role="switch" data-setting="hideDangerous" ${s.hideDangerous ? "checked" : ""}></label>
            <p class="fine">Чем ниже порог ликвидности, тем больше щитков в выдаче и тем выше риск, что ликвидность заберут. Фильтры «памп» и «импульс» действуют на стратегии «Ранний вход» и «Всплеск объёма». Импульс считается угасающим, когда цена падает и за 5 минут, и за час, или когда за 5 минут продаж в полтора раза больше покупок.</p>
          </section>
          <section class="group"><h3>Данные</h3>
            <p class="fine">Рынок: DexScreener. Проверка контрактов: GoPlus Security. История кошельков: Etherscan и Helius. Настройки хранятся только в этом браузере. Приложение не подключается к кошельку и не проводит сделки.</p>
          </section>
        </div>`;
      el.addEventListener("change", (e) => {
        const i = e.target.closest("[data-setting]");
        if (!i) return;
        const k = i.dataset.setting;
        if (k === "chain") {
          const set = new Set(s.chains);
          i.checked ? set.add(i.value) : set.delete(i.value);
          s.chains = CHAINS.map((c) => c.id).filter((id) => set.has(id));
        } else if (["hideDangerous", "skipFading", "aiEnabled", "smartAuto"].includes(k)) {
          s[k] = i.checked;
        } else if (k === "aiModel") {
          s[k] = i.value;
        } else {
          s[k] = Number(i.value);
        }
        store.saveSettings();
        if (k === "autoRefreshMin") store.scheduleAutoRefresh();
        if (k === "chain") store.refresh();
        if (k === "smartFollow") smart.syncFollow();
        toast("Сохранено");
      });
    },
    update() {},
    subtitle: () => "Ключи, сети, фильтры и обновление",
  },
};


async function runCheck() {
  const chain = $("#checkChain").value;
  const addr = $("#checkAddr").value.trim();
  if (!addr) return;
  ui.checkLoading = true; ui.checkPair = null; ui.checkError = null;
  render();
  try {
    const pairs = await dex.tokenPairs(chain, addr);
    const own = pairs.filter((p) => p.baseToken.address.toLowerCase() === addr.toLowerCase());
    const list = own.length ? own : pairs;
    const best = list.reduce((a, b) => (!a || P.liq(b) > P.liq(a) ? b : a), null);
    if (best) {
      ui.checkPair = best;
      ui.checkLoading = false;
      render();
      await store.checkSecurity(best, true);
    } else {
      ui.checkError = `На DexScreener нет торговых пар для этого адреса в сети ${chainById(chain)?.name || chain}. Проверь адрес и выбранную сеть.`;
    }
  } catch (e) {
    ui.checkError = e.message;
  } finally {
    ui.checkLoading = false;
    render();
  }
}

// ---------- shell ----------

const NAV = [
  ["Главное", [["picks", "Подборка"]]],
  ["Рынок", [["screener", "Скринер"], ["check", "Проверка токена"]]],
  ["Кошельки", [["wallets", "Сильные кошельки"], ["copy", "Копи-трейдинг"]]],
  ["Торговля", [["rules", "Мои правила"]]],
];
const TAB_ICON = { picks: "sparkle", screener: "screener", check: "check", wallets: "wallets", copy: "copy", rules: "rules", settings: "settings" };

let route = null;

function currentRoute() {
  const h = location.hash.replace("#", "");
  return views[h] ? h : "picks";
}

function renderNav() {
  const r = currentRoute();
  $("#nav").innerHTML = NAV.map(([sec, items]) => `
    <div class="navsec"><h4>${sec}</h4>${items.map(([id, t, badge]) => `
      <a href="#${id}" class="navitem ${r === id ? "on" : ""}">${icon(TAB_ICON[id])}<span>${t}</span>${badge ? `<em>${badge}</em>` : ""}</a>`).join("")}</div>`).join("");
  $("#settingsLink").classList.toggle("on", r === "settings");
  const tabs = [["picks", "Подборка"], ["screener", "Скринер"], ["wallets", "Кошельки"], ["copy", "Копи"], ["settings", "Ещё"]];
  $("#tabbar").innerHTML = tabs.map(([id, t]) => `
    <a href="#${id}" class="${r === id ? "on" : ""}">${icon(TAB_ICON[id])}<span>${t}</span></a>`).join("");
}

function renderDetailPanel() {
  const panel = $("#inspector");
  if (!["screener", "picks"].includes(currentRoute()) || !ui.selected) {
    panel.hidden = true;
    document.body.classList.remove("has-inspector");
    return;
  }
  const p = store.pairs.find((x) => P.id(x) === ui.selected) || ai.results().map((r) => r.pair).find((x) => P.id(x) === ui.selected);
  if (!p) { panel.hidden = true; document.body.classList.remove("has-inspector"); return; }
  const scroll = panel.scrollTop;
  const sameToken = panel.firstElementChild?.dataset.key === P.key(p);
  panel.innerHTML = detailHTML(p);
  panel.hidden = false;
  document.body.classList.add("has-inspector");
  if (sameToken) panel.scrollTop = scroll;
  if (!store.secErrors.has(P.key(p))) store.checkSecurity(p);
}

function render() {
  const r = currentRoute();
  const main = $("#view");
  if (r !== route) {
    route = r;
    const fresh = main.cloneNode(false);
    main.replaceWith(fresh);
    views[r].mount(fresh);
    renderNav();
  }
  const view = $("#view");
  $("#title").textContent = views[r].title;
  $("#subtitle").textContent = views[r].subtitle();
  $("#refreshBtn").hidden = r !== "screener";
  $("#refreshBtn").classList.toggle("spinning", store.loading);
  $("#refreshBtn").disabled = store.loading;
  try {
    views[r].update(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="notice bad">${icon("bad", "bad")}<span>Ошибка отображения: ${esc(e.message)}. Пришли скриншот этого сообщения, чтобы я исправил.</span></p>`;
  }
  renderDetailPanel();
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const v = a.dataset.value;
  switch (a.dataset.action) {
    case "risk": ui.risk = v; saveUI(); render(); break;
    case "strategy": ui.strategy = v; saveUI(); render(); break;
    case "sort":
      ui.sort = ui.sort.key === v ? { key: v, dir: -ui.sort.dir } : { key: v, dir: v === "symbol" || v === "chain" || v === "age" ? 1 : -1 };
      render(); break;
    case "select": ui.selected = ui.selected === v ? null : v; render(); break;
    case "close-detail": ui.selected = null; render(); break;
    case "refresh": store.refresh(); break;
    case "copy": copyText(v); break;
    case "profile": store.settings.riskProfile = v; store.saveSettings(); break;
    case "ai-run": ai.run({ manual: true }); break;
    case "pick-open": {
      const p = store.pairs.find((x) => P.key(x) === v) || ai.state.results[v]?.pair;
      if (p) { ui.selected = P.id(p); render(); }
      break;
    }
    case "find-buyers":
      ui.selected = null;
      location.hash = "#wallets";
      startTokenScan(a.dataset.chain, v);
      break;
    case "save-keys":
      keys.set({ anthropic: $("#keyAnthropic").value.trim(), etherscan: $("#keyEtherscan").value.trim(), helius: $("#keyHelius").value.trim() });
      ai.error = null;
      setTimeout(() => { ai.run(); smart.tick(); }, 500);
      toast("Ключи сохранены");
      startPolling();
      break;
    case "reset-plan":
      store.settings.plans[v] = { ...DEFAULT_PLANS[v] };
      store.saveSettings();
      route = null; render(); toast("Значения сброшены");
      break;
    case "recheck": {
      const key = a.closest(".detail")?.dataset.key;
      const p = store.pairs.find((x) => P.key(x) === key) || (ui.checkPair && P.key(ui.checkPair) === key ? ui.checkPair : null);
      if (p) store.checkSecurity(p, true);
      break;
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.selected) { ui.selected = null; render(); }
  if (e.key === "Enter" && e.target.matches("tr[data-action='select']")) e.target.click();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r" && currentRoute() === "screener") {
    e.preventDefault();
    store.refresh();
  }
});

$("#refreshBtn").addEventListener("click", () => store.refresh());
window.addEventListener("hashchange", () => { ui.selected = null; render(); });

let frame = 0;
store.subscribe(() => {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; render(); });
});

window.addEventListener("app:update", () => {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; render(); });
});

window.addEventListener("app:check", (e) => {
  const { chain, address } = e.detail;
  location.hash = "#check";
  render();
  $("#checkChain").value = chain;
  $("#checkAddr").value = address;
  runCheck();
});

window.addEventListener("ai:results", (e) => {
  const list = e.detail || [];
  if (!list.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  for (const r of list.slice(0, 3)) {
    try { new Notification(`ИИ: кандидат ${ai.state.results[r.id]?.pair?.baseToken?.symbol || ""}`, { body: r.headline, tag: r.id }); } catch { /* ignore */ }
  }
});

render();
store.scheduleAutoRefresh();
store.refresh();
startPolling();
ai.start();
smart.start();
