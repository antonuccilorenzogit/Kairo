/* Kairo web app — vanilla JS, no build step.
 * Talks only to the Kairo server (/api/*). Secrets (access code, Groq key) stay in this
 * device's localStorage and are sent as headers on each request. */
"use strict";

const APP_VERSION = "1.1.1";
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
  server: store.get("server", location.origin),
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
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/info") { route("accesso"); throw new ApiError(data.errore || "Codice non valido", 401); }
  if (!res.ok) throw new ApiError(data.errore || `Errore ${res.status}`, res.status);
  return data;
}

/* ---------- icons ---------- */
const ico = {
  oggi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 17a8 8 0 0 1 16 0"/><path d="M2 17h20M12 4v3M5 8l2 2M19 8l-2 2"/></svg>',
  recupero: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
  sonno: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
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
const TABS = [["oggi", "Oggi"], ["recupero", "Recupero"], ["sonno", "Sonno"], ["coach", "Coach"]];
function renderTabs(active) {
  const nav = $("#tabbar");
  if (!active) { nav.hidden = true; return; }
  nav.hidden = false;
  nav.innerHTML = TABS.map(([k, l]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ""}>${ico[k]}${l}</a>`).join("");
}
function header(title, { back = null, gear = true, sub = "" } = {}) {
  return `<div class="row between">
    <div class="row">${back ? `<a class="iconbtn" href="#/${back}" aria-label="Indietro">${ico.back}</a>` : ""}<div class="col" style="gap:2px"><h1 class="title">${title}</h1>${sub ? `<div class="muted">${sub}</div>` : ""}</div></div>
    ${gear ? `<a class="iconbtn" href="#/impostazioni" aria-label="Impostazioni" style="color:var(--ink)">${ico.gear}</a>` : ""}</div>`;
}
const loading = (n = 3) => Array.from({ length: n }, () => '<div class="card"><div class="skeleton" style="height:80px"></div></div>').join("");
const errorCard = (e) => `<div class="card"><div class="h2">Qualcosa non va</div><p class="muted">${esc(e.message || e)}</p><a class="btn ghost" href="#/diagnostica">Apri la diagnostica</a></div>`;

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

views.oggi = async (el) => {
  const p = cfg().profilo;
  el.innerHTML = `${header(`Ciao${p.nome ? ",<br>" + esc(p.nome) : ""}`, { sub: fmtDate(todayStr()) })}${loading(3)}`;
  const [hist] = await Promise.all([api("/api/history?days=2")]);
  const d = hist[hist.length - 1], y = hist[0];
  const r = d.recupero, st = state(r.score);
  const delta = r.score != null && y.recupero.score != null ? r.score - y.recupero.score : null;
  const hrv = r.componenti.hrv, fcr = r.componenti.fc_riposo;
  const cmp = (v, b, invert) => (v == null || b == null ? '<span class="muted">nessun dato</span>'
    : ((invert ? v < b : v > b) ? `<span class="good">${invert ? "▼" : "▲"} media ${fmtNum(b)}</span>` : `<span class="mid">${invert ? "▲" : "▼"} media ${fmtNum(b)}</span>`));
  el.innerHTML = `${header(`Ciao${p.nome ? ",<br>" + esc(p.nome) : ""}`, { sub: fmtDate(d.giorno) })}
    <div class="card col center" style="padding:16px 20px 20px;gap:4px">
      ${bean(r.score)}
      ${r.score == null
        ? `<div class="h2">In calibrazione</div><div class="muted small" style="max-width:280px">Sto imparando il tuo normale: servono almeno 5 notti con HRV e FC a riposo (ne ho ${r.giorni_baseline}).</div>`
        : `<div class="huge">${r.score}</div><div class="h2 ${st.cls}">${st.label}</div>
           ${delta != null ? `<div class="muted small">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} da ieri</div>` : ""}
           ${r.calibrazione ? `<div class="muted small">Stima provvisoria · baseline di ${r.giorni_baseline} giorni</div>` : ""}`}
    </div>
    <div class="grid3">
      <a class="mini" href="#/sonno" style="text-decoration:none;color:inherit"><div class="label">Sonno</div><div class="big">${d.sonno ? fmtMin(d.sonno.durata_min) : "–"}</div><div class="small ${d.sonno ? "good" : "muted"}" style="font-weight:700">${d.sonno ? d.sonno.punteggio + " punti" : "nessun dato"}</div></a>
      <a class="mini" href="#/recupero" style="text-decoration:none;color:inherit"><div class="label">HRV</div><div class="big">${d.notte.hrv_ms != null ? fmtNum(d.notte.hrv_ms) + " ms" : "–"}</div><div class="small" style="font-weight:700">${cmp(d.notte.hrv_ms, hrv.baseline)}</div></a>
      <a class="mini" href="#/recupero" style="text-decoration:none;color:inherit"><div class="label">FC riposo</div><div class="big">${d.notte.fcr_bpm != null ? fmtNum(d.notte.fcr_bpm) : "–"}</div><div class="small" style="font-weight:700">${cmp(d.notte.fcr_bpm, fcr.baseline, true)}</div></a>
    </div>
    <a class="card soft row" href="#/coach" style="text-decoration:none;color:inherit;gap:12px">
      ${ico.sun(30)}<div class="col" style="gap:2px;flex:1"><div style="font-weight:900">Consiglio di oggi</div><div id="advice" class="small" style="color:var(--text);line-height:1.45"><div class="skeleton" style="width:90%"></div></div></div>${ico.chevron}
    </a>
    ${d.checkin
      ? `<button class="card row between" data-checkin style="border:0;text-align:left;cursor:pointer"><div class="col" style="gap:2px"><div style="font-weight:900">Check-in fatto ✓</div><div class="small muted">Energia ${d.checkin.energia}/5 · Dolori ${d.checkin.dolori}/5 · ${esc(d.checkin.attivita || "riposo")}</div></div>${ico.chevron}</button>`
      : `<button class="btn orange block" data-checkin style="justify-content:space-between;min-height:64px;border-radius:22px"><span class="col" style="gap:0;text-align:left"><span style="font-weight:900">Check-in del mattino</span><span class="small" style="font-weight:600">Com'è andata ieri? 10 secondi</span></span>${ico.arrow}</button>`}
    <div class="row between small muted" style="padding:0 4px"><div>Ieri: ${fmtNum(y.attivita.passi)} passi · ${fmtNum(y.attivita.kcal_attive)} kcal attive</div><div>Oggi: ${fmtNum(d.attivita.passi)} passi</div></div>`;
  el.querySelectorAll("[data-checkin]").forEach((b) => b.addEventListener("click", () => checkinSheet(d.checkin)));
  // the advice arrives asynchronously so the page is usable immediately
  api("/api/coach/oggi", { method: "POST", body: { profilo: profiloText() } })
    .then((a) => { const box = $("#advice"); if (box) box.textContent = a.errore ? a.errore : a.testo; })
    .catch((e) => { const box = $("#advice"); if (box) box.textContent = e.message; });
};

function profiloText() {
  const p = cfg().profilo;
  return [p.nome ? `si chiama ${p.nome}` : "", p.note || ""].filter(Boolean).join(". ");
}

/* explanation panels for the recovery components */
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
      + range("Uomini 18–29 anni con Apple Watch (indicativo)", 45, 105, 20, 140, b ?? d.notte.hrv_ms, ["20 ms", "tipico 45–105 · mediana 65", "140"])
      + you(b ? `media personale ${fmtNum(b)} ms, oggi ${fmtNum(d.notte.hrv_ms)} ms. Conta il confronto con te stesso: l'HRV dipende molto anche dalla genetica e dall'età.` : "non ho ancora abbastanza notti per la tua media personale.")
      + tip("L'HRV è più alta di notte. Per questo Kairo usa le misure fatte mentre dormi: quelle di giorno cambiano con caffè, stress e movimento. Apple Watch misura la SDNN, quindi i valori non sono confrontabili con Whoop o Oura (che usano la RMSSD).");
  } else if (kind === "fc_riposo") {
    const b = c.fc_riposo.baseline;
    const saved = b ? Math.max(0, Math.round((70 - b) * 1440)) : null;
    html = sheetHead("FC a riposo · il motore al minimo")
      + body("Quanti battiti al minuto servono al cuore quando non fai niente. Un cuore allenato pompa più sangue a ogni colpo, quindi gliene servono meno. Se sale di 5+ bpm sopra la tua media per più giorni, spesso indica fatica, poco sonno o un malanno.")
      + range("Atleti 40–60 · adulti 60–100 bpm", 40, 60, 35, 100, b ?? d.notte.fcr_bpm, ["35", "zona sportivi", "100"], true)
      + you(b ? `media personale ${fmtNum(b)} bpm, oggi ${fmtNum(d.notte.fcr_bpm)}.` : "non ho ancora abbastanza giorni per la tua media.")
      + (saved ? tip(`Rispetto a chi ha 70 bpm a riposo, il tuo cuore fa circa <b>${fmtNum(saved)} battiti in meno al giorno</b>: ${fmtNum(saved * 365 / 1e6, 1)} milioni in un anno.`) : "");
  } else if (kind === "sonno") {
    const s = d.sonno;
    html = sheetHead("Punteggio del sonno")
      + body("Combina quanto hai dormito (50 punti, obiettivo 8 h), quanto del tempo a letto hai passato dormendo (20), la quota di sonno profondo e REM (20) e la regolarità dell'orario negli ultimi 7 giorni (10).")
      + you(s ? `${s.punteggio}/100 · ${fmtMin(s.durata_min)} di sonno, efficienza ${s.efficienza}%, addormentato alle ${hhmm(s.inizio)}.` : "nessuna notte registrata: dormi con il Watch per avere questo dato.")
      + tip("Il sonno profondo si concentra nella prima metà della notte, il REM verso il mattino: andare a letto tardi taglia soprattutto il profondo, quello che ripara i muscoli.");
  } else {
    html = sheetHead("Respirazione notturna")
      + body("Quanti respiri fai al minuto mentre dormi. È molto stabile: un aumento di 1–2 respiri al minuto per più notti può segnalare affaticamento o un malanno in arrivo.")
      + range("Adulti a riposo: 12–20 respiri/min", 12, 20, 8, 26, d.notte.resp_rpm, ["8", "normale 12–20", "26"], true)
      + you(d.notte.resp_rpm ? `${fmtNum(d.notte.resp_rpm, 1)} respiri al minuto stanotte.` : "nessun dato stanotte (serve il Watch durante il sonno).")
      + tip("Il Watch misura la respirazione solo mentre dormi: è uno dei segnali più precoci di un raffreddore in arrivo.");
  }
  openSheet(html, "Spiegazione");
}

views.recupero = async (el) => {
  el.innerHTML = header("Recupero") + loading(3);
  const [hist, mesi] = await Promise.all([api("/api/history?days=14"), api("/api/hrv-mensile")]);
  const d = hist[hist.length - 1], r = d.recupero, st = state(r.score);
  const comps = [
    ["hrv", "HRV", d.notte.hrv_ms != null ? `${fmtNum(d.notte.hrv_ms)} ms` : "–", r.componenti.hrv],
    ["fc_riposo", "FC a riposo", d.notte.fcr_bpm != null ? `${fmtNum(d.notte.fcr_bpm)} bpm` : "–", r.componenti.fc_riposo],
    ["sonno", "Sonno", d.sonno ? `${d.sonno.punteggio} pt` : "–", r.componenti.sonno],
    ["respirazione", "Respirazione", d.notte.resp_rpm != null ? fmtNum(d.notte.resp_rpm, 1) : "–", r.componenti.respirazione],
  ];
  const sign = { hrv: 1, fc_riposo: -1, sonno: 1, respirazione: -1 };
  const compRow = ([k, name, val, c]) => {
    const z = c.z == null ? 0 : c.z * sign[k];
    const w = Math.min(Math.abs(z), 3) / 3 * 50;
    const color = z > 0.05 ? "var(--green)" : z < -0.05 ? "var(--red)" : "#C9CEDB";
    const media = c.baseline != null ? `media ${fmtNum(c.baseline, k === "respirazione" ? 1 : 0)}` : c.valore == null ? "nessun dato" : "in calibrazione";
    return `<button class="comp" data-info="${k === "respirazione" ? "resp" : k}" aria-label="Cosa significa ${name}">
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
    <div class="card row" style="gap:14px">${bean(r.score, 46)}<div class="col" style="gap:2px"><div style="font-size:30px;font-weight:900;line-height:1">${r.score ?? "–"} <span class="${st.cls}" style="font-size:16px">${st.label}</span></div><div class="small muted">Rispetto ai tuoi ultimi 60 giorni${r.calibrazione ? ` · baseline ${r.giorni_baseline} gg` : ""}</div></div></div>
    <div class="card" style="padding:16px 16px 10px"><div class="row between" style="padding:0 2px 6px"><div class="label">Cosa ha pesato oggi</div><div class="small muted">tocca per capire</div></div>
      ${comps.map(compRow).join("")}
      <div class="row between small muted" style="padding:8px 2px 4px"><div>← peggiora</div><div>migliora →</div></div></div>
    <div class="card"><div class="label" style="margin-bottom:8px">Ultimi 14 giorni</div><div class="row" style="gap:2px;align-items:flex-end">${bars}</div></div>
    ${mesi.length > 1 ? `<button class="card col" data-info="hrv" style="border:0;text-align:left;cursor:pointer;gap:8px"><div class="row between" style="width:100%"><div class="label">HRV · media mensile</div><div class="small muted">${mesi.length} mesi</div></div>${lineChart(mesi.map((m) => m.media), mesi.map((m) => m.mese.slice(5)))}</button>` : ""}`;
  el.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => infoSheet(b.dataset.info, d)));
};

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
  const d = hist[hist.length - 1], s = d.sonno;
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
  const debt = hist.filter((h) => h.sonno).reduce((a, h) => a + (h.sonno.durata_min - 480), 0);
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
      : `<div class="card col center" style="gap:8px">${bean(null, 90)}<div class="h2">Nessun dato del sonno stanotte</div><div class="muted small" style="max-width:300px">Per avere sonno, respirazione e HRV notturna indossa il Watch mentre dormi. Carica il Watch mentre fai colazione o la doccia.</div></div>`}
    <div class="card"><div class="row between" style="margin-bottom:8px"><div class="label">Ultimi 7 giorni</div>${nNights ? `<div class="small ${debt < 0 ? "bad" : "good"}" style="font-weight:800">${debt < 0 ? "Debito" : "Surplus"} ${fmtMin(Math.abs(debt))} su 8 h</div>` : ""}</div><div class="row" style="gap:2px;align-items:flex-end">${week}</div></div>
    ${s && s.regolarita_min != null ? `<div class="card soft"><div style="line-height:1.45">Il tuo orario di addormentamento varia di circa <b>${s.regolarita_min} minuti</b> da una sera all'altra. ${s.regolarita_min > 60 ? "Più regolarità di solito significa sonno più profondo." : "Ottima regolarità."}</div></div>` : ""}`;
  el.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => infoSheet("sonno", d)));
};

