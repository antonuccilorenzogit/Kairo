/* Kairo web app — vanilla JS, no build step.
 * Talks only to the Kairo server (/api/*). Secrets (access code, Groq key) stay in this
 * device's localStorage and are sent as headers on each request. */
"use strict";

const APP_VERSION = "1.15.1";
// Public repository (used for the update check and the "open source" links).
const GITHUB_REPO = "antonuccilorenzogit/Kairo";
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

/* ---------- storage (safe wrapper: storage can be unavailable) ---------- */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem("kairo." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kairo." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("kairo." + k); } catch {} },
};
const cfg = () => ({
  server: location.origin, // the app is always served by its own Kairo server
  code: store.get("code", ""),
  groqKey: store.get("groqKey", ""),
  groqModel: store.get("groqModel", ""),
  profilo: store.get("profilo", { nome: "", note: "" }),
});
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome"; } catch { return "Europe/Rome"; } };
const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: tz() }).format(new Date());
const shiftDay = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = (n, d = 0) => (n == null || !Number.isFinite(Number(n)) ? "–" : Number(n).toLocaleString("it-IT", { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtMin = (m) => (m == null ? "–" : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}`);
const fmtDate = (d, opts = { weekday: "long", day: "numeric", month: "long" }) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", opts);
const hhmm = (iso) => (iso ? iso.slice(11, 16) : "–");
const ago = (iso) => {
  if (!iso) return "mai";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "adesso"; if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h fa`;
  return `${Math.round(h / 24)} giorni fa`;
};
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
const state = (score) => (score == null ? { key: "off", label: "In calibrazione", cls: "muted", fill: "#C9CEDB" }
  : score >= 67 ? { key: "good", label: "Recuperato", cls: "good", fill: "#5DC796" }
  : score >= 34 ? { key: "mid", label: "Parziale", cls: "mid", fill: "#F7C65C" }
  : { key: "bad", label: "Basso", cls: "bad", fill: "#EE6352" });

/* ---------- API ---------- */
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(path, { method = "GET", body, raw = false } = {}) {
  const c = cfg();
  const headers = { "x-timezone": tz() };
  if (c.code) headers.authorization = `Bearer ${c.code}`;
  if (c.groqKey) headers["x-groq-key"] = c.groqKey;
  if (c.groqModel) headers["x-groq-model"] = c.groqModel;
  if (body) headers["content-type"] = "application/json";
  let res;
  try { res = await fetch(c.server.replace(/\/$/, "") + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new ApiError("Server non raggiungibile. Controlla la connessione o l'indirizzo del server.", 0); }
  if (raw) return res;
  if (!(res.headers.get("content-type") || "").includes("application/json")) {
    throw new ApiError(`Il server ha risposto in modo inatteso (errore ${res.status}). Ricarica la pagina; se continua apri la Diagnostica.`, res.status);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/info") { route("accesso"); throw new ApiError(data.errore || "Codice non valido", 401); }
  if (res.status === 429) throw new ApiError(data.errore || "Troppi tentativi: riprova più tardi.", 429);
  if (!res.ok) throw new ApiError(data.errore || `Errore ${res.status}`, res.status);
  return data;
}

/* ---------- icons ---------- */
const ico = {
  oggi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 17a8 8 0 0 1 16 0"/><path d="M2 17h20M12 4v3M5 8l2 2M19 8l-2 2"/></svg>',
  recupero: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
  sonno: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  palestra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  corpo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 8v7M7 10.5l5-2 5 2M9 21l3-6 3 6"/></svg>',
  coach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9AA0AD" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA0AD" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  arrow: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  sun: (w = 52) => `<svg width="${w}" height="${Math.round(w * 0.77)}" viewBox="0 0 220 170" aria-hidden="true"><path d="M 50 120 A 60 60 0 0 1 170 120 Z" fill="#FF8A1F"/><path d="M 110 22 L 110 42 M 52 50 L 64 64 M 168 50 L 156 64 M 22 96 L 40 100 M 198 96 L 180 100" stroke="#FF8A1F" stroke-width="12" stroke-linecap="round"/><path d="M 20 140 L 200 140" stroke="#1C2340" stroke-width="12" stroke-linecap="round"/></svg>`,
};

/* Bean, the battery mascot: fills with the recovery score. */
let beanId = 0;
function bean(score, size = 150) {
  const id = "bean" + beanId++;
  const st = state(score);
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const h = Math.round(120 * pct / 100);
  const face = score == null
    ? '<circle cx="63" cy="88" r="5" fill="#1C2340"/><circle cx="87" cy="88" r="5" fill="#1C2340"/><path d="M 66 104 L 84 104" stroke="#1C2340" stroke-width="4" stroke-linecap="round"/>'
    : st.key === "good"
      ? '<circle cx="63" cy="88" r="5.5" fill="#1C2340"/><circle cx="87" cy="88" r="5.5" fill="#1C2340"/><path d="M 64 102 Q 75 112 86 102" fill="none" stroke="#1C2340" stroke-width="4" stroke-linecap="round"/>'
      : st.key === "mid"
        ? '<circle cx="63" cy="88" r="5.5" fill="#1C2340"/><circle cx="87" cy="88" r="5.5" fill="#1C2340"/><path d="M 66 104 L 84 104" stroke="#1C2340" stroke-width="4" stroke-linecap="round"/>'
        : '<path d="M 56 88 Q 63 94 70 88 M 80 88 Q 87 94 94 88" fill="none" stroke="#1C2340" stroke-width="4" stroke-linecap="round"/><path d="M 66 108 Q 75 100 84 108" fill="none" stroke="#1C2340" stroke-width="4" stroke-linecap="round"/>';
  const arms = st.key === "good"
    ? '<path d="M 36 96 Q 20 92 18 76" fill="none" stroke="#1C2340" stroke-width="7" stroke-linecap="round"/><path d="M 114 92 Q 132 82 128 62" fill="none" stroke="#1C2340" stroke-width="7" stroke-linecap="round"/><path d="M 128 34 L 134 22 M 136 46 L 148 42 M 132 58 L 144 62" stroke="#FFB547" stroke-width="5" stroke-linecap="round"/>'
    : '<path d="M 36 96 Q 22 100 22 116" fill="none" stroke="#1C2340" stroke-width="7" stroke-linecap="round"/><path d="M 114 96 Q 128 100 128 116" fill="none" stroke="#1C2340" stroke-width="7" stroke-linecap="round"/>';
  return `<svg width="${size}" height="${Math.round(size * 1.2)}" viewBox="0 0 150 180" role="img" aria-label="Bean, carica ${score == null ? "in calibrazione" : score + " su 100"}">
    <defs><clipPath id="${id}"><rect x="35" y="26" width="80" height="120" rx="34"/></clipPath></defs>
    <ellipse cx="75" cy="170" rx="44" ry="6" fill="#EFE9DF"/>
    <rect x="60" y="10" width="30" height="18" rx="7" fill="#1C2340"/>
    <rect x="35" y="26" width="80" height="120" rx="34" fill="#E9ECF2"/>
    <rect x="35" y="${146 - h}" width="80" height="${h}" fill="${st.fill}" clip-path="url(#${id})"/>
    ${arms}
    <rect x="54" y="144" width="13" height="18" rx="6" fill="#1C2340"/><rect x="83" y="144" width="13" height="18" rx="6" fill="#1C2340"/>
    ${face}</svg>`;
}

/* ---------- layout ---------- */
const TABS = [["oggi", "Oggi"], ["palestra", "Palestra"], ["sonno", "Sonno"], ["corpo", "Corpo"], ["coach", "Coach"]];
function renderTabs(active) {
  const nav = $("#tabbar");
  if (!active) { nav.hidden = true; return; }
  nav.hidden = false;
  nav.innerHTML = TABS.map(([k, l]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ""}>${ico[k]}${l}</a>`).join("");
}
function header(title, { back = null, gear = true, sub = "", sync = false } = {}) {
  return `<div class="row between">
    <div class="row">${back ? `<a class="iconbtn" href="#/${back}" aria-label="Indietro">${ico.back}</a>` : ""}<div class="col" style="gap:2px"><h1 class="title">${title}</h1>${sub ? `<div class="muted">${sub}</div>` : ""}</div></div>
    <div class="row" style="gap:8px">${sync ? `<a class="iconbtn" href="shortcuts://run-shortcut?name=HealthSync" id="syncNow" aria-label="Aggiorna i dati (HealthSync)" style="color:var(--ink);font-size:22px;font-weight:800;text-decoration:none">↻</a>` : ""}${gear ? `<a class="iconbtn" href="#/impostazioni" aria-label="Impostazioni" style="color:var(--ink)">${ico.gear}</a>` : ""}</div></div>`;
}
const loading = (n = 3) => Array.from({ length: n }, () => '<div class="card"><div class="skeleton" style="height:80px"></div></div>').join("");
const errorCard = (e) => `<div class="card"><div class="h2">Qualcosa non va</div><p class="muted">${esc(e.message || e)}</p><a class="btn ghost" href="#/diagnostica">Controlla lo stato di Kairo</a></div>`;

/* ---------- sheet (bottom panel) ---------- */
function openSheet(html, label = "Dettagli") {
  closeSheet();
  const w = document.createElement("div");
  w.className = "sheet-wrap"; w.id = "sheet";
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="grab"></div>${html}</div>`;
  w.addEventListener("click", (e) => { if (e.target === w || e.target.closest("[data-close]")) closeSheet(); });
  document.body.appendChild(w);
  document.addEventListener("keydown", escClose);
  const f = w.querySelector("button, a, input"); if (f) f.focus();
  return w;
}
function escClose(e) { if (e.key === "Escape") closeSheet(); }
function closeSheet() { const s = $("#sheet"); if (s) s.remove(); document.removeEventListener("keydown", escClose); }
const sheetHead = (t) => `<div class="row between"><div class="h2">${t}</div><button class="iconbtn" data-close aria-label="Chiudi">${ico.close}</button></div>`;

/* ---------- views ---------- */
const views = {};

let watchSyncReturn = false;
views.oggi = async (el) => {
  const p = store.get("profilo", null) || (await loadProfile());
  el.innerHTML = `${header(`Ciao${p.nome ? ",<br>" + esc(p.nome) : ""}`, { sub: fmtDate(todayStr()) })}${loading(3)}`;
  const hist = await api("/api/history?days=2");
  const d = hist[hist.length - 1], y = hist[0];
  const r = d.recupero, st = state(r.score), c = d.carico || {}, cs = c.consiglio, sn = d.sonno_stanotte;
  const delta = r.score != null && y.recupero.score != null ? r.score - y.recupero.score : null;
  const hour = new Date().getHours();
  const STATO = { calibrazione: ["In calibrazione", "muted"], scarico: ["Sotto il tuo solito", "mid"], mantenimento: ["Stai mantenendo", "good"], costruzione: ["Stai costruendo", "good"], attenzione: ["Carico alto", "mid"], eccesso: ["Troppo carico", "bad"] };
  const [stLabel, stCls] = STATO[c.stato] || STATO.calibrazione;
  const sleepNow = d.sonno ? `${fmtMin(d.sonno.durata_min)}${d.sonno.manuale ? " (dichiarate)" : ` · ${d.sonno.punteggio} punti`}` : null;
  const monday = new Date().getDay() === 1;
  // no check-in yet today: only the invitation. The coach writes today's texts once, after the check-in.
  if (!d.checkin) {
    el.innerHTML = `${header(`Ciao${p.nome ? ",<br>" + esc(p.nome) : ""}`, { sub: fmtDate(d.giorno), sync: true })}
      <div class="col today">
      <div class="card col center" style="gap:12px;padding:26px 20px">${bean(null, 70)}
        <div class="h2">Prima il check-in</div>
        <div class="small" style="line-height:1.5;color:var(--text);max-width:300px">Com'è andata ieri e come ti senti: 10 secondi. Poi vedi recupero, sonno e cosa fare oggi, con il consiglio del coach scritto su misura.</div>
        <button class="btn orange block" data-checkin style="min-height:52px;border-radius:18px;justify-content:center"><b>Fai il check-in</b>${ico.arrow}</button>
        <button class="small muted" id="skipCk" style="background:none;border:0;cursor:pointer;text-decoration:underline">Oggi salto il check-in</button></div>
      <a class="card row between" href="#/settimana"><span style="font-weight:800">La tua settimana</span>${ico.chevron}</a>
      </div>`;
    el.querySelectorAll("[data-checkin]").forEach((b) => b.addEventListener("click", () => checkinSheet(null, !d.sonno || d.sonno.manuale, y.attivita.sessioni || [])));
    $("#skipCk").onclick = async () => { try { await api("/api/checkin", { method: "POST", body: { day: todayStr() } }); router(); } catch (e) { toast(e.message); } };
    $("#syncNow").onclick = () => { const back = () => { if (document.visibilityState !== "visible") return; document.removeEventListener("visibilitychange", back); setTimeout(() => router(), 1500); }; document.addEventListener("visibilitychange", back); };
    return;
  }
  // right after waking up the Watch has not processed the sleep stages yet: offer a new sync (runs HealthSync)
  const nightPending = hour < 12 && (!d.sonno || (!d.sonno.manuale && d.sonno.fasi_min && (d.sonno.fasi_min.profondo || 0) + (d.sonno.fasi_min.rem || 0) === 0));
  watchSyncReturn = false;
  if (nightPending) {
    const back = () => { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", back); if (location.hash.replace(/^#\/?/, "").startsWith("oggi") || !location.hash) router(); } };
    document.addEventListener("visibilitychange", back);
  }
  const clamp = (n) => `display:-webkit-box;-webkit-line-clamp:${n};-webkit-box-orient:vertical;overflow:hidden`;
  el.innerHTML = `${header(`Ciao${p.nome ? ",<br>" + esc(p.nome) : ""}`, { sub: fmtDate(d.giorno), sync: true })}
    <div class="col today">
    ${d.allarme ? `<div class="card col" style="background:#FDE2DF;gap:4px"><div style="font-weight:900;color:var(--red-ink)">⚠︎ ${esc(d.allarme.titolo)}</div><div class="small" style="line-height:1.45">${esc(d.allarme.testo)}</div></div>` : ""}
    <a class="card row" href="#/recupero" style="gap:12px">
      ${bean(r.score, 54)}
      <div class="col" style="gap:2px;flex:1">${r.score == null
        ? `<div class="h2">In calibrazione</div><div class="muted small">Servono 5 notti con il Watch (ne ho ${r.giorni_baseline}): basta aspettare.</div>`
        : `<div class="row" style="gap:8px;align-items:baseline"><span style="font-size:34px;font-weight:900;line-height:1">${r.score}</span><span class="h2 ${st.cls}">${st.label}</span></div>
           <div class="muted small">Recupero${delta != null ? ` · ${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} da ieri` : ""}${r.affidabilita === "bassa" ? ` · <span class="mid">precisione bassa</span>` : ""}</div>`}</div>${ico.chevron}</a>
    <button class="card col" id="workout" style="gap:6px;border:0;text-align:left;cursor:pointer;width:100%;font:inherit;color:inherit"><div class="label">${p.infortunio?.attivo ? "Infortunio · cosa fare oggi" : "Allenamento di oggi"}</div>
      <div class="skeleton" style="height:22px;width:60%"></div><div class="skeleton" style="height:16px;width:85%"></div></button>
    <a class="card row between" href="${nightPending ? "shortcuts://run-shortcut?name=HealthSync" : "#/sonno"}" style="gap:12px">
      <div class="col" style="gap:2px;min-width:0"><div style="font-weight:800">${nightPending ? "Il Watch sta elaborando la notte" : sleepNow ? `Sonno · ${sleepNow}` : "Sonno non registrato"}</div>
        ${nightPending ? `<div class="small" style="color:var(--orange-ink);font-weight:700">Tocca per aggiornare i dati${sleepNow ? ` (ora: ${sleepNow})` : ""}</div>`
          : sn && sn.a_letto && hour >= 15 ? `<div class="small" style="color:var(--orange-ink);font-weight:700">${bedPassed(sn.a_letto) ? `È ora di andare a letto: stanotte ti servono ${fmtMin(sn.fabbisogno_min)}` : `Stasera a letto entro le ${sn.a_letto} (${fmtMin(sn.fabbisogno_min)})`}</div>` : !d.sonno ? `<div class="small muted">Senza Watch? Segna le ore nel check-in</div>` : ""}</div>${ico.chevron}</a>
    <button class="card soft row" id="coachCard" style="gap:12px;border:0;text-align:left;cursor:pointer;width:100%;font:inherit;color:inherit">
      <div class="col" style="gap:4px;flex:1;min-width:0"><div class="label">Il coach</div><div id="advice" class="small" style="color:var(--text);line-height:1.45;${clamp(3)}"><div class="skeleton" style="width:90%"></div></div></div>${ico.chevron}</button>
    ${d.checkin
      ? `<button class="card row between" data-checkin style="border:0;text-align:left;cursor:pointer;font:inherit;color:inherit;width:100%"><span style="font-weight:800">${d.checkin.energia == null && d.checkin.attivita == null ? "Check-in saltato" : `Check-in fatto <span class="good">✓</span>`}</span><span class="small muted">${d.checkin.energia == null && d.checkin.attivita == null ? "fallo ora" : "modifica"}</span></button>`
      : `<button class="btn orange block" data-checkin style="justify-content:space-between;min-height:52px;border-radius:18px"><span><b>Check-in del mattino</b> <span class="small" style="font-weight:600">· 10 secondi</span></span>${ico.arrow}</button>`}
    <a class="card row between" href="#/settimana" style="${monday ? "background:var(--soft)" : ""}"><span style="font-weight:800">La tua settimana${monday ? ` <span class="small" style="color:var(--orange-ink)">· resoconto pronto</span>` : ""}</span>${ico.chevron}</a>
    </div>`;
  // ↻ runs HealthSync in Comandi; back in Kairo, reload the page with the new data
  $("#syncNow").onclick = () => {
    if (watchSyncReturn) return; watchSyncReturn = true;
    const back = () => { if (document.visibilityState !== "visible") return; document.removeEventListener("visibilitychange", back); watchSyncReturn = false; setTimeout(() => router(), 1500); };
    document.addEventListener("visibilitychange", back);
  };
  el.querySelectorAll("[data-checkin]").forEach((b) => b.addEventListener("click", () => checkinSheet(d.checkin, !d.sonno || d.sonno.manuale, y.attivita.sessioni || [])));
  todayLoad = [stLabel, stCls];
  loadWorkout(false);
  // the advice arrives asynchronously so the page is usable immediately; tapping it shows the whole message
  todayAdvice = "";
  $("#coachCard").onclick = () => adviceSheet();
  loadAdvice();
};

// Coach's message of the day: 3 lines on Oggi, the whole message in a sheet
let todayAdvice = "";
function loadAdvice() {
  return api("/api/coach/oggi", { method: "POST", body: {} })
    .then((a) => { todayAdvice = a.notte_in_attesa ? "Scrivo il messaggio di oggi appena arrivano i dati completi della notte: il Watch li elabora qualche minuto dopo la sveglia. Tocca **↻** in alto per aggiornare." : a.errore || a.testo || ""; const box = $("#advice"); if (box) box.innerHTML = md(todayAdvice); })
    .catch((e) => { const box = $("#advice"); if (box) box.textContent = e.message; });
}
function adviceSheet() {
  openSheet(`${sheetHead("Il coach di oggi")}
    <div class="md" style="line-height:1.6">${todayAdvice ? md(todayAdvice) : '<div class="skeleton" style="height:60px"></div>'}</div>
    <a class="btn primary" href="#/coach">Parla con il coach</a>`, "Il coach");
  if (!todayAdvice) loadAdvice().then(() => { if ($("#sheet") && todayAdvice) adviceSheet(); });
}
// "22:09" already passed this evening? (after midnight counts as passed until the morning)
function bedPassed(hhmm) {
  const [h, m] = hhmm.split(":").map(Number), now = new Date(), cur = now.getHours() * 60 + now.getMinutes(), bed = h * 60 + m;
  return bed >= 12 * 60 ? cur >= bed || cur < 6 * 60 : cur >= bed && cur < 6 * 60;
}

// Today's workout: a compact card on Oggi (what, how long, how hard), details in a sheet on tap
const SPORT = { palestra: "Palestra", nuoto: "Nuoto", bici: "Bici", corsa: "Corsa" };
const INT_LABEL = { leggero: ["Leggero", "good"], medio: ["Medio", "mid"], intenso: ["Intenso", "bad"] };
const MOD_LABEL = { riposo: ["Riposo", "bad"], "resto del corpo": ["Resto del corpo", "mid"], riabilitazione: ["Riabilitazione", "good"] };
let todayLoad = ["", "muted"], todayWorkout = null;

async function fetchWorkout(body) { return (todayWorkout = await api("/api/allenamento/oggi", { method: "POST", body })); }

async function loadWorkout(force, escludi, extra) {
  const box = $("#workout"); if (!box) return;
  let w;
  try { w = await fetchWorkout(extra || (force ? { altro: !!escludi, escludi, forza: true } : {})); }
  catch (e) { if ($("#workout")) $("#workout").innerHTML = `<div class="label">Allenamento di oggi</div><div class="small bad">${esc(e.message)}</div>`; return; }
  renderWorkoutCard(w);
}

// after the night is complete Kairo writes today's plan: until then, offer a new sync
function syncAndReload() {
  const back = () => { if (document.visibilityState !== "visible") return; document.removeEventListener("visibilitychange", back); setTimeout(() => router(), 1500); };
  document.addEventListener("visibilitychange", back);
  location.href = "shortcuts://run-shortcut?name=HealthSync";
}
function renderWorkoutCard(w) {
  const box = $("#workout"); if (!box) return;
  if (w.notte_in_attesa) {
    box.innerHTML = `<div class="label">${w.infortunio ? "Infortunio · cosa fare oggi" : "Allenamento di oggi"}</div><div class="row between" style="gap:10px"><div class="col" style="gap:4px;flex:1"><div class="h2">Aspetto la notte completa</div><div class="small" style="color:var(--orange-ink);font-weight:700">Il Watch sta elaborando il sonno · tocca per aggiornare</div></div>${ico.chevron}</div>`;
    box.onclick = syncAndReload;
    return;
  }
  // title on up to two lines, then one line with sport · duration · intensity
  const line = (label, title, meta) => `<div class="label">${label}</div><div class="row between" style="gap:10px"><div class="col" style="gap:4px;min-width:0;flex:1">
      <div class="h2" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${title}</div><div class="small muted">${meta}</div></div>${ico.chevron}</div>`;
  if (w.infortunio) {
    const [ml, mc] = MOD_LABEL[w.modalita] || ["", "muted"];
    box.innerHTML = line("Infortunio · cosa fare oggi", esc(w.titolo),
      w.dolore == null ? `<b class="${mc}">${ml}</b> · <span style="color:var(--orange-ink);font-weight:800">tocca per segnare il dolore</span>`
        : `<b class="${mc}">${ml}</b> · dolore ${w.dolore}/10${w.giorni != null ? ` · giorno ${w.giorni + 1}` : ""}`);
  } else {
    const [il, ic] = INT_LABEL[w.intensita] || ["", "muted"];
    const es = w.esito ? (w.esito.stato === "saltato" ? ` · <b class="muted">saltato</b>` : ` · <b class="good">✓ fatto${w.esito.stato === "altro" && w.esito.sport ? ` (${esc(w.esito.sport)})` : ""}</b>`) : "";
    box.innerHTML = line("Allenamento di oggi", esc(w.titolo), `${esc(SPORT[w.sport])} · ${w.durata_min} min · <b class="${ic}">${il}</b>${w.scheda ? ` · ${esc(w.scheda)}` : ""}${es}`);
  }
  box.onclick = () => (w.infortunio ? injuryDetail(w) : workoutDetail(w));
}

const steps = (w) => `<div class="col" style="gap:10px">${w.struttura.map((x) => `<div class="small" style="line-height:1.5"><b>${esc(x.fase)}</b><br>${esc(x.dettaglio)}</div>`).join("")}</div>`;
const sheetBusy = () => { const s = $("#sheet .sheet"); if (s) s.style.opacity = ".5"; };

function workoutDetail(w) {
  const [il, ic] = INT_LABEL[w.intensita] || ["", "muted"];
  openSheet(`${sheetHead(esc(w.titolo))}
    <div class="row" style="gap:8px;flex-wrap:wrap"><span class="pill ${ic}">${il}</span><span class="small muted">${esc(SPORT[w.sport])} · ${w.durata_min} min circa${w.scheda ? ` · <b style="color:var(--ink)">${esc(w.scheda)}</b>` : ""}</span></div>
    ${steps(w)}
    ${w.zone ? `<div class="card soft col" style="gap:4px;padding:10px 12px"><div class="small" style="font-weight:800">Le tue zone di frequenza cardiaca</div><div class="small" style="line-height:1.6">${w.zone.map((z) => `<span style="white-space:nowrap">Z${z.z} <b>${z.min}–${z.max}</b></span>`).join(" · ")} bpm</div></div>` : ""}
    <div class="small muted" style="line-height:1.5">${esc(w.perche)}</div>
    <div class="col" style="gap:6px"><div class="small" style="font-weight:800">${w.esito ? (w.esito.stato === "saltato" ? "Oggi: saltato" : `Oggi: fatto ✓${w.esito.sport ? ` · ${esc(w.esito.sport)}` : ""}`) + ` <span class="muted" style="font-weight:600">· puoi cambiarlo</span>` : "Com'è andata?"}</div>
      <div class="acts" style="grid-template-columns:repeat(3,minmax(0,1fr))"><button class="choice" data-esito="fatto">Fatto ✓</button><button class="choice" data-esito="altro">Fatto altro</button><button class="choice" data-esito="saltato">Saltato</button></div>
      <div class="acts" id="altroBox" style="grid-template-columns:repeat(3,minmax(0,1fr));display:none">${["palestra", "nuoto", "bici", "corsa", "calcio", "camminata"].map((k) => `<button class="choice" data-altro="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div></div>
    ${todayLoad[0] ? `<button id="wLoad" class="row between" style="background:none;border:0;border-top:1px solid var(--line);padding:12px 0 0;cursor:pointer;font:inherit;color:inherit;width:100%"><span class="small">Carico di allenamento: <b class="${todayLoad[1]}">${todayLoad[0]}</b></span>${ico.chevron}</button>` : ""}
    <div class="row" style="gap:8px">${w.sport === "palestra" && w.scheda ? `<button class="btn primary" id="wStart" style="flex:2;min-height:48px">Inizia ${esc(w.scheda)}</button>` : ""}<button class="btn ghost" id="wOther" style="flex:1;min-height:48px">Altra proposta</button></div>
    <button class="small muted" id="wHurt" style="background:none;border:0;cursor:pointer;padding:0;text-decoration:underline">Ti sei fatto male? Attiva la modalità infortunio</button>`, "Allenamento di oggi");
  const wl = $("#wLoad"); if (wl) wl.onclick = () => loadSheet();
  const saveEsito = async (stato, sport) => {
    try { const r = await api("/api/allenamento/esito", { method: "POST", body: { stato, sport } }); w.esito = { stato: r.stato, sport: r.sport }; todayWorkout = w; renderWorkoutCard(w); workoutDetail(w); toast(stato === "saltato" ? "Segnato: saltato" : "Segnato ✓"); }
    catch (e) { toast(e.message); }
  };
  $("#sheet").querySelectorAll("[data-esito]").forEach((b) => (b.onclick = () => (b.dataset.esito === "altro" ? ($("#altroBox").style.display = "") : saveEsito(b.dataset.esito, w.sport))));
  $("#sheet").querySelectorAll("[data-altro]").forEach((b) => (b.onclick = () => saveEsito("altro", b.dataset.altro)));
  $("#wOther").onclick = async () => {
    sheetBusy();
    try { const n = await fetchWorkout({ altro: true, escludi: w.sport, forza: true }); renderWorkoutCard(n); workoutDetail(n); } catch (e) { toast(e.message); closeSheet(); }
  };
  $("#wHurt").onclick = () => injurySheet();
  const st = $("#wStart"); if (st) st.onclick = async () => { const { schede } = await api("/api/schede"); const sc = schede.find((x) => x.nome === w.scheda); if (sc) { closeSheet(); startSession(sc); } };
}

function injuryDetail(w) {
  const [ml, mc] = MOD_LABEL[w.modalita] || ["", "muted"];
  openSheet(`${sheetHead(esc(w.titolo))}
    <div class="col" style="gap:6px"><div class="small" style="font-weight:800">Quanto ti fa male oggi? <span class="muted" style="font-weight:600">0 = niente · 10 = fortissimo</span></div>
      <div class="pain">${Array.from({ length: 11 }, (_, i) => `<button class="choice" data-pain="${i}" aria-pressed="${w.dolore === i}">${i}</button>`).join("")}</div>
      ${w.dolore == null ? `<div class="small muted">Segna il dolore: il coach adatta il piano di oggi.</div>` : ""}</div>
    <div class="row" style="gap:8px;flex-wrap:wrap"><span class="pill ${mc}">${ml}</span><span class="small muted">${w.durata_min} min circa${w.giorni != null ? ` · giorno ${w.giorni + 1} dall'infortunio` : ""}</span></div>
    ${steps(w)}
    <div class="small muted" style="line-height:1.5">${esc(w.perche)}</div>
    ${w.vincoli?.length ? `<div class="card soft col" style="gap:4px;padding:10px 12px"><div class="small" style="font-weight:800">Indicazioni del medico rispettate</div>${w.vincoli.map((x) => `<div class="small" style="line-height:1.4">✓ ${esc(x)}</div>`).join("")}</div>` : ""}
    <div class="warnbox">${esc(w.attenzione)}</div>
    <div class="row" style="gap:8px"><button class="btn ghost" id="injEdit" style="flex:1;min-height:48px">Modifica infortunio</button><button class="btn primary" id="injOff" style="flex:1;min-height:48px">Sono guarito</button></div>`, "Infortunio");
  $("#sheet").querySelectorAll("[data-pain]").forEach((b) => (b.onclick = async () => {
    sheetBusy();
    try { const n = await fetchWorkout({ dolore: Number(b.dataset.pain) }); renderWorkoutCard(n); injuryDetail(n); } catch (e) { toast(e.message); closeSheet(); return; }
    loadAdvice();
  }));
  $("#injEdit").onclick = () => injurySheet();
  $("#injOff").onclick = async () => {
    try { const saved = await api("/api/infortunio", { method: "POST", body: { attivo: false } }); store.set("profilo", saved); toast("Bentornato! Si riparte con calma"); router(); }
    catch (e) { toast(e.message); }
  };
}

// Describe the injury and the doctor's prescriptions (absolute constraints for the coach)
async function injurySheet() {
  const today = todayStr();
  let data = { infortunio: {}, vincoli: {} };
  try { data = await api("/api/infortunio"); } catch (_) {}
  const cur = data.infortunio || {}, v = data.vincoli || {}, rx = cur.prescrizioni || {};
  const tog = (id, on, label) => `<button type="button" class="choice" id="${id}" aria-pressed="${!!on}" style="text-align:left;padding:0 14px;font-size:15px">${label}</button>`;
  openSheet(`${sheetHead(cur.attivo ? "Il tuo infortunio" : "Modalità infortunio")}
    <div class="small" style="line-height:1.5;color:var(--text)">Finché è attiva, il coach non ti propone allenamenti normali: ogni giorno ti dice se riposare, quali esercizi riabilitativi fare o come allenare il resto del corpo.</div>
    <label class="field">Che infortunio hai?<textarea class="input" id="injD" rows="4" maxlength="1000" style="padding:12px;min-height:110px" placeholder="Es. distorsione alla caviglia destra giocando a calcio, è un po' gonfia, appoggio il piede ma fa male girare.">${esc(cur.descrizione || "")}</textarea><span class="hint">Dove, come è successo, cosa fa male, eventuale intervento.</span></label>
    <label class="field">Da quando<input class="input" id="injDal" type="date" max="${today}" value="${esc(cur.dal || today)}"></label>
    <div class="col" style="gap:10px"><div class="h2" style="font-size:17px">Indicazioni del medico</div>
      <div class="small muted" style="line-height:1.45">Sono <b>vincoli assoluti</b>: il coach non propone mai niente che li superi, e se l'IA sbaglia il piano viene scartato. Se le hai scritte sopra, Kairo le ha già riconosciute: controlla.</div>
      ${tog("rxLoad", v.no_carico, "🚫 Non posso caricare la parte infortunata")}
      <label class="field" id="rxFinoBox" style="${v.no_carico ? "" : "display:none"}">Senza carico fino al<input class="input" id="rxFino" type="date" value="${esc(v.fino || "")}"></label>
      ${tog("rxCrutch", v.stampelle, "🦯 Uso le stampelle")}
      <label class="field">Movimento massimo (gradi)<input class="input" id="rxDeg" type="number" inputmode="numeric" min="0" max="180" placeholder="es. 90 per la flessione del ginocchio" value="${v.gradi ?? ""}"></label>
      <label class="field">Altre indicazioni<textarea class="input" id="rxOther" rows="2" maxlength="500" style="padding:12px;min-height:64px" placeholder="Es. niente nuoto a rana per 2 mesi, tutore di notte">${esc(rx.altre || "")}</textarea></label></div>
    <button class="btn primary" id="injSave">${cur.attivo ? "Salva" : "Attiva modalità infortunio"}</button>`, "Infortunio");
  const press = (id) => { const b = $("#" + id); b.dataset.touched = "1"; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); };
  $("#rxLoad").onclick = () => { press("rxLoad"); $("#rxFinoBox").style.display = $("#rxLoad").getAttribute("aria-pressed") === "true" ? "" : "none"; };
  $("#rxCrutch").onclick = () => press("rxCrutch");
  $("#injSave").onclick = async () => {
    const descrizione = $("#injD").value.trim();
    if (descrizione.length < 3) { toast("Descrivi in breve l'infortunio"); return; }
    // untouched switches stay "not set" (null): Kairo keeps reading them from the description
    const val = (id, stored) => ($("#" + id).dataset.touched ? $("#" + id).getAttribute("aria-pressed") === "true" : stored ?? null);
    const deg = $("#rxDeg").value.trim(), fino = $("#rxFino").value;
    const prescrizioni = { no_carico: val("rxLoad", rx.no_carico), stampelle: val("rxCrutch", rx.stampelle),
      gradi: deg === String(v.gradi ?? "") ? rx.gradi ?? null : deg === "" ? null : Number(deg),
      fino: fino && fino !== v.fino ? fino : rx.fino || "", altre: $("#rxOther").value.trim() };
    try { const saved = await api("/api/infortunio", { method: "POST", body: { attivo: true, descrizione, dal: $("#injDal").value, prescrizioni } }); store.set("profilo", saved); closeSheet(); router(); }
    catch (e) { toast(e.message); }
  };
}

// Training load: last 28 days and how to read it
async function loadSheet() {
  const w = openSheet(`${sheetHead("Carico di allenamento")}<div class="skeleton" style="height:120px"></div>`, "Carico");
  let h;
  try { h = await api("/api/history?days=28"); } catch (e) { w.querySelector(".sheet").innerHTML = `<div class="grab"></div>${sheetHead("Carico di allenamento")}<div class="bad">${esc(e.message)}</div>`; return; }
  const c = h[h.length - 1].carico || {};
  const max = Math.max(1, ...h.map((d) => d.carico?.oggi || 0));
  const bars = h.map((d) => { const v = d.carico?.oggi; return `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:90px" title="${d.giorno}: ${v ?? "n/d"}"><div style="height:${v == null ? 2 : Math.max(3, (v / max) * 90)}px;background:${v == null ? "#E2E5EC" : d.giorno === h[h.length - 1].giorno ? "var(--orange)" : "#7DB7F0"};border-radius:3px"></div></div>`; }).join("");
  w.querySelector(".sheet").innerHTML = `<div class="grab"></div>${sheetHead("Carico di allenamento")}
    <div class="card col" style="gap:6px"><div class="row" style="gap:2px;align-items:flex-end">${bars}</div><div class="row between small muted"><span>${fmtDate(h[0].giorno, { day: "numeric", month: "short" })}</span><span>oggi</span></div></div>
    <div class="grid3"><div class="mini" style="cursor:default"><span class="label">7 giorni</span><span class="big">${c.acuto ?? "–"}</span><span class="small muted">media al giorno</span></div>
      <div class="mini" style="cursor:default"><span class="label">28 giorni</span><span class="big">${c.cronico ?? "–"}</span><span class="small muted">il tuo solito</span></div>
      <div class="mini" style="cursor:default"><span class="label">Rapporto</span><span class="big">${c.rapporto != null ? fmtNum(c.rapporto, 2) : "–"}</span><span class="small muted">ideale 0,8–1,3</span></div></div>
    <div style="line-height:1.55;color:var(--text)">Il <b>carico</b> misura quanto hai fatto lavorare il corpo: minuti passati nelle zone di frequenza cardiaca, pesati per l'intensità (TRIMP di Edwards). Per la palestra, dove il battito sottostima la fatica, Kairo usa anche la fatica percepita × la durata del check-in (session-RPE di Foster).</div>
    <div style="line-height:1.55;color:var(--text)">Il <b>rapporto</b> confronta l'ultima settimana con le ultime 4: tra 0,8 e 1,3 stai migliorando in sicurezza; sopra 1,5 il rischio di infortuni e sovrallenamento sale (Gabbett 2016); sotto 0,8 stai perdendo forma o scaricando.</div>
    <div class="small muted">FC massima usata: ${c.fc_max ?? "–"} bpm (stimata dall'età con la formula di Tanaka, oppure quella che imposti nel profilo).</div>`;
}

// Profile lives on the server (same on every device); a copy is kept here for offline use.
async function loadProfile() {
  try {
    const srv = await api("/api/profilo");
    const local = store.get("profilo", null);
    // one-time move of a profile saved only on this device
    if (local && (local.nome || local.obiettivi || local.note || local.eta) && !srv.nome && !srv.obiettivi && !srv.note && !srv.eta) {
      const saved = await api("/api/profilo", { method: "POST", body: { ...srv, ...local, tz: tz() } });
      store.set("profilo", saved); return saved;
    }
    store.set("profilo", srv); return srv;
  } catch { return cfg().profilo; }
}
function profiloText() {
  const p = cfg().profilo;
  return [p.nome ? `Si chiama ${p.nome}.` : "", p.eta ? `Ha ${p.eta} anni.` : "", p.sesso ? (p.sesso === "F" ? "È una donna." : "È un uomo.") : "", p.note ? `Di sé dice: ${p.note}` : "", p.obiettivi ? `I suoi obiettivi: ${p.obiettivi}` : "Non ha ancora indicato i suoi obiettivi."].filter(Boolean).join("\n");
}
// minimal, safe markdown for coach messages: **bold**, *italic*, bullet lists, paragraphs
function md(text) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  const out = []; let list = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    const m = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) { if (!list) { list = []; out.push(list); } list.push(inline(m[1])); continue; }
    list = null;
    if (!line) continue;
    out.push(inline(line.replace(/^#+\s*/, "")));
  }
  return out.map((b) => (Array.isArray(b) ? `<ul>${b.map((i) => `<li>${i}</li>`).join("")}</ul>` : `<p>${b}</p>`)).join("");
}

/* explanation panels for the recovery components */
const SLEEP_NEED = 480; // fabbisogno di riferimento in minuti (8 h)
function infoSheet(kind, d) {
  const c = d.recupero.componenti;
  const pos = (v, a, b) => Math.max(0, Math.min(100, (v - a) / (b - a) * 100));
  const range = (title, lo, hi, a, b, you, labels, green) => `<div class="card col"><div class="small muted" style="font-weight:700">${title}</div>
      <div class="rangebar"><div class="t"></div><div class="b" style="left:${pos(lo, a, b)}%;width:${pos(hi, a, b) - pos(lo, a, b)}%;${green ? "background:#CDEBDB" : ""}"></div>${you != null ? `<div class="you" style="left:${pos(you, a, b)}%"></div>` : ""}</div>
      <div class="row between small muted"><div>${labels[0]}</div><div>${labels[1]}</div><div>${labels[2]}</div></div></div>`;
  const tip = (t) => `<div class="card soft col"><div class="label" style="color:var(--orange-ink)">Lo sapevi?</div><div style="line-height:1.45">${t}</div></div>`;
  const you = (t) => `<div style="line-height:1.5"><b style="color:var(--orange-ink)">Tu:</b> ${t}</div>`;
  const body = (t) => `<div style="line-height:1.5;color:var(--text)">${t}</div>`;
  let html = "";
  if (kind === "hrv") {
    const b = c.hrv.baseline;
    html = sheetHead("HRV · variabilità del battito")
      + body("Il cuore non batte come un metronomo: tra un battito e l'altro il tempo cambia di qualche millisecondo. Più cambia, più il corpo è rilassato e pronto. Stanchezza, stress o un malanno in arrivo rendono il battito più rigido e l'HRV scende.")
      + range("Adulti sani, SDNN a breve termine (Nunan et al. 2010)", 32, 93, 10, 140, b ?? d.notte.hrv_ms, ["10 ms", "tipico 32–93 · media 50", "140"])
      + you(b ? `media personale ${fmtNum(b)} ms${c.hrv.normale ? `, la tua fascia normale è ${fmtNum(c.hrv.normale[0])}–${fmtNum(c.hrv.normale[1])} ms` : ""}; oggi ${fmtNum(d.notte.hrv_ms)} ms. Conta il confronto con te stesso: l'HRV dipende molto da genetica ed età.` : "non ho ancora abbastanza notti per la tua media personale.")
      + body("<b>Come lo uso:</b> confronto il logaritmo dell'HRV di stanotte e la media degli ultimi 7 giorni con la tua media dei 60 giorni precedenti. Le variazioni entro ±0,5 deviazioni standard sono considerate normali oscillazioni (metodo di Plews e HRV4Training).")
      + tip("L'HRV è più alta di notte. Per questo Kairo usa le misure fatte mentre dormi: quelle di giorno cambiano con caffè, stress e movimento. Apple Watch misura la SDNN, quindi i valori non sono confrontabili con Whoop o Oura (che usano la RMSSD).");
  } else if (kind === "fc_riposo") {
    const b = c.fc_riposo.baseline;
    const saved = b ? Math.max(0, Math.round((70 - b) * 1440)) : null;
    html = sheetHead("FC a riposo · il motore al minimo")
      + body("Quanti battiti al minuto servono al cuore quando non fai niente. Un cuore allenato pompa più sangue a ogni colpo, quindi gliene servono meno. Se sale di 5+ bpm sopra la tua media per più giorni, spesso indica fatica, poco sonno o un malanno.")
      + range("Sportivi ben allenati 40–60 · adulti 60–100 bpm (American Heart Association)", 40, 60, 35, 100, b ?? d.notte.fcr_bpm, ["35", "zona sportivi", "100"], true)
      + you(b ? `media personale ${fmtNum(b)} bpm, oggi ${fmtNum(c.fc_riposo.valore)}${c.fc_riposo.fonte === "notte" ? " (mentre dormivi)" : ""}.` : "non ho ancora abbastanza giorni per la tua media.")
      + tip(c.fc_riposo.fonte === "notte" ? "Uso la <b>frequenza più bassa mentre dormi</b> (media di 10 minuti), come Oura e Whoop: è pronta appena ti svegli e la confronto solo con le tue altre notti." : "Uso la FC a riposo calcolata da Apple, che arriva durante la giornata. Dopo 5 notti con il Watch userò quella <b>mentre dormi</b>, pronta già alla sveglia.")
      + (saved ? tip(`Rispetto a chi ha 70 bpm a riposo, il tuo cuore fa circa <b>${fmtNum(saved)} battiti in meno al giorno</b>: ${fmtNum(saved * 365 / 1e6, 1)} milioni in un anno.`) : "");
  } else if (kind === "sonno") {
    const s = d.sonno;
    html = sheetHead("Punteggio del sonno")
      + body("Stessi ingredienti del punteggio di Oura, con le soglie delle linee guida sul sonno:")
      + `<div class="card list">${[["Durata", "durata", "35%", "7–9 h raccomandate (AASM); pieno punteggio da 8 h"], ["Efficienza", "efficienza", "20%", "≥ 85% del tempo a letto dormendo (National Sleep Foundation)"], ["Sonno profondo", "profondo", "10%", "almeno 15% del sonno"], ["REM", "rem", "10%", "almeno 20% del sonno"], ["Regolarità", "regolarita", "15%", "Sleep Regularity Index sugli ultimi 7 giorni"], ["Orario", "orario", "10%", "punto medio del sonno tra 00:00 e 03:00"]]
          .map(([l, k, w, why]) => `<div class="item"><div class="col" style="gap:2px"><b>${l} <span class="small muted">${w}</span></b><span class="small muted">${why}</span></div><b>${s && s.contributi && s.contributi[k] != null ? s.contributi[k] : "–"}</b></div>`).join("")}</div>`
      + you(s && s.manuale ? `${s.punteggio}/100 · ${fmtMin(s.durata_min)} dichiarate nel check-in: senza il Watch conta solo la durata.` : s ? `${s.punteggio}/100 · ${fmtMin(s.durata_min)} di sonno, efficienza ${s.efficienza}%, profondo ${s.quota_profondo}%, REM ${s.quota_rem}%${s.sri != null ? `, regolarità (SRI) ${s.sri}` : ""}.` : "nessuna notte registrata: dormi con il Watch per avere questo dato.")
      + tip("Il sonno profondo si concentra nella prima metà della notte, il REM verso il mattino: andare a letto tardi taglia soprattutto il profondo, quello che ripara i muscoli.");
  } else if (kind === "bilancio") {
    const v = c.bilancio_sonno.valore;
    html = sheetHead("Bilancio di sonno")
      + body("Confronta quanto hai dormito in media nelle ultime 14 notti registrate con il fabbisogno di riferimento di 8 ore (centro dell'intervallo 7–9 h raccomandato per gli adulti). Una notte corta si recupera; un debito che dura settimane pesa sul recupero. È lo stesso principio del «Sleep balance» di Oura.")
      + you(v == null ? "servono almeno 3 notti registrate nelle ultime 2 settimane." : v >= 0 ? `in media dormi ${fmtMin(SLEEP_NEED + v)} a notte: sei in pari.` : `in media dormi ${fmtMin(SLEEP_NEED + v)} a notte, ${fmtMin(-v)} meno del fabbisogno.`)
      + tip("Il debito di sonno non si azzera con una sola dormita lunga: servono più notti di fila un po' più lunghe del solito.");
  } else if (kind === "metodo") {
    const w = Object.entries(c).map(([k, x]) => [k, x.peso, x.punteggio]);
    const names = REC_NAMES;
    html = sheetHead("Come si calcola il Recupero")
      + body("Ogni ingrediente riceve un punteggio da 0 a 100, dove 60 significa «come al solito per te». Il Recupero è la loro media pesata; se un dato manca, gli altri si ridistribuiscono il peso. Un buon sonno o un buon umore però non possono compensare HRV e FC a riposo in allarme: il Recupero non supera di oltre 20 punti il loro segnale. Le tue medie usano mediana e deviazione robusta degli ultimi 60 giorni, senza i giorni con alcol, malanno o viaggio. Con poche misure di HRV il punteggio non cambia più di 15 punti da ieri. Le fasce sono quelle di Whoop: 67–100 verde, 34–66 giallo, 0–33 rosso.")
      + `<div class="card list">${w.map(([k, p, sc]) => `<div class="item"><span>${names[k]} <span class="small muted">${Math.round(p * 100)}%</span></span><b>${sc ?? "–"}</b></div>`).join("")}</div>`
      + body("La struttura segue la Readiness di Oura (FC a riposo e HRV confrontate con le tue medie, sonno, bilancio di sonno, attività di ieri e bilancio di attività); l'HRV e la sua stabilità (coefficiente di variazione a 7 giorni) seguono Plews e HRV4Training; come ti senti segue i questionari di benessere (Saw et al. 2016); respirazione e ossigeno notturni sono segnali precoci di malanno. Nessuna di queste app pubblica la formula esatta: i pesi sono di Kairo e il codice è pubblico su GitHub.");
  } else {
    html = sheetHead("Respirazione notturna")
      + body("Quanti respiri fai al minuto mentre dormi. È molto stabile: un aumento di 1–2 respiri al minuto per più notti può segnalare affaticamento o un malanno in arrivo.")
      + range("Adulti a riposo: 12–20 respiri/min", 12, 20, 8, 26, d.notte.resp_rpm, ["8", "normale 12–20", "26"], true)
      + you(d.notte.resp_rpm ? `${fmtNum(d.notte.resp_rpm, 1)} respiri al minuto stanotte.` : "nessun dato stanotte (serve il Watch durante il sonno).")
      + tip("Il Watch misura la respirazione solo mentre dormi: è uno dei segnali più precoci di un raffreddore in arrivo.");
  }
  openSheet(html, "Spiegazione");
}

const REC_NAMES = { hrv: "HRV", fc_riposo: "FC a riposo", sonno: "Sonno della notte", bilancio_sonno: "Bilancio di sonno (14 giorni)", respirazione: "Respirazione notturna", stabilita_hrv: "Stabilità dell'HRV (7 giorni)", soggettivo: "Come ti senti (check-in)", ossigeno: "Ossigeno notturno", attivita_ieri: "Attività di ieri", bilancio_attivita: "Bilancio di attività (7/28 giorni)" };
const TAG_LABEL = { alcol: "alcol", malanno: "malanno", viaggio: "viaggio", stress: "stress", "cena tardi": "cena tardi", "allenamento serale": "allenamento serale" };
views.recupero = async (el) => {
  el.innerHTML = header("Recupero") + loading(3);
  const [hist, mesi] = await Promise.all([api("/api/history?days=14"), api("/api/hrv-mensile")]);
  const d = hist[hist.length - 1], r = d.recupero, st = state(r.score);
  const comps = [
    ["hrv", "HRV", d.notte.hrv_ms != null ? `${fmtNum(d.notte.hrv_ms)} ms` : "–", r.componenti.hrv],
    ["fc_riposo", r.componenti.fc_riposo.fonte === "notte" ? "FC nel sonno" : "FC a riposo", r.componenti.fc_riposo.valore != null ? `${fmtNum(r.componenti.fc_riposo.valore)} bpm` : "–", r.componenti.fc_riposo],
    ["sonno", "Sonno", d.sonno ? `${d.sonno.punteggio} pt` : "–", r.componenti.sonno],
    ["bilancio_sonno", "Bilancio sonno 14 gg", r.componenti.bilancio_sonno.valore != null ? (r.componenti.bilancio_sonno.valore >= 0 ? "in pari" : `−${fmtMin(-r.componenti.bilancio_sonno.valore)}/notte`) : "–", r.componenti.bilancio_sonno],
    ["respirazione", "Respirazione", d.notte.resp_rpm != null ? fmtNum(d.notte.resp_rpm, 1) : "–", r.componenti.respirazione],
    ["stabilita_hrv", "Stabilità HRV 7 gg", r.componenti.stabilita_hrv?.valore != null ? `CV ${fmtNum(r.componenti.stabilita_hrv.valore, 1)}%` : "–", r.componenti.stabilita_hrv],
    ["soggettivo", "Come ti senti", d.checkin?.energia != null ? `energia ${d.checkin.energia}/5${d.checkin.dolori != null ? ` · indolenzim. ${d.checkin.dolori}/5` : ""}` : "–", r.componenti.soggettivo],
    ["ossigeno", "Ossigeno notturno", d.notte.spo2_media != null ? `${fmtNum(d.notte.spo2_media, 1)}%` : "–", r.componenti.ossigeno],
    ["attivita_ieri", "Attività di ieri", r.componenti.attivita_ieri?.valore != null ? `carico ${r.componenti.attivita_ieri.valore}` : "–", r.componenti.attivita_ieri],
    ["bilancio_attivita", "Bilancio di attività", r.componenti.bilancio_attivita?.valore != null ? fmtNum(r.componenti.bilancio_attivita.valore, 2) : "–", r.componenti.bilancio_attivita],
  ].filter(([k, , , c]) => c && (["hrv", "fc_riposo", "sonno", "bilancio_sonno"].includes(k) ? true : k === "respirazione" || k === "ossigeno" ? c.punteggio != null && c.punteggio < 60 : c.punteggio != null)); // the secondary ones only when they count
  const compRow = ([k, name, val, c]) => {
    // ogni contributo vale 0-100; 60 = come al solito: la barra mostra quanto si discosta
    const z = c.punteggio == null ? 0 : (c.punteggio - 60) / 20;
    const w = Math.min(Math.abs(z), 3) / 3 * 50;
    const color = z > 0.05 ? "var(--green)" : z < -0.05 ? "var(--red)" : "#C9CEDB";
    const wait = (n) => `tra ${n} ${n === 1 ? "giorno" : "giorni"}`;
    const media = c.punteggio != null ? `${c.punteggio}/100` : c.mancano > 0 ? wait(c.mancano) : k === "soggettivo" ? "fai il check-in" : "nessun dato oggi";
    return `<button class="comp" data-info="${k === "respirazione" ? "resp" : k === "bilancio_sonno" ? "bilancio" : ["hrv", "fc_riposo", "sonno"].includes(k) ? k : "metodo"}" aria-label="Cosa significa ${name}">
      <div class="row between" style="width:100%"><div class="row" style="gap:6px;font-weight:800">${name} ${ico.info} <span class="small muted" style="font-weight:600">${Math.round(c.peso * 100)}%</span></div>
      <div style="font-weight:800">${val} <span class="small muted" style="font-weight:600">${media}</span></div></div>
      <div class="track"><div class="zero"></div><div class="bar" style="left:${z >= 0 ? 50 : 50 - w}%;width:${Math.max(w, 1.5)}%;background:${color}"></div></div></button>`;
  };
  // 14-day score bars
  const bars = hist.map((h) => {
    const s = h.recupero.score; const sc = state(s);
    return `<div class="col" style="align-items:center;gap:4px;flex:1"><div style="height:90px;width:100%;display:flex;align-items:flex-end;justify-content:center"><div title="${h.giorno}: ${s ?? "n/d"}" style="width:70%;max-width:18px;border-radius:6px;height:${s == null ? 4 : Math.max(6, s * 0.9)}px;background:${s == null ? "#E2E5EC" : sc.fill}"></div></div><div class="small muted" style="font-size:11px">${fmtDate(h.giorno, { day: "numeric" })}</div></div>`;
  }).join("");
  el.innerHTML = `${header("Recupero", { sub: fmtDate(d.giorno, { weekday: "short", day: "numeric", month: "short" }) })}
    <div class="card row" style="gap:14px">${bean(r.score, 46)}<div class="col" style="gap:2px"><div style="font-size:30px;font-weight:900;line-height:1">${r.score ?? "–"} <span class="${st.cls}" style="font-size:16px">${st.label}</span></div><div class="small muted">Rispetto ai tuoi ultimi 60 giorni</div>${r.affidabilita ? `<button class="small" id="precBtn" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;font-weight:700">precisione <b class="${r.affidabilita === "alta" ? "good" : r.affidabilita === "media" ? "mid" : "bad"}" style="text-decoration:underline">${r.affidabilita}</b></button>` : ""}<button class="small" id="howScore" style="background:none;border:0;padding:0;color:var(--orange-ink);text-align:left;cursor:pointer;font-weight:700">Come si calcola?</button></div></div>
    ${r.domani_se_dormi?.personale ? `<div class="card small" style="line-height:1.45"><b>Se stanotte dormi quello che ti serve, domani circa ${r.domani_se_dormi.valore}</b><br><span class="muted">Imparato da ${r.domani_se_dormi.notti} tue notti piene.</span></div>` : ""}
    <div class="card" style="padding:16px 16px 10px"><div class="row between" style="padding:0 2px 6px"><div class="label">Cosa ha pesato oggi</div><div class="small muted">tocca per capire</div></div>
      ${comps.map(compRow).join("")}
      <div class="row between small muted" style="padding:8px 2px 4px"><div>← peggiora</div><div>migliora →</div></div></div>
    <div class="card"><div class="label" style="margin-bottom:8px">Ultimi 14 giorni</div><div class="row" style="gap:2px;align-items:flex-end">${bars}</div></div>
    ${mesi.length > 1 ? `<button class="card col" data-info="hrv" style="border:0;text-align:left;cursor:pointer;gap:8px"><div class="row between" style="width:100%"><div class="label">HRV · media mensile</div><div class="small muted">${mesi.length} mesi</div></div>${lineChart(mesi.map((m) => m.media), mesi.map((m) => m.mese.slice(5)))}</button>` : ""}`;
  el.insertAdjacentHTML("beforeend", `<div class="card col" style="gap:8px"><div class="label">Lo score funziona per te?</div>
      <div class="small" style="line-height:1.5;color:var(--text)">Kairo confronta le tue sedute in palestra nei giorni verdi e negli altri: se nei giorni verdi rendi di più, lo score sta leggendo bene il tuo corpo.</div>
      <button class="btn ghost" id="verify">Verifica</button><div id="verifyOut" class="small" style="line-height:1.5"></div></div>`);
  $("#verify").onclick = async () => {
    const out = $("#verifyOut"); out.textContent = "Calcolo…";
    try { const v = await api("/api/recupero/verifica"); out.innerHTML = `${esc(v.messaggio)}${v.pronto && v.correlazione != null ? `<br><span class="muted">${v.sedute} sedute · correlazione ${fmtNum(v.correlazione, 2)}${v.differenza_pct != null ? ` · giorni verdi ${v.giorni_verdi}, altri ${v.altri_giorni}` : ""}</span>` : ""}`; }
    catch (e) { out.textContent = e.message; }
  };
  el.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => infoSheet(b.dataset.info, d)));
  $("#howScore").onclick = () => infoSheet("metodo", d);
  const pb = $("#precBtn"); if (pb) pb.onclick = () => precisionSheet(r);
};

// Why today's precision is high/medium/low and how many days until it is as precise as it gets
function precisionSheet(r) {
  const C = r.componenti, why = [];
  const h = C.hrv;
  if (h.fonte === "mattino") why.push("L'HRV viene dalla misura del mattino (Respira): è la più affidabile.");
  else if (h.fonte !== "notte") why.push("Stanotte il Watch non ha misurato l'HRV mentre dormivi: uso le misure del giorno, meno affidabili.");
  else if (h.misure_tipiche && h.misure < h.misure_tipiche) why.push(`Stanotte il Watch ha fatto ${h.misure} ${h.misure === 1 ? "misura" : "misure"} di HRV, di solito ne fa ${h.misure_tipiche}: conta di più la media degli ultimi 7 giorni.`);
  else why.push(`Stanotte ${h.misure} ${h.misure === 1 ? "misura" : "misure"} di HRV, come al solito per te.`);
  if (C.fc_riposo.punteggio == null) why.push(C.fc_riposo.fonte === "apple" || C.fc_riposo.notti_fc_sonno < 5 ? "La FC a riposo di oggi non c'è ancora: quella di Apple arriva durante la giornata." : "Manca la FC a riposo di oggi.");
  if (r.calibrazione) why.push(`Le tue medie personali sono ancora in costruzione (${r.giorni_baseline} giorni su 14).`);
  const need = [Math.max(0, 14 - (r.giorni_baseline || 0)), r.domani_se_dormi?.mancano || 0];
  for (const k of ["hrv", "fc_riposo", "bilancio_sonno", "stabilita_hrv", "respirazione"]) need.push(C[k]?.mancano || 0);
  if (C.fc_riposo.fonte !== "notte") need.push(Math.max(0, 5 - (C.fc_riposo.notti_fc_sonno || 0)));
  const left = Math.max(...need), done = Math.max(0, 14 - Math.min(14, left));
  openSheet(`${sheetHead(`Precisione ${esc(r.affidabilita)}`)}
    <div class="small" style="line-height:1.6;color:var(--text)">${why.map((x) => `• ${esc(x)}`).join("<br>")}</div>
    ${left > 0 ? `<div class="col" style="gap:8px"><div style="font-weight:800">Precisione massima tra ${left} ${left === 1 ? "giorno" : "giorni"}</div>
      <div class="track" style="height:8px"><div class="bar" style="left:0;width:${Math.round((done / 14) * 100)}%;height:8px;background:var(--orange)"></div></div>
      <div class="small muted" style="line-height:1.5">Non devi fare niente: servono solo giorni di fila con il Watch, anche di notte.</div></div>` : `<div class="small good" style="font-weight:700">Hai abbastanza dati: la precisione dipende solo dalle misure di ogni notte.</div>`}
    ${h.fonte !== "mattino" ? `<div class="card soft small" style="line-height:1.5">💡 Per una misura sicura ogni giorno: appena sveglio, ancora a letto, 1 minuto di <b>Respira</b> sul Watch.</div>` : ""}`, "Precisione");
}

function lineChart(vals, labels) {
  const W = 320, H = 120, n = vals.length;
  const lo = Math.min(...vals) - 5, hi = Math.max(...vals) + 5;
  const x = (i) => 10 + i * ((W - 20) / Math.max(n - 1, 1));
  const y = (v) => H - 22 - (v - lo) / (hi - lo) * (H - 34);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1));
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Andamento HRV da ${fmtNum(Math.min(...vals))} a ${fmtNum(Math.max(...vals))} ms">
    <rect x="0" y="${y(mean + sd)}" width="${W}" height="${Math.max(0, y(mean - sd) - y(mean + sd))}" fill="#FFE8D2"/>
    <polyline points="${pts}" fill="none" stroke="#FF8A1F" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#fff" stroke="#C2410C" stroke-width="2"/>`).join("")}
    ${labels.map((l, i) => (i % 2 === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 4}" font-size="10" fill="#5F6675" text-anchor="middle">${esc(l)}</text>` : "")).join("")}
  </svg>`;
}

views.sonno = async (el) => {
  el.innerHTML = header("Sonno") + loading(3);
  const today = todayStr();
  const [hist, stages] = await Promise.all([api("/api/history?days=7"), api(`/api/sonno?d=${today}`)]);
  const d = hist[hist.length - 1], sAll = d.sonno, s = sAll && !sAll.manuale ? sAll : null, sn = d.sonno_stanotte;
  const tonight = sn ? `<div class="card col" style="gap:8px"><div class="label">Stanotte</div>
      <div class="row between"><div class="col" style="gap:2px"><div style="font-size:30px;font-weight:900;line-height:1">${fmtMin(sn.fabbisogno_min)}</div><div class="small muted">di sonno ti servono</div></div>
        ${sn.a_letto ? `<div class="col" style="gap:2px;text-align:right"><div style="font-size:30px;font-weight:900;line-height:1;color:var(--orange-ink)">${sn.a_letto}</div><div class="small muted">a letto entro${sn.sveglia ? ` · sveglia ${sn.sveglia}` : ""}</div></div>` : ""}</div>
      <div class="small" style="color:var(--text);line-height:1.5">Base ${fmtMin(sn.base_min)}${sn.per_carico_min ? ` + ${sn.per_carico_min} min per il carico di oggi` : ""}${sn.per_debito_min ? ` + ${sn.per_debito_min} min per recuperare il debito della settimana` : ""}.${sn.a_letto ? "" : " Imposta la sveglia nel profilo per l'orario consigliato."}</div></div>` : "";
  const level = { awake: 6, rem: 39, core: 72, asleep: 72, deep: 105, inbed: 6 };
  const color = { awake: "#FF8A1F", rem: "#9B7BEA", core: "#7DB7F0", asleep: "#7DB7F0", deep: "#2F4A8C", inbed: "#E2E5EC" };
  let hyp = "";
  if (s && stages.length) {
    const rows = stages.filter((x) => x.stage !== "inbed");
    const t0 = Date.parse(s.inizio), t1 = Date.parse(s.fine), W = 262;
    hyp = rows.filter((x) => Date.parse(x.end) > t0 && Date.parse(x.start) < t1).map((x) => {
      const a = Math.max(Date.parse(x.start), t0), b = Math.min(Date.parse(x.end), t1);
      return `<rect x="${((a - t0) / (t1 - t0) * W).toFixed(1)}" y="${level[x.stage]}" width="${Math.max((b - a) / (t1 - t0) * W, 1.5).toFixed(1)}" height="20" rx="4" fill="${color[x.stage]}"/>`;
    }).join("");
  }
  const week = hist.map((h) => {
    const m = h.sonno ? h.sonno.durata_min : null;
    return `<div class="col" style="align-items:center;gap:4px;flex:1"><div class="small" style="font-size:11px;font-weight:800">${m ? fmtMin(m).replace(" ", "") : ""}</div><div style="height:80px;width:100%;display:flex;align-items:flex-end;justify-content:center;position:relative"><div style="width:60%;max-width:22px;border-radius:6px;height:${m ? Math.min(80, m / 600 * 80) : 4}px;background:${m ? "#7DB7F0" : "#E2E5EC"}"></div></div><div class="small muted" style="font-size:11px">${fmtDate(h.giorno, { weekday: "narrow" })}</div></div>`;
  }).join("");
  const need = (cfg().profilo.sonno_min || 480);
  const debt = hist.filter((h) => h.sonno).reduce((a, h) => a + (h.sonno.durata_min - need), 0);
  const nNights = hist.filter((h) => h.sonno).length;
  el.innerHTML = `${header("Sonno", { sub: s ? `notte ${fmtDate(shiftDay(d.giorno, -1), { day: "numeric" })} → ${fmtDate(d.giorno, { day: "numeric", month: "short" })}` : "" })}
    ${s ? `<div class="card dark row between" style="align-items:flex-end">
        <div class="col" style="gap:4px"><div class="label" style="color:#FFB27A">Dormito</div><div style="font-size:44px;font-weight:900;line-height:1">${fmtMin(s.durata_min)}</div><div class="small" style="color:#C9CEDB">${hhmm(s.inizio)} → ${hhmm(s.fine)} · efficienza ${s.efficienza}%</div></div>
        <button class="col center" data-info="sonno" style="background:none;border:0;color:inherit;cursor:pointer;gap:2px" aria-label="Come si calcola il punteggio"><div style="font-size:40px;font-weight:900;color:#FFB27A;line-height:1">${s.punteggio}</div><div class="small" style="color:#C9CEDB">punteggio ⓘ</div></button></div>
      <div class="card col" style="gap:10px"><div class="label">Fasi della notte</div>
        <div class="row" style="gap:8px;align-items:stretch"><div class="col small muted" style="justify-content:space-between;height:132px;padding:6px 0;font-size:11px;width:54px"><div>Sveglio</div><div>REM</div><div>Leggero</div><div>Profondo</div></div>
        <svg viewBox="0 0 262 132" width="100%" style="flex:1" role="img" aria-label="Ipnogramma della notte">${[16, 49, 82, 115].map((yy) => `<line x1="0" y1="${yy}" x2="262" y2="${yy}" stroke="#EEF0F4"/>`).join("")}${hyp}</svg></div>
        <div class="row between small muted" style="padding-left:62px"><div>${hhmm(s.inizio)}</div><div>${hhmm(s.fine)}</div></div></div>
      <div class="grid2" style="grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">
        ${[["Leggero", s.fasi_min.leggero, "#7DB7F0"], ["Profondo", s.fasi_min.profondo, "#2F4A8C"], ["REM", s.fasi_min.rem, "#9B7BEA"], ["Sveglio", s.fasi_min.veglia, "#FF8A1F"]].map(([l, m, c]) => `<div class="mini" style="cursor:default"><span class="status-dot" style="background:${c}"></span><div class="small muted">${l}</div><div style="font-weight:900;font-size:17px">${m >= 60 ? fmtMin(m) : m + " min"}</div></div>`).join("")}
      </div>`
      : sAll ? `<div class="card dark col" style="gap:4px"><div class="label" style="color:#FFB27A">Dormito</div><div style="font-size:44px;font-weight:900;line-height:1">${fmtMin(sAll.durata_min)}</div><div class="small" style="color:#C9CEDB">dichiarato nel check-in · senza il Watch non ho fasi, HRV e respirazione notturna</div></div>`
      : `<div class="card col center" style="gap:8px">${bean(null, 90)}<div class="h2">Nessun dato del sonno stanotte</div><div class="muted small" style="max-width:300px">Per avere sonno, respirazione e HRV notturna indossa il Watch mentre dormi. Carica il Watch mentre fai colazione o la doccia.</div></div>`}
    ${tonight}
    <div class="card"><div class="row between" style="margin-bottom:8px"><div class="label">Ultimi 7 giorni</div>${nNights ? `<div class="small ${debt < 0 ? "bad" : "good"}" style="font-weight:800">${debt < 0 ? "Debito" : "Surplus"} ${fmtMin(Math.abs(debt))} su ${fmtMin(need)}</div>` : ""}</div><div class="row" style="gap:2px;align-items:flex-end">${week}</div></div>
    ${s && s.sri != null ? `<div class="card soft"><div style="line-height:1.45"><b>Regolarità ${s.sri}/100</b> (Sleep Regularity Index). ${s.sri >= 86 ? "Sei tra il quarto più regolare della popolazione: ottimo." : s.sri >= 74 ? "Nella media della popolazione (mediana 81)." : "Sotto la media della popolazione (mediana 81): orari più costanti aiutano recupero e sonno profondo."}</div></div>`
      : s && s.regolarita_min != null ? `<div class="card soft"><div style="line-height:1.45">Il tuo orario di addormentamento varia di circa <b>${s.regolarita_min} minuti</b> da una sera all'altra. ${s.regolarita_min > 60 ? "Più regolarità di solito significa sonno più profondo." : "Ottima regolarità."}</div></div>` : ""}`;
  el.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => infoSheet("sonno", d)));
};

views.coach = async (el) => {
  let msgs = [];
  const suggest = ["Fammi una valutazione della mia forma", "Su cosa devo lavorare questo mese?", "Posso allenarmi duro oggi?", "Come sta andando il mio sonno?"];
  const render = (busy = false) => {
    el.innerHTML = `${header("Coach", { sub: "Il tuo allenatore personale" })}
      ${msgs.length ? "" : `<div class="card soft col"><div style="line-height:1.45">Chiedimi qualsiasi cosa su recupero, sonno e allenamento: leggo i tuoi dati e ti dico cosa significano e su cosa lavorare.${cfg().profilo.obiettivi ? "" : ` <a href="#/profilo">Scrivi i tuoi obiettivi</a> per consigli su misura.`}</div></div>`}
      <div class="chips">${suggest.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <div class="chat" id="chat">${msgs.map((m) => `<div class="msg ${m.role === "user" ? "user" : "bot md"}">${m.role === "user" ? esc(m.content) : md(m.content)}${m.meta ? `<span class="meta">${esc(m.meta).replace(/\n/g, "<br>")}</span>` : ""}</div>`).join("")}${busy ? '<div class="msg bot"><div class="skeleton" style="width:180px"></div></div>' : ""}</div>
      ${msgs.length ? '<button class="btn ghost" id="clear" style="align-self:center;min-height:40px;font-size:14px">Nuova conversazione</button>' : ""}
      <div style="height:70px"></div>
      <div class="composer"><form id="f"><label for="q" style="position:absolute;left:-9999px">Messaggio</label><input id="q" class="input" placeholder="Scrivi una domanda…" autocomplete="off" maxlength="2000" ${busy ? "disabled" : ""}><button class="btn primary" ${busy ? "disabled" : ""}>Invia</button></form></div>`;
    window.scrollTo(0, document.body.scrollHeight);
    el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => send(b.dataset.q)));
    $("#f").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#q").value.trim(); if (v) send(v); });
    const c = $("#clear"); if (c) c.addEventListener("click", async () => { try { await api("/api/chat", { method: "DELETE" }); msgs = []; render(); } catch (e) { toast(e.message); } });
  };
  const send = async (q) => {
    msgs.push({ role: "user", content: q }); render(true);
    try { const r = await api("/api/coach/chat", { method: "POST", body: { domanda: q } }); msgs.push({ role: "assistant", content: r.errore || r.testo, meta: r.meta }); }
    catch (e) { msgs.push({ role: "assistant", content: e.message, meta: "errore" }); }
    render();
  };
  el.innerHTML = header("Coach") + loading(2);
  try { msgs = await api("/api/chat"); } catch { msgs = []; }
  store.del("chat");
  render();
};

/* ---------- weekly report ---------- */
views.settimana = async (el) => {
  el.innerHTML = header("La tua settimana", { back: "oggi" }) + loading(3);
  const w = await api("/api/settimana");
  const a = w.settimana, b = w.precedente;
  // goodUp = null: a change that is neither good nor bad by itself (training load)
  const arrow = (x, y, goodUp = true, d = 0) => (x == null || y == null || Math.abs(x - y) < (d ? 0.5 : 1) ? `<span class="muted">come la settimana prima</span>` : `<span class="${goodUp == null ? "muted" : (x > y) === goodUp ? "good" : "bad"}">${x > y ? "▲" : "▼"} ${fmtNum(Math.abs(x - y), d)} rispetto alla settimana prima</span>`);
  const STATO = { calibrazione: "in calibrazione", scarico: "sotto il tuo solito", mantenimento: "stai mantenendo", costruzione: "stai costruendo bene", attenzione: "carico alto, attenzione", eccesso: "troppo carico" };
  const maxLoad = Math.max(1, ...w.giorni.map((g) => g.carico || 0));
  const days = w.giorni.map((g, i) => { const sc = state(g.recupero); return `<div class="col" data-day="${i}" style="flex:1;align-items:center;gap:4px;cursor:pointer"><div style="height:70px;width:100%;display:flex;align-items:flex-end;justify-content:center"><div style="width:60%;max-width:22px;border-radius:5px;height:${g.carico == null ? 3 : Math.max(4, (g.carico / maxLoad) * 70)}px;background:${g.carico == null ? "#E2E5EC" : "#7DB7F0"}"></div></div><span class="status-dot" style="background:${g.recupero == null ? "#E2E5EC" : sc.fill}"></span><span class="small muted" style="font-size:11px">${fmtDate(g.giorno, { weekday: "narrow" })}</span></div>`; }).join("");
  const row = (label, value, sub) => `<div class="item"><div class="col" style="gap:2px"><b>${label}</b><span class="small">${sub}</span></div><div class="big" style="font-size:20px">${value}</div></div>`;
  el.innerHTML = `${header("La tua settimana", { back: "oggi", sub: `${fmtDate(w.da, { day: "numeric", month: "short" })} – ${fmtDate(w.a, { day: "numeric", month: "short" })}` })}
    <div class="card soft row" style="gap:12px;align-items:flex-start">${ico.sun(30)}<div id="wcoach" class="small md" style="line-height:1.5;color:var(--text);flex:1"><div class="skeleton" style="width:95%"></div><div class="skeleton" style="width:70%;margin-top:6px"></div></div></div>
    <div class="card col" style="gap:6px"><div class="row" style="gap:4px">${days}</div><div class="small muted" style="line-height:1.6;padding-top:4px"><b style="color:#7DB7F0">▮</b> barra = <b>carico</b> del giorno (più alta = più fatica)<br><b>●</b> pallino = <b>recupero</b> della mattina: <span class="good">verde</span> 67+ · <span class="mid">giallo</span> 34–66 · <span class="bad">rosso</span> sotto 34 · grigio nessun dato<br>Tocca un giorno per i numeri.</div><div id="dayInfo" class="small" style="font-weight:700;min-height:18px"></div></div>
    <div class="card list">
      ${row("Allenamento", `${a.giorni_allenamento} giorni`, `${STATO[w.stato_carico] || ""} · carico ${fmtNum(a.carico)} ${arrow(a.carico, b.carico, null)}`)}
      ${row("Recupero medio", a.recupero ?? "–", arrow(a.recupero, b.recupero))}
      ${row("Sonno medio", a.sonno_min ? fmtMin(a.sonno_min) : "–", `${a.notti} notti registrate su 7 · ${arrow(a.sonno_min, b.sonno_min)}`)}
      ${row("HRV", a.hrv != null ? `${fmtNum(a.hrv)} ms` : "–", w.hrv_media_personale ? `${a.hrv >= w.hrv_media_personale ? '<span class="good">sopra</span>' : '<span class="mid">sotto</span>'} la tua media (${fmtNum(w.hrv_media_personale)})` : "")}
      ${row("FC a riposo", a.fcr != null ? `${fmtNum(a.fcr)} bpm` : "–", w.fcr_media_personale ? `${a.fcr <= w.fcr_media_personale ? '<span class="good">sotto</span>' : '<span class="mid">sopra</span>'} la tua media (${fmtNum(w.fcr_media_personale)})` : "")}
      ${w.vo2max ? row("VO₂max", fmtNum(w.vo2max.valore, 1), w.vo2max.quattro_settimane_fa ? arrow(w.vo2max.valore, w.vo2max.quattro_settimane_fa, true, 1).replace("settimana prima", "4 settimane fa") : "") : ""}
    </div>`;
  el.querySelectorAll("[data-day]").forEach((x) => (x.onclick = () => {
    const g = w.giorni[Number(x.dataset.day)];
    $("#dayInfo").innerHTML = `${fmtDate(g.giorno, { weekday: "long", day: "numeric" })}: carico ${g.carico ?? "–"} · recupero ${g.recupero ?? "–"} · sonno ${g.sonno_min ? fmtMin(g.sonno_min) : "–"}`;
  }));
  api("/api/settimana/coach", { method: "POST" }).then((r) => { const b2 = $("#wcoach"); if (b2) b2.innerHTML = md(r.errore || r.testo); }).catch((e) => { const b2 = $("#wcoach"); if (b2) b2.textContent = e.message; });
};

/* ---------- body ---------- */
const fatKg = (m) => (m && m.peso != null && m.grasso_pct != null ? (m.peso * m.grasso_pct) / 100 : null);
const leanKg = (m) => (m ? (m.massa_magra ?? (fatKg(m) != null ? m.peso - fatKg(m) : null)) : null);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400e3);
const signed = (x, d = 1, unit = "") => (x == null ? "–" : `${x > 0 ? "▲" : x < 0 ? "▼" : "="} ${fmtNum(Math.abs(x), d)}${unit}`);
// VO2max: tabelle della Cooper Institute (le stesse delle classificazioni Garmin), mL/kg/min.
// Colonne: 20-29, 30-39, 40-49, 50-59, 60-69, 70-79 · righe: 40°, 60°, 80°, 95° percentile
const COOPER = {
  M: { p40: [41.7, 40.5, 38.5, 35.6, 32.3, 29.4], p60: [45.4, 44.0, 42.4, 39.2, 35.5, 32.3], p80: [51.1, 48.3, 46.4, 43.4, 39.5, 36.7], p95: [55.4, 54.0, 52.5, 48.9, 45.7, 42.1] },
  F: { p40: [36.1, 34.4, 33.0, 30.1, 27.5, 25.9], p60: [39.5, 37.8, 36.3, 33.0, 30.0, 28.1], p80: [43.9, 42.4, 39.7, 36.7, 33.0, 30.9], p95: [49.6, 47.4, 45.3, 41.1, 37.8, 36.7] },
};
const cooperRow = (age, sex) => { const t = COOPER[sex === "F" ? "F" : "M"], i = Math.max(0, Math.min(5, Math.floor((age - 20) / 10))); return { p40: t.p40[i], p60: t.p60[i], p80: t.p80[i], p95: t.p95[i] }; };
// mediana (50° percentile) per età, interpolata tra i centri delle decadi
const vo2Median = (age, sex) => {
  const t = COOPER[sex === "F" ? "F" : "M"], med = t.p40.map((v, i) => (v + t.p60[i]) / 2), x = (Math.max(25, Math.min(75, age)) - 25) / 10, i = Math.min(4, Math.floor(x));
  return med[i] + (med[i + 1] - med[i]) * (x - i);
};
// età fitness come Garmin: l'età in cui il tuo VO2max sarebbe nella media (minimo 20 anni)
const fitnessAge = (vo2, sex) => {
  const t = COOPER[sex === "F" ? "F" : "M"], med = t.p40.map((v, i) => (v + t.p60[i]) / 2);
  if (vo2 >= med[0]) return 20;
  for (let i = 1; i < med.length; i++) if (vo2 >= med[i]) return Math.round(25 + 10 * (i - 1) + 10 * (med[i - 1] - vo2) / (med[i - 1] - med[i]));
  return 80;
};
function vo2Level(vo2, age, sex) {
  const r = cooperRow(age, sex);
  if (vo2 >= r.p95) return ["superiore · oltre il 95° percentile", "good"];
  if (vo2 >= r.p80) return ["eccellente · oltre l'80° percentile", "good"];
  if (vo2 >= r.p60) return ["buono · oltre il 60° percentile", "good"];
  if (vo2 >= r.p40) return ["discreto · oltre il 40° percentile", "mid"];
  return ["scarso · sotto il 40° percentile", "bad"];
}
// American Heart Association: 60-100 bpm normale, 40-60 tipico degli sportivi ben allenati
const fcrLevel = (v) => (v < 40 ? "molto bassa" : v <= 60 ? "fascia degli sportivi (40–60, AHA)" : v <= 100 ? "normale (60–100, AHA)" : "alta: parlane con un medico");
// average of the last n days up to `day`; null when there are too few values to be meaningful
const avgUpTo = (series, day, n = 7, min = 3) => { const from = shiftDay(day, -(n - 1)); const v = series.filter(([d]) => d >= from && d <= day).map((r) => r[1]); return v.length >= min ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const valueBefore = (series, day) => { let out = null; for (const r of series) if (r[0] <= day) out = r; return out; };

function timeChart(points, color, unit, dec = 1) {
  if (points.length < 2) return `<div class="small muted" style="padding:12px 0">Servono almeno due misure per il grafico.</div>`;
  const W = 340, H = 150, L = 34, R = 10, T = 14, B = 26;
  const vs = points.map((p) => p[1]); let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.15, 0.5); lo -= pad; hi += pad;
  const t0 = Date.parse(points[0][0]), t1 = Date.parse(points[points.length - 1][0]) || t0 + 1;
  const x = (d) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  const months = []; const seen = new Set();
  for (const [d] of points) { const k = d.slice(0, 7); if (!seen.has(k)) { seen.add(k); months.push(d); } }
  const step = Math.ceil(months.length / 5);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Andamento nel tempo">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#ECE6DC"/><text x="0" y="${y(t) + 4}" font-size="11" fill="#9AA0AD" font-weight="700">${fmtNum(t, dec)}${unit}</text>`).join("")}
    ${months.filter((_, i) => i % step === 0).map((d) => `<text x="${x(d) - 8}" y="${H - 6}" font-size="11" fill="#9AA0AD" font-weight="700">${new Date(d + "T12:00:00").toLocaleDateString("it-IT", { month: "short" })}</text>`).join("")}
    <path d="${points.map((p, i) => `${i ? "L" : "M"} ${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${i === points.length - 1 ? 6 : 3.5}" fill="${i === points.length - 1 ? color : "#fff"}" stroke="${color}" stroke-width="2.5"/>`).join("")}
  </svg>`;
}

const QUAD = {
  ricomposizione: ["Ricomposizione", "good", (f, l) => `hai perso <b>${fmtNum(-f, 1)} kg di grasso</b> e messo <b>${fmtNum(l, 1)} kg di massa magra</b>. È il risultato migliore possibile: il peso cambia poco, ma cambia quello giusto.`],
  definizione: ["Definizione", "mid", (f, l) => `hai perso <b>${fmtNum(-f, 1)} kg di grasso</b> ma anche <b>${fmtNum(-l, 1)} kg di massa magra</b>. Per proteggere i muscoli: proteine alte (circa 1,6–2 g per kg) e pesi pesanti almeno 2 volte a settimana.`],
  massa: ["Massa", "mid", (f, l) => `hai messo <b>${fmtNum(l, 1)} kg di massa magra</b> e <b>${fmtNum(f, 1)} kg di grasso</b>. Va bene in una fase di costruzione; se vuoi limitare il grasso riduci un po' il surplus calorico.`],
  rivedere: ["Da rivedere", "bad", (f, l) => `il grasso è salito di <b>${fmtNum(f, 1)} kg</b> e la massa magra è scesa di <b>${fmtNum(-l, 1)} kg</b>. Di solito succede con meno allenamento e alimentazione meno curata: ripartiamo da 3 allenamenti di forza a settimana.`],
  stabile: ["Stabile", "mid", () => `grasso e massa magra sono praticamente invariati.`],
};
function quadrantOf(dF, dL) {
  if (Math.abs(dF) < 0.3 && Math.abs(dL) < 0.3) return "stabile";
  if (dF <= 0 && dL >= 0) return "ricomposizione";
  if (dF <= 0) return "definizione";
  if (dL >= 0) return "massa";
  return "rivedere";
}
function quadrantSvg(dF, dL) {
  const cx = 160 + Math.max(-1, Math.min(1, dF / 4)) * 135, cy = 120 - Math.max(-1, Math.min(1, dL / 3)) * 95;
  const q = quadrantOf(dF, dL);
  const box = (x, y, key, title, sub, fill, ink) => `<rect x="${x}" y="${y}" width="148" height="108" rx="14" fill="${q === key ? fill : "#F4F1EC"}"/>
    <text x="${x + 12}" y="${y + 22}" font-weight="900" font-size="13" fill="${q === key ? ink : "#5F6675"}">${title}</text><text x="${x + 12}" y="${y + 38}" font-size="10.5" font-weight="600" fill="#5F6675">${sub}</text>`;
  return `<svg viewBox="0 0 320 252" width="100%" role="img" aria-label="Qualità del cambiamento: ${QUAD[q][0]}">
    ${box(10, 10, "ricomposizione", "Ricomposizione", "− grasso · + muscoli", "#DDF3E7", "#2E8B5A")}
    ${box(162, 10, "massa", "Massa", "+ grasso · + muscoli", "#FFF1CC", "#8A5F00")}
    ${box(10, 122, "definizione", "Definizione", "− grasso · − muscoli", "#FFF1CC", "#8A5F00")}
    ${box(162, 122, "rivedere", "Da rivedere", "+ grasso · − muscoli", "#FDE2DF", "#B8322A")}
    <line x1="160" y1="10" x2="160" y2="230" stroke="#C9CEDB" stroke-width="1.5" stroke-dasharray="4 4"/><line x1="10" y1="120" x2="310" y2="120" stroke="#C9CEDB" stroke-width="1.5" stroke-dasharray="4 4"/>
    <path d="M 160 120 L ${cx.toFixed(1)} ${cy.toFixed(1)}" stroke="#1C2340" stroke-width="2" stroke-dasharray="3 4"/>
    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" fill="${{ good: "#5DC796", mid: "#F7C65C", bad: "#EE6352" }[QUAD[q][1]]}" stroke="#fff" stroke-width="4"/>
    <text x="10" y="248" font-size="10" font-weight="700" fill="#9AA0AD">← meno grasso</text><text x="236" y="248" font-size="10" font-weight="700" fill="#9AA0AD">più grasso →</text>
  </svg>`;
}

function fatInfoSheet(m, sex) {
  const ranges = sex === "F" ? [["Grasso essenziale", "10–13%"], ["Atlete", "14–20%"], ["In forma", "21–24%"], ["Nella media", "25–31%"], ["Obesità", "32% e oltre"]] : [["Grasso essenziale", "2–5%"], ["Atleti", "6–13%"], ["In forma", "14–17%"], ["Nella media", "18–24%"], ["Obesità", "25% e oltre"]];
  openSheet(`${sheetHead("Massa grassa")}
    <div style="line-height:1.55;color:var(--text)">È la parte del tuo peso fatta di grasso. Il resto è <b>massa magra</b>: muscoli, ossa, organi e acqua. Due persone con lo stesso peso possono avere un corpo molto diverso: per questo conta più la composizione del peso sulla bilancia.</div>
    <div class="card list"><div class="label" style="margin-bottom:4px">Riferimenti ${sex === "F" ? "donne" : "uomini"} (American Council on Exercise)</div>${ranges.map(([a, b]) => `<div class="item"><span>${a}</span><b>${b}</b></div>`).join("")}</div>
    ${m?.grasso_pct != null ? `<div class="card soft"><b>Tu:</b> ${fmtNum(m.grasso_pct, 1)}% (${fmtNum(fatKg(m), 1)} kg di grasso su ${fmtNum(m.peso, 1)} kg).</div>` : ""}
    <div class="small muted" style="line-height:1.5">Le bilance a impedenza (InBody e simili) variano anche di 1–2 punti in base ad acqua e pasti: misurati sempre nelle stesse condizioni, per esempio la mattina a digiuno.</div>
    ${sex ? "" : `<div class="small muted">Imposta il sesso in Impostazioni per riferimenti precisi.</div>`}`, "Massa grassa");
}
function vo2InfoSheet(vo2, age, sex) {
  openSheet(`${sheetHead("VO₂max")}
    <div style="line-height:1.55;color:var(--text)">È la quantità massima di ossigeno che il tuo corpo riesce a usare durante lo sforzo: la "cilindrata" del motore. È il miglior indicatore della forma aerobica ed è legato alla salute a lungo termine. L'Apple Watch lo stima durante camminate e corse all'aperto.</div>
    ${age ? (() => { const r = cooperRow(age, sex); return `<div class="card list"><div class="label" style="margin-bottom:4px">${sex === "F" ? "Donne" : "Uomini"} ${Math.floor(age / 10) * 10}–${Math.floor(age / 10) * 10 + 9} anni (Cooper Institute)</div>
      ${[["Superiore", `≥ ${fmtNum(r.p95, 1)}`], ["Eccellente", `${fmtNum(r.p80, 1)}–${fmtNum(r.p95, 1)}`], ["Buono", `${fmtNum(r.p60, 1)}–${fmtNum(r.p80, 1)}`], ["Discreto", `${fmtNum(r.p40, 1)}–${fmtNum(r.p60, 1)}`], ["Scarso", `< ${fmtNum(r.p40, 1)}`]].map(([a, b]) => `<div class="item"><span>${a}</span><b>${b}</b></div>`).join("")}
      <div class="item"><b>Tu</b><b>${fmtNum(vo2, 1)}</b></div></div>`; })() : ""}
    <div class="card soft" style="line-height:1.5"><b>Età del cuore:</b> è l'età in cui il tuo VO₂max sarebbe nella media (50° percentile), come la «Fitness Age» di Garmin, calcolata sulle stesse tabelle della Cooper Institute. Il minimo della scala è 20 anni. Si abbassa soprattutto con allenamenti aerobici sostenuti e a intervalli (per esempio 4 × 4 minuti molto intensi in bici o a nuoto).</div>
    <div class="small muted">Il VO₂max dell'Apple Watch è una stima (errore tipico di qualche punto rispetto al test in laboratorio). Non è una valutazione medica.</div>`, "VO₂max");
}

views.corpo = async (el) => {
  el.innerHTML = header("Corpo") + loading(3);
  const data = await api("/api/corpo");
  const prof = cfg().profilo, age = Number(prof.eta) || null, sex = prof.sesso || "";
  const ms = data.misure, last = ms[ms.length - 1];
  const today = todayStr();
  let html = header("Corpo", { sub: last ? `Ultima misura: ${fmtDate(last.giorno, { day: "numeric", month: "long" })}` : "" });

  if (!last) {
    html += `<div class="card col" style="gap:10px"><div class="h2">Nessuna misura ancora</div><div style="line-height:1.55;color:var(--text)">Kairo legge peso e composizione corporea da Salute. Usa una bilancia che scrive in Salute (InBody, Withings, Xiaomi…) oppure aggiungi il peso a mano nell'app Salute. Se ne hai di vecchie, caricale con <a href="#/importa">Importa da Salute</a>.</div></div>`;
  } else {
    const age_d = daysBetween(last.giorno, today);
    if (age_d > 30) html += `<div class="card row" style="background:#FFF1CC;color:#8A5F00;gap:10px;padding:12px 16px;font-weight:700"><span style="font-size:20px" aria-hidden="true">⏳</span><span>L'ultima misura ha ${age_d} giorni. Rifai una misura per vedere i progressi di questi mesi.</span></div>`;

    // 1 · composition
    const prev3 = [...ms].reverse().find((m) => m.giorno <= shiftDay(last.giorno, -80) && m.grasso_pct != null);
    const fk = fatKg(last), lk = leanKg(last);
    const dPct = prev3 && last.grasso_pct != null ? last.grasso_pct - prev3.grasso_pct : null;
    const pctFat = last.grasso_pct;
    html += `<div class="card col" style="gap:14px">
      <div class="row between"><div class="label">Composizione</div><button class="iconbtn" id="fatInfo" style="width:32px;height:32px;background:none" aria-label="Cos'è la massa grassa">${ico.info}</button></div>
      ${pctFat != null ? `<div class="row" style="align-items:flex-end;gap:12px;flex-wrap:wrap"><div class="huge">${fmtNum(pctFat, 1)}<span style="font-size:30px">%</span></div>
        <div class="col" style="gap:4px;padding-bottom:6px"><div style="font-weight:800">di massa grassa</div>${dPct != null ? `<span class="pill ${dPct <= 0 ? "good" : "bad"}">${signed(dPct, 1)} in ${Math.round(daysBetween(prev3.giorno, last.giorno) / 30)} mesi</span>` : ""}</div></div>
        <div style="display:flex;height:30px;border-radius:15px;overflow:hidden;font-weight:900;font-size:13px">
          <div style="width:${Math.max(pctFat, 24)}%;background:#FFB27A;display:flex;align-items:center;padding:0 10px;white-space:nowrap">${fmtNum(fk, 1)} kg</div>
          <div style="flex:1;background:#BFEBD3;display:flex;align-items:center;padding:0 10px">${fmtNum(lk, 1)} kg di massa magra</div></div>
        <div class="row small muted" style="gap:16px"><span><span class="status-dot" style="background:#FFB27A"></span> Grasso</span><span><span class="status-dot" style="background:#5DC796"></span> Muscoli, ossa e acqua</span></div>`
      : `<div class="muted">La tua bilancia registra solo il peso: per la composizione serve una bilancia a impedenza.</div>`}
      <div class="grid3">
        ${[["Peso", last.peso, prev3?.peso, "kg", -1], ["Magra", lk, leanKg(prev3), "kg", 1], ["BMI", last.bmi, null, "", 0]].map(([l, v, o, u, good]) =>
          `<div class="mini" style="background:var(--bg)"><span class="label">${l}</span><span class="big">${fmtNum(v, 1)}</span>${o != null && v != null ? `<span class="small ${(v - o) * good >= 0 ? "good" : "bad"}">${signed(v - o, 1, " " + u)}</span>` : l === "BMI" && v ? `<span class="small muted">${v < 18.5 ? "sottopeso" : v < 25 ? "normopeso" : v < 30 ? "sovrappeso" : "obesità"} (OMS)</span>` : ""}</div>`).join("")}
      </div>
      <div class="seg" role="tablist" id="seg">${[["grasso_pct", "Grasso"], ["peso", "Peso"], ["magra", "Muscoli"]].map(([k, l], i) => `<button role="tab" data-s="${k}" aria-selected="${i === 0}">${l}</button>`).join("")}</div>
      <div id="chart"></div></div>`;

    // 4 · quality of change
    html += `<div class="card col" style="gap:12px"><div class="label">Qualità del cambiamento</div>
      <div class="seg" id="qseg">${[[90, "3 mesi"], [180, "6 mesi"], [365, "1 anno"]].map(([d, l], i) => `<button data-q="${d}" aria-selected="${i === 0}">${l}</button>`).join("")}</div>
      <div id="quad"></div></div>`;
  }

  // 5 · engine
  const vo2 = data.vo2max, vNow = vo2[vo2.length - 1];
  const fcrNow = data.fcr.length ? avgUpTo(data.fcr, data.fcr[data.fcr.length - 1][0]) : null;
  const fcrOld = data.fcr.length ? avgUpTo(data.fcr, shiftDay(data.fcr[data.fcr.length - 1][0], -90)) : null;
  const fcwNow = data.fc_camminata.length ? avgUpTo(data.fc_camminata, data.fc_camminata[data.fc_camminata.length - 1][0], 30, 5) : null;
  const fcwOld = data.fc_camminata.length ? avgUpTo(data.fc_camminata, shiftDay(data.fc_camminata[data.fc_camminata.length - 1][0], -90), 30, 5) : null;
  if (vNow || fcrNow) {
    const vOld = vNow ? valueBefore(vo2, shiftDay(vNow[0], -180)) : null;
    const dV = vNow && vOld ? vNow[1] - vOld[1] : null;
    const fa = vNow && sex ? fitnessAge(vNow[1], sex) : null;
    const lvl = vNow && age ? vo2Level(vNow[1], age, sex || "M") : null;
    const row = (label, sub, value, unit, delta, goodWhenDown, id = "") => `<${id ? `button id="${id}"` : "div"} class="rowm" style="${id ? "background:none;border:0;width:100%;color:inherit;text-align:left;cursor:pointer;" : ""}">
      <div class="col" style="gap:2px"><b>${label}</b><span class="small" style="color:#AEB4C6">${sub}</span></div>
      <div style="text-align:right"><div class="big" style="color:#fff">${value}${unit ? ` <span style="font-size:14px">${unit}</span>` : ""}</div>${delta}</div></${id ? "button" : "div"}>`;
    const dl = (d, goodWhenDown, txt, dec = 0) => (d == null ? "" : Math.abs(d) < (dec ? 0.3 : 1) ? `<span class="small" style="color:#AEB4C6">stabile</span>` : `<span class="small" style="color:${(d < 0) === goodWhenDown ? "#5DC796" : "#FFB547"}">${signed(d, dec)} ${txt}</span>`);
    let tip = "";
    if (dV != null) tip = dV < -1 ? `il VO₂max è calato di ${fmtNum(-dV, 1)} in 6 mesi. Due uscite aerobiche sostenute a settimana (bici, nuoto o corsa) lo riportano su in 6–8 settimane.` : dV > 1 ? `il VO₂max è salito di ${fmtNum(dV, 1)} in 6 mesi: il lavoro aerobico sta funzionando, continua così.` : `il VO₂max è stabile. Per alzarlo aggiungi una seduta a intervalli a settimana, per esempio 4 × 4 minuti molto intensi in bici.`;
    html += `<div class="card dark col" style="gap:6px">
      <div class="row between"><div class="label" style="color:#AEB4C6">Motore</div><span class="small" style="color:#AEB4C6">VO₂max e cuore</span></div>
      ${fa ? `<div class="row" style="gap:14px;padding:6px 0 10px"><div style="font-size:64px;font-weight:900;letter-spacing:-2px;line-height:1;color:#FFB547">${fa}</div>
        <div class="col" style="gap:2px"><div style="font-weight:900;font-size:18px">anni: l'età del tuo cuore</div><div class="small" style="color:#AEB4C6">${fa === 20 && vNow[1] >= vo2Median(20, sex) ? "Il valore minimo della scala: il tuo VO₂max è sopra la media dei ventenni" : "L'età in cui il tuo VO₂max sarebbe nella media"}${age ? `. Hai ${age} anni` : ""}. Metodo Garmin, tabelle Cooper Institute.</div></div></div>`
      : vNow ? `<div class="small" style="color:#AEB4C6;padding:4px 0 8px">Inserisci età e sesso nel <a href="#/profilo" style="color:#FFB547">Profilo</a> per vedere l'età del tuo cuore.</div>` : ""}
      ${vNow ? row("VO₂max", lvl ? lvl[0] : `misurato ${ago(vNow[0] + "T12:00:00")}`, fmtNum(vNow[1], 1), "", dl(dV, false, "in 6 mesi", 1), false, "vo2Info") : ""}
      ${vNow && age ? (() => { const r = cooperRow(age, sex), lo = r.p40 - 8, hi = r.p95 + 4, at = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
          const segs = [[lo, r.p40, "#3A2E3F"], [r.p40, r.p60, "#3C4A7A"], [r.p60, r.p80, "#3D6A5C"], [r.p80, r.p95, "#2E8B5A"], [r.p95, hi, "#5DC796"]];
          return `<div class="rangebar" style="margin:-2px 0 0">${segs.map(([a, b, c]) => `<div class="b" style="left:${at(a)}%;width:${at(b) - at(a)}%;background:${c};border-radius:0"></div>`).join("")}<div class="you" style="left:${at(vNow[1])}%;border-color:#1C2340"></div></div>
          <div class="row between small" style="color:#AEB4C6;margin-top:-4px;font-size:11px"><span>scarso</span><span>discreto</span><span>buono</span><span>eccellente</span><span>superiore</span></div>
          <div class="small" style="color:#AEB4C6;font-size:11px;text-align:center">${sex === "F" ? "Donne" : "Uomini"} ${Math.floor(age / 10) * 10}–${Math.floor(age / 10) * 10 + 9} anni · Cooper Institute</div>`; })() : ""}
      ${fcrNow ? row("FC a riposo", fcrLevel(fcrNow), fmtNum(fcrNow, 0), "bpm", dl(fcrOld != null ? fcrNow - fcrOld : null, true, "in 3 mesi"), true) : ""}
      ${fcwNow ? row("FC camminando", "più bassa = cuore più efficiente", fmtNum(fcwNow, 0), "bpm", dl(fcwOld != null ? fcwNow - fcwOld : null, true, "in 3 mesi"), true) : ""}
      ${tip ? `<div class="card" style="background:#2A3150;margin-top:8px;padding:14px"><div class="small" style="line-height:1.5;color:#E6E8F0"><b>Coach:</b> ${tip}</div></div>` : ""}
    </div>`;
  }

  // 3 · measurement diary
  if (ms.length) {
    const rows = [...ms].reverse().slice(0, 60);
    html += `<details class="card" id="diary"><summary class="row between" style="list-style:none;cursor:pointer"><div class="h2">Misurazioni</div><span class="small muted">${ms.length} · apri ▾</span></summary>
      <div class="small muted" style="margin-top:6px">Tocca due misure per confrontarle.</div>
      <div class="list" style="margin-top:4px">${rows.map((m, i) => {
        const p = rows[i + 1]; const dF = p ? (fatKg(m) ?? 0) - (fatKg(p) ?? 0) : null, dL = p && leanKg(m) != null && leanKg(p) != null ? leanKg(m) - leanKg(p) : null;
        return `<button class="item" data-m="${m.giorno}" aria-pressed="false"><div class="col" style="gap:2px;text-align:left"><b>${fmtDate(m.giorno, { day: "numeric", month: "long", year: "numeric" })}</b></div>
          <div class="small" style="text-align:right;font-weight:600">${fmtNum(m.peso, 1)} kg${m.grasso_pct != null ? ` · ${fmtNum(m.grasso_pct, 1)}%` : ""}${p && fatKg(m) != null && fatKg(p) != null ? `<br><span class="${dF <= 0 ? "good" : "bad"}">grasso ${signed(dF, 1)}</span>${dL != null ? ` · <span class="${dL >= 0 ? "good" : "bad"}">magra ${signed(dL, 1)}</span>` : ""}` : ""}</div></button>`; }).join("")}</div>
      <button class="btn ghost block" id="cmp" disabled style="margin-top:10px">Confronta due misure</button></details>`;
  }
  el.innerHTML = html;

  if (last) {
    const series = { grasso_pct: ms.filter((m) => m.grasso_pct != null).map((m) => [m.giorno, m.grasso_pct]), peso: ms.filter((m) => m.peso != null).map((m) => [m.giorno, m.peso]), magra: ms.filter((m) => leanKg(m) != null).map((m) => [m.giorno, Math.round(leanKg(m) * 10) / 10]) };
    const conf = { grasso_pct: ["#FF8A1F", "%"], peso: ["#1C2340", ""], magra: ["#2E8B5A", ""] };
    const drawChart = (k) => { $("#chart").innerHTML = timeChart(series[k].slice(-30), conf[k][0], conf[k][1]); el.querySelectorAll("#seg button").forEach((b) => b.setAttribute("aria-selected", b.dataset.s === k)); };
    if (!series.grasso_pct.length) { $("#seg").remove(); $("#chart").innerHTML = timeChart(series.peso.slice(-30), "#1C2340", ""); } else drawChart("grasso_pct");
    el.querySelectorAll("#seg button").forEach((b) => (b.onclick = () => drawChart(b.dataset.s)));
    const drawQuad = (days) => {
      el.querySelectorAll("#qseg button").forEach((b) => b.setAttribute("aria-selected", Number(b.dataset.q) === days));
      const ref = [...ms].reverse().find((m) => m.giorno <= shiftDay(last.giorno, -(days - 10)) && fatKg(m) != null);
      if (!ref || fatKg(last) == null) { $("#quad").innerHTML = `<div class="muted" style="line-height:1.5">Serve una misura con massa grassa di almeno ${days === 365 ? "un anno" : days / 30 + " mesi"} prima dell'ultima.</div>`; return; }
      const dF = fatKg(last) - fatKg(ref), dL = leanKg(last) - leanKg(ref), q = quadrantOf(dF, dL);
      const months = Math.max(1, Math.round(daysBetween(ref.giorno, last.giorno) / 30));
      $("#quad").innerHTML = `${quadrantSvg(dF, dL)}<div style="line-height:1.55;color:var(--text)"><b class="${QUAD[q][1]}">${QUAD[q][0]}.</b> In ${months} ${months === 1 ? "mese" : "mesi"} ${QUAD[q][2](dF, dL)}</div>
        <div class="small muted">Dal ${fmtDate(ref.giorno, { day: "numeric", month: "short", year: "numeric" })} al ${fmtDate(last.giorno, { day: "numeric", month: "short", year: "numeric" })}</div>`;
    };
    drawQuad(90);
    el.querySelectorAll("#qseg button").forEach((b) => (b.onclick = () => drawQuad(Number(b.dataset.q))));
    $("#fatInfo").onclick = () => fatInfoSheet(last, sex);
  }
  const vi = $("#vo2Info"); if (vi) vi.onclick = () => vo2InfoSheet(vo2[vo2.length - 1][1], age, sex || "M");
  // compare two measurements
  const picked = [];
  el.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => {
    const d = b.dataset.m, i = picked.indexOf(d);
    if (i >= 0) picked.splice(i, 1); else { picked.push(d); if (picked.length > 2) picked.shift(); }
    el.querySelectorAll("[data-m]").forEach((x) => { const on = picked.includes(x.dataset.m); x.setAttribute("aria-pressed", on); x.style.background = on ? "var(--soft)" : ""; });
    $("#cmp").disabled = picked.length !== 2;
  }));
  const cmp = $("#cmp");
  if (cmp) cmp.onclick = () => {
    const [a, b] = picked.map((d) => ms.find((m) => m.giorno === d)).sort((x, y) => (x.giorno < y.giorno ? -1 : 1));
    const rows = [["Peso", a.peso, b.peso, " kg", -1], ["Massa grassa", a.grasso_pct, b.grasso_pct, "%", -1], ["Grasso", fatKg(a), fatKg(b), " kg", -1], ["Massa magra", leanKg(a), leanKg(b), " kg", 1], ["BMI", a.bmi, b.bmi, "", 0]];
    const f = (d) => fmtDate(d, { day: "numeric", month: "short", year: "2-digit" });
    openSheet(`${sheetHead("Prima e dopo")}
      <div class="small muted">${daysBetween(a.giorno, b.giorno)} giorni tra le due misure</div>
      <div class="card list"><div class="item small muted"><span style="flex:1.2"></span><b style="flex:1;text-align:right">${f(a.giorno)}</b><b style="flex:1;text-align:right">${f(b.giorno)}</b><b style="flex:1;text-align:right">Diff.</b></div>
      ${rows.map(([l, x, y, u, g]) => `<div class="item"><span style="flex:1.2">${l}</span><span style="flex:1;text-align:right">${fmtNum(x, 1)}</span><span style="flex:1;text-align:right">${fmtNum(y, 1)}</span>
        <b style="flex:1;text-align:right" class="${x == null || y == null || !g ? "" : (y - x) * g >= 0 ? "good" : "bad"}">${x == null || y == null ? "–" : signed(y - x, 1)}</b></div>`).join("")}</div>`, "Confronto misure");
  };
};

