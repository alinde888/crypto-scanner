import { P, fmt, TIERS, chainById, DEFAULT_PLANS } from "./engine.js";
import { store } from "./store.js";
import { esc, icon, chainBadge, change, tokenIcon, empty } from "./ui.js";
import { ai, VERDICT_UI, MODELS, fmtTokens } from "./ai.js";
import { smart } from "./smartmoney.js";
import { keys, watchlist } from "./wallets.js";

const MIN_CONFIDENCE = 60;
const CANDIDATE_TTL = 3 * 3600e3;

// A pick is stale once the market has moved against it since the analysis.
function stale(r) {
  const p = ai.live(r);
  const now = P.price(p);
  if (!now || !r.priceAt) return false;
  return now / r.priceAt - 1 < -0.25;
}

const ago = (ts) => {
  const m = (Date.now() - ts) / 60000;
  if (m < 1) return "только что";
  if (m < 60) return `${Math.floor(m)} мин назад`;
  return `${Math.floor(m / 60)} ч назад`;
};

function levels(r, p) {
  const tier = r.risk in TIERS ? r.risk : "high";
  const plan = store.settings.plans[tier] || DEFAULT_PLANS[tier];
  const price = P.price(p);
  if (!price) return "";
  const lv = (t, pct, cls) => `<div><span>${t}</span><b class="num ${cls}">${fmt.price(price * (1 + pct / 100))}</b><em class="num">${fmt.pct(pct)}</em></div>`;
  return `<div class="levels-row">
    ${lv("Стоп", -plan.stopLoss, "bad")}${lv("Тейк 1", plan.tp1, "good")}${lv("Тейк 2", plan.tp2, "good")}
    <div><span>Позиция</span><b class="num">до ${plan.position}%</b><em>депозита</em></div>
  </div>`;
}

