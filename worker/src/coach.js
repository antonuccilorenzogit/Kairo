// AI coach: builds a numeric summary of the user's data and asks an LLM to explain it.
// Primary provider: Groq (key sent by the device on every request, never stored here).
// Fallback: Cloudflare Workers AI (free daily allowance, no key needed).
import { computeHistory } from "./metrics.js";
import { strengthSummary, muscleFatigue } from "./strength.js";
import { MEMORY_RULES, applyTags } from "./memory.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
// Workers AI models tried in order (catalog changes over time: the first that answers wins)
export const FALLBACK_MODELS = ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-3.2-3b-instruct"];
export const FALLBACK_MODEL = FALLBACK_MODELS[0];

// advice cached before this date was written with an older prompt and is regenerated
const PROMPT_DATE = "2026-10-11T19:45:00Z";
const fmtMin = (m) => (m == null ? "n/d" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);

// One compact line per day: the LLM receives numbers already computed, never raw samples.
export async function buildContext(db, today, days = 14) {
  const hist = await computeHistory(db, today, days);
  const lines = hist.map((d) => {
    const r = d.recupero, s = d.sonno, n = d.notte, a = d.attivita, c = d.checkin;
    const parts = [
      d.giorno,
      `recupero ${r.score ?? "n/d"} (${r.stato})`,
      `HRV ${n.hrv_ms ?? "n/d"}ms`,
      `FC riposo ${n.fcr_bpm ?? "n/d"}`,
      s ? (s.manuale ? `sonno ${fmtMin(s.durata_min)} (dichiarato, senza Watch)` : `sonno ${fmtMin(s.durata_min)} (punteggio ${s.punteggio}, profondo ${s.fasi_min.profondo}m, REM ${s.fasi_min.rem}m)`) : "sonno non registrato",
      `carico ${d.carico?.oggi ?? "n/d"}`,
    ];
    if (d.attivita.sessioni?.length) parts.push(`allenamenti rilevati dal battito: ${d.attivita.sessioni.map((x) => `${x.minuti} min${x.sport ? ` (${x.sport})` : ""} FC media ${x.fc_media}`).join(", ")}`);
    if (c) parts.push(`check-in: energia ${c.energia}/5, indolenzimento ${c.dolori}/5, umore ${c.umore}/5, attività del giorno prima ${c.attivita || "n/d"}${c.rpe ? `, fatica percepita ${c.rpe}/10` : ""}${c.durata_min ? ` per ${c.durata_min} min` : ""}`);
    return "- " + parts.join(" · ");
  });
  const summary = await buildSummary(db, today, hist);
  return { hist, text: lines.join("\n"), summary };
}

const avg = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const r1 = (x, d = 0) => (x == null ? "n/d" : Number(x).toFixed(d));
const daysAgo = (day, n) => new Date(Date.parse(day + "T12:00:00Z") - n * 86400e3).toISOString().slice(0, 10);