/* ---------- gym: routines, live session, progress ---------- */
const localIso = (d = new Date()) => {
  const off = -d.getTimezoneOffset(), pad = (n) => String(Math.abs(Math.trunc(n))).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
};
const kgStep = (kg) => (kg >= 20 ? 2.5 : 1);
// double progression: all sets at the top of the range last time → add weight, otherwise same weight and more reps
function progression(ex, last) {
  if (!last || !last.serie.length) return { testo: "Prima volta: scegli un carico con cui arrivi al range con 2 ripetizioni in riserva.", kg: null };
  const done = last.serie.filter((x) => x.reps != null);
  const kg = Math.max(...last.serie.map((x) => x.kg || 0)) || null;
  const allTop = done.length >= Math.min(ex.serie, last.serie.length) && done.every((x) => x.reps >= ex.max);
  const lastTxt = `Ultima volta: ${last.serie.map((x) => `${x.kg != null ? fmtNum(x.kg, 1) + " kg × " : ""}${x.reps ?? "–"}`).join(", ")}`;
  const h = last.storia || [], rpe = h[0]?.rpe;
  // stall: same weight for the last 3 sessions and no more reps → deload 10% and build back up
  if (kg && h.length >= 3 && h.every((x) => x.kg === h[0].kg) && h[0].reps != null && h[2].reps != null && h[0].reps <= h[2].reps) {
    const dl = Math.max(kgStep(kg), Math.round((kg * 0.9) / kgStep(kg)) * kgStep(kg));
    return { testo: `${lastTxt}. Fermo da 3 sedute allo stesso carico: oggi scarico a ${fmtNum(dl, 1)} kg con ripetizioni pulite, poi si risale.`, kg: dl };
  }
  // range closed: add weight, unless last time was already at the limit (RPE 9.5-10)
  if (kg && allTop && rpe != null && rpe >= 9.5) return { testo: `${lastTxt}. Range chiuso ma al limite (RPE ${fmtNum(rpe, 1)}): resta a ${fmtNum(kg, 1)} kg finché non ti sembra più facile.`, kg };
  if (kg && allTop) return { testo: `${lastTxt}. Hai chiuso il range: prova ${fmtNum(kg + kgStep(kg), 1)} kg.`, kg: kg + kgStep(kg) };
  return { testo: `${lastTxt}. ${kg ? `Stesso carico, punta a ${ex.max} ripetizioni.` : ""}`, kg };
}