views.coach = async (el) => {
  const msgs = store.get("chat", []);
  const suggest = ["Posso allenarmi duro oggi?", "Perché il mio recupero è così?", "Come sta andando il mio sonno?", "Cosa posso migliorare questa settimana?"];
  const render = (busy = false) => {
    el.innerHTML = `${header("Coach", { sub: "Risponde con i tuoi dati degli ultimi 21 giorni" })}
      ${msgs.length ? "" : `<div class="card soft col"><div style="line-height:1.45">Chiedimi qualsiasi cosa sui tuoi dati: recupero, sonno, allenamento. Uso solo i numeri del tuo database.</div></div>`}
      <div class="chips">${suggest.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <div class="chat" id="chat">${msgs.map((m) => `<div class="msg ${m.role === "user" ? "user" : "bot"}">${esc(m.content)}${m.meta ? `<span class="meta">${esc(m.meta)}</span>` : ""}</div>`).join("")}${busy ? '<div class="msg bot"><div class="skeleton" style="width:180px"></div></div>' : ""}</div>
      ${msgs.length ? '<button class="btn ghost" id="clear" style="align-self:center;min-height:40px;font-size:14px">Nuova conversazione</button>' : ""}
      <div style="height:70px"></div>
      <div class="composer"><form id="f"><label class="sr" for="q" style="position:absolute;left:-9999px">Messaggio</label><input id="q" class="input" placeholder="Scrivi una domanda…" autocomplete="off" ${busy ? "disabled" : ""}><button class="btn primary" ${busy ? "disabled" : ""}>Invia</button></form></div>`;
    window.scrollTo(0, document.body.scrollHeight);
    el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => send(b.dataset.q)));
    $("#f").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#q").value.trim(); if (v) send(v); });
    const c = $("#clear"); if (c) c.addEventListener("click", () => { msgs.length = 0; store.set("chat", msgs); render(); });
  };
  const send = async (q) => {
    msgs.push({ role: "user", content: q }); store.set("chat", msgs); render(true);
    try {
      const r = await api("/api/coach/chat", { method: "POST", body: { messaggi: msgs.map(({ role, content }) => ({ role, content })), profilo: profiloText() } });
      msgs.push({ role: "assistant", content: r.errore || r.testo, meta: r.errore ? "errore" : `${r.provider === "groq" ? "Groq" : "Modello di riserva"} · ${r.model}${r.avviso ? " · " + r.avviso : ""}` });
    } catch (e) { msgs.push({ role: "assistant", content: e.message, meta: "errore" }); }
    store.set("chat", msgs.slice(-40)); render();
  };
  render();
};

