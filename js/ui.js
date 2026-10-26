import { chainById, P, fmt } from "./engine.js?v=01c4dd2c";

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

export const ICONS = {
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
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
};
export const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

export function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2000);
}

export async function copyText(text, label = "Адрес скопирован") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast("Не удалось скопировать, выдели адрес вручную"); }
}

export const chainBadge = (id) => `<span class="chain" title="${esc(chainById(id)?.name || id)}">${esc(chainById(id)?.short || id)}</span>`;

export const change = (v) => `<span class="num ${v == null ? "muted" : v > 0 ? "good" : v < 0 ? "bad" : "muted"}">${fmt.pct(v)}</span>`;

export function tokenIcon(p, size = 28) {
  const url = safeUrl(p.info?.imageUrl);
  const letter = esc(P.symbol(p).slice(0, 1));
  return `<span class="tokicon" style="--s:${size}px">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<b>${letter}</b></span>`;
}

export function empty(title, text, actions = "") {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${actions}</div>`;
}