async function startSession(scheda) {
  const cur = store.get("sessione", null);
  if (cur && !confirm(`C'è già un allenamento in corso (${cur.nome}). Vuoi abbandonarlo e iniziare ${scheda.nome}?`)) return route("sessione");
  let ultimo = {};
  try { ultimo = (await api("/api/schede")).ultimo || {}; } catch (_) {}
  store.set("sessione", {
    id: scheda.id, nome: scheda.nome, inizio: localIso(), inizioMs: Date.now(),
    esercizi: scheda.esercizi.map((e) => {
      const pr = progression(e, ultimo[e.nome]);
      return { nome: e.nome, min: e.min, max: e.max, note: e.note || "", consiglio: pr.testo,
        serie: Array.from({ length: e.serie }, (_, i) => ({ kg: pr.kg ?? ultimo[e.nome]?.serie[i]?.kg ?? null, reps: null, fatto: false })) };
    }),
  });
  route("sessione");
}

// sessions finished without connection wait here and are sent later
async function flushQueue() {
  const q = store.get("coda", []);
  if (!q.length) return 0;
  const left = [];
  for (const job of q) { try { await api("/api/forza", { method: "POST", body: { serie: job } }); } catch (_) { left.push(job); } }
  store.set("coda", left);
  return q.length - left.length;
}