/* ---------- check-in ---------- */
function checkinSheet(existing) {
  const s = { energia: existing?.energia ?? 3, dolori: existing?.dolori ?? 2, umore: existing?.umore ?? 3, act: new Set((existing?.attivita || "").split(",").filter(Boolean)), rpe: existing?.rpe ?? 6, durata: existing?.durata_min ?? 60 };
  const ACTS = [["palestra", "Palestra"], ["nuoto", "Nuoto"], ["bici", "Bici"], ["calcio", "Calcio"], ["corsa", "Corsa"], ["camminata", "Camminata"], ["altro", "Altro"], ["riposo", "Riposo"]];
  const scale = (k, label, hint) => `<div class="col"><div class="row between"><div style="font-weight:800">${label}</div><div class="small muted">${hint}</div></div>
    <div class="scale" role="group" aria-label="${label}">${[1, 2, 3, 4, 5].map((n) => `<button class="choice" data-k="${k}" data-v="${n}" aria-pressed="${s[k] === n}">${n}</button>`).join("")}</div></div>`;
  const draw = () => {
    const sport = [...s.act].some((a) => a !== "riposo");
    w.querySelector(".sheet").innerHTML = `<div class="grab"></div>${sheetHead("Check-in")}
      <div class="muted">Com'è andata ieri, e come ti senti oggi?</div>
      ${scale("energia", "Energia", "1 a terra · 5 al top")}${scale("dolori", "Indolenzimento", "1 niente · 5 tanto")}${scale("umore", "Umore", "1 giù · 5 alle stelle")}
      <div class="col"><div style="font-weight:800">Cosa hai fatto ieri</div><div class="acts" style="grid-template-columns:repeat(4,minmax(0,1fr))">${ACTS.map(([k, l]) => `<button class="choice" data-a="${k}" aria-pressed="${s.act.has(k)}">${l}</button>`).join("")}</div></div>
      ${sport ? `<div class="card col"><label class="row between" for="rpe" style="font-weight:800"><span>Quanto è stata dura?</span><span style="color:var(--orange-ink)">RPE ${s.rpe}</span></label><input id="rpe" type="range" min="1" max="10" value="${s.rpe}">
        <label class="row between" for="dur" style="font-weight:800"><span>Durata</span><span class="muted">${s.durata} min</span></label><input id="dur" type="range" min="10" max="240" step="5" value="${s.durata}"></div>` : ""}
      <button class="btn primary block" id="save">Salva check-in</button>`;
    w.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => { s[b.dataset.k] = Number(b.dataset.v); draw(); }));
    w.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.a;
      if (k === "riposo") { s.act = s.act.has("riposo") ? new Set() : new Set(["riposo"]); }
      else { s.act.delete("riposo"); s.act.has(k) ? s.act.delete(k) : s.act.add(k); }
      draw();
    }));
    const rpe = w.querySelector("#rpe"); if (rpe) rpe.addEventListener("input", (e) => { s.rpe = Number(e.target.value); e.target.previousElementSibling.lastElementChild.textContent = "RPE " + s.rpe; });
    const dur = w.querySelector("#dur"); if (dur) dur.addEventListener("input", (e) => { s.durata = Number(e.target.value); e.target.previousElementSibling.lastElementChild.textContent = s.durata + " min"; });
    w.querySelector("#save").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const sportNow = [...s.act].some((a) => a !== "riposo");
        await api("/api/checkin", { method: "POST", body: { day: todayStr(), energia: s.energia, dolori: s.dolori, umore: s.umore, attivita: [...s.act].join(","), rpe: sportNow ? s.rpe : null, durata_min: sportNow ? s.durata : null } });
        closeSheet(); toast("Check-in salvato"); router();
      } catch (err) { e.target.disabled = false; toast(err.message); }
    });
  };
  const w = openSheet("", "Check-in");
  draw();
}