// Big picture already digested: trends and long-term values, so the coach can reason instead of listing numbers.
async function buildSummary(db, today, hist) {
  const last7 = hist.slice(-7), prev7 = hist.slice(-14, -7);
  const q = (sql, ...b) => db.prepare(sql).bind(...b).first();
  const [hrv60, fcr60, vo2now, pesoNow, grassoNow, passi30, nuoto30, bici30] = await Promise.all([
    q("SELECT avg(value) v, count(*) n FROM samples WHERE metric='hrv' AND ts >= ?", daysAgo(today, 60)),
    q("SELECT avg(value) v FROM samples WHERE metric='fcr' AND ts >= ?", daysAgo(today, 60)),
    q("SELECT value v, ts FROM samples WHERE metric='vo2max' ORDER BY ts DESC LIMIT 1"),
    q("SELECT value v, ts FROM samples WHERE metric='peso' ORDER BY ts DESC LIMIT 1"),
    q("SELECT value v, ts FROM samples WHERE metric='grasso_pct' ORDER BY ts DESC LIMIT 1"),
    q("SELECT avg(value) v FROM daily WHERE metric='passi' AND day >= ?", daysAgo(today, 30)),
    q("SELECT count(*) n, sum(value) v FROM daily WHERE metric='dist_nuoto' AND day >= ?", daysAgo(today, 30)),
    q("SELECT count(*) n, sum(value) v FROM daily WHERE metric='dist_bici' AND day >= ?", daysAgo(today, 30)),
  ]);
  // value N days before the latest measurement, to describe the trend
  const before = (metric, now, n) => (now ? q(`SELECT value v, ts FROM samples WHERE metric=? AND ts <= ? ORDER BY ts DESC LIMIT 1`, metric, daysAgo(now.ts.slice(0, 10), n)) : null);
  const [vo2old, pesoOld, grassoOld] = await Promise.all([before("vo2max", vo2now, 180), before("peso", pesoNow, 90), before("grasso_pct", grassoNow, 90)]);
  const age = (ts) => { const d = Math.round((Date.parse(today) - Date.parse(ts.slice(0, 10))) / 86400e3); return d <= 1 ? "recente" : `di ${d} giorni fa`; };
  const nights = last7.filter((d) => d.sonno).length;
  const oggi = hist[hist.length - 1];
  const c = oggi.carico || {};
  const STATO = { calibrazione: "in calibrazione (servono 2 settimane di dati)", scarico: "sotto il solito (scarico)", mantenimento: "nella norma (mantenimento)", costruzione: "in crescita sana (costruzione)", attenzione: "alto: attenzione", eccesso: "troppo alto: rischio di sovraccarico" };
  const acts = {};
  hist.slice(-14).forEach((d) => (d.checkin?.attivita || "").split(",").filter(Boolean).forEach((a) => (acts[a] = (acts[a] || 0) + 1)));
  let forza = "";
  try {
    const fs = await strengthSummary(db, today);
    if (fs.esercizi.length) forza = "Forza (massimale stimato, Epley): " + fs.esercizi.slice(0, 4).map((e) => `${e.esercizio} ${r1(e.max_4_settimane ?? e.record, 1)} kg${e.max_4_precedenti ? ` (4 settimane prima ${r1(e.max_4_precedenti, 1)})` : ""}${e.settimane_dal_record >= 4 ? `, nessun record da ${e.settimane_dal_record} settimane` : ""}`).join("; ") + `. Serie per settimana (ultime 8): ${fs.serie_per_settimana.join(", ")}.`;
    const mf = await muscleFatigue(db);
    const st = mf.filter((f) => f.stato !== "fresco"), lo = mf.filter((f) => f.volume === "basso"), hi = mf.filter((f) => f.volume === "alto");
    if (mf.length) forza += ` Fatica per muscolo: ${st.length ? st.map((f) => `${f.muscolo} ${f.stato}`).join(", ") : "tutti freschi"}. Serie negli ultimi 7 giorni (consigliato 10-20 per muscolo): ${mf.map((f) => `${f.muscolo} ${f.serie_7g}`).join(", ")}${lo.length ? `; volume basso per ${lo.map((f) => f.muscolo).join(", ")}` : ""}${hi.length ? `; volume alto per ${hi.map((f) => f.muscolo).join(", ")}` : ""}.`;
  } catch (_) {}
  const lines = [
    forza,
    `Carico di allenamento (TRIMP): media ultimi 7 giorni ${r1(c.acuto)}, media 28 giorni ${r1(c.cronico)}, rapporto ${c.rapporto ?? "n/d"} → ${STATO[c.stato] || "n/d"}. Carico di oggi finora ${c.oggi ?? 0}.`,
    c.consiglio ? `ALLENAMENTO CONSIGLIATO OGGI (calcolato da recupero e carico): ${c.consiglio.titolo} — ${c.consiglio.testo} (carico tra ${c.consiglio.min} e ${c.consiglio.max}).` : "Allenamento consigliato: non ancora disponibile (servono 2 settimane di carico).",
    oggi.allarme ? `ATTENZIONE: ${oggi.allarme.titolo}. ${oggi.allarme.testo}` : "Nessun allarme di sovraccarico o malanno.",
    oggi.sonno_stanotte ? `Fabbisogno di sonno stanotte ${fmtMin(oggi.sonno_stanotte.fabbisogno_min)}${oggi.sonno_stanotte.a_letto ? `, a letto entro le ${oggi.sonno_stanotte.a_letto}` : ""} (debito ultimi 7 giorni ${fmtMin(oggi.sonno_stanotte.debito_7g_min)}).` : "",
    `Recupero medio: ultimi 7 giorni ${r1(avg(last7.map((d) => d.recupero.score)))}, 7 giorni prima ${r1(avg(prev7.map((d) => d.recupero.score)))}.`,
    `HRV media 7 giorni ${r1(avg(last7.map((d) => d.notte.hrv_ms)))} ms contro media personale 60 giorni ${r1(hrv60?.v)} ms (più alta = più recuperato).`,
    `FC a riposo media 7 giorni ${r1(avg(last7.map((d) => d.notte.fcr_bpm)))} contro media 60 giorni ${r1(fcr60?.v)} bpm (più bassa = meglio).`,
    `Sonno: registrato in ${nights} notti su 7${nights ? `, durata media ${fmtMin(Math.round(avg(last7.map((d) => d.sonno?.durata_min))))}` : ""}.`,
    `Passi: media 7 giorni ${r1(avg(last7.map((d) => d.attivita.passi)))}, media 30 giorni ${r1(passi30?.v)}.`,
    vo2now ? `VO2max ${r1(vo2now.v, 1)} (misura ${age(vo2now.ts)})${vo2old ? `; 6 mesi prima era ${r1(vo2old.v, 1)}` : ""}.` : "VO2max non disponibile.",
    pesoNow ? `Peso ${r1(pesoNow.v, 1)} kg (misura ${age(pesoNow.ts)})${pesoOld ? `; 3 mesi prima ${r1(pesoOld.v, 1)} kg` : ""}${grassoNow ? `. Massa grassa ${r1(grassoNow.v, 1)}%${grassoOld ? ` (3 mesi prima ${r1(grassoOld.v, 1)}%)` : ""}` : ""}.` : "Peso non disponibile.",
    `Ultimi 30 giorni registrati dal Watch: nuoto in ${nuoto30?.n || 0} giorni${nuoto30?.n ? ` (${r1(nuoto30.v)} m in totale)` : ""}, bici in ${bici30?.n || 0} giorni${bici30?.n ? ` (${r1(bici30.v, 1)} km in totale)` : ""}.`,
    Object.keys(acts).length ? `Attività dichiarate nei check-in degli ultimi 14 giorni: ${Object.entries(acts).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "Nessun check-in negli ultimi 14 giorni.",
  ];
  return lines.join("\n");
}

const SYSTEM = (profile) => `Sei il coach di Kairo: un allenatore personale esperto di recupero, sonno e allenamento. Parli italiano, dai del tu, con il tono di un coach umano che conosce bene la persona: caldo, diretto, motivante, mai robotico.

COME RAGIONI
- Prima capisci, poi parli: guarda i trend (media 7 giorni contro la media personale), non il singolo giorno. Un giorno storto non è un problema, una settimana sì.
- Quando si parla di allenamento parti dall'ALLENAMENTO CONSIGLIATO calcolato da Kairo e adattalo ai suoi sport; se c'è un'ATTENZIONE mettila al primo posto.
- Collega i dati agli obiettivi della persona. Se non li conosci, proponi tu un obiettivo sensato e chiedi se è quello giusto.
- Usa SOLO i numeri forniti, non inventarne. Se un dato manca (es. sonno non registrato perché non dorme con il Watch), dillo in una frase e spiega perché servirebbe.
- Non sei un medico: niente diagnosi; se qualcosa è preoccupante suggerisci di parlarne con un medico.

COME RISPONDI
- Interpreta, non elencare: spiega cosa significano i dati per lui, in parole semplici. Cita al massimo 2 o 3 numeri, solo quelli che contano.
- Niente elenco di tutte le metriche, niente titoli, niente tabelle. Paragrafi brevi, come un messaggio di un coach.
- Per una valutazione generale segui questo filo: com'è la situazione in una frase → cosa sta andando bene → 1 o 2 cose da migliorare e perché → obiettivo concreto per le prossime 2-4 settimane con 2-3 azioni pratiche → una domanda per conoscerlo meglio (solo se utile).
- Puoi usare **grassetto** per 1-2 concetti chiave e un elenco puntato solo per le azioni pratiche.

COSA SAI DEI DATI
Lo score di recupero (0-100) segue la struttura della Readiness di Oura: HRV (stanotte e media 7 giorni) e FC a riposo confrontate con la media personale dei 60 giorni, sonno della notte, bilancio di sonno a 14 giorni e respirazione notturna. Fasce Whoop: 67+ verde, 34-66 giallo, sotto 34 rosso. Il punteggio del sonno usa le soglie AASM/NSF (7-9 h, efficienza >= 85%). L'HRV di Apple Watch è SDNN: confrontala con la media personale, non con altre persone. Il VO2max è il miglior indicatore della forma aerobica.
${profile ? `\nCHI È LA PERSONA\n${profile}` : ""}`;

function parseQuota(h) {
  const g = (k) => h.get(k);
  return {
    richieste_limite: g("x-ratelimit-limit-requests"), richieste_rimaste: g("x-ratelimit-remaining-requests"),
    richieste_reset: g("x-ratelimit-reset-requests"),
    token_limite: g("x-ratelimit-limit-tokens"), token_rimasti: g("x-ratelimit-remaining-tokens"),
    token_reset: g("x-ratelimit-reset-tokens"), letto: new Date().toISOString(),
  };
}

async function saveSetting(db, key, value) {
  await db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key, typeof value === "string" ? value : JSON.stringify(value)).run();
}

async function countCall(db, provider) {
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO settings(key,value) VALUES(?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`)
    .bind(`ai_calls_${provider}_${day}`).run();
}