views.palestra = async (el) => {
  el.innerHTML = header("Palestra") + loading(2);
  const sent = await flushQueue();
  const [{ schede }, forza] = await Promise.all([api("/api/schede"), api("/api/forza").catch(() => null)]);
  const cur = store.get("sessione", null), queued = store.get("coda", []).length;
  let html = header("Palestra");
  if (sent) html += `<div class="card soft small">Inviati ${sent} allenamenti salvati senza rete ✓</div>`;
  if (queued) html += `<div class="card soft small">${queued} allenamenti in attesa di connessione: li invio appena c'è rete.</div>`;
  if ((store.get("profilo", {}) || {}).infortunio?.attivo) html += `<a class="card col" href="#/oggi" style="gap:4px;background:#FDE2DF;text-decoration:none;color:inherit"><div style="font-weight:900;color:var(--red-ink)">🩹 Sei in modalità infortunio</div><div class="small" style="line-height:1.5">Le schede normali per ora sono in pausa: nella pagina Oggi trovi cosa fare per riabilitazione e resto del corpo.</div></a>`;
  if (cur) html += `<a class="btn orange block" href="#/sessione" style="justify-content:space-between;min-height:60px;border-radius:20px"><span class="col" style="gap:0;text-align:left"><span style="font-weight:900">Allenamento in corso</span><span class="small" style="font-weight:600">${esc(cur.nome)} · ${Math.round((Date.now() - cur.inizioMs) / 60000)} min</span></span>${ico.arrow}</a>`;
  html += `<div class="row between" style="padding:0 2px"><div class="label">Le tue schede</div><button class="small" id="aiSchede" style="background:none;border:0;color:var(--orange-ink);font-weight:800;cursor:pointer">✨ Crea con il coach</button></div>`;
  html += schede.length ? schede.map((sc, i) => `<div class="card col" style="gap:10px">
      <div class="row between"><div class="h2">${esc(sc.nome)}</div><a class="small" href="#/scheda?id=${encodeURIComponent(sc.id)}" style="font-weight:800">Modifica</a></div>
      <div class="small muted" style="line-height:1.5">${sc.esercizi.map((e) => `${esc(e.nome)} <span style="white-space:nowrap">${e.serie}×${e.min}${e.max !== e.min ? "–" + e.max : ""}</span>`).join(" · ")}</div>
      <button class="btn primary" data-start="${i}">Inizia allenamento</button></div>`).join("")
    : `<div class="card col" style="gap:10px"><div class="h2">Nessuna scheda</div><div class="small" style="line-height:1.5;color:var(--text)">Descrivi al coach i tuoi allenamenti (es. «Lunedì: panca 4x8-10, croci 3x12…») e compila lui le schede. Oppure creale a mano.</div>
      <button class="btn primary" id="aiSchede2">✨ Crea le schede con il coach</button><a class="btn ghost" href="#/scheda?id=nuova">Crea a mano</a></div>`;
  if (schede.length) html += `<a class="btn ghost" href="#/scheda?id=nuova">+ Nuova scheda</a>`;
  // fatigue per muscle group: what is still tired and weekly volume (10-20 sets per muscle)
  if (forza && forza.muscoli?.length) {
    const ST = { stanco: "err", "in recupero": "warn", fresco: "ok" };
    html += `<div class="card col" style="gap:8px"><div class="row between"><div class="label">Muscoli</div><span class="small muted">serie in 7 giorni</span></div>
      <div class="list">${forza.muscoli.map((m) => `<div class="item"><span class="row" style="gap:10px"><span class="status-dot ${ST[m.stato]}"></span><span style="text-transform:capitalize">${esc(m.muscolo)}</span><span class="small muted" style="font-weight:600">${esc(m.stato)}</span></span><span class="small ${m.volume === "giusto" ? "muted" : "mid"}" style="font-weight:700">${m.serie_7g}${m.volume !== "giusto" ? ` · ${m.volume}` : ""}</span></div>`).join("")}</div>
      <div class="small muted" style="line-height:1.45">Stanco = allenato nelle ultime 24–48 ore: l'allenamento del giorno sceglie la scheda con i muscoli più freschi. Per crescere servono circa 10–20 serie a settimana per muscolo.</div></div>`;
  }
  // exercises Kairo cannot link to a muscle: the person chooses once
  if (forza && forza.non_riconosciuti?.length) {
    html += `<div class="card col" style="gap:8px"><div class="label">Esercizi da collegare</div><div class="small muted" style="line-height:1.45">Non so quale muscolo allenano: scegli tu, così contano nella fatica e nella scelta della scheda.</div>
      <div class="list">${forza.non_riconosciuti.map((n) => `<div class="item"><span style="font-weight:700">${esc(n)}</span><select class="input" data-mus="${esc(n)}" style="width:auto;min-height:38px;padding:4px 8px"><option value="">scegli…</option>${forza.elenco_muscoli.map((m) => `<option value="${m}">${m}</option>`).join("")}<option value="nessuno">nessuno (cardio, stretching)</option></select></div>`).join("")}</div></div>`;
  }
  // progress of the main lifts
  if (forza && forza.esercizi.length) {
    const maxSets = Math.max(1, ...forza.serie_per_settimana);
    html += `<div class="card col" style="gap:10px"><div class="row between"><div class="label">Progressione dei carichi</div><span class="small muted">massimale stimato</span></div>
      <div class="list">${forza.esercizi.slice(0, 5).map((e, i) => {
        const cur2 = e.max_4_settimane, prev = e.max_4_precedenti, d = cur2 != null && prev != null ? cur2 - prev : null, stuck = e.settimane_dal_record >= 4;
        return `<button class="item" data-ex="${i}"><div class="col" style="gap:2px;text-align:left"><b>${esc(e.esercizio)}</b><span class="small ${stuck ? "mid" : "muted"}">${stuck ? `nessun record da ${e.settimane_dal_record} settimane` : `record ${fmtNum(e.record, 1)} kg`}</span></div>
          <div style="text-align:right"><div class="big" style="font-size:20px">${cur2 != null ? fmtNum(cur2, 1) : "–"} <span class="small muted">kg</span></div>${d != null ? `<span class="small ${d >= 0 ? "good" : "bad"}">${signed(d, 1)} in 4 settimane</span>` : ""}</div></button>`; }).join("")}</div>
      <div class="col" style="gap:4px"><div class="small muted">Serie per settimana (ultime 8)</div><div class="row" style="gap:4px;align-items:flex-end;height:44px">${forza.serie_per_settimana.map((n, i) => `<div style="flex:1;height:${Math.max(3, (n / maxSets) * 44)}px;background:${i === 7 ? "var(--orange)" : "#C9CEDB"};border-radius:4px" title="${n} serie"></div>`).join("")}</div></div></div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll("[data-start]").forEach((b) => (b.onclick = () => startSession(schede[Number(b.dataset.start)])));
  el.querySelectorAll("[data-mus]").forEach((sel) => (sel.onchange = async () => {
    if (!sel.value) return;
    try { await api("/api/muscoli", { method: "POST", body: { esercizio: sel.dataset.mus, muscolo: sel.value } }); toast("Collegato"); views.palestra(el); } catch (e) { toast(e.message); }
  }));
  for (const id of ["#aiSchede", "#aiSchede2"]) { const b = $(id); if (b) b.onclick = () => aiSchedeSheet(schede); }
  el.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => {
    const e = forza.esercizi[Number(b.dataset.ex)];
    openSheet(`${sheetHead(esc(e.esercizio))}<div class="small muted">Massimale stimato (formula di Epley) della serie migliore di ogni seduta</div>${timeChart(e.storico, "#FF8A1F", "")}
      <div style="line-height:1.55;color:var(--text)">${e.settimane_dal_record >= 4 ? `Nessun nuovo record da <b>${e.settimane_dal_record} settimane</b>. Di solito aiuta una settimana di scarico (−40% di serie) e poi ripartire con un piccolo aumento di carico o un cambio di ripetizioni.` : `Ultimo record il ${fmtDate(e.record_il, { day: "numeric", month: "long" })}: la progressione sta funzionando.`}</div>`, "Esercizio");
  }));
};

