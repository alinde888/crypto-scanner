import { CHAINS, chainById, P, fmt, SEV, VERDICT, TIERS, STRATEGIES, DEFAULT_PLANS } from "./engine.js";
import { dex } from "./api.js";
import { store } from "./store.js";

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

const ICONS = {
  screener: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  check: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  wallets: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2M3 9h18"/>',
  copy: '<path d="M6 4v8a4 4 0 0 0 4 4h8"/><path d="M15 13l3 3-3 3"/><path d="M6 4l-2 2M6 4l2 2"/>',
  rules: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  doc: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  rebound: '<path d="M4 6l6 8 4-4 6 8"/><path d="M15 18h5v-5"/>',
  trend: '<path d="M4 18l6-6 4 4 6-8"/><path d="M15 8h5v5"/>',
  columns: '<path d="M4 9l8-5 8 5M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  bad: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};
const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

const SEV_UI = {
  [SEV.critical]: { icon: "bad", cls: "bad" },
  [SEV.warning]: { icon: "warn", cls: "warn" },
  [SEV.info]: { icon: "info", cls: "muted" },
  [SEV.ok]: { icon: "ok", cls: "good" },
};

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Адрес скопирован"); }
  catch { toast("Не удалось скопировать, выдели адрес вручную"); }
}

// ---------- shared pieces ----------

const chainBadge = (id) => `<span class="chain" title="${esc(chainById(id)?.name || id)}">${esc(chainById(id)?.short || id)}</span>`;

const change = (v) => `<span class="num ${v == null ? "muted" : v > 0 ? "good" : v < 0 ? "bad" : "muted"}">${fmt.pct(v)}</span>`;

function tokenIcon(p, size = 28) {
  const url = safeUrl(p.info?.imageUrl);
  const letter = esc(P.symbol(p).slice(0, 1));
  return `<span class="tokicon" style="--s:${size}px">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<b>${letter}</b></span>`;
}

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
      $("#summary", el).innerHTML = `<p>${s.summary}</p><div class="rules">${s.rules.map((r) => `<span>${r}</span>`).join("")}</div>`;

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

  wallets: {
    title: "Сильные кошельки",
    mount(el) {
      el.innerHTML = empty("Следующий этап", "Здесь будет поиск кошельков с реальным винрейтом: прибыль считается по каждой сделке из истории блокчейна, боты и кошельки разработчиков отсеиваются.");
    },
    update() {},
    subtitle: () => "Скоро",
  },

  copy: {
    title: "Копи-трейдинг",
    mount(el) {
      el.innerHTML = empty("Следующий этап", "Ты добавляешь кошельки в отслеживание, а приложение показывает их покупки и продажи с мгновенной скам-проверкой токена.");
    },
    update() {},
    subtitle: () => "Скоро",
  },

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
            <label class="toggle"><span>Скрывать токены с опасным контрактом</span>
              <input type="checkbox" role="switch" data-setting="hideDangerous" ${s.hideDangerous ? "checked" : ""}></label>
            <p class="fine">Чем ниже порог ликвидности, тем больше щитков в выдаче и тем выше риск, что ликвидность заберут.</p>
          </section>
          <section class="group"><h3>Данные</h3>
            <p class="fine">Рынок: DexScreener. Проверка контрактов: GoPlus Security. Настройки хранятся только в этом браузере. Приложение не подключается к кошельку и не проводит сделки.</p>
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
        } else if (k === "hideDangerous") {
          s.hideDangerous = i.checked;
        } else {
          s[k] = Number(i.value);
        }
        store.saveSettings();
        if (k === "autoRefreshMin") store.scheduleAutoRefresh();
        if (k === "chain") store.refresh();
        toast("Сохранено");
      });
    },
    update() {},
    subtitle: () => "Сети, фильтры и обновление",
  },
};

function empty(title, text, actions = "") {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${actions}</div>`;
}

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
  ["Рынок", [["screener", "Скринер"], ["check", "Проверка токена"]]],
  ["Кошельки", [["wallets", "Сильные кошельки", "скоро"], ["copy", "Копи-трейдинг", "скоро"]]],
  ["Торговля", [["rules", "Мои правила"]]],
];
const TAB_ICON = { screener: "screener", check: "check", wallets: "wallets", copy: "copy", rules: "rules", settings: "settings" };

let route = null;

function currentRoute() {
  const h = location.hash.replace("#", "");
  return views[h] ? h : "screener";
}

function renderNav() {
  const r = currentRoute();
  $("#nav").innerHTML = NAV.map(([sec, items]) => `
    <div class="navsec"><h4>${sec}</h4>${items.map(([id, t, badge]) => `
      <a href="#${id}" class="navitem ${r === id ? "on" : ""}">${icon(TAB_ICON[id])}<span>${t}</span>${badge ? `<em>${badge}</em>` : ""}</a>`).join("")}</div>`).join("");
  $("#settingsLink").classList.toggle("on", r === "settings");
  const tabs = [["screener", "Скринер"], ["check", "Проверка"], ["rules", "Правила"], ["settings", "Настройки"]];
  $("#tabbar").innerHTML = tabs.map(([id, t]) => `
    <a href="#${id}" class="${r === id ? "on" : ""}">${icon(TAB_ICON[id])}<span>${t}</span></a>`).join("");
}

function renderDetailPanel() {
  const panel = $("#inspector");
  if (currentRoute() !== "screener" || !ui.selected) {
    panel.hidden = true;
    document.body.classList.remove("has-inspector");
    return;
  }
  const p = store.pairs.find((x) => P.id(x) === ui.selected);
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
  views[r].update(view);
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

render();
store.scheduleAutoRefresh();
store.refresh();
