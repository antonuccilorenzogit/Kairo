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
// a new injury starts with an empty pain log and an empty log of the exercises done
export async function clearPain(db) { await db.prepare("DELETE FROM settings WHERE key IN (?, ?)").bind(PAIN_KEY, DONE_KEY).run(); }

// ---------- were the day's exercises done? ("fatto", "parte" = only some, "saltato") ----------
const DONE_KEY = "infortunio_esiti";
export const ESITI_INFORTUNIO = { fatto: "fatti", parte: "fatti in parte", saltato: "saltati" };
export async function doneLog(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(DONE_KEY).first();
  try { return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
export async function saveDone(db, day, stato) {
  if (!Object.hasOwn(ESITI_INFORTUNIO, stato)) return { errore: "Esito non valido" };
  const log = await doneLog(db);
  log[day] = stato;
  const kept = Object.fromEntries(Object.entries(log).sort().slice(-60));
  await db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(DONE_KEY, JSON.stringify(kept)).run();
  return { ok: true, stato };
}
const doneTrend = (log, since, before) => Object.entries(log).filter(([d]) => (!since || d >= since) && (!before || d < before)).slice(-7);
const doneText = (t) => t.map(([d, v]) => `${d.slice(5)} ${ESITI_INFORTUNIO[v]}`).join(", ");

const painTrend = (log, since) => Object.entries(log).filter(([d]) => !since || d >= since).slice(-7);

// One line for every coach prompt: how the pain is going.
export async function injuryText(db, profile) {
  if (!profile.infortunio?.attivo) return "";
  const t = painTrend(await painLog(db), profile.infortunio.dal);
  const done = doneTrend(await doneLog(db), profile.infortunio.dal);
  const v = constraintList(constraints(profile.infortunio));
  return (done.length ? `\nEsercizi del giorno (riabilitazione/resto del corpo): ${doneText(done)}.` : "") + (v.length ? `\nVINCOLI ASSOLUTI prescritti dal medico (non proporre MAI nulla che li violi, nemmeno in chat): ${v.join("; ")}.` : "") + (t.length ? `\nDolore dichiarato (0-10) negli ultimi giorni: ${t.map(([d, v]) => `${d.slice(5)} ${v}`).join(", ")}.` : "\nNon ha ancora indicato quanto gli fa male.");
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

// ---------- prescriptions: absolute constraints ----------
// What the doctor or physio prescribed always wins. Values set explicitly in the app are used as they are;
// otherwise they are read from the description ("divieto di carico per 30 giorni", "stampelle", "flessione max 90°").
const NO_LOAD = /(divieto|senza|niente|vietato|non)\s+(di\s+|il\s+)?(carico|caricare|appoggi)|carico\s+(vietato|negato|non consentito|zero|assente)|(non\s+(posso|devo|può)\s+(caricare|appoggiare))|scarico\s+(totale|completo)|non weight/i;
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
function detectDegrees(t) {
  if (!/flession|flett|piega|mobilizz|range|escursion|limit|massim|gradi|°/i.test(t)) return null;
  const nums = [...t.matchAll(/(\d{1,3})\s*(°|gradi)/gi)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 180);
  return nums.length ? Math.max(...nums) : null;
}
export function constraints(inj) {
  const p = inj?.prescrizioni || {};
  const t = `${inj?.descrizione || ""} ${p.altre || ""}`;
  const no_carico = p.no_carico ?? NO_LOAD.test(t);
  let fino = p.fino || "";
  if (!fino && no_carico && inj?.dal) { const m = t.match(/carico[^.\n]{0,80}?(\d{1,3})\s*giorn/i); if (m) fino = addDays(inj.dal, Number(m[1])); }
  return { no_carico, fino, stampelle: p.stampelle ?? /stampell/i.test(t), gradi: p.gradi ?? detectDegrees(t), altre: p.altre || "" };
}
const fmtD = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
// The constraints in plain words (shown on the card and given to the coach).
export function constraintList(c, day) {
  const out = [];
  if (c.no_carico) out.push(`Niente carico sulla parte infortunata${c.fino ? ` (prescritto fino al ${fmtD(c.fino)}${day && c.fino < day ? ": se il medico ti ha dato il via libera, aggiornalo" : ""})` : ""}`);
  if (c.stampelle) out.push("Stampelle: niente esercizi con le braccia mentre cammini");
  if (c.gradi != null) out.push(`Movimento massimo ${c.gradi}°`);
  if (c.altre) out.push(`Altre indicazioni: ${c.altre}`);
  return out;
}

// Words that mean loading the injured limb, per body area (unknown area → all of them).
const LOAD_WORDS = {
  inferiore: /in piedi|cammin|sul posto|squat|affond|corsa|corr[ei]re|\bsalt|gradin|scale\b|sulle punte|polpacc|plank|piegament|push|ponte|step\b|cyclette|\bbici|pedal|corda|equilibrio su|una gamba|in ginocchio|sulle ginocchia/i,
  superiore: /piegament|push|plank|trazion|\bdip|quadrupedi|carponi|bird dog|appoggiat[oi] sulle mani|in appoggio sulle mani|manubri|bilanciere|kettlebell|nuot|bracciat/i,
  schiena: /squat|stacc|bilanciere|sollev[a-z]* (pes|carich)|affond|corsa|\bsalt/i,
};
// Removes negated phrases ("non camminare", "senza appoggiare il piede") before looking for forbidden words.
const stripNegations = (t) => t.replace(/\b(non|niente|senza|evita(re)?|mai|vietat[oa]|no)\b[^.,;:()]{0,50}/gi, " ");
export function violation(plan, c, area) {
  const text = stripNegations([plan.titolo, ...plan.struttura.flatMap((x) => [x.fase, x.dettaglio])].join(" . "));
  if (c.no_carico) {
    const re = LOAD_WORDS[area] || null;
    const hit = re ? text.match(re) : text.match(LOAD_WORDS.inferiore) || text.match(LOAD_WORDS.superiore);
    if (hit) return `«${hit[0]}» con il divieto di carico`;
  }
  if (c.gradi != null) {
    const over = [...text.matchAll(/(\d{1,3})\s*(°|gradi)/gi)].map((m) => Number(m[1])).find((n) => n > c.gradi && n <= 360);
    if (over) return `${over}° oltre il limite di ${c.gradi}°`;
  }
  if (c.stampelle && /stampell[^.]{0,80}(bracci|circol|alz[ai]|ruot)/i.test(text)) return "esercizi di braccia con le stampelle";
  return null;
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
  inferiore: "Parte alta, tutto da seduto (sedia stabile), con la gamba infortunata ferma: 3 giri di spinte in avanti con l'elastico 12, rematore con l'elastico 12, alzate laterali con due bottiglie d'acqua 12, curl con l'elastico 15. Poi da sdraiato a pancia in su: addominali sollevando solo le spalle 3 × 12. Recupero 1' tra i giri.",
  superiore: "Gambe e core senza usare le braccia: 3 giri di squat a corpo libero 15, affondi 10 per gamba, ponte glutei 15, polpacci 20, dead bug 10 per lato (braccia ferme). Se non coinvolge la zona, 20' di cyclette facile.",
  schiena: "Niente carichi sulla schiena: camminata 20-30' a passo comodo, poi 3 giri di ponte glutei 12, dead bug 8 per lato e bird dog 8 per lato, lenti e controllati.",
  "più zone": "Solo ciò che non fa male: camminata facile 15-20' se possibile e esercizi di core a terra (dead bug, ponte glutei) senza coinvolgere le zone doloranti.",
  "non chiara": "Allena solo le parti che non fanno male: per esempio camminata facile 20' e 2-3 giri di esercizi a corpo libero lontani dalla zona dolorante (core, ponte glutei, piegamenti).",
};
// Same idea, never loading the injured limb (used when the doctor forbade weight bearing).
const REST_NO_LOAD = {
  superiore: "Gambe e addominali senza usare il braccio infortunato: 3 giri di squat a corpo libero 15, ponte per i glutei da sdraiato 15, sollevamenti sulle punte 20, addominali da sdraiato con le braccia ferme sul petto 12.",
  schiena: "Solo da sdraiato, senza pesi: 3 giri di ponte per i glutei 10 lento, sollevamento alternato delle gambe piegate 8 per lato, respirazione profonda con la pancia 2'.",
};
const ATTENZIONE = "Fermati e senti un medico o un fisioterapista se il dolore è forte o peggiora, se c'è molto gonfiore, formicolio o perdita di forza, o se non riesci a caricare la zona. Questi consigli non sostituiscono il fisioterapista: se ti ha dato esercizi, segui i suoi.";

export function ruleBased(mode, area, motivo, c = {}) {
  const rest = c.no_carico ? REST_NO_LOAD[area] || REST_OF_BODY.inferiore : REST_OF_BODY[area] || REST_OF_BODY["non chiara"];
  const range = c.gradi != null ? ` (mai oltre ${c.gradi}°)` : "";
  const struttura = mode === "riposo" ? [
    { fase: "Proteggi la zona", dettaglio: "Evita i movimenti che fanno male; tienila sollevata quando puoi e comprimila se è gonfia. Nei primi giorni meglio evitare antinfiammatori e ghiaccio prolungato, salvo indicazione del medico." },
    { fase: "Muovi il resto", dettaglio: c.no_carico ? "Qualche minuto di movimenti lenti da seduto delle parti sane (spalle, braccia, l'altra gamba), solo se non fa male. Il movimento leggero aiuta il recupero." : "Una camminata breve o qualche minuto di mobilità delle articolazioni sane, solo se non fa male. Il movimento leggero aiuta il recupero." },
    { fase: "Recupera bene", dettaglio: "Dormi almeno 8 ore e mangia proteine a ogni pasto: è il momento in cui il corpo ripara i tessuti." },
  ] : mode === "resto del corpo" ? [
    { fase: "Resto del corpo", dettaglio: rest },
    { fase: "Zona infortunata", dettaglio: `Solo movimenti dolci da seduto o sdraiato che non fanno male${range}, 2 × 10 lenti, oppure niente se fa male anche così.` },
  ] : [
    { fase: "Riabilitazione", dettaglio: `Da seduto o sdraiato: contrai i muscoli vicino alla zona senza muoverla 10 × 10", poi movimenti lenti nel range che non fa male${range} 3 × 12. Dolore massimo 3/10 durante. Se il fisioterapista ti ha dato esercizi, fai i suoi.` },
    { fase: "Resto del corpo", dettaglio: rest },
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
  const done = await doneLog(env.DB);
  const esito = done[day] || null;
  const giorni = inj.dal ? Math.max(0, daysBetween(inj.dal, day)) : null;
  const area = injuryArea(inj.descrizione);
  const c = constraints(inj);
  const vincoli = constraintList(c, day);
  const firma = JSON.stringify([inj.descrizione, inj.dal, inj.prescrizioni, dolore]);
  const key = "A:" + day;
  if (!force) {
    const c = await env.DB.prepare("SELECT text FROM advice WHERE day = ?").bind(key).first();
    if (c) try { const j = JSON.parse(c.text); if (j.infortunio && j.firma === firma) return { ...j, esito, cache: true }; } catch (_) {}
  }
  const lim = allowedMode({ dolore, giorni });
  const trend = painTrend(log, inj.dal);
  const prompt = `MODALITÀ INFORTUNIO. Oggi è ${day}.
${vincoli.length ? `VINCOLI ASSOLUTI PRESCRITTI (un piano che li viola viene scartato):\n${vincoli.map((v) => `- ${v}`).join("\n")}${c.no_carico ? "\n  → per la parte infortunata nessun esercizio in piedi, in appoggio, camminando o in ginocchio: solo da seduto o sdraiato." : ""}${c.gradi != null ? `\n  → non scrivere mai angoli oltre ${c.gradi}°.` : ""}\n` : ""}
- Infortunio descritto dalla persona: """${clip(inj.descrizione, 1000) || "non descritto"}"""
- Iniziato: ${inj.dal || "data non indicata"}${giorni != null ? ` (${giorni} giorni fa)` : ""}. Zona stimata: ${area}.
- Dolore oggi (0-10): ${dolore ?? "non indicato"}. Andamento: ${trend.length ? trend.map(([d, v]) => `${d.slice(5)}=${v}`).join(", ") : "nessun dato"}.
- Esercizi dei giorni scorsi: ${doneTrend(done, inj.dal, day).length ? doneText(doneTrend(done, inj.dal, day)) : "nessun dato"}. Se sono stati saltati o fatti solo in parte, non aumentare: riproponi lo stesso livello o uno più semplice; se fatti con dolore stabile o in calo, puoi progredire di poco.
- Recupero di stanotte: ${today?.recupero?.score ?? "n/d"}; sonno ${today?.sonno?.durata_min ? `${Math.round(today.sonno.durata_min / 6) / 10} h` : "n/d"}.
- Sport abituali: ${(profile.sport || []).join(", ") || "n/d"}.
- LIMITE DI SICUREZZA calcolato da Kairo: al massimo "${lim.modalita}" (${lim.motivo}). Ordine dal più prudente: riposo < resto del corpo < riabilitazione. NON proporre più di questo.

Scegli cosa fare oggi tra: "riposo" (proteggere la zona, muovere solo il resto in modo leggerissimo), "resto del corpo" (mini allenamento per le parti non coinvolte, senza caricare la zona), "riabilitazione" (esercizi dolci e progressivi per la zona, più qualcosa per il resto del corpo).
Regole:
- Le indicazioni del medico, del chirurgo o del fisioterapista scritte nella descrizione sono VINCOLI ASSOLUTI, più importanti di tutto il resto. Divieto di carico → nessun esercizio in piedi sull'arto, niente camminate "sul posto" o con appoggio: per quell'arto solo esercizi da sdraiato o seduto. Limite di flessione o di movimento → non superarlo mai e scrivilo nell'esercizio. Dopo un intervento, per la zona operata proponi solo esercizi semplici e prudenti (isometrie, mobilizzazione nel range consentito) e ricorda di seguire il programma del fisioterapista.
- Ogni esercizio deve essere fattibile davvero nella sua situazione: con le stampelle le mani sono occupate, quindi niente esercizi di braccia mentre cammina; gli esercizi per il resto del corpo si fanno seduti o sdraiati se non può stare in piedi su due gambe.
- Niente "riscaldamento" o "defaticamento" di riempimento: solo blocchi che servono davvero.
- Dolore massimo 3/10 durante gli esercizi; il giorno dopo il dolore non deve peggiorare; niente sport abituali che coinvolgono la zona.
- Esercizi a corpo libero o con elastico, con serie e ripetizioni o tempi precisi. Scrivi in italiano semplice, senza nomi inglesi: spiega in poche parole come si fa ogni esercizio (posizione di partenza e movimento).
- Niente diagnosi.
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
  // the prescriptions are checked on the AI's text: a plan that breaks one is discarded
  let scartato = null;
  if (plan) { scartato = violation(plan, c, area); if (scartato) plan = null; }
  if (!plan) plan = ruleBased(lim.modalita, area, lim.motivo, c);
  plan = { infortunio: true, ...plan, dolore, giorni, area, limite: lim.modalita, vincoli, ...(scartato ? { scartato } : {}), firma };
  await env.DB.prepare("INSERT INTO advice(day,text,provider,model,created) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text, provider=excluded.provider, model=excluded.model, created=excluded.created")
    .bind(key, JSON.stringify(plan), plan.fonte, plan.modello || null, new Date().toISOString()).run();
  return { ...plan, esito };
}