// The coach turns a free description into routines; you check them before saving.
function aiSchedeSheet(current) {
  const w = openSheet(`${sheetHead("Schede con il coach")}
    <div class="small" style="line-height:1.5;color:var(--text)">Scrivi i tuoi allenamenti come li diresti a un amico: giorni, esercizi, serie e ripetizioni. Il coach li trasforma in schede.</div>
    <textarea class="input" id="aiTxt" rows="8" style="padding:12px;min-height:180px" placeholder="Es.\nScheda A petto e tricipiti: panca piana 4x8-10, panca inclinata manubri 3x10-12, croci ai cavi 3x12-15, french press 3x10\nScheda B schiena: trazioni 4x6-8, rematore bilanciere 4x8-10…"></textarea>
    <button class="btn primary" id="aiGo">Compila le schede</button><div id="aiOut"></div>`, "Schede con il coach");
  w.querySelector("#aiGo").onclick = async () => {
    const out = w.querySelector("#aiOut"), txt = w.querySelector("#aiTxt").value;
    out.innerHTML = '<div class="skeleton" style="height:80px"></div>';
    try {
      const r = await api("/api/schede/ia", { method: "POST", body: { testo: txt } });
      if (r.errore) { out.innerHTML = `<div class="small bad">${esc(r.errore)}</div>`; return; }
      out.innerHTML = `<div class="small muted">${r.fonte === "ia" ? "Compilate dal coach" : "Lette dal testo (IA non disponibile)"}: controlla e salva.</div>
        ${r.schede.map((sc) => `<div class="card col" style="gap:6px"><b>${esc(sc.nome)}</b>${sc.esercizi.map((e) => `<div class="row between small"><span>${esc(e.nome)}</span><b>${e.serie} × ${e.min}${e.max !== e.min ? "–" + e.max : ""}</b></div>`).join("")}</div>`).join("")}
        <div class="row">${current.length ? `<button class="btn ghost" id="aiAdd" style="flex:1">Aggiungi alle mie</button>` : ""}<button class="btn primary" id="aiSave" style="flex:1">${current.length ? "Sostituisci le mie" : "Salva le schede"}</button></div>`;
      const save = async (list) => { try { await api("/api/schede", { method: "PUT", body: { schede: list } }); closeSheet(); toast("Schede salvate"); router(); } catch (e) { toast(e.message); } };
      out.querySelector("#aiSave").onclick = () => save(r.schede);
      const add = out.querySelector("#aiAdd"); if (add) add.onclick = () => save([...current, ...r.schede]);
    } catch (e) { out.innerHTML = `<div class="small bad">${esc(e.message)}</div>`; }
  };
}

// Manual editor of one routine
views.scheda = async (el) => {
  const id = new URLSearchParams(location.hash.split("?")[1] || "").get("id");
  const { schede } = await api("/api/schede");
  const isNew = id === "nuova";
  const sc = isNew ? { id: "s" + Date.now().toString(36), nome: `Scheda ${String.fromCharCode(65 + schede.length)}`, esercizi: [{ nome: "", serie: 3, min: 8, max: 10, note: "" }] } : JSON.parse(JSON.stringify(schede.find((x) => x.id === id) || {}));
  if (!sc.esercizi) return route("palestra");
  const draw = () => {
    el.innerHTML = `${header(isNew ? "Nuova scheda" : "Modifica scheda", { back: "palestra", gear: false })}
      <div class="card col" style="gap:10px"><label class="field">Nome<input class="input" id="scNome" value="${esc(sc.nome)}" maxlength="60"></label></div>
      ${sc.esercizi.map((e, i) => `<div class="card col" style="gap:8px">
        <div class="row" style="gap:8px"><input class="input" data-f="nome" data-i="${i}" value="${esc(e.nome)}" placeholder="Esercizio" maxlength="80"><button class="iconbtn" data-del="${i}" aria-label="Elimina esercizio" style="background:var(--bg)">${ico.close}</button></div>
        <div class="row" style="gap:8px"><label class="field" style="flex:1;font-size:13px">Serie<input class="input" type="number" inputmode="numeric" min="1" max="10" data-f="serie" data-i="${i}" value="${e.serie}"></label>
          <label class="field" style="flex:1;font-size:13px">Rip. min<input class="input" type="number" inputmode="numeric" min="1" max="50" data-f="min" data-i="${i}" value="${e.min}"></label>
          <label class="field" style="flex:1;font-size:13px">Rip. max<input class="input" type="number" inputmode="numeric" min="1" max="60" data-f="max" data-i="${i}" value="${e.max}"></label></div></div>`).join("")}
      <button class="btn ghost" id="addEx">+ Aggiungi esercizio</button>
      <button class="btn primary" id="saveSc">Salva scheda</button>
      ${isNew ? "" : `<button class="btn danger" id="delSc">Elimina scheda</button>`}`;
    el.querySelectorAll("[data-f]").forEach((inp) => (inp.oninput = () => { const e = sc.esercizi[Number(inp.dataset.i)]; e[inp.dataset.f] = inp.dataset.f === "nome" ? inp.value : Number(inp.value); }));
    el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { sc.esercizi.splice(Number(b.dataset.del), 1); draw(); }));
    $("#scNome").oninput = (e) => (sc.nome = e.target.value);
    $("#addEx").onclick = () => { sc.esercizi.push({ nome: "", serie: 3, min: 8, max: 10, note: "" }); draw(); };
    $("#saveSc").onclick = async () => {
      sc.esercizi = sc.esercizi.filter((e) => e.nome.trim());
      for (const e of sc.esercizi) if (e.max < e.min) e.max = e.min;
      const list = isNew ? [...schede, sc] : schede.map((x) => (x.id === sc.id ? sc : x));
      try { await api("/api/schede", { method: "PUT", body: { schede: list } }); toast("Scheda salvata"); route("palestra"); } catch (err) { toast(err.message); }
    };
    const del = $("#delSc");
    if (del) del.onclick = async () => { if (!confirm(`Eliminare ${sc.nome}? Gli allenamenti già fatti restano.`)) return; await api("/api/schede", { method: "PUT", body: { schede: schede.filter((x) => x.id !== sc.id) } }); route("palestra"); };
  };
  draw();
};

// Live session: stays on the phone (works offline), sent to the server when you finish
let wakeLock = null;
views.sessione = async (el) => {
  const ses = store.get("sessione", null);
  if (!ses) return route("palestra");
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (_) {}
  const save = () => store.set("sessione", ses);
  const draw = () => {
    const done = ses.esercizi.reduce((a, e) => a + e.serie.filter((x) => x.fatto).length, 0), tot = ses.esercizi.reduce((a, e) => a + e.serie.length, 0);
    el.innerHTML = `${header(esc(ses.nome), { back: "palestra", gear: false, sub: `${Math.round((Date.now() - ses.inizioMs) / 60000)} min · ${done}/${tot} serie` })}
      ${ses.esercizi.map((e, i) => `<div class="card col" style="gap:8px">
        <div class="row between"><div class="h2" style="font-size:18px">${esc(e.nome)}</div><span class="small muted" style="white-space:nowrap">${e.min}${e.max !== e.min ? "–" + e.max : ""} rip.</span></div>
        ${e.consiglio ? `<div class="small muted" style="line-height:1.4">${esc(e.consiglio)}</div>` : ""}
        ${e.serie.map((x, j) => `<div class="row" style="gap:8px;${x.fatto ? "opacity:.6" : ""}">
          <span class="small" style="width:52px;font-weight:800">Serie ${j + 1}</span>
          <input class="input" type="number" inputmode="decimal" step="0.5" min="0" placeholder="kg" data-k="${i}.${j}" value="${x.kg ?? ""}" style="flex:1;min-height:44px" aria-label="Chili serie ${j + 1}">
          <input class="input" type="number" inputmode="numeric" min="0" max="100" placeholder="${e.min}${e.max !== e.min ? "–" + e.max : ""}" data-r="${i}.${j}" value="${x.reps ?? ""}" style="flex:1;min-height:44px" aria-label="Ripetizioni serie ${j + 1}">
          <button class="choice" data-ok="${i}.${j}" aria-pressed="${x.fatto}" style="min-height:44px;width:52px" aria-label="Serie fatta">✓</button></div>`).join("")}
        <button class="small" data-add="${i}" style="background:none;border:0;color:var(--orange-ink);font-weight:800;cursor:pointer;align-self:flex-start">+ serie</button></div>`).join("")}
      <button class="btn primary block" id="finish">Termina allenamento</button>
      <button class="btn ghost block" id="abandon">Abbandona</button>`;
    const at = (v) => v.split(".").map(Number);
    el.querySelectorAll("[data-k]").forEach((inp) => (inp.onchange = () => { const [i, j] = at(inp.dataset.k); ses.esercizi[i].serie[j].kg = inp.value === "" ? null : Number(inp.value); save(); }));
    el.querySelectorAll("[data-r]").forEach((inp) => (inp.onchange = () => { const [i, j] = at(inp.dataset.r); ses.esercizi[i].serie[j].reps = inp.value === "" ? null : Number(inp.value); save(); }));
    el.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => {
      const [i, j] = at(b.dataset.ok), x = ses.esercizi[i].serie[j];
      x.fatto = !x.fatto;
      if (x.fatto && x.reps == null) x.reps = ses.esercizi[i].max; // tick without typing = top of the range
      // the next set starts with the same weight
      const nx = ses.esercizi[i].serie[j + 1]; if (x.fatto && nx && nx.kg == null) nx.kg = x.kg;
      save(); const y = window.scrollY; draw(); window.scrollTo(0, y);
    }));
    el.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => { const e = ses.esercizi[Number(b.dataset.add)]; e.serie.push({ kg: e.serie[e.serie.length - 1]?.kg ?? null, reps: null, fatto: false }); save(); draw(); }));
    $("#abandon").onclick = () => { if (confirm("Abbandonare l'allenamento? Le serie segnate non verranno salvate.")) { store.del("sessione"); route("palestra"); } };
    $("#finish").onclick = () => finishSheet(ses);
  };
  draw();
};

// End of session: how hard was it (session RPE), then send — or keep it queued without connection
function finishSheet(ses) {
  let rpe = 7;
  const w = openSheet(`${sheetHead("Fine allenamento")}
    <div class="col" style="gap:6px"><label class="row between" for="rpeF" style="font-weight:800"><span>Quanto è stato duro?</span><span id="rpeV" style="color:var(--orange-ink)">7/10</span></label>
      <input id="rpeF" type="range" min="1" max="10" value="7"><div class="row between small muted"><span>1 facilissimo</span><span>10 al limite</span></div></div>
    <div class="small muted" style="line-height:1.5">Serve a calcolare il carico della seduta (durata × fatica, metodo di Foster).</div>
    <button class="btn primary block" id="sendF">Salva allenamento</button>`, "Fine allenamento");
  w.querySelector("#rpeF").oninput = (e) => { rpe = Number(e.target.value); w.querySelector("#rpeV").textContent = rpe + "/10"; };
  w.querySelector("#sendF").onclick = async () => {
    const end = localIso();
    const serie = ses.esercizi.flatMap((e) => e.serie.filter((x) => x.fatto).map((x, j) => ({ start: ses.inizio, end, workout: ses.nome, exercise: e.nome, set_index: j, set_type: "normal", weight: x.kg, reps: x.reps, rpe, fonte: "kairo" })));
    if (!serie.length) { toast("Nessuna serie segnata"); return; }
    try { await api("/api/forza", { method: "POST", body: { serie } }); toast(`Salvato: ${serie.length} serie`); }
    catch (_) { store.set("coda", [...store.get("coda", []), serie]); toast("Senza rete: lo invio appena possibile"); }
    store.del("sessione");
    try { await wakeLock?.release(); } catch (_) {}
    closeSheet(); route("palestra");
  };
}