/* ---------- settings ---------- */
views.impostazioni = async (el) => {
  const c = cfg();
  el.innerHTML = `${header("Impostazioni", { back: "oggi", gear: false })}
    <div class="card col" style="gap:12px"><div class="h2">Profilo</div>
      <label class="field">Nome<input class="input" id="nome" value="${esc(c.profilo.nome)}" autocomplete="given-name"></label>
      <label class="field">Note per il coach<textarea class="input" id="note" rows="3" style="padding:12px;min-height:84px" placeholder="Es. palestra 3 volte a settimana, nuoto, obiettivo 10% di grasso">${esc(c.profilo.note)}</textarea><span class="hint">Restano su questo dispositivo e vengono inviate all'IA insieme alle domande.</span></label>
      <button class="btn ghost" id="saveProfilo">Salva profilo</button></div>

    <div class="card col" style="gap:12px"><div class="h2">Intelligenza artificiale</div>
      <label class="field">Chiave API Groq<input class="input" id="gk" type="password" value="${esc(c.groqKey)}" placeholder="gsk_…" autocomplete="off"><span class="hint">Gratuita su <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a>. Resta solo su questo dispositivo. Senza chiave Kairo usa il modello di riserva di Cloudflare.</span></label>
      <label class="field">Modello<select class="input" id="gm"><option value="">Predefinito</option>${c.groqModel ? `<option selected>${esc(c.groqModel)}</option>` : ""}</select></label>
      <div class="row"><button class="btn ghost" id="loadModels">Carica modelli</button><button class="btn ghost" id="testAi">Prova connessione</button></div>
      <div id="aiOut" class="small muted"></div>
      <button class="btn primary" id="saveAi">Salva</button></div>

    <div class="card col" style="gap:12px"><div class="h2">Comando rapido HealthSync</div>
      <div class="small" style="line-height:1.5;color:var(--text)">Il comando legge i dati di Salute sull'iPhone e li invia al tuo server. Durante l'importazione ti chiede indirizzo e codice qui sotto.</div>
      <div class="card soft col" style="gap:4px"><div class="small muted">Indirizzo del server</div><div class="code">${esc(c.server)}</div></div>
      <a class="btn orange" href="shortcuts/HealthSync.shortcut" target="_blank" rel="noopener">Scarica HealthSync</a>
      <a class="btn ghost" href="#/guida">Guida passo passo (A–Z)</a></div>

    <div class="card col" style="gap:10px"><div class="h2">Server e accesso</div>
      <label class="field">Indirizzo del server<input class="input" id="srv" value="${esc(c.server)}" inputmode="url" autocomplete="off"></label>
      <label class="field">Codice di accesso<input class="input" id="code" type="password" value="${esc(c.code)}" autocomplete="current-password"></label>
      <div class="row"><button class="btn ghost" id="saveSrv">Salva</button><button class="btn ghost" id="chgCode">Cambia codice</button></div></div>

    <div class="card list">
      <a class="item" href="#/diagnostica">Diagnostica ${ico.chevron}</a>
      <a class="item" href="#/guida">Guida e tutorial ${ico.chevron}</a>
      <a class="item" href="#/importa">Importa dati da Salute (esportazione) ${ico.chevron}</a>
      <a class="item" href="#/info">Informazioni, licenze e open source ${ico.chevron}</a>
      <a class="item" href="/api/export" id="export">Esporta tutti i dati (JSON) ${ico.chevron}</a>
      <button class="item" id="logout">Esci da questo dispositivo ${ico.chevron}</button>
      <button class="item bad" id="wipe">Cancella tutti i dati dal server ${ico.chevron}</button>
    </div>
    <div class="small muted center" style="display:flex;justify-content:center">Kairo ${APP_VERSION} · <a href="${GITHUB_URL}" target="_blank" rel="noopener" style="margin-left:4px">open source</a></div>`;

  $("#saveProfilo").onclick = () => { store.set("profilo", { nome: $("#nome").value.trim(), note: $("#note").value.trim() }); toast("Profilo salvato"); };
  $("#saveAi").onclick = () => { store.set("groqKey", $("#gk").value.trim()); store.set("groqModel", $("#gm").value); toast("Impostazioni IA salvate"); };
  $("#loadModels").onclick = async () => {
    store.set("groqKey", $("#gk").value.trim());
    const out = $("#aiOut"); out.textContent = "Carico i modelli…";
    try {
      const r = await api("/api/ai/modelli");
      if (r.errore) { out.textContent = r.errore; return; }
      const cur = cfg().groqModel;
      $("#gm").innerHTML = '<option value="">Predefinito (openai/gpt-oss-120b)</option>' + r.modelli.map((m) => `<option ${m === cur ? "selected" : ""}>${esc(m)}</option>`).join("");
      out.textContent = `${r.modelli.length} modelli disponibili.`;
    } catch (e) { out.textContent = e.message; }
  };
  $("#testAi").onclick = async () => {
    store.set("groqKey", $("#gk").value.trim()); store.set("groqModel", $("#gm").value);
    const out = $("#aiOut"); out.textContent = "Provo…";
    try {
      const r = await api("/api/ai/test", { method: "POST" });
      out.innerHTML = r.errore ? `<span class="bad">${esc(r.errore)}</span>` : `<span class="good">Funziona</span> · ${r.provider === "groq" ? "Groq" : "Modello di riserva"} · ${esc(r.model)} · ${r.latenza_ms} ms${r.quota?.richieste_rimaste ? ` · ${esc(r.quota.richieste_rimaste)} richieste rimaste oggi` : ""}${r.avviso ? `<br>${esc(r.avviso)}` : ""}`;
    } catch (e) { out.textContent = e.message; }
  };
  $("#saveSrv").onclick = () => { store.set("server", $("#srv").value.trim().replace(/\/$/, "")); store.set("code", $("#code").value.trim()); toast("Salvato"); };
  $("#chgCode").onclick = async () => {
    const nuovo = prompt("Nuovo codice di accesso (almeno 8 caratteri). Dopo andrà aggiornato anche nel comando HealthSync.");
    if (!nuovo) return;
    try { await api("/api/codice", { method: "POST", body: { nuovo } }); store.set("code", nuovo); toast("Codice cambiato"); views.impostazioni(el); }
    catch (e) { toast(e.message); }
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
  $("#logout").onclick = () => { if (confirm("Rimuovere codice e chiavi da questo dispositivo? I dati sul server restano.")) { ["code", "groqKey", "groqModel", "chat"].forEach(store.del); route("accesso"); } };
  $("#wipe").onclick = async () => {
    const v = prompt("Questa azione cancella definitivamente tutti i tuoi dati dal server. Scrivi CANCELLA per confermare.");
    if (v !== "CANCELLA") return;
    try { await api("/api/dati", { method: "DELETE", body: { conferma: "CANCELLA" } }); toast("Dati cancellati"); }
    catch (e) { toast(e.message); }
  };
};

/* ---------- diagnostics ---------- */
async function latestRelease() {
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const j = await r.json(); return { tag: (j.tag_name || "").replace(/^v/, ""), url: j.html_url };
  } catch { return null; }
}
const newer = (a, b) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); } return false; };