async function callGroq(key, model, messages) {
  const body = { model, messages, temperature: 0.6, max_tokens: 1200 };
  if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const quota = parseQuota(res.headers);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Groq HTTP ${res.status}`);
    err.status = res.status; err.quota = quota;
    throw err;
  }
  return { text: data.choices?.[0]?.message?.content?.trim() || "", quota, usage: data.usage };
}

async function callWorkersAI(env, messages) {
  if (!env.AI) throw new Error("Workers AI non configurato");
  let last;
  for (const model of FALLBACK_MODELS) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: 600 });
      const text = (out.response || out.choices?.[0]?.message?.content || "").trim();
      if (text) return { text, model };
    } catch (e) { last = e; }
  }
  throw last || new Error("Nessuna risposta dal modello di riserva");
}

// Groq key and model: this device's (header) → Cloudflare secret → saved on the server for all devices.
export async function groqConfig(env, req) {
  const row = async (k) => (await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(k).first())?.value || "";
  const key = req.headers.get("x-groq-key") || env.GROQ_API_KEY || (await row("groq_key"));
  const model = req.headers.get("x-groq-model") || (await row("groq_model")) || DEFAULT_GROQ_MODEL;
  return { key, model };
}

// Ask the LLM. Tries Groq first (if a key is available), then Workers AI.
export async function ask(env, req, messages) {
  const { key, model } = await groqConfig(env, req);
  let groqError = null;
  if (key) {
    try {
      const r = await callGroq(key, model, messages);
      await saveSetting(env.DB, "ai_quota_groq", r.quota);
      await countCall(env.DB, "groq");
      return { ...r, provider: "groq", model };
    } catch (e) {
      groqError = e.message;
      if (e.quota) await saveSetting(env.DB, "ai_quota_groq", e.quota);
      if (e.status === 401) return { errore: "Chiave Groq non valida", provider: "groq", model };
    }
  }
  try {
    const r = await callWorkersAI(env, messages);
    await countCall(env.DB, "workers_ai");
    return { ...r, provider: "workers_ai", avviso: groqError ? `Groq non disponibile (${groqError}): uso il modello di riserva.` : null };
  } catch (e) {
    return { errore: `Nessun modello IA disponibile. ${groqError || ""} ${e.message}`.trim() };
  }
}

export async function dailyAdvice(env, req, today, force, profile) {
  if (!force) {
    const cached = await env.DB.prepare("SELECT * FROM advice WHERE day = ?").bind(today).first();
    if (cached && cached.created >= PROMPT_DATE) return { testo: cached.text, provider: cached.provider, model: cached.model, cache: true };
  }
  const ctx = await buildContext(env.DB, today, 10);
  const messages = [
    { role: "system", content: SYSTEM(profile) },
    { role: "user", content: `Quadro generale:\n${ctx.summary}\n\nUltimi giorni (l'ultima riga è oggi):\n${ctx.text}\n\nScrivi il messaggio del coach di stamattina: massimo 2 frasi (max 40 parole). Di' com'è messo oggi rispetto al solito (recupero, sonno) e una cosa da curare oggi (sonno, idratazione, intensità). Non descrivere la seduta: l'allenamento di oggi è già proposto a parte. Se c'è un'ATTENZIONE, parti da quella. Al massimo un numero. Niente elenchi, niente titoli.` },
  ];
  const r = await ask(env, req, messages);
  if (r.errore) return r;
  await env.DB.prepare("INSERT INTO advice(day,text,provider,model,created) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text, provider=excluded.provider, model=excluded.model, created=excluded.created")
    .bind(today, r.text, r.provider, r.model, new Date().toISOString()).run();
  return { testo: r.text, provider: r.provider, model: r.model, quota: r.quota, avviso: r.avviso, cache: false };
}

// The chat's data context changes slowly: kept for 30 minutes, so a conversation does not recompute it at every message.
async function chatContext(db, today) {
  const key = "CTX:" + today;
  const c = await db.prepare("SELECT text, created FROM advice WHERE day = ?").bind(key).first();
  if (c && Date.now() - Date.parse(c.created) < 30 * 60e3) try { return JSON.parse(c.text); } catch (_) {}
  const ctx = await buildContext(db, today, 14);
  const v = { summary: ctx.summary, text: ctx.text };
  await db.prepare("INSERT INTO advice(day,text,created) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text, created=excluded.created").bind(key, JSON.stringify(v), new Date().toISOString()).run();
  return v;
}

export async function chat(env, req, today, history, profile) {
  const ctx = await chatContext(env.DB, today);
  const messages = [
    { role: "system", content: SYSTEM(profile) + MEMORY_RULES.replace("{OGGI}", today) + `\n\nQUADRO GENERALE\n${ctx.summary}\n\nULTIMI 14 GIORNI (l'ultima riga è oggi)\n${ctx.text}\n\nLunghezza: risposte brevi (max 90 parole) per domande semplici, fino a 200 parole per valutazioni generali o piani.` },
    ...history.slice(-10).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) })),
  ];
  const r = await ask(env, req, messages);
  if (r.errore) return r;
  const m = await applyTags(env.DB, r.text);
  return { testo: m.testo, ricordati: m.ricordati, dimenticati: m.dimenticati, provider: r.provider, model: r.model, quota: r.quota, avviso: r.avviso };
}