/* ---------- check-in ---------- */
function checkinSheet(existing, askSleep = false, detected = []) {
  // training sessions the Watch detected yesterday (from heart rate): duration and sport prefilled
  const detMin = detected.reduce((a, x) => a + x.minuti, 0), detSport = detected.map((x) => x.sport).find(Boolean);
  const s = { energia: existing?.energia ?? 3, dolori: existing?.dolori ?? 2, umore: existing?.umore ?? 3,
    act: new Set((existing?.attivita || (!existing && detSport ? detSport : "")).split(",").filter(Boolean)), rpe: existing?.rpe ?? 6,
    durata: existing?.durata_min ?? (detMin ? Math.min(240, Math.round(detMin / 5) * 5) : 60), sonno: existing?.sonno_min ?? 450,
    tag: new Set((existing?.tag || "").split(",").filter(Boolean)) };
  const ACTS = [["palestra", "Palestra"], ["nuoto", "Nuoto"], ["bici", "Bici"], ["calcio", "Calcio"], ["corsa", "Corsa"], ["camminata", "Camminata"], ["altro", "Altro"], ["riposo", "Riposo"]];
  const scale = (k, label, hint) => `<div class="col"><div class="row between"><div style="font-weight:800">${label}</div><div class="small muted">${hint}</div></div>
    <div class="scale" role="group" aria-label="${label}">${[1, 2, 3, 4, 5].map((n) => `<button class="choice" data-k="${k}" data-v="${n}" aria-pressed="${s[k] === n}">${n}</button>`).join("")}</div></div>`;
  const draw = () => {
    const sport = [...s.act].some((a) => a !== "riposo");
    w.querySelector(".sheet").innerHTML = `<div class="grab"></div>${sheetHead("Check-in")}
      <div class="muted">Com'è andata ieri, e come ti senti oggi?</div>
      ${askSleep ? `<div class="card col"><label class="row between" for="slp" style="font-weight:800"><span>Quanto hai dormito? <span class="small muted" style="font-weight:600">(senza Watch)</span></span><span style="color:var(--orange-ink)">${fmtMin(s.sonno)}</span></label><input id="slp" type="range" min="180" max="720" step="15" value="${s.sonno}"></div>` : ""}
      ${scale("energia", "Energia", "1 a terra · 5 al top")}${scale("dolori", "Indolenzimento", "1 niente · 5 tanto")}${scale("umore", "Umore", "1 giù · 5 alle stelle")}
      ${detMin ? `<div class="card soft small" style="line-height:1.45">⌚ Il Watch ha rilevato ieri <b>${detMin} min</b> di allenamento${detected.length > 1 ? ` in ${detected.length} sessioni` : ""} · FC media ${Math.round(detected.reduce((a, x) => a + x.fc_media * x.minuti, 0) / detMin)}${detSport ? ` · probabilmente <b>${esc(detSport)}</b>` : ""}. Dimmi cos'era.</div>` : ""}
      <div class="col"><div style="font-weight:800">Cosa hai fatto ieri</div><div class="acts" style="grid-template-columns:repeat(4,minmax(0,1fr))">${ACTS.map(([k, l]) => `<button class="choice" data-a="${k}" aria-pressed="${s.act.has(k)}">${l}</button>`).join("")}</div></div>
      ${sport ? `<div class="card col"><label class="row between" for="rpe" style="font-weight:800"><span>Quanto è stata dura?</span><span style="color:var(--orange-ink)">RPE ${s.rpe}</span></label><input id="rpe" type="range" min="1" max="10" value="${s.rpe}">
        <label class="row between" for="dur" style="font-weight:800"><span>Durata</span><span class="muted">${s.durata} min</span></label><input id="dur" type="range" min="10" max="240" step="5" value="${s.durata}"></div>` : ""}
      <div class="col"><div style="font-weight:800">Ieri sera o stanotte <span class="small muted" style="font-weight:600">(facoltativo)</span></div><div class="acts" style="grid-template-columns:repeat(3,minmax(0,1fr))">${["alcol", "malanno", "viaggio", "stress", "cena tardi", "allenamento serale"].map((k) => `<button class="choice" data-tag="${k}" aria-pressed="${s.tag.has(k)}" style="font-size:13px">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div><span class="hint">Spiegano un recupero diverso dal solito; alcol, malanno e viaggio non entrano nelle tue medie.</span></div>
      <button class="btn primary block" id="save">Salva check-in</button>`;
    w.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => { s[b.dataset.k] = Number(b.dataset.v); draw(); }));
    w.querySelectorAll("[data-tag]").forEach((b) => b.addEventListener("click", () => { s.tag.has(b.dataset.tag) ? s.tag.delete(b.dataset.tag) : s.tag.add(b.dataset.tag); draw(); }));
    w.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.a;
      if (k === "riposo") { s.act = s.act.has("riposo") ? new Set() : new Set(["riposo"]); }
      else { s.act.delete("riposo"); s.act.has(k) ? s.act.delete(k) : s.act.add(k); }
      draw();
    }));
    const rpe = w.querySelector("#rpe"); if (rpe) rpe.addEventListener("input", (e) => { s.rpe = Number(e.target.value); e.target.previousElementSibling.lastElementChild.textContent = "RPE " + s.rpe; });
    const slp = w.querySelector("#slp"); if (slp) slp.addEventListener("input", (e) => { s.sonno = Number(e.target.value); e.target.previousElementSibling.lastElementChild.textContent = fmtMin(s.sonno); });
    const dur = w.querySelector("#dur"); if (dur) dur.addEventListener("input", (e) => { s.durata = Number(e.target.value); e.target.previousElementSibling.lastElementChild.textContent = s.durata + " min"; });
    w.querySelector("#save").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const sportNow = [...s.act].some((a) => a !== "riposo");
        await api("/api/checkin", { method: "POST", body: { day: todayStr(), energia: s.energia, dolori: s.dolori, umore: s.umore, attivita: [...s.act].join(","), rpe: sportNow ? s.rpe : null, durata_min: sportNow ? s.durata : null, sonno_min: askSleep ? s.sonno : existing?.sonno_min ?? null, tag: [...s.tag].join(",") } });
        closeSheet(); toast("Check-in salvato"); router();
      } catch (err) { e.target.disabled = false; toast(err.message); }
    });
  };
  const w = openSheet("", "Check-in");
  draw();
}

/* ---------- settings ---------- */
/* ---------- settings: a simple menu, every row opens its own page ---------- */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const subHeader = (t, sub = "") => header(t, { back: "impostazioni", gear: false, sub });
const row = (href, icon, title, value = "", id = "") => `<a class="item" href="#/${href}"${id ? ` id="${id}"` : ""}><span class="row" style="gap:12px"><span style="width:26px;text-align:center;font-size:18px">${icon}</span><span>${title}</span></span><span class="row" style="gap:6px"><span class="small muted" style="font-weight:600;text-align:right" data-val>${value}</span>${ico.chevron}</span></a>`;
const group = (title, rows) => `<div class="col" style="gap:6px"><div class="label" style="padding:0 6px">${title}</div><div class="card list" style="padding:4px 16px">${rows}</div></div>`;

views.impostazioni = async (el) => {
  await loadProfile();
  const c = cfg(), p = c.profilo, inj = p.infortunio?.attivo;
  const sports = (p.sport || []).map((s) => SPORT[s]).join(", ");
  el.innerHTML = `${header("Impostazioni", { back: "oggi", gear: false })}
    ${group("Tu", row("profilo", "👤", "Profilo", esc([p.nome, p.eta ? `${p.eta} anni` : ""].filter(Boolean).join(" · ") || "da completare"))
      + row("sport", inj ? "🩹" : "🏅", "Sport e infortunio", inj ? `<span class="bad">infortunio attivo</span>` : esc(sports || "nessuno"))
      + row("memoria", "🧠", "Cosa ricorda il coach", "", "rowMem"))}
    ${group("App", row("notifiche", "🔔", "Notifiche", "", "rowPush")
      + row("ia", "✨", "Coach IA", "", "rowIa")
      + row("collegamento", "📱", "Collegamento iPhone", "", "rowSync"))}
    ${group("Dati", row("importa", "⬇️", "Importa dati", "Salute, Hevy, Strong")
      + row("backup", "💾", "Backup ed esportazione", "", "rowBk")
      + row("diagnostica", "🩺", "Stato di Kairo", "", "rowDiag"))}
    ${group("Altro", row("account", "🔑", "Codice di accesso e account")
      + row("guida", "📖", "Guida")
      + row("info", "ℹ️", "Informazioni e open source"))}
    <div class="small muted center" style="display:flex;justify-content:center">Kairo ${APP_VERSION}</div>`;
  const set = (id, html) => { const v = $(`#${id} [data-val]`); if (v) v.innerHTML = html; };
  api("/api/ia/chiave").then((r) => set("rowIa", r.sul_server || r.segreto_cloudflare || cfg().groqKey ? "Groq" : "modello di riserva")).catch(() => {});
  api("/api/memoria").then((r) => set("rowMem", r.memoria.length ? `${r.memoria.length} ricordi` : "niente")).catch(() => {});
  if (pushSupported()) navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => set("rowPush", s ? "attive" : "spente")).catch(() => {});
  else set("rowPush", "non disponibili");
  try {
    const d = await api("/api/diagnostica");
    const last = d.importazioni[0];
    set("rowSync", last ? `ultimo invio ${ago(last.received)}` : `<span class="bad">mai</span>`);
    set("rowBk", d.backup?.ultimo ? ago(d.backup.ultimo.creato) : d.backup?.attivo ? "nessuno" : "non attivi");
    const checks = healthChecks(d, null, 0, null);
    const bad = checks.filter((x) => x.s === "err").length, warn = checks.filter((x) => x.s === "warn").length;
    set("rowDiag", bad ? `<span class="bad">${bad + warn} da sistemare</span>` : warn ? `<span class="mid">${warn} da controllare</span>` : `<span class="good">tutto ok</span>`);
  } catch (_) { set("rowDiag", `<span class="bad">server non raggiungibile</span>`); }
};

