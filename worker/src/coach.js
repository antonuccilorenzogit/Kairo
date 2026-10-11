// AI coach: builds a numeric summary of the user's data and asks an LLM to explain it.
// Primary provider: Groq (key sent by the device on every request, never stored here).
// Fallback: Cloudflare Workers AI (free daily allowance, no key needed).
import { computeHistory } from "./metrics.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
// Workers AI models tried in order (catalog changes over time: the first that answers wins)
export const FALLBACK_MODELS = ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-3.2-3b-instruct"];
export const FALLBACK_MODEL = FALLBACK_MODELS[0];

const fmtMin = (m) => (m == null ? "n/d" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);

// One compact line per day: the LLM receives numbers already computed, never raw samples.
export async function buildContext(db, today, days = 14) {
  const hist = await computeHistory(db, today, days);
  const lines = hist.map((d) => {
    const r = d.recupero, s = d.sonno, n = d.notte, a = d.attivita, c = d.checkin;
    const parts = [
      d.giorno,
      `recupero ${r.score ?? "n/d"} (${r.stato})`,
      `HRV ${n.hrv_ms ?? "n/d"}ms${r.componenti.hrv.baseline ? ` [media ${r.componenti.hrv.baseline}]` : ""}`,
      `FC riposo ${n.fcr_bpm ?? "n/d"}${r.componenti.fc_riposo.baseline ? ` [media ${r.componenti.fc_riposo.baseline}]` : ""}`,
      s ? `sonno ${fmtMin(s.durata_min)} punteggio ${s.punteggio} (${s.inizio.slice(11, 16)}-${s.fine.slice(11, 16)}, profondo ${s.fasi_min.profondo}m, REM ${s.fasi_min.rem}m)` : "sonno n/d",
      `passi ${a.passi ?? "n/d"}`, `kcal attive ${a.kcal_attive ?? "n/d"}`,
    ];
    if (c) parts.push(`check-in: energia ${c.energia}/5, dolori ${c.dolori}/5, umore ${c.umore}/5, attività ieri ${c.attivita || "n/d"}${c.rpe ? `, RPE ${c.rpe}` : ""}`);
    return "- " + parts.join(" · ");
  });
  return { hist, text: lines.join("\n") };
}

const SYSTEM = (profile) => `Sei il coach di Kairo, un'app personale di recupero e allenamento.
Parli italiano, in modo diretto, amichevole e concreto. Non sei un medico: non fai diagnosi.
Regole: usa SOLO i numeri forniti, non inventarne. Se un dato manca dillo. Risposte brevi.
Lo score di recupero (0-100) confronta HRV notturna, FC a riposo, sonno e respirazione con la media personale degli ultimi 60 giorni.
L'HRV di Apple Watch è SDNN: confrontala solo con la media personale.
${profile ? `Profilo dell'utente: ${profile}` : ""}`;

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
  const body = { model, messages, temperature: 0.4, max_tokens: 900 };
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

// Ask the LLM. Tries Groq first (if a key is available), then Workers AI.
export async function ask(env, req, messages) {
  const key = req.headers.get("x-groq-key") || env.GROQ_API_KEY || "";
  const model = req.headers.get("x-groq-model") || DEFAULT_GROQ_MODEL;
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
    if (cached) return { testo: cached.text, provider: cached.provider, model: cached.model, cache: true };
  }
  const ctx = await buildContext(env.DB, today, 10);
  const messages = [
    { role: "system", content: SYSTEM(profile) },
    { role: "user", content: `Dati degli ultimi giorni (l'ultima riga è oggi):\n${ctx.text}\n\nScrivi il consiglio di oggi in massimo 2 frasi (max 45 parole): com'è il recupero e cosa conviene fare oggi con l'allenamento. Niente elenchi, niente titoli.` },
  ];
  const r = await ask(env, req, messages);
  if (r.errore) return r;
  await env.DB.prepare("INSERT INTO advice(day,text,provider,model,created) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text, provider=excluded.provider, model=excluded.model, created=excluded.created")
    .bind(today, r.text, r.provider, r.model, new Date().toISOString()).run();
  return { testo: r.text, provider: r.provider, model: r.model, quota: r.quota, avviso: r.avviso, cache: false };
}

export async function chat(env, req, today, history, profile) {
  const ctx = await buildContext(env.DB, today, 21);
  const messages = [
    { role: "system", content: SYSTEM(profile) + `\n\nDati degli ultimi 21 giorni (l'ultima riga è oggi):\n${ctx.text}\n\nRispondi in modo conciso (max 120 parole), cita i numeri che usi.` },
    ...history.slice(-10).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) })),
  ];
  const r = await ask(env, req, messages);
  if (r.errore) return r;
  return { testo: r.text, provider: r.provider, model: r.model, quota: r.quota, avviso: r.avviso };
}

export async function testAI(env, req) {
  const t0 = Date.now();
  const r = await ask(env, req, [{ role: "user", content: "Rispondi solo con: ok" }]);
  return { ...r, latenza_ms: Date.now() - t0 };
}

export async function groqModels(req, env) {
  const key = req.headers.get("x-groq-key") || env.GROQ_API_KEY || "";
  if (!key) return { errore: "Nessuna chiave Groq" };
  const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${key}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { errore: (data.error && data.error.message) || `HTTP ${res.status}` };
  return { modelli: (data.data || []).filter((m) => m.active !== false).map((m) => m.id).sort() };
}