export async function weeklyCoach(env, req, rep, profile) {
  const key = "W:" + rep.a;
  const cached = await env.DB.prepare("SELECT * FROM advice WHERE day = ?").bind(key).first();
  if (cached && cached.created >= PROMPT_DATE) return { testo: cached.text, provider: cached.provider, model: cached.model, cache: true };
  const w = rep.settimana, p = rep.precedente;
  const dati = [
    `Settimana dal ${rep.da} al ${rep.a}. Carico totale ${w.carico} (settimana prima ${p.carico}), giorni di allenamento ${w.giorni_allenamento} (prima ${p.giorni_allenamento}); stato del carico: ${rep.stato_carico}, rapporto acuto:cronico ${rep.rapporto ?? "n/d"}.`,
    `Recupero medio ${w.recupero ?? "n/d"} (prima ${p.recupero ?? "n/d"}). Sonno medio ${w.sonno_min ? fmtMin(w.sonno_min) : "n/d"} su ${w.notti} notti registrate (prima ${p.sonno_min ? fmtMin(p.sonno_min) : "n/d"}).`,
    `HRV media ${w.hrv ?? "n/d"} ms (media personale ${rep.hrv_media_personale ?? "n/d"}); FC a riposo ${w.fcr ?? "n/d"} (media ${rep.fcr_media_personale ?? "n/d"}).`,
    rep.vo2max ? `VO2max ${rep.vo2max.valore}${rep.vo2max.quattro_settimane_fa ? ` (4 settimane fa ${rep.vo2max.quattro_settimane_fa})` : ""}.` : "",
  ].join("\n");
  const r = await ask(env, req, [
    { role: "system", content: SYSTEM(profile) },
    { role: "user", content: `${dati}\n\nScrivi il resoconto della settimana come un coach, in 3 frasi brevi (max 70 parole in tutto): 1) com'è andata, 2) la cosa più importante da migliorare, 3) l'obiettivo concreto per la prossima settimana. Niente elenchi, niente titoli, al massimo 3 numeri.` },
  ]);
  if (r.errore) return r;
  await env.DB.prepare("INSERT INTO advice(day,text,provider,model,created) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text, provider=excluded.provider, model=excluded.model, created=excluded.created")
    .bind(key, r.text, r.provider, r.model, new Date().toISOString()).run();
  return { testo: r.text, provider: r.provider, model: r.model };
}

export async function testAI(env, req) {
  const t0 = Date.now();
  const r = await ask(env, req, [{ role: "user", content: "Rispondi solo con: ok" }]);
  return { ...r, latenza_ms: Date.now() - t0 };
}

export async function groqModels(req, env) {
  const { key } = await groqConfig(env, req);
  if (!key) return { errore: "Nessuna chiave Groq" };
  const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${key}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { errore: (data.error && data.error.message) || `HTTP ${res.status}` };
  return { modelli: (data.data || []).filter((m) => m.active !== false).map((m) => m.id).sort() };
}