// ---- Profilo ----
views.profilo = async (el) => {
  await loadProfile();
  const p = cfg().profilo;
  const sleepOpts = [[420, "7 h"], [450, "7 h 30"], [480, "8 h"], [510, "8 h 30"], [540, "9 h"]];
  el.innerHTML = `${subHeader("Profilo", "Il coach lo usa per i consigli")}
    <div class="card col" style="gap:12px">
      <label class="field">Nome<input class="input" id="nome" value="${esc(p.nome)}" autocomplete="given-name"></label>
      <div class="grid2"><label class="field">Età<input class="input" id="eta" type="number" inputmode="numeric" min="12" max="99" value="${esc(p.eta || "")}"></label>
        <label class="field">Sesso<select class="input" id="sesso"><option value="">–</option><option value="M" ${p.sesso === "M" ? "selected" : ""}>Uomo</option><option value="F" ${p.sesso === "F" ? "selected" : ""}>Donna</option></select></label></div>
      <label class="field">I tuoi obiettivi<textarea class="input" id="obiettivi" rows="2" style="padding:12px;min-height:64px" placeholder="Es. scendere al 12% di grasso, nuotare 2 km senza fermarmi">${esc(p.obiettivi || "")}</textarea></label>
      <label class="field">Chi sei e come ti alleni<textarea class="input" id="note" rows="3" style="padding:12px;min-height:84px" placeholder="Es. palestra 3 volte a settimana, nuoto 1-2 volte, bici nel weekend">${esc(p.note)}</textarea></label>
      <div class="grid2"><label class="field">Sveglia abituale<input class="input" id="sveglia" type="time" value="${esc(p.sveglia || "")}"></label>
        <label class="field">Sonno che ti serve<select class="input" id="sonnomin"><option value="" ${!p.sonno_min ? "selected" : ""}>Automatico</option>${sleepOpts.map(([v, l]) => `<option value="${v}" ${p.sonno_min === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <span class="hint" style="margin-top:-6px">La sveglia serve per dirti a che ora andare a letto. «Automatico» impara quanto ti serve dalle notti dopo cui ti svegli recuperato.</span>
      <label class="field">FC massima (se la conosci)<input class="input" id="fcmax" type="number" inputmode="numeric" min="120" max="230" placeholder="${p.eta ? `stimata ${Math.round(208 - 0.7 * p.eta)} bpm` : "es. 195"}" value="${esc(p.fc_max || "")}"><span class="hint">Serve a calcolare il carico. Vuota = stima dall'età.</span></label>
      <button class="btn primary" id="saveProfilo">Salva</button></div>`;
  $("#saveProfilo").onclick = async () => {
    const body = { ...p, nome: $("#nome").value.trim(), eta: $("#eta").value.trim(), sesso: $("#sesso").value, note: $("#note").value.trim(), obiettivi: $("#obiettivi").value.trim(),
      sveglia: $("#sveglia").value, sonno_min: $("#sonnomin").value ? Number($("#sonnomin").value) : null, fc_max: $("#fcmax").value.trim(), tz: tz() };
    delete body.infortunio;
    try { const saved = await api("/api/profilo", { method: "POST", body }); store.set("profilo", saved); toast("Profilo salvato"); route("impostazioni"); }
    catch (e) { toast(e.message); }
  };
};

// ---- Sport e infortunio ----
views.sport = async (el) => {
  await loadProfile();
  const p = cfg().profilo, inj = p.infortunio || {};
  el.innerHTML = `${subHeader("Sport e infortunio")}
    <div class="card col" style="gap:10px"><div class="h2">I tuoi sport</div>
      <div class="small muted">L'allenamento del giorno sceglie solo tra questi.</div>
      <div class="acts" style="grid-template-columns:repeat(2,minmax(0,1fr))">${Object.entries(SPORT).map(([k, l]) => `<button type="button" class="choice" data-sport="${k}" aria-pressed="${(p.sport || []).includes(k)}">${l}</button>`).join("")}</div>
      <button class="btn primary" id="saveSport">Salva</button></div>
    <div class="card col" style="gap:10px"><div class="row between"><div class="h2">Infortunio</div>${inj.attivo ? `<span class="pill bad">attivo</span>` : ""}</div>
      <div class="small muted" style="line-height:1.45">${inj.attivo ? esc(inj.descrizione) : "Se ti fai male, il coach smette di proporti allenamenti normali e ti dice ogni giorno se riposare, quali esercizi riabilitativi fare o come allenare il resto del corpo, rispettando le indicazioni del medico."}</div>
      ${inj.attivo ? `<button class="btn ghost" id="injEditS">Modifica infortunio e indicazioni del medico</button><button class="btn primary" id="injOffS">Sono guarito</button>` : `<button class="btn ghost" id="injOnS">🩹 Attiva la modalità infortunio</button>`}</div>`;
  el.querySelectorAll("[data-sport]").forEach((b) => (b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true")));
  $("#saveSport").onclick = async () => {
    const sport = [...el.querySelectorAll("[data-sport]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.sport);
    if (!sport.length) { toast("Scegli almeno uno sport"); return; }
    const body = { ...p, sport, tz: tz() }; delete body.infortunio;
    try { const saved = await api("/api/profilo", { method: "POST", body }); store.set("profilo", saved); toast("Sport salvati"); } catch (e) { toast(e.message); }
  };
  const on = $("#injOnS"), ed = $("#injEditS"), off = $("#injOffS");
  if (on) on.onclick = () => injurySheet();
  if (ed) ed.onclick = () => injurySheet();
  if (off) off.onclick = async () => { try { const saved = await api("/api/infortunio", { method: "POST", body: { attivo: false } }); store.set("profilo", saved); toast("Bentornato! Si riparte con calma"); router(); } catch (e) { toast(e.message); } };
};

// ---- Cosa ricorda il coach ----
views.memoria = async (el) => {
  el.innerHTML = `${subHeader("Cosa ricorda il coach")}
    <div class="small muted" style="line-height:1.5;padding:0 4px">Quando in chat gli racconti qualcosa di importante (una gara, un dolore, un obiettivo) il coach se lo segna e lo usa nei consigli.</div>
    <div class="card list" id="memList" style="padding:4px 16px"><div class="skeleton" style="height:40px;margin:10px 0"></div></div>
    <div class="row"><input class="input" id="memNew" maxlength="240" placeholder="Aggiungi, es. gara 10 km il 15 novembre" style="flex:1"><button class="btn primary" id="memAdd">Aggiungi</button></div>`;
  const memLoad = async () => {
    const box = $("#memList"); if (!box) return;
    try {
      const { memoria } = await api("/api/memoria");
      box.innerHTML = memoria.length ? memoria.map((m) => `<div class="item" style="gap:10px;align-items:flex-start"><div style="flex:1;line-height:1.4;font-weight:600">${esc(m.testo)}<div class="small muted" style="font-weight:500">${m.fonte === "utente" ? "aggiunto da te" : "dal coach"} · ${esc(m.creato)}</div></div><button class="iconbtn" data-mem="${m.id}" aria-label="Elimina" style="color:var(--muted)">✕</button></div>`).join("")
        : `<div class="small muted" style="padding:14px 0">Ancora niente: parla con il coach o aggiungi qui sotto.</div>`;
      box.querySelectorAll("[data-mem]").forEach((b) => (b.onclick = async () => { try { await api("/api/memoria?id=" + b.dataset.mem, { method: "DELETE" }); memLoad(); } catch (e) { toast(e.message); } }));
    } catch (e) { box.textContent = e.message; }
  };
  memLoad();
  $("#memAdd").onclick = async () => {
    const t = $("#memNew").value.trim(); if (!t) return;
    try { const r = await api("/api/memoria", { method: "POST", body: { testo: t } }); if (r.errore) return toast(r.errore); $("#memNew").value = ""; memLoad(); } catch (e) { toast(e.message); }
  };
};

// ---- Notifiche ----
views.notifiche = async (el) => {
  el.innerHTML = `${subHeader("Notifiche")}
    <div class="card col" style="gap:12px">
      <div class="small" style="line-height:1.5;color:var(--text)">Solo due al giorno: <b>la mattina</b> recupero e allenamento di oggi, <b>la sera</b> l'orario per andare a letto.</div>
      <div class="row"><button class="btn primary" id="pushOn" style="flex:2">Attiva</button><button class="btn ghost" id="pushTest" style="flex:1" disabled>Prova</button></div>
      <div id="pushOut" class="small"></div></div>`;
  const pushState = async () => {
    if (!pushSupported()) { $("#pushOn").disabled = true; $("#pushOut").innerHTML = /iPhone|iPad/.test(navigator.userAgent) && !isStandalone() ? "Su iPhone le notifiche funzionano solo con Kairo aggiunto alla schermata Home: aprilo dall'icona e torna qui." : "Questo browser non supporta le notifiche."; return null; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    $("#pushOn").textContent = sub ? "Disattiva" : "Attiva"; $("#pushTest").disabled = !sub;
    return sub;
  };
  pushState().catch(() => {});
  $("#pushOn").onclick = async () => {
    const out = $("#pushOut");
    try {
      const reg = await navigator.serviceWorker.ready;
      const cur = await reg.pushManager.getSubscription();
      if (cur) { await api("/api/push/iscrivi", { method: "DELETE", body: { endpoint: cur.endpoint } }); await cur.unsubscribe(); out.textContent = "Notifiche disattivate."; return pushState(); }
      if ((await Notification.requestPermission()) !== "granted") { out.textContent = "Permesso negato: puoi attivarlo nelle impostazioni del telefono."; return; }
      const { chiave } = await api("/api/push/chiave");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(chiave.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((chiave.length + 3) % 4)), (ch) => ch.charCodeAt(0)) });
      await api("/api/push/iscrivi", { method: "POST", body: sub.toJSON() });
      out.innerHTML = '<span class="good">Notifiche attive su questo dispositivo.</span>';
      pushState();
    } catch (e) { out.textContent = e.message; }
  };
  $("#pushTest").onclick = async () => {
    try { const r = await api("/api/push/prova", { method: "POST" }); $("#pushOut").textContent = r.inviate ? "Inviata: arriva tra qualche secondo." : "Nessun dispositivo ha ricevuto la notifica."; }
    catch (e) { $("#pushOut").textContent = e.message; }
  };
};

// ---- Coach IA ----
// The Groq key is saved on your server, so iPhone and PC use the same one (it never comes back in full).
views.ia = async (el) => {
  el.innerHTML = `${subHeader("Coach IA")}
    <div class="card col" style="gap:12px">
      <div class="small" style="line-height:1.5;color:var(--text)">Il coach funziona sempre. Con una <b>chiave Groq</b> (gratuita) risponde meglio; senza usa il modello di riserva di Cloudflare.</div>
      <div id="keyState" class="card soft small" style="line-height:1.5">…</div>
      <label class="field"><span id="gkLabel">Chiave Groq</span><input class="input" id="gk" type="password" placeholder="gsk_…" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="hint">Si crea su <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a>. Viene salvata sul <b>tuo</b> server e vale su tutti i tuoi dispositivi.</span></label>
      <details><summary class="small" style="cursor:pointer;font-weight:700">Avanzate: scegli il modello</summary>
        <div class="col" style="gap:8px;padding-top:10px"><select class="input" id="gm"><option value="">Predefinito</option></select><button class="btn ghost" id="loadModels">Carica modelli</button></div></details>
      <div class="row"><button class="btn primary" id="saveAi" style="flex:1">Salva</button><button class="btn ghost" id="testAi" style="flex:1">Prova</button></div>
      <div id="aiOut" class="small muted"></div></div>`;
  let st = {};
  const show = async () => {
    try { st = await api("/api/ia/chiave"); } catch (e) { $("#keyState").textContent = e.message; return; }
    $("#keyState").innerHTML = st.sul_server ? `✓ Chiave salvata sul tuo server (…${esc(st.finale)}): vale su iPhone e PC. <button class="small" id="rmKey" style="background:none;border:0;color:var(--red-ink);font-weight:800;cursor:pointer;padding:0">Rimuovi</button>`
      : st.segreto_cloudflare ? "✓ Chiave impostata come segreto su Cloudflare." : "Nessuna chiave: il coach usa il modello di riserva.";
    $("#gkLabel").textContent = st.sul_server ? "Sostituisci la chiave" : "Chiave Groq";
    if (st.modello && !$("#gm").querySelector(`option[value="${CSS.escape(st.modello)}"]`)) $("#gm").insertAdjacentHTML("beforeend", `<option value="${esc(st.modello)}" selected>${esc(st.modello)}</option>`);
    const rm = $("#rmKey"); if (rm) rm.onclick = async () => { if (!confirm("Rimuovere la chiave Groq dal server? Il coach userà il modello di riserva.")) return; await api("/api/ia/chiave", { method: "DELETE" }); show(); };
  };
  show();
  const save = async () => {
    const k = $("#gk").value.trim();
    if (!validKey(k)) return false;
    const r = await api("/api/ia/chiave", { method: "POST", body: { ...(k ? { chiave: k } : {}), modello: $("#gm").value } });
    if (r.errore) { toast(r.errore); return false; }
    store.del("groqKey"); store.del("groqModel"); $("#gk").value = ""; await show(); return true;
  };
  $("#saveAi").onclick = async () => { try { if (await save()) toast("Salvato: vale su tutti i tuoi dispositivi"); } catch (e) { toast(e.message); } };
  $("#loadModels").onclick = async () => {
    const out = $("#aiOut"); out.textContent = "Carico i modelli…";
    try {
      if ($("#gk").value.trim() && !(await save())) return;
      const r = await api("/api/ai/modelli");
      if (r.errore) { out.textContent = r.errore; return; }
      const cur = $("#gm").value || st.modello;
      $("#gm").innerHTML = '<option value="">Predefinito (openai/gpt-oss-120b)</option>' + r.modelli.map((m) => `<option value="${esc(m)}" ${m === cur ? "selected" : ""}>${esc(m)}</option>`).join("");
      out.textContent = `${r.modelli.length} modelli disponibili.`;
    } catch (e) { out.textContent = e.message; }
  };
  $("#testAi").onclick = async () => {
    const out = $("#aiOut"); out.textContent = "Provo…";
    try {
      if ($("#gk").value.trim() && !(await save())) { out.textContent = ""; return; }
      const r = await api("/api/ai/test", { method: "POST" });
      out.innerHTML = r.errore ? `<span class="bad">${esc(r.errore)}</span>` : `<span class="good">Funziona</span> · ${r.provider === "groq" ? "Groq" : "modello di riserva"} · ${r.latenza_ms} ms${r.quota?.richieste_rimaste ? ` · ${esc(r.quota.richieste_rimaste)} richieste rimaste oggi` : ""}${r.avviso ? `<br>${esc(r.avviso)}` : ""}`;
    } catch (e) { out.textContent = e.message; }
  };
};

// A key saved only on this device (older versions) moves to the server once, so the PC uses it too.
async function migrateGroqKey() {
  const k = cfg().groqKey; if (!k) return;
  try {
    const st = await api("/api/ia/chiave");
    if (!st.sul_server) await api("/api/ia/chiave", { method: "POST", body: { chiave: k, ...(cfg().groqModel ? { modello: cfg().groqModel } : {}) } });
    store.del("groqKey"); store.del("groqModel");
    if (!st.sul_server) toast("Chiave Groq salvata sul tuo server: ora vale anche sul PC");
  } catch (_) {}
}

// ---- Collegamento iPhone ----
views.collegamento = async (el) => {
  el.innerHTML = `${subHeader("Collegamento iPhone")}
    <div class="card col" style="gap:12px">
      <div class="small" style="line-height:1.5;color:var(--text)">Il comando <b>HealthSync</b> usa questo link per mandare i dati del Watch. Serve solo a inviare dati: non apre l'app.</div>
      <div class="card soft code" id="linkBox" style="word-break:break-all">…</div>
      <div class="row"><button class="btn primary" id="copyLink" style="flex:2">Copia link</button><button class="btn ghost" id="newLink" style="flex:1">Rigenera</button></div>
      <a class="btn ghost" href="#/guida">Guida passo passo</a></div>`;
  let link = "";
  api("/api/collegamento").then((r) => { link = r.link; $("#linkBox").textContent = link; }).catch((e) => { $("#linkBox").textContent = e.message; });
  $("#copyLink").onclick = () => link && copyText(link, "Link copiato");
  $("#newLink").onclick = async () => {
    if (!confirm("Creare un nuovo link? Quello vecchio smette di funzionare e dovrai aggiornarlo nel comando HealthSync.")) return;
    try { const r = await api("/api/collegamento", { method: "POST" }); link = r.link; $("#linkBox").textContent = link; toast("Nuovo link creato"); } catch (e) { toast(e.message); }
  };
};

// ---- Backup ed esportazione ----
views.backup = async (el) => {
  el.innerHTML = `${subHeader("Backup ed esportazione")}
    <div class="card col" style="gap:10px">
      <div id="bkInfo" class="small" style="line-height:1.5;color:var(--text)">…</div>
      <div class="row"><button class="btn primary" id="bkNow" style="flex:1">Backup ora</button><label class="btn ghost" style="flex:1;cursor:pointer">Ripristina<input type="file" id="bkFile" accept=".json,.gz,application/json,application/gzip" hidden></label></div>
      <div id="bkOut" class="small"></div></div>
    <div class="label" style="padding:0 6px">Ultimi backup · tocca per scaricare</div>
    <div class="card list" id="bkList" style="padding:4px 16px"></div>
    <a class="btn ghost" href="/api/export" id="export">Esporta tutti i dati (JSON)</a>`;
  const fmtBytes = (b) => (b > 1048576 ? `${fmtNum(b / 1048576, 1)} MB` : `${fmtNum(b / 1024, 0)} KB`);
  const loadBackups = async () => {
    try {
      const r = await api("/api/backup");
      $("#bkInfo").innerHTML = r.attivo
        ? `Kairo salva da solo una copia dei tuoi dati <b>ogni lunedì</b> e prima di ogni cancellazione, e tiene le ultime 8. ${r.ultimo ? `Ultimo: <b>${ago(r.ultimo.creato)}</b>.` : "Nessun backup ancora."}`
        : `I backup automatici non sono attivi su questo server: si attivano con il prossimo aggiornamento automatico. Intanto puoi esportare i dati qui sotto.`;
      $("#bkNow").disabled = !r.attivo;
      $("#bkList").innerHTML = r.backup.length ? r.backup.slice(0, 8).map((b) => `<a class="item" href="#" data-bk="${esc(b.chiave)}"><span>${fmtDate(b.creato.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })} <span class="small muted">· ${esc(b.motivo || "")}</span></span><span class="small muted">${fmtBytes(b.byte)} ↓</span></a>`).join("") : `<div class="small muted" style="padding:14px 0">Nessun backup.</div>`;
      el.querySelectorAll("[data-bk]").forEach((a) => (a.onclick = async (e) => {
        e.preventDefault();
        try {
          const res = await api(`/api/backup/file?chiave=${encodeURIComponent(a.dataset.bk)}`, { raw: true });
          if (!res.ok) throw new Error("Download non riuscito");
          const blob = await res.blob(), link = document.createElement("a");
          link.href = URL.createObjectURL(blob); link.download = `kairo-backup-${a.dataset.bk.slice(7, 17)}.json.gz`; link.click();
        } catch (err) { toast(err.message); }
      }));
    } catch (e) { $("#bkInfo").textContent = e.message; }
  };
  loadBackups();
  $("#bkNow").onclick = async () => {
    $("#bkOut").textContent = "Creo il backup…";
    try { const r = await api("/api/backup", { method: "POST" }); $("#bkOut").innerHTML = r.errore ? `<span class="bad">${esc(r.errore)}</span>` : `<span class="good">Backup creato.</span>`; loadBackups(); }
    catch (e) { $("#bkOut").textContent = e.message; }
  };
  $("#bkFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const out = $("#bkOut");
    try {
      out.textContent = "Leggo il file…";
      const text = /\.gz$/i.test(f.name) ? await new Response(f.stream().pipeThrough(new DecompressionStream("gzip"))).text() : await f.text();
      const data = JSON.parse(text);
      if (data.app !== "kairo") throw new Error("Questo file non è un backup o un'esportazione di Kairo.");
      const tables = ["samples", "daily", "hourly", "sleep", "checkin", "memoria"];
      const total = tables.reduce((a, t) => a + (data[t]?.length || 0), 0);
      if (!confirm(`Ripristinare ${fmtNum(total)} righe dal ${String(data.esportato || "").slice(0, 10)}? I dati attuali restano: vengono solo aggiunti quelli mancanti.`)) { out.textContent = ""; return; }
      let done = 0, saved = 0;
      for (const t of tables) for (const part of chunks(data[t] || [], 3000)) {
        const r = await api("/api/ripristina", { method: "POST", body: { app: "kairo", [t]: part } });
        if (r.errore) throw new Error(r.errore);
        saved += r.righe; done += part.length;
        out.textContent = `Ripristino… ${Math.round((done / total) * 100)}%`;
      }
      out.innerHTML = `<span class="good">Ripristino completato: ${fmtNum(saved)} righe.</span>`;
    } catch (err) { out.innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
    e.target.value = "";
  };
  $("#export").onclick = async (e) => {
    e.preventDefault();
    try {
      const res = await api("/api/export", { raw: true });
      if (!res.ok) throw new Error("Esportazione non riuscita");
      const blob = await res.blob(); const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `kairo-export-${todayStr()}.json`; a.click();
    } catch (err) { toast(err.message); }
  };
};

// ---- Account ----
views.account = async (el) => {
  const c = cfg();
  el.innerHTML = `${subHeader("Codice di accesso e account")}
    <div class="card col" style="gap:10px">
      <div class="small" style="line-height:1.5;color:var(--text)">Il codice serve per aprire Kairo su un nuovo dispositivo, insieme all'indirizzo:</div>
      <div class="card soft code" style="word-break:break-all">${esc(c.server)}</div>
      <button class="btn ghost" id="chgCode">Cambia codice</button></div>
    <div class="card list" style="padding:4px 16px">
      <button class="item" id="logout">Esci da questo dispositivo ${ico.chevron}</button>
      <button class="item bad" id="wipe">Cancella tutti i dati dal server ${ico.chevron}</button></div>
    <div class="small muted" style="padding:0 6px;line-height:1.45">Uscendo, codice e chiavi vengono tolti solo da questo dispositivo: i dati restano sul server. Prima di cancellare i dati Kairo ne salva un backup.</div>`;
  $("#chgCode").onclick = async () => {
    const nuovo = prompt("Nuovo codice di accesso (almeno 10 caratteri).");
    if (!nuovo) return;
    try { await api("/api/codice", { method: "POST", body: { nuovo } }); store.set("code", nuovo); toast("Codice cambiato"); } catch (e) { toast(e.message); }
  };
  $("#logout").onclick = () => { if (confirm("Rimuovere codice e chiavi da questo dispositivo? I dati sul server restano.")) { ["code", "groqKey", "groqModel", "chat"].forEach(store.del); route("accesso"); } };
  $("#wipe").onclick = async () => {
    const v = prompt("Questa azione cancella tutti i tuoi dati dal server (prima Kairo ne salva un backup, se i backup sono attivi). Scrivi CANCELLA per confermare.");
    if (v !== "CANCELLA") return;
    try { await api("/api/dati", { method: "DELETE", body: { conferma: "CANCELLA" } }); toast("Dati cancellati"); } catch (e) { toast(e.message); }
  };
};

/* ---------- Stato di Kairo (diagnostics) ---------- */
async function latestRelease() {
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const j = await r.json(); return { tag: (j.tag_name || "").replace(/^v/, ""), url: j.html_url };
  } catch { return null; }
}
const newer = (a, b) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); } return false; };

// The checks in plain words: s = ok | warn | err | off, text = what it means, fix = what to do.
function healthChecks(d, err, lat, rel) {
  const out = [];
  if (err || !d) {
    out.push({ s: "err", t: "Server", text: "Il tuo server non risponde.", fix: "Controlla la connessione. Se continua, apri Cloudflare → Workers e verifica che Kairo sia pubblicato." });
    return out;
  }
  out.push({ s: lat > 2500 ? "warn" : "ok", t: "Server", text: lat ? `Risponde in ${lat} ms.` : "Risponde.", fix: lat > 2500 ? "È lento: riprova tra poco, di solito è la rete." : "" });
  // versions
  const srv = d.server.versione;
  if (srv && srv !== APP_VERSION) out.push({ s: "warn", t: "Versione", text: `App ${APP_VERSION}, server ${srv}.`, fix: "Chiudi e riapri Kairo per caricare la versione nuova." });
  else if (rel && newer(rel.tag, srv || APP_VERSION)) out.push({ s: "warn", t: "Versione", text: `Hai la ${srv}, è uscita la ${rel.tag}.`, fix: "Si aggiorna da sola il lunedì. Per farlo subito: il tuo repository GitHub → Actions → Aggiorna Kairo → Run workflow." });
  else out.push({ s: "ok", t: "Versione", text: `Kairo ${srv || APP_VERSION}${rel ? ", aggiornato" : ""}.`, fix: "" });
  // sync
  const last = d.importazioni[0], ageH = last ? (Date.now() - Date.parse(last.received)) / 36e5 : Infinity;
  out.push(!last ? { s: "err", t: "iPhone", text: "Non è mai arrivato nessun dato.", fix: "Installa il comando HealthSync seguendo la Guida (Impostazioni → Guida)." }
    : ageH < 14 ? { s: "ok", t: "iPhone", text: `Ultimi dati arrivati ${ago(last.received)}.`, fix: "" }
    : { s: ageH < 36 ? "warn" : "err", t: "iPhone", text: `Ultimi dati arrivati ${ago(last.received)}.`, fix: "Apri Comandi → Automazione e controlla che le automazioni di HealthSync siano attive e su «Esegui immediatamente». Puoi anche lanciare HealthSync a mano." });
  // Watch data that recovery needs
  const lastOf = (m) => d.metriche.find((x) => x.metric === m)?.a;
  const days = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 864e5 : Infinity);
  const missing = [["HRV", lastOf("hrv")], ["FC a riposo", lastOf("fcr")], ["sonno", d.sonno.n ? d.sonno.a : null]].filter(([, a]) => days(a) > 3).map(([n]) => n);
  out.push(!missing.length ? { s: "ok", t: "Dati del Watch", text: "HRV, FC a riposo e sonno arrivano regolarmente.", fix: "" }
    : { s: missing.length === 3 ? "err" : "warn", t: "Dati del Watch", text: `Mancano da più di 3 giorni: ${missing.join(", ")}.`, fix: missing.includes("sonno") ? "Per il sonno tieni il Watch di notte con la modalità Sonno attiva. Se mancano anche gli altri, controlla in Salute → Condivisione → App → Comandi che sia tutto consentito." : "Controlla in Salute → Condivisione → App → Comandi che sia tutto consentito." });
  // AI
  const q = d.ia.groq_quota, key = cfg().groqKey || d.ia.chiave_groq_sul_server;
  out.push(key ? { s: q && Number(q.richieste_rimaste) < 50 ? "warn" : "ok", t: "Coach IA", text: `Groq attivo${q?.richieste_rimaste ? `, ${q.richieste_rimaste} richieste rimaste oggi` : ""}.`, fix: q && Number(q.richieste_rimaste) < 50 ? "Quasi finite per oggi: nel frattempo risponde il modello di riserva." : "" }
    : d.ia.riserva_disponibile ? { s: "ok", t: "Coach IA", text: "Funziona con il modello di riserva gratuito.", fix: "Per risposte migliori aggiungi una chiave Groq gratuita in Impostazioni → Coach IA." }
    : { s: "err", t: "Coach IA", text: "Nessun modello IA disponibile.", fix: "Aggiungi una chiave Groq in Impostazioni → Coach IA." });
  // backup
  const bk = d.backup;
  out.push(!bk?.attivo ? { s: "warn", t: "Backup", text: "I backup automatici non sono attivi.", fix: "Si attivano con il prossimo aggiornamento automatico (lunedì). Intanto esporta i dati da Backup ed esportazione." }
    : bk.ultimo && days(bk.ultimo.creato) < 9 ? { s: "ok", t: "Backup", text: `Ultima copia ${ago(bk.ultimo.creato)}.`, fix: "" }
    : { s: "warn", t: "Backup", text: bk.ultimo ? `Ultima copia ${ago(bk.ultimo.creato)}.` : "Nessuna copia ancora.", fix: "Tocca «Backup ora» in Backup ed esportazione." });
  // this device
  out.push(isStandalone() ? { s: "ok", t: "Questo telefono", text: "Kairo è installata come app.", fix: "" }
    : { s: "warn", t: "Questo telefono", text: "Kairo è aperta nel browser.", fix: "In Safari: Condividi → Aggiungi alla schermata Home. Serve anche per le notifiche." });
  return out;
}

views.diagnostica = async (el) => {
  el.innerHTML = subHeader("Stato di Kairo") + loading(2);
  const t0 = performance.now();
  let d, err;
  try { d = await api("/api/diagnostica"); } catch (e) { err = e; }
  const lat = Math.round(performance.now() - t0);
  const rel = await latestRelease();
  const checks = healthChecks(d, err, lat, rel);
  const todo = checks.filter((x) => x.s === "err" || x.s === "warn");
  const worst = checks.some((x) => x.s === "err") ? "err" : todo.length ? "warn" : "ok";
  const COL = { ok: ["#DDF3E8", "var(--green-ink)", "✓"], warn: ["#FDF1D6", "var(--yellow-ink)", "!"], err: ["#FDE2DF", "var(--red-ink)", "✕"] };
  const c = cfg();
  const dot = (s) => `<span class="status-dot ${s}"></span>`;
  const item = (s, label, value) => `<div class="item"><div class="row" style="gap:10px">${dot(s)}<span>${label}</span></div><div class="small muted" style="text-align:right">${value}</div></div>`;
  let html = subHeader("Stato di Kairo");
  html += `<div class="card row" style="gap:14px;background:${COL[worst][0]}"><span style="width:44px;height:44px;border-radius:50%;background:${COL[worst][1]};color:#fff;display:grid;place-items:center;font-size:22px;font-weight:900;flex:none">${COL[worst][2]}</span>
    <div class="col" style="gap:2px"><div class="h2" style="color:${COL[worst][1]}">${worst === "ok" ? "Tutto funziona" : `${todo.length} ${todo.length === 1 ? "cosa" : "cose"} da sistemare`}</div><div class="small" style="color:var(--text)">${worst === "ok" ? "Dati, coach e backup sono a posto." : "Qui sotto trovi cosa fare."}</div></div></div>`;
  html += `<div class="card list" style="padding:4px 16px">${checks.map((x) => `<div class="item" style="align-items:flex-start;gap:12px"><span style="padding-top:6px">${dot(x.s)}</span><div class="col" style="gap:3px;flex:1"><div style="font-weight:800">${x.t}</div><div class="small" style="color:var(--text);font-weight:500;line-height:1.45">${esc(x.text)}</div>${x.fix ? `<div class="small" style="font-weight:600;line-height:1.45;color:${x.s === "ok" ? "var(--muted)" : "var(--ink)"}">→ ${esc(x.fix)}</div>` : ""}</div></div>`).join("")}</div>`;
  html += `<div class="row" style="gap:8px"><button class="btn ghost" id="testAi" style="flex:1">Prova il coach</button><button class="btn ghost" id="copy" style="flex:1">Copia report</button></div><div id="aiOut" class="small muted"></div>`;

  // technical details, closed by default
  if (d) {
    const metricName = { hrv: "HRV", fcr: "FC a riposo", fc: "Frequenza cardiaca", fc_camminata: "FC camminata", resp: "Respirazione", spo2: "Ossigeno (SpO₂)", vo2max: "VO₂max", peso: "Peso", grasso_pct: "% grasso", massa_magra: "Massa magra", bmi: "BMI", passi: "Passi", kcal_attive: "Calorie attive", kcal_riposo: "Calorie a riposo", dist_piedi: "Distanza a piedi", piani: "Piani", dist_bici: "Distanza bici", dist_nuoto: "Distanza nuoto", bracciate: "Bracciate", trimp: "Carico (TRIMP)" };
    const rows = [...d.metriche.map((m) => ({ ...m, last: m.a })), ...d.giornaliere.map((m) => ({ ...m, last: m.a + "T12:00:00" }))];
    const fresh = (iso) => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 48 ? "ok" : h < 24 * 14 ? "warn" : "off"; };
    const lastByMod = {}; d.importazioni.forEach((i) => { if (!lastByMod[i.modulo]) lastByMod[i.modulo] = i; });
    const q = d.ia.groq_quota;
    html += `<details class="card"><summary style="cursor:pointer;font-weight:800">Dettagli tecnici</summary><div class="list" style="padding-top:8px">
      <div class="label" style="padding-top:8px">Versioni</div>
      ${item("off", "App", APP_VERSION)}${item("off", "Server", esc(d.server.versione))}${item("off", "Schema database", `v${d.server.schema}`)}${item("off", "Ultima su GitHub", rel ? esc(rel.tag) : "–")}
      <div class="label" style="padding-top:12px">Invii da iPhone</div>
      ${Object.values(lastByMod).slice(0, 6).map((i) => item("off", esc(i.modulo || "?"), `${ago(i.received)} · ${i.righe} righe`)).join("") || item("off", "Nessun invio", "")}
      <div class="label" style="padding-top:12px">Dati ricevuti</div>
      ${item(d.sonno.n ? fresh(d.sonno.a) : "off", "Sonno (fasi)", d.sonno.n ? `${fmtNum(d.sonno.n)} · ultima ${ago(d.sonno.a)}` : "nessun dato")}
      ${rows.map((m) => item(fresh(m.last), metricName[m.metric] || esc(m.metric), `${fmtNum(m.n)} · ultimo ${ago(m.last)}`)).join("")}
      <div class="label" style="padding-top:12px">Coach IA</div>
      ${item("off", "Modello", esc(c.groqModel || d.ia.modello_predefinito))}
      ${q ? item("off", "Richieste Groq rimaste", `${esc(q.richieste_rimaste ?? "?")} su ${esc(q.richieste_limite ?? "?")}`) : ""}
      ${item("off", "Chiamate oggi", `Groq ${d.ia.chiamate_oggi_groq} · riserva ${d.ia.chiamate_oggi_riserva}`)}
      ${item("off", "Modello di riserva", d.ia.riserva_disponibile ? esc(d.ia.modello_riserva) : "non configurato")}
      <div class="label" style="padding-top:12px">Database e dispositivo</div>
      ${item("off", "Righe", Object.entries(d.database.righe).map(([k, v]) => `${k} ${fmtNum(v)}`).join(" · "))}
      ${d.database.dimensione_byte ? item("off", "Dimensione", `${fmtNum(d.database.dimensione_byte / 1048576, 1)} MB su 5.000 MB`) : ""}
      ${item("off", "Indirizzo server", `<span class="code">${esc(c.server)}</span>`)}${item("off", "Fuso orario", esc(tz()))}
    </div></details>`;
  }
  el.innerHTML = html;
  $("#testAi").onclick = async () => {
    const out = $("#aiOut"); out.textContent = "Provo…";
    try { const r = await api("/api/ai/test", { method: "POST" }); out.innerHTML = r.errore ? `<span class="bad">${esc(r.errore)}</span>` : `<span class="good">Il coach risponde</span> · ${r.provider === "groq" ? "Groq" : "modello di riserva"} · ${r.latenza_ms} ms`; }
    catch (e) { out.textContent = e.message; }
  };
  $("#copy").onclick = async () => {
    const report = { app: APP_VERSION, server: d?.server, ultima_release: rel?.tag, latenza_ms: lat, errore: err?.message, controlli: checks.map((x) => `${x.s} ${x.t}: ${x.text}`), importazioni: d?.importazioni?.slice(0, 5), dati: d?.database, ia: d ? { ...d.ia } : null, dispositivo: { standalone: isStandalone(), tz: tz(), ua: navigator.userAgent, chiave_groq: !!c.groqKey } };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); toast("Report copiato (senza chiavi)"); } catch { toast("Copia non riuscita"); }
  };
};

/* ---------- info & licenses ---------- */
views.info = async (el) => {
  el.innerHTML = `${header("Informazioni", { back: "impostazioni", gear: false })}
    <div class="card col center" style="gap:8px">${ico.sun(70)}<div style="font-size:40px;font-weight:900;letter-spacing:-1px">kairo<span style="color:var(--orange)">.</span></div><div class="muted">Versione ${APP_VERSION}</div><div class="small" style="max-width:320px;line-height:1.5">Kairós: il momento giusto. Kairo legge i dati del tuo Apple Watch e ti dice ogni mattina come hai recuperato.</div></div>
    <div class="card col" style="gap:10px"><div class="h2">Open source</div>
      <div style="line-height:1.5;color:var(--text)">Kairo è software libero, rilasciato con licenza <b>MIT</b>. Il codice è pubblico: chiunque può controllarlo, installarlo sul proprio account e contribuire.</div>
      <a class="btn primary" href="${GITHUB_URL}" target="_blank" rel="noopener">Codice su GitHub</a>
      <a class="btn ghost" href="${GITHUB_URL}/blob/main/LICENSE" target="_blank" rel="noopener">Leggi la licenza</a>
      <a class="btn ghost" href="${GITHUB_URL}/issues" target="_blank" rel="noopener">Segnala un problema</a></div>
    <div class="card col" style="gap:8px"><div class="h2">Privacy</div>
      <div style="line-height:1.5;color:var(--text)">I tuoi dati stanno nel <b>tuo</b> database Cloudflare, non su server di terzi. Codice di accesso e chiave Groq restano su questo dispositivo. All'IA vengono inviati solo riassunti numerici, mai i dati grezzi. Nessun tracciamento, nessuna pubblicità.</div></div>
    <div class="card col" style="gap:8px"><div class="h2">Avvertenza</div>
      <div style="line-height:1.5;color:var(--text)">Kairo non è un dispositivo medico e non fornisce diagnosi. I punteggi sono stime basate sui sensori del Watch: per dubbi sulla salute rivolgiti a un medico.</div></div>
    <div class="card list"><div class="label" style="margin-bottom:4px">Componenti di terze parti</div>
      <div class="item"><span>Font Nunito</span><span class="small muted">SIL Open Font License 1.1</span></div>
      <div class="item"><span>Cloudflare Workers, D1, Workers AI</span><span class="small muted">servizio · termini Cloudflare</span></div>
      <div class="item"><span>Groq API</span><span class="small muted">servizio · termini Groq</span></div>
      <div class="item"><span>Llama 3.1 (modello di riserva)</span><span class="small muted">Llama 3.1 Community License</span></div>
      <div class="item"><span>Apple Salute e Comandi Rapidi</span><span class="small muted">marchi di Apple Inc.</span></div>
    </div>
    <div class="small muted center" style="display:flex;justify-content:center">© ${new Date().getFullYear()} <a href="https://github.com/antonuccilorenzogit" target="_blank" rel="noopener" style="margin:0 4px">antonuccilorenzogit</a> e contributori</div>`;
};

/* ---------- guide: A–Z setup wizard ---------- */
async function copyText(t, ok = "Copiato") { try { await navigator.clipboard.writeText(t); toast(ok); } catch { toast("Copia non riuscita: selezionalo e copialo a mano"); } }
const tip = (t, body) => `<div class="card soft col" style="gap:4px"><div style="font-weight:900">${t}</div><div class="small" style="line-height:1.5">${body}</div></div>`;
const GUIDE = [
  { t: "Prima di iniziare", body: () => `
    <div style="line-height:1.55;color:var(--text)">In 6 passi l'iPhone inizierà a mandare a Kairo i dati del Watch, da solo, ogni giorno. Ci vogliono circa <b>5 minuti</b>, una volta sola.</div>
    <div class="card soft col" style="gap:6px"><div style="font-weight:900">Fai questa guida sull'iPhone, in Safari</div><div class="small" style="line-height:1.5">Ti serve l'app <b>Comandi</b> (è già sull'iPhone; se l'hai cancellata, riscaricala gratis dall'App Store).</div></div>
    <div class="h2" style="font-size:17px">Un'impostazione da attivare</div>
    <ol class="steps"><li>Apri <b>Impostazioni</b> dell'iPhone → <b>App</b> → <b>Comandi</b> → <b>Avanzate</b>.</li>
      <li>Attiva <b>Consenti condivisione di grandi quantità di dati</b>.</li>
      <li>Torna qui e tocca <b>Avanti</b>.</li></ol>
    <div class="small muted">Su iOS 17 o precedenti il percorso è Impostazioni → Comandi rapidi → Avanzate.</div>` },
  { t: "Installa il comando", body: () => `
    <div style="line-height:1.55;color:var(--text)">Due pulsanti, in quest'ordine:</div>
    <button class="btn primary block" id="copyLink">① Copia il link di collegamento</button>
    <a class="btn orange block" href="shortcuts/HealthSync.shortcut" target="_blank" rel="noopener">② Scarica HealthSync</a>
    <ol class="steps"><li>Safari chiede <b>«Scaricare HealthSync.shortcut?»</b> → tocca <b>Scarica</b>.</li>
      <li>Tocca l'icona <b>download</b> (cerchio con la freccia ↓, nella barra di Safari) → tocca <b>HealthSync.shortcut</b>. Si apre l'app Comandi.</li>
      <li>Tocca <b>Configura comando</b>. Nel riquadro tieni premuto → <b>Incolla</b> (è il link copiato al punto ①).</li>
      <li>Tocca <b>Aggiungi comando</b>. Fatto.</li></ol>
    ${tip("Non trovi il file?", "Apri l'app <b>File</b> → <b>Download</b> → tocca <b>HealthSync.shortcut</b>.")}` },
  { t: "Prova il comando", body: () => `
    <ol class="steps"><li>Apri l'app <b>Comandi</b> e tocca il riquadro <b>HealthSync</b>.</li>
      <li>La prima volta iOS chiede dei permessi: rispondi sempre <b>Consenti</b> (o <b>Consenti sempre</b>). Se compare l'elenco dei dati di Salute: <b>Attiva tutto</b> → <b>Consenti</b>.</li>
      <li>Aspetta che il comando finisca (pochi secondi), poi torna qui.</li></ol>
    <button class="btn primary block" id="verify">Controlla se i dati sono arrivati</button><div id="verifyOut" class="small" style="line-height:1.5"></div>` },
  { t: "Rendilo automatico", body: () => `
    <div style="line-height:1.55;color:var(--text)">Crei due automazioni, così il comando parte da solo. Apri <b>Comandi</b> → scheda <b>Automazione</b> (in basso).</div>
    <div class="card soft col" style="gap:8px"><div style="font-weight:900">A · Quando spegni la sveglia</div>
      <ol class="steps"><li>Tocca <b>+</b> (in alto a destra) → <b>Sveglia</b>.</li>
        <li>Scegli <b>Viene fermata</b> e <b>Esegui immediatamente</b>.</li>
        <li><b>Avanti</b> → scegli <b>HealthSync</b> → <b>Fine</b>.</li></ol></div>
    <div class="card soft col" style="gap:8px"><div style="font-weight:900">B · Quando metti in carica</div>
      <ol class="steps"><li>Tocca <b>+</b> → <b>Caricatore</b>.</li>
        <li>Scegli <b>È collegato</b> e <b>Esegui immediatamente</b>.</li>
        <li><b>Avanti</b> → <b>HealthSync</b> → <b>Fine</b>.</li></ol></div>
    <div class="card soft col" style="gap:8px"><div style="font-weight:900">C · Mezz'ora dopo la sveglia <span class="small muted" style="font-weight:600">(consigliata)</span></div>
      <div class="small" style="line-height:1.5">Il Watch finisce di elaborare le fasi del sonno qualche minuto dopo il risveglio: questo invio porta la notte completa.</div>
      <ol class="steps"><li>Tocca <b>+</b> → <b>Ora del giorno</b>.</li>
        <li>Scegli un orario circa 30 minuti dopo la tua sveglia, <b>Ogni giorno</b>, e <b>Esegui immediatamente</b>.</li>
        <li><b>Avanti</b> → <b>HealthSync</b> → <b>Fine</b>.</li></ol></div>
    <div class="small muted" style="line-height:1.5">Non usi la sveglia? In A scegli <b>Ora del giorno</b> (es. 9:00, ogni giorno). Le automazioni non si possono scaricare come file: Apple permette di condividere solo i comandi.</div>` },
  { t: "Carica il tuo storico", body: () => `
    <div style="line-height:1.55;color:var(--text)">Facoltativo ma consigliato: così Kairo conosce subito le tue medie, invece di aspettare due settimane.</div>
    <ol class="steps"><li>Apri l'app <b>Salute</b> → tocca la tua <b>foto</b> in alto a destra.</li>
      <li>In fondo: <b>Esporta tutti i dati sanitari</b> → <b>Esporta</b>. Aspetta (anche qualche minuto).</li>
      <li>Scegli <b>Salva su File</b> → <b>Sul mio iPhone</b> → <b>Salva</b>.</li>
      <li>Tocca il pulsante qui sotto e scegli il file <b>esportazione.zip</b>.</li></ol>
    <a class="btn primary block" href="#/importa">Importa da Salute</a>` },
  { t: "Kairo sulla schermata Home", body: () => `
    <ol class="steps"><li>In <b>Safari</b> tocca <b>Condividi</b> (quadrato con la freccia ↑).</li>
      <li>Scorri → <b>Aggiungi alla schermata Home</b> → <b>Aggiungi</b>.</li>
      <li>Apri Kairo dall'icona e inserisci di nuovo il <b>codice di accesso</b> (l'app sulla Home ha una memoria separata da Safari).</li>
      <li>Dall'icona, vai in <b>Impostazioni → Notifiche → Attiva</b>: la mattina ti arriva il recupero con l'allenamento consigliato, la sera l'orario per andare a letto.</li></ol>
    <div class="small muted" style="line-height:1.5"><b>Sul PC:</b> apri <span class="code">${esc(location.origin)}</span> in Chrome o Edge, accedi con il codice e clicca <b>Installa</b> nella barra degli indirizzi.</div>` },
  { t: "Fatto", body: () => `
    <div class="col center" style="gap:8px">${bean(90, 110)}<div class="h2">Kairo è pronto</div></div>
    <ol class="steps"><li><b>Dormi con il Watch</b>: è la base dello score di recupero.</li>
      <li>La mattina spegni la sveglia: i dati arrivano da soli.</li>
      <li>Apri Kairo e fai il <b>check-in</b> (10 secondi).</li></ol>
    ${tip("Qualcosa non torna?", "<b>Impostazioni → Diagnostica</b> ti dice quando sono arrivati gli ultimi dati e cosa controllare.")}
    <a class="btn primary" href="#/oggi">Vai a Oggi</a>` },
];

views.guida = async (el) => {
  const c = cfg();
  let i = Math.max(0, Math.min(GUIDE.length - 1, Number(store.get("guidaStep", 0)) || 0));
  const draw = () => {
    store.set("guidaStep", i);
    const g = GUIDE[i];
    el.innerHTML = `${header("Guida", { back: "impostazioni", gear: false, sub: "Collega l'iPhone in 5 minuti" })}
      <div class="col" style="gap:8px"><div class="row between small"><b>Passo ${i + 1} di ${GUIDE.length}</b><span class="muted">${Math.round((i / (GUIDE.length - 1)) * 100)}%</span></div>
        <div class="track"><div class="bar" style="left:0;width:${(i / (GUIDE.length - 1)) * 100}%;background:var(--orange)"></div></div>
        <div class="chips" style="gap:6px">${GUIDE.map((s, k) => `<button class="chip" data-go="${k}" style="padding:4px 10px;font-size:12px;${k === i ? "background:var(--ink);color:#fff;border-color:var(--ink)" : k < i ? "background:#DDF3E7;border-color:#DDF3E7" : ""}" aria-label="Passo ${k + 1}: ${esc(s.t)}">${k + 1}</button>`).join("")}</div></div>
      <div class="card col" style="gap:14px"><div class="h2">${i + 1} · ${g.t}</div>${g.body(c)}</div>
      <div class="row">${i > 0 ? `<button class="btn ghost" id="prev" style="flex:1">Indietro</button>` : ""}${i < GUIDE.length - 1 ? `<button class="btn primary" id="next" style="flex:2">Avanti</button>` : ""}</div>
      <a class="small center" style="display:block" href="${GITHUB_URL}/blob/main/docs/SETUP.md" target="_blank" rel="noopener">Guida completa su GitHub</a>`;
    el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { i = Number(b.dataset.go); draw(); window.scrollTo(0, 0); }));
    const cl = $("#copyLink");
    if (cl) cl.onclick = async () => {
      try { const r = await api("/api/collegamento"); await copyText(r.link, "Link copiato: ora tocca ②"); cl.textContent = "① Link copiato ✓"; }
      catch (e) { toast(e.message); }
    };
    const p = $("#prev"); if (p) p.onclick = () => { i--; draw(); window.scrollTo(0, 0); };
    const n = $("#next"); if (n) n.onclick = () => { i++; draw(); window.scrollTo(0, 0); };
    const v = $("#verify");
    if (v) v.onclick = async () => {
      const out = $("#verifyOut"); out.textContent = "Controllo…";
      try {
        const d = await api("/api/diagnostica");
        const last = d.importazioni[0];
        const min = last ? (Date.now() - Date.parse(last.received)) / 60000 : Infinity;
        out.innerHTML = last && min < 30
          ? `<span class="good"><b>Funziona!</b></span> Ultimo invio ${ago(last.received)} (${last.righe} righe). Vai avanti.`
          : `<span class="bad"><b>Non ancora.</b></span> ${last ? `L'ultimo invio è di ${ago(last.received)}.` : "Nessun invio ricevuto."} Controlla che il comando sia finito senza errori. Se ha dato errore 401, il link non è giusto: rifai il passo 2.`;
      } catch (e) { out.textContent = e.message; }
    };
  };
  draw();
};

/* ---------- import from the Apple Health export ---------- */
views.importa = async (el) => {
  const cutoff = (days) => shiftDay(todayStr(), -days);
  el.innerHTML = `${header("Importa dati", { back: "impostazioni", gear: false, sub: "Da Salute e dalle app di allenamento" })}
    <div class="card col" style="gap:12px"><div class="h2">1 · Esporta da Salute</div>
      <ol class="steps"><li>Apri l'app <b>Salute</b> sull'iPhone.</li>
        <li>Tocca la tua <b>foto</b> (o iniziali) in alto a destra.</li>
        <li>Scorri in fondo e tocca <b>Esporta tutti i dati sanitari</b> → <b>Esporta</b>. Può richiedere qualche minuto.</li>
        <li>Nel menu che si apre scegli <b>Salva su File</b> → <b>Sul mio iPhone</b> → <b>Salva</b>.</li></ol>
      <div class="small muted">Il file si chiama <b>esportazione.zip</b> (o export.zip). Va bene anche il file .xml che c'è dentro, utile se lo apri dal PC.</div></div>
    <div class="card col" style="gap:12px"><div class="h2">2 · Scegli il file</div>
      <label class="field">Periodo da importare<select class="input" id="period"><option value="365">Ultimo anno</option><option value="730" selected>Ultimi 2 anni</option><option value="3650">Tutto</option></select></label>
      <input type="file" id="file" accept=".zip,.xml,application/zip,text/xml" class="input" style="padding:10px">
      <button class="btn primary" id="go" disabled>Analizza il file</button>
      <div class="small muted">Il file viene letto <b>su questo dispositivo</b>: al tuo server arrivano solo i valori che Kairo usa (non ECG, non posizioni GPS, non documenti clinici).</div>
      <div id="prog"></div></div>
    <div id="result"></div>
    <div class="card col" style="gap:12px"><div class="h2">Allenamenti di palestra da altre app</div>
      <div class="small" style="line-height:1.5;color:var(--text)">Kairo riconosce da solo il file di <b>Hevy</b> e di <b>Strong</b>.</div>
      <ol class="steps"><li><b>Hevy:</b> Profilo → ⚙️ Impostazioni → <b>Esporta e importa dati</b> → <b>Esporta allenamenti</b>.</li>
        <li><b>Strong:</b> Profilo → ⚙️ Impostazioni → <b>Esporta dati</b>.</li>
        <li>Salva il file <b>.csv</b> su File e sceglilo qui sotto. Puoi ripeterlo quando vuoi: le serie già importate non vengono duplicate.</li></ol>
      <input type="file" id="hevyFile" accept=".csv,text/csv" class="input" style="padding:10px">
      <div id="hevyOut" class="small"></div></div>`;
  $("#hevyFile").onchange = (e) => importHevy(e.target.files[0], $("#hevyOut"));
  const file = $("#file"), go = $("#go"), prog = $("#prog"), result = $("#result");
  file.onchange = () => { go.disabled = !file.files.length; };
  const bar = (pct, text) => `<div class="col" style="gap:6px"><div class="track"><div class="bar" style="left:0;width:${pct}%;background:var(--orange)"></div></div><div class="small muted">${text}</div></div>`;
  go.onclick = () => {
    const f = file.files[0]; if (!f) return;
    go.disabled = true; result.innerHTML = "";
    prog.innerHTML = bar(0, "Apro il file…");
    const w = new Worker("import-worker.js");
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "progress") prog.innerHTML = bar(Math.min(99, (m.read / m.total) * 100), `Leggo… ${fmtNum(m.records)} misurazioni lette, ${fmtNum(m.kept)} utili`);
      else if (m.type === "error") { w.terminate(); go.disabled = false; prog.innerHTML = `<div class="small bad">${esc(m.message)}</div>`; }
      else if (m.type === "done") { w.terminate(); go.disabled = false; prog.innerHTML = bar(100, `Letto ${esc(m.file)}: ${fmtNum(m.records)} misurazioni.`); showResult(m); }
    };
    w.onerror = (e) => { go.disabled = false; prog.innerHTML = `<div class="small bad">Errore: ${esc(e.message || "lettura non riuscita")}</div>`; };
    const days = Number($("#period").value);
    w.postMessage({ file: f, since: cutoff(days), fcSince: cutoff(14), hrmax: cfg().profilo.fc_max || (cfg().profilo.eta ? Math.round(208 - 0.7 * cfg().profilo.eta) : 190) });
  };
  const NAMES = { hrv: "HRV", fcr: "FC a riposo", fc: "Frequenza cardiaca (14 giorni)", fc_camminata: "FC camminata", resp: "Respirazione", spo2: "Ossigeno", vo2max: "VO₂max", peso: "Peso", grasso_pct: "% grasso", massa_magra: "Massa magra", bmi: "BMI", trimp: "Carico di allenamento (giorni)", passi: "Passi (giorni)", kcal_attive: "Calorie attive (giorni)", kcal_riposo: "Calorie a riposo (giorni)", dist_piedi: "Distanza a piedi (giorni)", piani: "Piani (giorni)", dist_bici: "Bici (giorni)", dist_nuoto: "Nuoto (giorni)", bracciate: "Bracciate (giorni)", kcal_cibo: "Calorie cibo (giorni)", proteine: "Proteine (giorni)", carboidrati: "Carboidrati (giorni)", grassi: "Grassi (giorni)", acqua: "Acqua (giorni)" };
  function showResult(m) {
    const rows = Object.entries(m.data).filter(([, v]) => v.length);
    const total = rows.reduce((a, [, v]) => a + v.length, 0) + m.sleep.length;
    if (!total) { result.innerHTML = `<div class="card"><div class="h2">Nessun dato utile</div><p class="muted">Nel periodo scelto non ci sono dati che Kairo usa.</p></div>`; return; }
    result.innerHTML = `<div class="card list"><div class="label" style="margin-bottom:4px">Trovato ${m.first ? `dal ${fmtDate(m.first, { day: "numeric", month: "short", year: "numeric" })}` : ""}</div>
        ${m.sleep.length ? `<div class="item"><span>Sonno (fasi)</span><span class="small muted">${fmtNum(m.sleep.length)}</span></div>` : ""}
        ${rows.map(([k, v]) => `<div class="item"><span>${NAMES[k] || esc(k)}</span><span class="small muted">${fmtNum(v.length)}</span></div>`).join("")}
        <div class="item"><b>Totale</b><b>${fmtNum(total)} righe</b></div></div>
      ${total > 80000 ? tip("Tanti dati", "Il piano gratuito di Cloudflare permette circa 100.000 scritture al giorno. Se l'invio si ferma, riprova domani: i dati già inviati non vengono duplicati. Oppure scegli un periodo più corto.") : ""}
      <button class="btn orange block" id="send">Invia ${fmtNum(total)} righe a Kairo</button><div id="sendOut"></div>`;
    $("#send").onclick = () => send(m, total);
  }
  async function send(m, total) {
    const btn = $("#send"), out = $("#sendOut"); btn.disabled = true;
    // same format as the HealthSync shortcut: <key>_valori / <key>_date (/ <key>_fine), values joined by ";"
    const jobs = [];
    for (const [k, v] of Object.entries(m.data)) jobs.push(...chunks(v, 1000).map((c) => ({ [`${k}_valori`]: c.map((r) => r[1]).join(";"), [`${k}_date`]: c.map((r) => r[0]).join(";") })));
    jobs.push(...chunks(m.sleep, 800).map((c) => ({ sonno_valori: c.map((r) => r[2]).join(";"), sonno_date: c.map((r) => r[0]).join(";"), sonno_fine: c.map((r) => r[1]).join(";") })));
    let done = 0, rows = 0;
    try {
      for (const j of jobs) {
        const r = await api("/api/ingest", { method: "POST", body: { modulo: "importa_salute", versione: APP_VERSION, esportato: new Date().toISOString(), ...j } });
        rows += r.righe || 0; done++;
        out.innerHTML = bar((done / jobs.length) * 100, `Invio ${done} di ${jobs.length}…`);
      }
      out.innerHTML = `<div class="card soft col" style="gap:6px;margin-top:10px"><div style="font-weight:900" class="good">Importazione completata</div><div class="small">${fmtNum(rows)} righe salvate. Le tue medie personali sono pronte.</div><a class="btn primary" href="#/recupero">Vai a Recupero</a></div>`;
    } catch (e) {
      btn.disabled = false; btn.textContent = "Riprova l'invio";
      out.innerHTML = `<div class="small bad" style="padding-top:8px">${esc(e.message)} (inviati ${done} blocchi di ${jobs.length}). Puoi riprovare: i dati già salvati non vengono duplicati.</div>`;
    }
  }
};
// Hevy CSV export → sets. Columns: title, start_time, end_time, description, exercise_title, superset_id,
// exercise_notes, set_index, set_type, weight_kg (or weight_lbs), reps, distance_km, duration_seconds, rpe
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const MESI = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, gen: 0, mag: 4, giu: 5, lug: 6, ago: 7, set: 8, ott: 9, dic: 11 };
function hevyDate(s) {
  s = String(s || "").trim();
  let d;
  const m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})/);
  if (m && MESI[m[2].toLowerCase()] != null) d = new Date(Number(m[3]), MESI[m[2].toLowerCase()], Number(m[1]), Number(m[4]), Number(m[5]));
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s.replace(" ", "T"));
  if (!d || isNaN(d)) return null;
  const off = -d.getTimezoneOffset(), pad = (n) => String(Math.abs(n)).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${off >= 0 ? "+" : "-"}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}
// Strong CSV: Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE
async function importStrong(rows, head, out) {
  const col = (n) => head.indexOf(n);
  const dur = (s) => { const h = /(\d+)\s*h/.exec(s || ""), m = /(\d+)\s*m/.exec(s || ""); return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) || null; };
  const sets = []; let bad = 0;
  for (const r of rows) {
    const startD = new Date(String(r[col("date")] || "").replace(" ", "T"));
    if (isNaN(startD)) { bad++; continue; }
    const min = dur(r[col("duration")]);
    const so = String(r[col("set order")] || "");
    if (!/^\d+$/.test(so)) continue; // warm-up (W) and drop sets are not counted
    sets.push({ start: localIso(startD), end: min ? localIso(new Date(startD.getTime() + min * 60000)) : null, workout: r[col("workout name")], exercise: r[col("exercise name")],
      set_index: Number(so) - 1, set_type: "normal", weight: r[col("weight")] === "" ? null : Number(String(r[col("weight")]).replace(",", ".")),
      reps: r[col("reps")] === "" ? null : Number(r[col("reps")]), rpe: col("rpe") >= 0 && r[col("rpe")] !== "" ? Number(r[col("rpe")]) : null, fonte: "strong" });
  }
  return sendSets(sets, bad, out);
}
async function sendSets(sets, bad, out) {
  let saved = 0, discarded = bad;
  for (const [i, part] of chunks(sets, 2000).entries()) {
    out.textContent = `Invio ${i + 1} di ${Math.ceil(sets.length / 2000)}…`;
    const r = await api("/api/forza", { method: "POST", body: { serie: part } });
    saved += r.righe; discarded += r.scartate;
  }
  const workouts = new Set(sets.map((x) => x.start)).size;
  out.innerHTML = `<span class="good">Importate ${fmtNum(saved)} serie da ${fmtNum(workouts)} allenamenti.</span>${discarded ? ` <span class="muted">${fmtNum(discarded)} righe scartate.</span>` : ""} <a href="#/palestra">Vedi i progressi</a>`;
}
async function importHevy(f, out) {
  if (!f) return;
  try {
    out.textContent = "Leggo il file…";
    const rows = parseCsv(await f.text());
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    const col = (n) => head.indexOf(n);
    if (col("exercise name") >= 0 && col("set order") >= 0) return importStrong(rows, head, out);
    if (col("exercise_title") < 0 || col("start_time") < 0) throw new Error("Formato non riconosciuto: serve l'export CSV di Hevy o di Strong.");
    const lbs = col("weight_kg") < 0 && col("weight_lbs") >= 0;
    const sets = [];
    let bad = 0;
    for (const r of rows) {
      const start = hevyDate(r[col("start_time")]), end = hevyDate(r[col("end_time")]);
      if (!start) { bad++; continue; }
      const w = r[col(lbs ? "weight_lbs" : "weight_kg")];
      sets.push({ start, end, workout: r[col("title")], exercise: r[col("exercise_title")], set_index: Number(r[col("set_index")]) || 0, set_type: r[col("set_type")] || "normal",
        weight: w === "" || w == null ? null : Math.round(Number(w) * (lbs ? 0.45359237 : 1) * 100) / 100, reps: r[col("reps")] === "" ? null : Number(r[col("reps")]),
        rpe: col("rpe") >= 0 && r[col("rpe")] !== "" ? Number(r[col("rpe")]) : null, fonte: "hevy" });
    }
    return sendSets(sets, bad, out);
  } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
}

const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/* ---------- onboarding / access ---------- */
views.benvenuto = async (el) => {
  const info = await api("/api/info").catch(() => null);
  if (info && !info.setup_richiesto && cfg().code) return route("oggi");
  if (info && !info.setup_richiesto) return route("accesso");
  el.innerHTML = `<div class="col center" style="gap:14px;padding-top:30px">${ico.sun(90)}
      <div style="font-size:48px;font-weight:900;letter-spacing:-1.5px">kairo<span style="color:var(--orange)">.</span></div>
      <div class="muted" style="max-width:300px;line-height:1.5">Ogni giorno parte da come hai recuperato.</div>${bean(82, 120)}</div>
    <div class="card col" style="gap:12px"><div class="h2">Crea il tuo codice di accesso</div>
      <div class="small" style="line-height:1.5;color:var(--text)">Benvenuto! Scegli un codice di almeno 10 caratteri (meglio una frase corta, es. «mattino-bici-42»): ti servirà per aprire Kairo su iPhone e PC. Salvalo nel portachiavi o in Note.</div>
      <label class="field">Codice<input class="input" id="c1" type="password" autocomplete="new-password" minlength="10"></label>
      <label class="field">Ripeti il codice<input class="input" id="c2" type="password" autocomplete="new-password"></label>
      <button class="btn primary" id="go">Crea e continua</button><div id="msg" class="small bad"></div></div>`;
  $("#go").onclick = async () => {
    const a = $("#c1").value, b = $("#c2").value;
    if (a.length < 10) return ($("#msg").textContent = "Almeno 10 caratteri.");
    if (a !== b) return ($("#msg").textContent = "I due codici non coincidono.");
    try { await api("/api/setup", { method: "POST", body: { codice: a } }); store.set("code", a); route("configura-ia"); }
    catch (e) { $("#msg").textContent = e.message; }
  };
};

views.accesso = async (el) => {
  el.innerHTML = `<div class="col center" style="gap:12px;padding-top:30px">${ico.sun(80)}<div style="font-size:42px;font-weight:900;letter-spacing:-1px">kairo<span style="color:var(--orange)">.</span></div></div>
    <div class="card col" style="gap:12px"><div class="h2">Accedi</div><div class="small muted">Inserisci il codice di accesso che hai creato la prima volta.</div>
      <label class="field">Codice di accesso<input class="input" id="code" type="password" autocomplete="current-password"></label>
      <button class="btn primary" id="go">Entra</button><div id="msg" class="small bad"></div>
      <a class="small" href="${GITHUB_URL}#readme" target="_blank" rel="noopener">Non hai ancora un server? Leggi come crearlo</a></div>`;
  $("#go").onclick = async () => {
    store.set("code", $("#code").value.trim());
    try {
      const info = await api("/api/info");
      if (info.setup_richiesto) return route("benvenuto");
      await api("/api/diagnostica"); route(store.get("groqAsked") ? "oggi" : "configura-ia");
    } catch (e) { $("#msg").textContent = e.status === 401 ? "Codice non valido." : e.message; }
  };
};

function validKey(v) {
  const k = String(v || "").trim();
  if (!k) return true;
  if (!/^gsk_[A-Za-z0-9]{20,}$/.test(k)) { toast("La chiave Groq inizia con gsk_ e non ha spazi: ricopiala per intero."); return false; }
  return true;
}

views["configura-ia"] = async (el) => {
  store.set("groqAsked", true);
  el.innerHTML = `${header("Coach IA", { gear: false, sub: "Facoltativo · 2 minuti" })}
    <div class="card col" style="gap:12px">
      <div style="line-height:1.55;color:var(--text)">Il coach funziona già, con un modello gratuito di Cloudflare. Con una chiave <b>Groq</b> (gratis) diventa più preciso e veloce.</div>
      <ol class="steps"><li>Apri <a href="https://console.groq.com/keys" target="_blank" rel="noopener"><b>console.groq.com/keys</b></a> e accedi (anche con Google).</li>
        <li>Tocca <b>Create API Key</b>, scrivi un nome qualsiasi (es. Kairo) e conferma.</li>
        <li>Tocca <b>Copy</b>, torna qui e incolla la chiave (inizia con <span class="code">gsk_</span>).</li></ol>
      <label class="field">Chiave Groq<input class="input" id="gk" type="password" placeholder="gsk_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <button class="btn primary" id="save">Salva e prova</button>
      <div id="out" class="small" style="line-height:1.5"></div>
      <button class="btn ghost" id="skip">Lo faccio dopo</button></div>
    <div class="small muted center">La chiave viene salvata sul tuo server e vale su tutti i tuoi dispositivi. Puoi cambiarla in Impostazioni → Coach IA.</div>`;
  $("#save").onclick = async () => {
    const k = $("#gk").value.trim();
    if (!k) return ($("#out").textContent = "Incolla prima la chiave, oppure tocca «Lo faccio dopo».");
    if (!validKey(k)) return;
    store.set("groqKey", k); $("#out").textContent = "Provo la connessione…";
    try {
      const r = await api("/api/ai/test", { method: "POST" });
      if (r.errore) { $("#out").innerHTML = `<span class="bad">${esc(r.errore)}</span>`; return; }
      if (r.provider !== "groq") { $("#out").innerHTML = `<span class="bad">Groq non ha risposto${r.avviso ? ": " + esc(r.avviso) : ""}</span>`; return; }
      await api("/api/ia/chiave", { method: "POST", body: { chiave: k } }); store.del("groqKey");
      toast("Chiave Groq funzionante"); route("guida");
    } catch (e) { $("#out").innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  };
  $("#skip").onclick = () => route("guida");
};

/* ---------- router ---------- */
const PUBLIC = new Set(["benvenuto", "accesso"]);
function route(name) { location.hash = "#/" + name; }
let profileLoaded = false;
async function router() {
  closeSheet();
  const name = (location.hash.replace(/^#\/?/, "") || "oggi").split("?")[0];
  // each navigation renders into a fresh container: a slow view that finishes late writes into a detached node
  const el = document.createElement("div");
  el.style.display = "contents";
  $("#app").replaceChildren(el);
  document.body.classList.toggle("wide", name === "diagnostica");
  if (!PUBLIC.has(name) && !cfg().code) {
    const info = await api("/api/info").catch(() => null);
    return route(info && info.setup_richiesto ? "benvenuto" : "accesso");
  }
  if (!profileLoaded) { profileLoaded = true; loadProfile(); migrateGroqKey(); }
  const view = views[name] || views.oggi;
  renderTabs(TABS.some(([k]) => k === name) ? name : null);
  window.scrollTo(0, 0);
  try { await view(el); } catch (e) { if (e.status !== 401) el.innerHTML = header("Kairo") + errorCard(e); }
}
window.addEventListener("hashchange", router);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
// new version on the server → a small banner; tapping it loads the new app (no need to close and reopen)
let updateShown = false;
async function checkUpdate() {
  if (updateShown || !cfg().code) return;
  try {
    const info = await api("/api/info");
    if (!info.versione || info.versione === APP_VERSION) return;
    updateShown = true;
    const b = document.createElement("button");
    b.className = "btn primary"; b.id = "updBanner";
    b.style.cssText = "position:fixed;left:16px;right:16px;bottom:calc(84px + var(--safe-bottom, 0px));z-index:40;min-height:48px;border-radius:16px;box-shadow:0 6px 20px rgba(28,35,64,.25)";
    b.textContent = `Aggiornamento pronto (${info.versione}) · tocca`;
    b.onclick = async () => { b.textContent = "Aggiorno…"; try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch (_) {} location.reload(); };
    document.body.appendChild(b);
  } catch (_) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(); });
setTimeout(checkUpdate, 4000);
router();