views.diagnostica = async (el) => {
  el.innerHTML = header("Diagnostica", { back: "impostazioni", gear: false }) + loading(4);
  const t0 = performance.now();
  let d, err;
  try { d = await api("/api/diagnostica"); } catch (e) { err = e; }
  const lat = Math.round(performance.now() - t0);
  const rel = await latestRelease();
  const dot = (s) => `<span class="status-dot ${s}"></span>`;
  const item = (s, label, value) => `<div class="item"><div class="row" style="gap:10px">${dot(s)}<span>${label}</span></div><div class="small muted" style="text-align:right">${value}</div></div>`;
  const c = cfg();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const sw = "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
  let html = header("Diagnostica", { back: "impostazioni", gear: false });

  // Server & versions
  const srvV = d?.server.versione;
  const updApp = rel && newer(rel.tag, APP_VERSION), updSrv = rel && srvV && newer(rel.tag, srvV);
  html += `<div class="card list"><div class="label" style="margin-bottom:4px">Server e versioni</div>
    ${item(err ? "err" : lat > 1500 ? "warn" : "ok", "Server raggiungibile", err ? esc(err.message) : `${lat} ms`)}
    ${item("ok", "Versione app", APP_VERSION)}
    ${item(!srvV ? "off" : srvV !== APP_VERSION ? "warn" : "ok", "Versione server", srvV ? `${esc(srvV)}${srvV !== APP_VERSION ? " · diversa dall'app" : ""}` : "–")}
    ${item(!rel ? "off" : updApp || updSrv ? "warn" : "ok", "Ultima versione su GitHub", rel ? `${esc(rel.tag)}${updApp || updSrv ? ` · <a href="${esc(rel.url)}" target="_blank" rel="noopener">aggiornamento disponibile</a>` : " · aggiornato"}` : "nessuna release pubblicata")}
    ${item(d ? "ok" : "off", "Schema database", d ? `v${d.server.schema}` : "–")}
  </div>`;

  if (d) {
    // Sync freshness
    const last = d.importazioni[0];
    const ageH = last ? (Date.now() - Date.parse(last.received)) / 36e5 : Infinity;
    const lastByMod = {};
    d.importazioni.forEach((i) => { if (!lastByMod[i.modulo]) lastByMod[i.modulo] = i; });
    html += `<div class="card list"><div class="label" style="margin-bottom:4px">Sincronizzazione da iPhone</div>
      ${item(ageH < 14 ? "ok" : ageH < 36 ? "warn" : "err", "Ultimo invio", last ? `${ago(last.received)} · ${esc(last.modulo || "?")} · ${last.righe} righe` : "mai: installa il comando HealthSync")}
      ${Object.values(lastByMod).slice(0, 6).map((i) => item("off", esc(i.modulo || "?"), `${ago(i.received)}${i.versione ? " · comando v" + esc(i.versione) : ""}`)).join("")}
      ${ageH >= 36 && last ? `<div class="small" style="padding:10px 0;line-height:1.45">L'ultimo invio è vecchio: controlla in Comandi → Automazioni che le automazioni di HealthSync siano attive e impostate su "Esegui immediatamente".</div>` : ""}
    </div>`;

    // Data per metric
    const metricName = { hrv: "HRV", fcr: "FC a riposo", fc: "Frequenza cardiaca", fc_camminata: "FC camminata", resp: "Respirazione", spo2: "Ossigeno (SpO₂)", vo2max: "VO₂max", peso: "Peso", grasso_pct: "% grasso", massa_magra: "Massa magra", bmi: "BMI", passi: "Passi", kcal_attive: "Calorie attive", kcal_riposo: "Calorie a riposo", dist_piedi: "Distanza a piedi", piani: "Piani", dist_bici: "Distanza bici", dist_nuoto: "Distanza nuoto", bracciate: "Bracciate", kcal_cibo: "Calorie cibo", proteine: "Proteine", carboidrati: "Carboidrati", grassi: "Grassi", acqua: "Acqua" };
    const rows = [...d.metriche.map((m) => ({ ...m, last: m.a })), ...d.giornaliere.map((m) => ({ ...m, last: m.a + "T12:00:00" }))];
    const fresh = (iso) => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 48 ? "ok" : h < 24 * 14 ? "warn" : "off"; };
    html += `<div class="card list"><div class="label" style="margin-bottom:4px">Dati ricevuti</div>
      ${item(d.sonno.n ? fresh(d.sonno.a) : "off", "Sonno (fasi)", d.sonno.n ? `${d.sonno.n} fasi · ultima ${ago(d.sonno.a)}` : "nessun dato")}
      ${rows.map((m) => item(fresh(m.last), metricName[m.metric] || esc(m.metric), `${fmtNum(m.n)} valori · ultimo ${ago(m.last)}`)).join("")}
      ${item("off", "Righe nel database", Object.entries(d.database.righe).map(([k, v]) => `${k} ${fmtNum(v)}`).join(" · "))}
      ${d.database.dimensione_byte ? item("off", "Dimensione database", `${fmtNum(d.database.dimensione_byte / 1048576, 1)} MB su 5.000 MB gratuiti`) : ""}
    </div>`;

    // AI
    const q = d.ia.groq_quota;
    html += `<div class="card list"><div class="label" style="margin-bottom:4px">Intelligenza artificiale</div>
      ${item(c.groqKey ? "ok" : d.ia.chiave_groq_sul_server ? "ok" : "warn", "Chiave Groq", c.groqKey ? "salvata su questo dispositivo" : d.ia.chiave_groq_sul_server ? "configurata sul server" : "assente: uso il modello di riserva")}
      ${item("off", "Modello", esc(c.groqModel || d.ia.modello_predefinito))}
      ${q ? item(Number(q.richieste_rimaste) < 50 ? "warn" : "ok", "Richieste Groq rimaste oggi", `${esc(q.richieste_rimaste ?? "?")} su ${esc(q.richieste_limite ?? "?")}${q.richieste_reset ? ` · si azzera tra ${esc(q.richieste_reset)}` : ""}`) : item("off", "Richieste Groq rimaste", "nessuna chiamata ancora")}
      ${q ? item(Number(q.token_rimasti) < 2000 ? "warn" : "ok", "Token al minuto rimasti", `${esc(q.token_rimasti ?? "?")} su ${esc(q.token_limite ?? "?")}`) : ""}
      ${q ? item("off", "Quota letta", ago(q.letto)) : ""}
      ${item("off", "Chiamate oggi", `Groq ${d.ia.chiamate_oggi_groq} · riserva ${d.ia.chiamate_oggi_riserva}`)}
      ${item(d.ia.riserva_disponibile ? "ok" : "err", "Modello di riserva (Cloudflare)", d.ia.riserva_disponibile ? esc(d.ia.modello_riserva) + " · ~280 risposte/giorno gratis" : "non configurato")}
      <div style="padding-top:10px"><button class="btn ghost block" id="testAi">Prova l'IA adesso</button><div id="aiOut" class="small muted" style="padding-top:8px"></div></div>
    </div>`;
  }

  // Device
  let quota = null; try { quota = await navigator.storage?.estimate?.(); } catch {}
  html += `<div class="card list"><div class="label" style="margin-bottom:4px">Questo dispositivo</div>
    ${item(standalone ? "ok" : "warn", "Installata come app", standalone ? "sì" : "no: aggiungila alla schermata Home")}
    ${item(sw ? "ok" : "off", "Funzionamento offline", sw ? "attivo" : "non attivo")}
    ${item(c.code ? "ok" : "err", "Codice di accesso", c.code ? "salvato" : "mancante")}
    ${item("off", "Indirizzo server", `<span class="code">${esc(c.server)}</span>`)}
    ${item("off", "Fuso orario", esc(tz()))}
    ${quota ? item("off", "Spazio usato dall'app", `${fmtNum((quota.usage || 0) / 1024, 0)} KB`) : ""}
  </div>
  <button class="btn ghost" id="copy">Copia report diagnostico</button>`;
  el.innerHTML = html;

  const t = $("#testAi");
  if (t) t.onclick = async () => {
    const out = $("#aiOut"); out.textContent = "Provo…";
    try { const r = await api("/api/ai/test", { method: "POST" }); out.innerHTML = r.errore ? `<span class="bad">${esc(r.errore)}</span>` : `<span class="good">Funziona</span> · ${r.provider === "groq" ? "Groq" : "riserva"} · ${esc(r.model)} · ${r.latenza_ms} ms`; }
    catch (e) { out.textContent = e.message; }
  };
  $("#copy").onclick = async () => {
    const report = { app: APP_VERSION, server: d?.server, ultima_release: rel?.tag, latenza_ms: lat, errore: err?.message, importazioni: d?.importazioni?.slice(0, 5), dati: d?.database, ia: d ? { ...d.ia } : null, dispositivo: { standalone, sw, tz: tz(), ua: navigator.userAgent, chiave_groq: !!c.groqKey } };
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
  { t: "Come funziona", body: (c) => `
    <div style="line-height:1.55;color:var(--text)">Kairo riceve i dati dall'iPhone in tre pezzi:</div>
    <ol class="steps"><li><b>Il comando HealthSync</b> legge i dati di Salute (che arrivano dal Watch) e li invia al tuo server.</li>
      <li><b>Due automazioni</b> lo fanno partire da solo: quando spegni la sveglia e quando metti in carica l'iPhone.</li>
      <li><b>L'app Kairo</b> (questa) mostra recupero, sonno e coach, su iPhone e PC.</li></ol>
    ${tip("Cosa ti serve", "iPhone con l'app <b>Comandi</b> (è già installata; se l'hai cancellata riscaricala gratis dall'App Store), Apple Watch abbinato, e <b>questa pagina aperta in Safari sull'iPhone</b>. Tempo: circa 10 minuti, una volta sola.")}` },
  { t: "Prepara l'iPhone", body: () => `
    <ol class="steps"><li>Apri l'app <b>Impostazioni</b> dell'iPhone.</li>
      <li>Scorri e tocca <b>App</b> → <b>Comandi</b> (su iOS meno recenti: direttamente <b>Comandi rapidi</b>).</li>
      <li>Tocca <b>Avanzate</b>.</li>
      <li>Attiva <b>Consenti condivisione di grandi quantità di dati</b>.</li></ol>
    ${tip("Perché", "Senza questa opzione iOS blocca l'invio quando i dati superano qualche centinaio di valori, per esempio la frequenza cardiaca di due giorni.")}` },
  { t: "Copia indirizzo e codice", body: (c) => `
    <div style="line-height:1.55;color:var(--text)">Il comando ti chiederà queste due cose quando lo aggiungi. Tienile a portata di mano.</div>
    <div class="card soft col" style="gap:6px"><div class="small muted">1 · Indirizzo del server</div><div class="code">${esc(c.server)}</div>
      <button class="btn ghost" data-copy="${esc(c.server)}">Copia indirizzo</button></div>
    <div class="card soft col" style="gap:6px"><div class="small muted">2 · Codice di accesso</div><div class="code">${c.code ? "•".repeat(Math.min(c.code.length, 16)) : "non salvato su questo dispositivo"}</div>
      ${c.code ? `<button class="btn ghost" id="copyCode">Copia codice</button>` : ""}</div>
    ${tip("Suggerimento", "Copia l'indirizzo ora; il codice lo copi al passo 5, quando il comando lo chiede. Gli appunti tengono una cosa sola alla volta.")}` },
  { t: "Scarica HealthSync", body: () => `
    <a class="btn orange block" href="shortcuts/HealthSync.shortcut" target="_blank" rel="noopener">Scarica HealthSync</a>
    <ol class="steps"><li>Tocca il pulsante qui sopra. Safari chiede <b>«Vuoi scaricare HealthSync.shortcut?»</b>: tocca <b>Scarica</b>.</li>
      <li>Tocca l'icona dei download nella barra di Safari (un cerchio con la freccia ↓) e poi <b>HealthSync.shortcut</b>.</li>
      <li>Si apre l'app <b>Comandi</b> con l'anteprima del comando.</li></ol>
    ${tip("Non si apre?", "Apri l'app <b>File</b> → <b>Download</b> e tocca <b>HealthSync.shortcut</b>. Se compare «Impossibile aprire», aggiorna iOS: i comandi firmati richiedono iOS 15 o successivo.")}` },
  { t: "Aggiungi il comando", body: (c) => `
    <ol class="steps"><li>Nell'anteprima tocca <b>Configura comando</b> (o <b>Aggiungi comando</b>).</li>
      <li><b>Domanda 1, indirizzo del server:</b> cancella il testo di esempio e incolla <span class="code">${esc(c.server)}</span></li>
      <li>Tocca <b>Avanti</b>.</li>
      <li><b>Domanda 2, codice di accesso:</b> torna qui, copia il codice, torna su Comandi e incollalo.</li>
      <li>Tocca <b>Aggiungi comando</b>. HealthSync compare in <b>Comandi</b>.</li></ol>
    ${c.code ? `<button class="btn ghost" id="copyCode">Copia codice</button>` : ""}
    ${tip("Hai sbagliato qualcosa?", "Tieni premuto su HealthSync → <b>Modifica</b>. In cima ci sono due blocchi di testo: il primo è l'indirizzo, il secondo il codice. Correggili e tocca <b>Fine</b>.")}` },
  { t: "Primo avvio e permessi", body: () => `
    <ol class="steps"><li>In Comandi tocca la scheda <b>HealthSync</b> per avviarlo.</li>
      <li>Alla richiesta di accedere a <b>Salute</b>: tocca <b>Consenti</b>. Se compare l'elenco dei dati, tocca <b>Attiva tutto</b> e poi <b>Consenti</b>.</li>
      <li>Alla richiesta di connettersi al tuo server: <b>Consenti sempre</b>.</li>
      <li>Alla richiesta di salvare in iCloud Drive (copia di sicurezza in <i>iCloud Drive/Kairo</i>): <b>Consenti sempre</b>.</li>
      <li>Quando il comando finisce, torna qui e tocca <b>Verifica</b>.</li></ol>
    <button class="btn primary block" id="verify">Verifica che i dati siano arrivati</button><div id="verifyOut" class="small" style="line-height:1.5"></div>
    ${tip("Perché due volte «Consenti»?", "iOS chiede il permesso la prima volta per ogni tipo di azione. Dopo «Consenti sempre» il comando gira da solo, senza domande.")}` },
  { t: "Automazione 1: sveglia", body: () => `
    <ol class="steps"><li>Apri <b>Comandi</b> e tocca la scheda <b>Automazione</b> in basso.</li>
      <li>Tocca <b>+</b> in alto a destra (o <b>Nuova automazione</b>).</li>
      <li>Scegli <b>Sveglia</b> → seleziona <b>Viene fermata</b> → lascia <b>Qualsiasi sveglia</b>.</li>
      <li>In basso scegli <b>Esegui immediatamente</b> e disattiva <b>Notifica durante l'esecuzione</b>.</li>
      <li>Tocca <b>Avanti</b>, scegli <b>HealthSync</b> e poi <b>Fine</b>.</li></ol>
    ${tip("Non usi la sveglia?", "Al punto 3 scegli <b>Ora del giorno</b> → per esempio le 9:00, <b>Ogni giorno</b>. Il resto è uguale.")}` },
  { t: "Automazione 2: caricatore", body: () => `
    <ol class="steps"><li>Sempre in <b>Automazione</b>, tocca <b>+</b>.</li>
      <li>Scegli <b>Caricatore</b> → <b>È collegato</b>.</li>
      <li>Scegli <b>Esegui immediatamente</b> e disattiva la notifica.</li>
      <li>Tocca <b>Avanti</b> → <b>HealthSync</b> → <b>Fine</b>.</li></ol>
    ${tip("Perché le automazioni non sono un file da importare?", "Apple permette di condividere i <b>comandi</b> come file, ma non le <b>automazioni</b>: vanno create a mano sull'iPhone. Sono solo questi due minuti, una volta per sempre.")}` },
  { t: "Importa lo storico", body: () => `
    <div style="line-height:1.55;color:var(--text)">Così Kairo calcola subito le tue medie personali, invece di aspettare 2 settimane. Scegli uno dei due modi (una volta sola).</div>
    <div class="card soft col" style="gap:8px"><div style="font-weight:900">A · Consigliato: esportazione di Salute</div>
      <div class="small" style="line-height:1.5">Prende tutto in un colpo: fino a 2 anni di HRV, FC, sonno, attività, peso.</div>
      <a class="btn primary" href="#/importa">Importa da Salute</a></div>
    <div class="card soft col" style="gap:8px"><div style="font-weight:900">B · Con i comandi Storico</div>
      <div class="small" style="line-height:1.5">Scarica e aggiungi ognuno come al passo 4–5 (stesse due domande), poi avviali una volta in ordine. Ognuno può richiedere un minuto: tieni lo schermo acceso.</div>
      <div class="grid2"><a class="btn ghost" href="shortcuts/HealthSync_Storico_1A.shortcut" target="_blank" rel="noopener">1A · cuore</a><a class="btn ghost" href="shortcuts/HealthSync_Storico_1B.shortcut" target="_blank" rel="noopener">1B · corpo</a><a class="btn ghost" href="shortcuts/HealthSync_Storico_1C.shortcut" target="_blank" rel="noopener">1C · attività</a><a class="btn ghost" href="shortcuts/HealthSync_Storico_2.shortcut" target="_blank" rel="noopener">2 · sonno</a></div>
      <div class="small muted">Dopo averli usati puoi eliminarli da Comandi.</div></div>` },
  { t: "Kairo sulla schermata Home", body: () => `
    <div class="h2" style="font-size:17px">iPhone</div>
    <ol class="steps"><li>In <b>Safari</b>, con Kairo aperto, tocca <b>Condividi</b> (il quadrato con la freccia ↑).</li>
      <li>Scorri e tocca <b>Aggiungi alla schermata Home</b> → <b>Aggiungi</b>.</li>
      <li>Apri Kairo dall'icona. La prima volta ti chiede di nuovo il <b>codice</b>: è normale, l'app installata ha una memoria separata da Safari.</li></ol>
    <div class="h2" style="font-size:17px">PC</div>
    <ol class="steps"><li>Apri lo stesso indirizzo in <b>Chrome</b> o <b>Edge</b> e accedi con il codice.</li>
      <li>Clicca l'icona <b>Installa</b> a destra nella barra degli indirizzi (o menu ⋮ → <b>Installa Kairo</b>).</li></ol>
    ${tip("Funziona anche a PC spento", "Il server è su Cloudflare, sempre acceso: l'iPhone invia i dati e tu li vedi ovunque.")}` },
  { t: "Fatto", body: () => `
    <div class="col center" style="gap:8px">${bean(90, 110)}<div class="h2">Kairo è pronto</div></div>
    <ol class="steps"><li><b>Ogni mattina</b> spegni la sveglia: i dati della notte arrivano da soli.</li>
      <li>Apri Kairo e fai il <b>check-in</b> (10 secondi): il coach ne tiene conto.</li>
      <li><b>Dormi con il Watch</b>: sonno, respirazione e HRV notturna sono il cuore dello score.</li></ol>
    ${tip("Se un giorno i dati non sono aggiornati", "Apri <b>Impostazioni → Diagnostica</b>: ti dice quando è arrivato l'ultimo invio e cosa controllare.")}
    <a class="btn ghost" href="#/diagnostica">Apri la diagnostica</a>
    <a class="btn primary" href="#/oggi">Vai a Oggi</a>` },
];

views.guida = async (el) => {
  const c = cfg();
  let i = Math.max(0, Math.min(GUIDE.length - 1, Number(store.get("guidaStep", 0)) || 0));
  const draw = () => {
    store.set("guidaStep", i);
    const g = GUIDE[i];
    el.innerHTML = `${header("Guida", { back: "impostazioni", gear: false, sub: "Configurazione dalla A alla Z" })}
      <div class="col" style="gap:8px"><div class="row between small"><b>Passo ${i + 1} di ${GUIDE.length}</b><span class="muted">${Math.round((i / (GUIDE.length - 1)) * 100)}%</span></div>
        <div class="track"><div class="bar" style="left:0;width:${(i / (GUIDE.length - 1)) * 100}%;background:var(--orange)"></div></div>
        <div class="chips" style="gap:6px">${GUIDE.map((s, k) => `<button class="chip" data-go="${k}" style="padding:4px 10px;font-size:12px;${k === i ? "background:var(--ink);color:#fff;border-color:var(--ink)" : k < i ? "background:#DDF3E7;border-color:#DDF3E7" : ""}" aria-label="Passo ${k + 1}: ${esc(s.t)}">${k + 1}</button>`).join("")}</div></div>
      <div class="card col" style="gap:14px"><div class="h2">${i + 1} · ${g.t}</div>${g.body(c)}</div>
      <div class="row">${i > 0 ? `<button class="btn ghost" id="prev" style="flex:1">Indietro</button>` : ""}${i < GUIDE.length - 1 ? `<button class="btn primary" id="next" style="flex:2">Avanti</button>` : ""}</div>
      <a class="small center" style="display:block" href="${GITHUB_URL}/blob/main/docs/SETUP.md" target="_blank" rel="noopener">Guida completa su GitHub</a>`;
    el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { i = Number(b.dataset.go); draw(); window.scrollTo(0, 0); }));
    el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copyText(b.dataset.copy, "Indirizzo copiato")));
    const cc = $("#copyCode"); if (cc) cc.onclick = () => copyText(c.code, "Codice copiato");
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
          : `<span class="bad"><b>Non ancora.</b></span> ${last ? `L'ultimo invio è di ${ago(last.received)}.` : "Nessun invio ricevuto."} Controlla che il comando sia finito senza errori e che indirizzo e codice siano giusti (passo 5).`;
      } catch (e) { out.textContent = e.message; }
    };
  };
  draw();
};

/* ---------- import from the Apple Health export ---------- */
views.importa = async (el) => {
  const cutoff = (days) => shiftDay(todayStr(), -days);
  el.innerHTML = `${header("Importa da Salute", { back: "impostazioni", gear: false })}
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
    <div id="result"></div>`;
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
    w.postMessage({ file: f, since: cutoff(days), fcSince: cutoff(14) });
  };
  const NAMES = { hrv: "HRV", fcr: "FC a riposo", fc: "Frequenza cardiaca (14 giorni)", fc_camminata: "FC camminata", resp: "Respirazione", spo2: "Ossigeno", vo2max: "VO₂max", peso: "Peso", grasso_pct: "% grasso", massa_magra: "Massa magra", bmi: "BMI", passi: "Passi (giorni)", kcal_attive: "Calorie attive (giorni)", kcal_riposo: "Calorie a riposo (giorni)", dist_piedi: "Distanza a piedi (giorni)", piani: "Piani (giorni)", dist_bici: "Bici (giorni)", dist_nuoto: "Nuoto (giorni)", bracciate: "Bracciate (giorni)", kcal_cibo: "Calorie cibo (giorni)", proteine: "Proteine (giorni)", carboidrati: "Carboidrati (giorni)", grassi: "Grassi (giorni)", acqua: "Acqua (giorni)" };
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
      <div class="small" style="line-height:1.5;color:var(--text)">Questo server è nuovo. Scegli un codice (almeno 8 caratteri): servirà all'app e al comando HealthSync. Salvalo in un posto sicuro, per esempio nel portachiavi.</div>
      <label class="field">Codice<input class="input" id="c1" type="password" autocomplete="new-password" minlength="8"></label>
      <label class="field">Ripeti il codice<input class="input" id="c2" type="password" autocomplete="new-password"></label>
      <button class="btn primary" id="go">Crea e continua</button><div id="msg" class="small bad"></div></div>`;
  $("#go").onclick = async () => {
    const a = $("#c1").value, b = $("#c2").value;
    if (a.length < 8) return ($("#msg").textContent = "Almeno 8 caratteri.");
    if (a !== b) return ($("#msg").textContent = "I due codici non coincidono.");
    try { await api("/api/setup", { method: "POST", body: { codice: a } }); store.set("code", a); route("configura-ia"); }
    catch (e) { $("#msg").textContent = e.message; }
  };
};

views.accesso = async (el) => {
  el.innerHTML = `<div class="col center" style="gap:12px;padding-top:30px">${ico.sun(80)}<div style="font-size:42px;font-weight:900;letter-spacing:-1px">kairo<span style="color:var(--orange)">.</span></div></div>
    <div class="card col" style="gap:12px"><div class="h2">Accedi</div>
      <label class="field">Indirizzo del server<input class="input" id="srv" value="${esc(cfg().server)}" inputmode="url" autocomplete="off"><span class="hint">Di solito è già giusto: è l'indirizzo di questa pagina.</span></label>
      <label class="field">Codice di accesso<input class="input" id="code" type="password" autocomplete="current-password"></label>
      <button class="btn primary" id="go">Entra</button><div id="msg" class="small bad"></div>
      <a class="small" href="${GITHUB_URL}#readme" target="_blank" rel="noopener">Non hai ancora un server? Leggi come crearlo</a></div>`;
  $("#go").onclick = async () => {
    store.set("server", $("#srv").value.trim().replace(/\/$/, "")); store.set("code", $("#code").value.trim());
    try {
      const info = await api("/api/info");
      if (info.setup_richiesto) return route("benvenuto");
      await api("/api/diagnostica"); route(store.get("groqAsked") ? "oggi" : "configura-ia");
    } catch (e) { $("#msg").textContent = e.status === 401 ? "Codice non valido." : e.message; }
  };
};

views["configura-ia"] = async (el) => {
  store.set("groqAsked", true);
  el.innerHTML = `${header("Il tuo coach IA", { gear: false })}
    <div class="card col" style="gap:12px">
      <div style="line-height:1.5;color:var(--text)">Kairo usa <b>Groq</b>, gratuito e velocissimo (circa 1.000 richieste al giorno). Crea una chiave su <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> e incollala qui. Resta solo su questo dispositivo.</div>
      <label class="field">Chiave API Groq<input class="input" id="gk" type="password" placeholder="gsk_…" autocomplete="off"></label>
      <button class="btn primary" id="save">Salva e prova</button>
      <button class="btn ghost" id="skip">Salta: uso il modello gratuito di Cloudflare</button>
      <div id="out" class="small muted"></div></div>`;
  $("#save").onclick = async () => {
    store.set("groqKey", $("#gk").value.trim()); $("#out").textContent = "Provo la connessione…";
    try { const r = await api("/api/ai/test", { method: "POST" }); if (r.errore) { $("#out").textContent = r.errore; return; } route("guida"); }
    catch (e) { $("#out").textContent = e.message; }
  };
  $("#skip").onclick = () => route("guida");
};

/* ---------- router ---------- */
const PUBLIC = new Set(["benvenuto", "accesso"]);
function route(name) { location.hash = "#/" + name; }
async function router() {
  closeSheet();
  const name = (location.hash.replace(/^#\/?/, "") || "oggi").split("?")[0];
  const el = $("#app");
  document.body.classList.toggle("wide", name === "diagnostica");
  if (!PUBLIC.has(name) && !cfg().code) {
    const info = await api("/api/info").catch(() => null);
    return route(info && info.setup_richiesto ? "benvenuto" : "accesso");
  }
  const view = views[name] || views.oggi;
  renderTabs(TABS.some(([k]) => k === name) ? name : null);
  window.scrollTo(0, 0);
  try { await view(el); } catch (e) { if (e.status !== 401) el.innerHTML = header("Kairo") + errorCard(e); }
}
window.addEventListener("hashchange", router);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
router();