function card(r) {
  const p = ai.live(r);
  const v = VERDICT_UI[r.verdict];
  const now = P.price(p);
  const since = r.priceAt && now ? ((now / r.priceAt) - 1) * 100 : null;
  const compact = r.verdict !== "candidate";
  return `<article class="pick ${r.verdict}">
    <header>
      ${tokenIcon(p, 36)}
      <div class="ptitle"><b>${esc(P.symbol(p))}</b><span>${esc(P.name(p))}</span></div>
      ${chainBadge(p.chainId)}
      <span class="pill ${v.cls}">${v.t}</span>
    </header>
    <p class="headline">${esc(r.headline)}</p>
    <div class="pmeta">
      <span>Цена <b class="num">${fmt.price(now)}</b></span>
      <span>С момента анализа ${change(since)}</span>
      <span>1 ч ${change(P.change(p, "h1"))}</span>
      <span>Ликв. <b class="num">${fmt.usd(P.liq(p))}</b></span>
      <span>Возраст <b class="num">${fmt.age(P.ageHours(p))}</b></span>
      <span class="pill ${TIERS[r.risk]?.cls || "muted"}">${TIERS[r.risk]?.title || r.risk}</span>
      ${r.smartBuys ? `<span class="pill good">${icon("wallets")}Сильных кошельков: ${r.smartBuys}</span>` : ""}
    </div>
    <div class="conf"><span>Уверенность анализа</span><i style="--w:${Math.max(0, Math.min(100, r.confidence))}%"></i><b class="num">${r.confidence}</b></div>
    ${compact ? `<p class="thesis">${esc(r.thesis)}</p>` : `
      <p class="thesis">${esc(r.thesis)}</p>
      <div class="pcols">
        <div><h4>За</h4><ul>${r.positives.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h4>Риски</h4><ul>${r.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <p class="kv"><b>Вход:</b> ${esc(r.timing)}</p>
      <p class="kv"><b>Идея не сработала, если:</b> ${esc(r.invalidation)}</p>
      ${levels(r, p)}`}
    ${compact ? `<details><summary>Подробнее</summary>
      <div class="pcols">
        <div><h4>За</h4><ul>${r.positives.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h4>Риски</h4><ul>${r.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <p class="kv"><b>Что изменит оценку:</b> ${esc(r.timing)}</p>
      <p class="kv"><b>Идея не сработала, если:</b> ${esc(r.invalidation)}</p>
    </details>` : ""}
    <footer>
      <a class="btn primary sm" href="${esc(P.url(p))}" target="_blank" rel="noopener">${icon("external")}DexScreener</a>
      <button class="btn sm" data-action="pick-open" data-value="${esc(P.key(p))}">${icon("check")}Карточка токена</button>
      <button class="btn sm" data-action="copy" data-value="${esc(p.baseToken.address)}">${icon("doc")}Адрес</button>
      <span class="fine">${esc(MODELS.find((m) => m.id === r.model)?.title.split(":")[0] || r.model)} · ${ago(r.at)}</span>
    </footer>
  </article>`;
}

export const picksView = {
  title: "Подборка",
  subtitle: () => {
    const n = ai.results().filter((r) => r.verdict === "candidate").length;
    return ai.lastRun ? `Кандидатов: ${n} · последний анализ в ${fmt.time(ai.lastRun)}` : "Готовые идеи: рынок, сильные кошельки и анализ ИИ";
  },
  mount(el) {
    el.innerHTML = `<div class="picks" id="picksBody"></div>`;
  },
  update(el) {
    const cfg = ai.cfg();
    const k = keys.get();
    const profile = cfg.profile;
    const inProfile = (r) => profile === "all" || r.risk === profile;
    const fresh = (r) => Date.now() - r.at < CANDIDATE_TTL && !stale(r);
    const all = ai.results().filter(inProfile);
    const cand = all.filter((r) => r.verdict === "candidate" && r.confidence >= MIN_CONFIDENCE && fresh(r))
      .sort((a, b) => b.confidence - a.confidence || b.at - a.at);
    const rejected = all.filter((r) => !cand.includes(r)).sort((a, b) => b.at - a.at);
    ai.resetDay();

    const seg = [["all", "Любой риск"], ["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]];
    const smartN = smart.smartList().length;
    const followed = watchlist.all().length;

    let html = `
      <div class="picksbar">
        <div class="segmented" role="tablist" aria-label="Профиль риска">${seg.map(([v, t]) => `<button role="tab" aria-selected="${profile === v}" data-action="profile" data-value="${v}">${t}</button>`).join("")}</div>
        <button class="btn primary" data-action="ai-run" ${ai.running || !k.anthropic ? "disabled" : ""}>${ai.running ? '<span class="spinner sm"></span>Анализ…' : `${icon("sparkle")}Анализировать сейчас`}</button>
      </div>
      <div class="statusline">
        ${ai.running || ai.status ? `<span class="row">${ai.running ? '<span class="spinner sm"></span>' : ""}${esc(ai.status)}</span>` : ""}
        <span>ИИ сегодня: <b class="num">${ai.state.calls}</b> из ${cfg.dailyCalls} анализов · токены <b class="num">${fmtTokens(ai.state.inTok)}</b> вход / <b class="num">${fmtTokens(ai.state.outTok)}</b> выход</span>
        <span>Сильных кошельков: <b class="num">${smartN}</b> · отслеживается: <b class="num">${followed}</b>${smart.running ? ` · <span class="spinner sm"></span> ${esc(smart.status)}` : ""}</span>
      </div>`;

    if (!k.anthropic) {
      html += `<p class="notice">${icon("key")}<span>Чтобы ИИ сам искал и разбирал токены, добавь ключ Anthropic API в <a href="#settings">Настройках</a>. Ключ хранится только в этом браузере.${!k.helius && !k.etherscan ? " Для поиска сильных кошельков там же добавь ключи Helius и Etherscan." : ""}</span></p>`;
    }
    if (ai.error) html += `<p class="notice bad">${icon("bad", "bad")}<span>${esc(ai.error)}</span></p>`;
    if (smart.error) html += `<p class="notice bad">${icon("bad", "bad")}<span>Поиск кошельков: ${esc(smart.error)}</span></p>`;
    if (smart.notice) html += `<p class="notice">${icon("info")}<span>Поиск кошельков: ${esc(smart.notice)}</span></p>`;

    if (!store.pairs.length) {
      html += '<div class="empty"><span class="spinner"></span><p>Загружаю рынок…</p></div>';
    } else if (!all.length) {
      if (k.anthropic) {
        html += empty("Анализ ещё не готов", ai.running ? "ИИ разбирает первых кандидатов, это займёт до минуты." : "Анализ запускается после каждого обновления рынка, примерно раз в 5 минут. Можно запустить вручную кнопкой выше.");
      } else {
        const pend = ai.pending(profile).slice(0, 12);
        html += `<h3 class="sect">Кандидаты по стратегиям, без анализа ИИ</h3>
          <div class="tablescroll"><table class="grid"><thead><tr><th>Токен</th><th class="c-chain">Сеть</th><th class="r">1 ч</th><th class="r c-24">24 ч</th><th class="r c-liq">Ликвидность</th><th class="r c-age">Возраст</th></tr></thead>
          <tbody>${pend.map((p) => `<tr data-action="pick-open" data-value="${esc(P.key(p))}" tabindex="0">
            <td><div class="tok">${tokenIcon(p)}<div><b>${esc(P.symbol(p))}</b><span>${esc(P.name(p))}</span></div></div></td>
            <td class="c-chain">${chainBadge(p.chainId)}</td><td class="r">${change(P.change(p, "h1"))}</td><td class="r c-24">${change(P.change(p, "h24"))}</td>
            <td class="r num c-liq">${fmt.usd(P.liq(p))}</td><td class="r num c-age">${fmt.age(P.ageHours(p))}</td></tr>`).join("")}</tbody></table></div>`;
      }
    } else {
      html += `<p class="muted pad0">Разобрано за последние сутки: <b class="num">${all.length}</b> · прошли отбор: <b class="num">${cand.length}</b>. В подборке только сделки, которые ИИ счёл сильными (уверенность от ${MIN_CONFIDENCE}), не старше ${CANDIDATE_TTL / 3600e3} ч.</p>`;
      if (!cand.length) {
        html += empty("Сейчас сильных сделок нет", "ИИ разобрал рынок, но ни один токен не прошёл отбор под этот профиль риска. Это нормально: пустая подборка лучше слабых идей. Новые токены разбираются каждые несколько минут.");
      }
      for (const tier of ["high", "medium", "low"]) {
        const list = cand.filter((r) => r.risk === tier);
        if (!list.length) continue;
        html += `<h3 class="sect"><i class="dot ${TIERS[tier].cls}"></i>${TIERS[tier].title} <span class="muted num">${list.length}</span></h3><div class="pickgrid">${list.map(card).join("")}</div>`;
      }
      if (rejected.length) {
        html += `<details class="avoid"><summary><h3 class="sect">Отсеяно ИИ <span class="muted num">${rejected.length}</span></h3></summary>
          <ul class="rejected">${rejected.map((r) => {
            const p = ai.live(r);
            const why = r.verdict === "candidate" ? (r.confidence < MIN_CONFIDENCE ? "низкая уверенность" : "устарело") : VERDICT_UI[r.verdict].t.toLowerCase();
            return `<li data-action="pick-open" data-value="${esc(P.key(p))}" tabindex="0">${tokenIcon(p, 22)}<b>${esc(P.symbol(p))}</b>${chainBadge(p.chainId)}<span class="pill ${VERDICT_UI[r.verdict].cls}">${why}</span><span class="muted">${esc(r.headline)}</span></li>`;
          }).join("")}</ul></details>`;
      }
    }
    html += `<p class="fine pad0">Анализ ИИ основан на данных рынка и контрактов на момент разбора и не предсказывает цену. Уровни посчитаны по твоим правилам для категории риска, которую назначил ИИ.</p>`;

    const body = el.querySelector("#picksBody");
    const open = [...body.querySelectorAll("details")].map((d) => d.open);
    body.innerHTML = html;
    [...body.querySelectorAll("details")].forEach((d, i) => { if (open[i]) d.open = true; });
  },
};

export { chainById };
