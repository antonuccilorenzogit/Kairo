// Injury mode: instead of the usual workout, every day the coach proposes rest, rehab exercises
// or a short session for the parts of the body that are not injured.
// Safety rules (they set the limit, the AI cannot go beyond it):
// - PEACE & LOVE (Dubois & Esculier, Br J Sports Med 2020): the first 1-3 days protect the area,
//   keep moving what is healthy, avoid prolonged anti-inflammatories/ice unless the doctor says otherwise.
// - Pain-monitoring model (Silbernagel 2007; Thomeé 1997): exercise is fine if pain stays at or below 3/10
//   during the session and is not worse the next morning; pain of 7/10 or more → rest.
import { ask } from "./coach.js";

export const MODALITA = ["riposo", "resto del corpo", "riabilitazione"];
const PAIN_KEY = "infortunio_dolore";
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400e3);

// ---------- daily pain (0-10) ----------
export async function painLog(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(PAIN_KEY).first();
  try { return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
export async function savePain(db, day, value) {
  const v = Number(value);
  if (!Number.isInteger(v) || v < 0 || v > 10) return { errore: "Il dolore va da 0 a 10" };
  const log = await painLog(db);
  log[day] = v;
  const kept = Object.fromEntries(Object.entries(log).sort().slice(-60));
  await db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(PAIN_KEY, JSON.stringify(kept)).run();
  return { ok: true };
}
export async function clearPain(db) { await db.prepare("DELETE FROM settings WHERE key = ?").bind(PAIN_KEY).run(); }

const painTrend = (log, since) => Object.entries(log).filter(([d]) => !since || d >= since).slice(-7);

// One line for every coach prompt: how the pain is going.
export async function injuryText(db, profile) {
  if (!profile.infortunio?.attivo) return "";
  const t = painTrend(await painLog(db), profile.infortunio.dal);
  return t.length ? `\nDolore dichiarato (0-10) negli ultimi giorni: ${t.map(([d, v]) => `${d.slice(5)} ${v}`).join(", ")}.` : "\nNon ha ancora indicato quanto gli fa male.";
}

// ---------- body area from the description ----------
const AREAS = [
  ["inferiore", /gamb|ginocch|cavigl|pied|polpacc|cosc|femor|quadricip|\banca\b|inguin|tallon|achill|tibi|menisc|crociat|adduttor|ischiocrural|flessor|fascite|alluce/i],
  ["superiore", /spall|gomit|pols|man[oi]\b|dit[oa]|bracci|bicipit|tricipit|pettoral|clavicol|cuffia|epicondil|scafoid/i],
  ["schiena", /schien|lombar|dorsal|cervical|collo|ernia|vertebr|costol|sciatic|bacino/i],
];
export function injuryArea(text) {
  const t = String(text || "");
  const hits = AREAS.filter(([, re]) => re.test(t)).map(([a]) => a);
  return hits.length === 1 ? hits[0] : hits.length ? "più zone" : "non chiara";
}

// ---------- rules ----------
// The most that is allowed today: rest in the first days or with strong pain, then the healthy parts, then rehab.
export function allowedMode({ dolore, giorni }) {
  if (dolore != null && dolore >= 7) return { modalita: "riposo", motivo: `Dolore ${dolore}/10: oggi la priorità è far calmare la zona.` };
  if (giorni != null && giorni <= 2) return { modalita: "riposo", motivo: `Sei ${giorni === 0 ? "al primo giorno" : `a ${giorni + 1} giorni`} dall'infortunio: nei primi giorni si protegge la zona.` };
  if (dolore != null && dolore >= 4) return { modalita: "resto del corpo", motivo: `Dolore ${dolore}/10: la zona va ancora lasciata tranquilla, ma il resto del corpo può lavorare.` };
  if (dolore == null) return { modalita: "resto del corpo", motivo: "Dimmi quanto ti fa male oggi: intanto alleniamo solo ciò che non è coinvolto." };
  return { modalita: "riabilitazione", motivo: `Dolore ${dolore}/10: puoi iniziare a muovere la zona, sempre senza superare 3/10.` };
}

const REST_OF_BODY = {
  inferiore: "Parte alta da seduto o a terra, senza caricare la zona: 3 giri di piegamenti (anche sulle ginocchia) 8-12, rematore con elastico o manubrio da seduto 12, alzate laterali 12, dead bug 10 per lato. Recupero 1' tra i giri.",
  superiore: "Gambe e core senza usare le braccia: 3 giri di squat a corpo libero 15, affondi 10 per gamba, ponte glutei 15, polpacci 20, dead bug 10 per lato (braccia ferme). Se non coinvolge la zona, 20' di cyclette facile.",
  schiena: "Niente carichi sulla schiena: camminata 20-30' a passo comodo, poi 3 giri di ponte glutei 12, dead bug 8 per lato e bird dog 8 per lato, lenti e controllati.",
  "più zone": "Solo ciò che non fa male: camminata facile 15-20' se possibile e esercizi di core a terra (dead bug, ponte glutei) senza coinvolgere le zone doloranti.",
  "non chiara": "Allena solo le parti che non fanno male: per esempio camminata facile 20' e 2-3 giri di esercizi a corpo libero lontani dalla zona dolorante (core, ponte glutei, piegamenti).",
};
const ATTENZIONE = "Fermati e senti un medico o un fisioterapista se il dolore è forte o peggiora, se c'è molto gonfiore, formicolio o perdita di forza, o se non riesci a caricare la zona. Questi consigli non sostituiscono il fisioterapista: se ti ha dato esercizi, segui i suoi.";

function ruleBased(mode, area, motivo) {
  const struttura = mode === "riposo" ? [
    { fase: "Proteggi la zona", dettaglio: "Evita i movimenti che fanno male; tienila sollevata quando puoi e comprimila se è gonfia. Nei primi giorni meglio evitare antinfiammatori e ghiaccio prolungato, salvo indicazione del medico." },
    { fase: "Muovi il resto", dettaglio: "Una camminata breve o qualche minuto di mobilità delle articolazioni sane, solo se non fa male. Il movimento leggero aiuta il recupero." },
    { fase: "Recupera bene", dettaglio: "Dormi almeno 8 ore e mangia proteine a ogni pasto: è il momento in cui il corpo ripara i tessuti." },
  ] : mode === "resto del corpo" ? [
    { fase: "Resto del corpo", dettaglio: REST_OF_BODY[area] || REST_OF_BODY["non chiara"] },
    { fase: "Zona infortunata", dettaglio: "Solo movimenti dolci che non fanno male, 2 × 10 lenti, oppure niente se fa male anche così." },
  ] : [
    { fase: "Riabilitazione", dettaglio: "Contrazioni isometriche dei muscoli vicino alla zona (spingi senza muovere) 5 × 30-45\", poi movimenti lenti nel range che non fa male 3 × 12-15. Dolore massimo 3/10 durante." },
    { fase: "Resto del corpo", dettaglio: REST_OF_BODY[area] || REST_OF_BODY["non chiara"] },
    { fase: "Controllo di domani", dettaglio: "Se domattina il dolore è uguale o minore, puoi ripetere o aumentare un poco; se è peggiorato, torna un passo indietro." },
  ];
  const titolo = mode === "riposo" ? "Riposo attivo" : mode === "resto del corpo" ? "Allena il resto del corpo" : "Riabilitazione dolce";
  return { modalita: mode, titolo, durata_min: mode === "riposo" ? 15 : 30, struttura, perche: motivo, attenzione: ATTENZIONE, fonte: "regole" };
}

const jsonFrom = (text) => {
  const a = String(text || "").indexOf("{"), b = String(text || "").lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
};

// ---------- the day's plan ----------
export async function injuryPlan(env, req, { day, today, profile, profileText, force = false }) {
  const inj = profile.infortunio;
  const log = await painLog(env.DB);
  const dolore = log[day] ?? null;
  const giorni = inj.dal ? Math.max(0, daysBetween(inj.dal, day)) : null;
  const area = injuryArea(inj.descrizione);
  const firma = JSON.stringify([inj.descrizione, inj.dal, dolore]);
  const key = "A:" + day;
  if (!force) {
    const c = await env.DB.prepare("SELECT text FROM advice WHERE day = ?").bind(key).first();
    if (c) try { const j = JSON.parse(c.text); if (j.infortunio && j.firma === firma) return { ...j, cache: true }; } catch (_) {}
  }
  const lim = allowedMode({ dolore, giorni });
  const trend = painTrend(log, inj.dal);
  const prompt = `MODALITÀ INFORTUNIO. Oggi è ${day}.
- Infortunio descritto dalla persona: """${clip(inj.descrizione, 1000) || "non descritto"}"""
- Iniziato: ${inj.dal || "data non indicata"}${giorni != null ? ` (${giorni} giorni fa)` : ""}. Zona stimata: ${area}.
- Dolore oggi (0-10): ${dolore ?? "non indicato"}. Andamento: ${trend.length ? trend.map(([d, v]) => `${d.slice(5)}=${v}`).join(", ") : "nessun dato"}.
- Recupero di stanotte: ${today?.recupero?.score ?? "n/d"}; sonno ${today?.sonno?.durata_min ? `${Math.round(today.sonno.durata_min / 6) / 10} h` : "n/d"}.
- Sport abituali: ${(profile.sport || []).join(", ") || "n/d"}.
- LIMITE DI SICUREZZA calcolato da Kairo: al massimo "${lim.modalita}" (${lim.motivo}). Ordine dal più prudente: riposo < resto del corpo < riabilitazione. NON proporre più di questo.

Scegli cosa fare oggi tra: "riposo" (proteggere la zona, muovere solo il resto in modo leggerissimo), "resto del corpo" (mini allenamento per le parti non coinvolte, senza caricare la zona), "riabilitazione" (esercizi dolci e progressivi per la zona, più qualcosa per il resto del corpo).
Regole: dolore massimo 3/10 durante gli esercizi; il giorno dopo il dolore non deve peggiorare; niente sport abituali che coinvolgono la zona; se la persona cita indicazioni del medico o del fisioterapista, seguile; esercizi a corpo libero o con elastico, con serie e ripetizioni o tempi precisi, spiegati in modo semplice; niente diagnosi.
Rispondi SOLO con JSON: {"modalita":"riposo|resto del corpo|riabilitazione","titolo":"max 5 parole","durata_min":20,"struttura":[{"fase":"...","dettaglio":"esercizi concreti con serie, ripetizioni o tempi"}],"perche":"una frase sul perché oggi","attenzione":"quando fermarsi o sentire un medico, specifico per questo infortunio"}`;
  let plan = null;
  const r = await ask(env, req, [{ role: "system", content: `Sei l'allenatore di Kairo, esperto di rientro dagli infortuni sportivi. Rispondi solo con JSON valido.\n${profileText}` }, { role: "user", content: prompt }]);
  const j = r.errore ? null : jsonFrom(r.text);
  if (j && MODALITA.includes(j.modalita)) {
    const struttura = (Array.isArray(j.struttura) ? j.struttura : []).slice(0, 6).map((x) => ({ fase: clip(x?.fase, 40), dettaglio: clip(x?.dettaglio, 400) })).filter((x) => x.fase && x.dettaglio);
    // the AI may be more careful than the rules, never less
    if (struttura.length && MODALITA.indexOf(j.modalita) <= MODALITA.indexOf(lim.modalita)) plan = {
      modalita: j.modalita, titolo: clip(j.titolo, 60) || ruleBased(j.modalita, area, "").titolo,
      durata_min: Math.max(5, Math.min(90, Math.round(Number(j.durata_min)) || 20)), struttura,
      perche: clip(j.perche, 240) || lim.motivo, attenzione: clip(j.attenzione, 300) || ATTENZIONE, fonte: "ia", modello: r.model,
    };
  }
  if (!plan) plan = ruleBased(lim.modalita, area, lim.motivo);
  plan = { infortunio: true, ...plan, dolore, giorni, area, limite: lim.modalita, firma };
  await env.DB.prepare("INSERT INTO advice(day,text,provider,model,created) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text, provider=excluded.provider, model=excluded.model, created=excluded.created")
    .bind(key, JSON.stringify(plan), plan.fonte, plan.modello || null, new Date().toISOString()).run();
  return plan;
}
