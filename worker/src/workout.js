// Daily workout recommendation (which sport, how hard, what session) and gym routines ("schede").
// The AI proposes the session; recovery, training load and alarms set the limits; fixed rules are the fallback.
import { ask } from "./coach.js";
import { muscleFatigue, routineFatigue } from "./strength.js";
import { hrMax, ALTRI_SPORT } from "./profile.js";

// Heart-rate zones as % of max HR (same as the training load): Z1 50-60 … Z5 90-100.
export function hrZones(hrmax) {
  return [1, 2, 3, 4, 5].map((z) => ({ z, min: Math.round(hrmax * (0.4 + z / 10)), max: Math.round(hrmax * (0.5 + z / 10)) }));
}
const zonesText = (zs) => zs.map((x) => `Z${x.z} ${x.min}-${x.max}`).join(" · ");
// "(zona 2)" / "(zona 2-3)" in the fixed sessions → the person's bpm
const withBpm = (txt, zs) => txt.replace(/zona (\d)(?:-(\d))?/g, (_, a, b) => `zona ${a}${b ? "-" + b : ""}: ${zs[a - 1].min}-${zs[(b || a) - 1].max} bpm`);

export const INTENSITA = ["leggero", "medio", "intenso"];
const NOMI = { palestra: "Palestra", nuoto: "Nuoto", bici: "Bici", corsa: "Corsa" };
const addDay = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

// ---------- routines ----------
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
export function cleanSchede(list) {
  if (!Array.isArray(list)) return { errore: "Formato non valido" };
  const out = [];
  for (const [i, s] of list.slice(0, 8).entries()) {
    const nome = clip(s?.nome, 60) || `Scheda ${String.fromCharCode(65 + i)}`;
    const esercizi = [];
    for (const e of Array.isArray(s?.esercizi) ? s.esercizi.slice(0, 20) : []) {
      const n = clip(e?.nome, 80);
      const serie = Math.round(Number(e?.serie)), min = Math.round(Number(e?.min)), max = Math.round(Number(e?.max ?? e?.min));
      if (!n || !(serie >= 1 && serie <= 10) || !(min >= 1 && min <= 50) || !(max >= min && max <= 60)) continue;
      esercizi.push({ nome: n, serie, min, max, note: clip(e?.note, 120) });
    }
    if (esercizi.length) out.push({ id: clip(s?.id, 40) || `s${Date.now().toString(36)}${i}`, nome, ordine: i, esercizi });
  }
  return { schede: out };
}

export async function getSchede(db) {
  const r = await db.prepare("SELECT id, nome, ordine, esercizi FROM schede ORDER BY ordine").all();
  return r.results.map((s) => ({ ...s, esercizi: JSON.parse(s.esercizi) }));
}

export async function saveSchede(db, list) {
  const c = cleanSchede(list);
  if (c.errore) return c;
  const now = new Date().toISOString();
  await db.batch([db.prepare("DELETE FROM schede"), ...c.schede.map((s) => db.prepare("INSERT INTO schede(id,nome,ordine,esercizi,updated) VALUES(?,?,?,?,?)").bind(s.id, s.nome, s.ordine, JSON.stringify(s.esercizi), now))]);
  return c;
}

// Last session of each exercise (to prefill weights and suggest progression).
export async function lastSets(db, names) {
  const out = {};
  for (const n of names.slice(0, 60)) {
    const last = await db.prepare("SELECT start FROM sets WHERE exercise = ? AND (set_type IS NULL OR set_type != 'warmup') ORDER BY start DESC LIMIT 1").bind(n).first();
    if (!last) continue;
    const r = await db.prepare("SELECT weight, reps FROM sets WHERE exercise = ? AND start = ? AND (set_type IS NULL OR set_type != 'warmup') ORDER BY set_index").bind(n, last.start).all();
    // the last 3 sessions: heaviest weight, reps done at that weight, average RPE (to spot a stall)
    const h = await db.prepare(`SELECT start, max(weight) kg, avg(rpe) rpe FROM sets WHERE exercise = ? AND (set_type IS NULL OR set_type != 'warmup') GROUP BY start ORDER BY start DESC LIMIT 3`).bind(n).all();
    const storia = [];
    for (const x of h.results) {
      const reps = await db.prepare("SELECT sum(reps) r FROM sets WHERE exercise = ? AND start = ? AND weight = ?").bind(n, x.start, x.kg).first();
      storia.push({ data: x.start, kg: x.kg, reps: reps?.r ?? null, rpe: x.rpe == null ? null : Math.round(x.rpe * 10) / 10 });
    }
    out[n] = { data: last.start, serie: r.results.map((x) => ({ kg: x.weight, reps: x.reps })), storia };
  }
  return out;
}

// Free text → routines without AI: lines like "Panca piana 4x8-10" (a line without numbers starts a new routine).
export function parseSchedeText(text) {
  const schede = [];
  let cur = null;
  for (const raw of String(text || "").split(/\n/)) {
    const line = raw.replace(/^[-•*\d.)\s]+(?=\D)/, "").trim();
    if (!line) continue;
    const m = line.match(/^(.+?)[\s:–-]+(\d{1,2})\s*[x×*]\s*(\d{1,2})(?:\s*[-–/]\s*(\d{1,2}))?/i);
    if (m) {
      if (!cur) { cur = { nome: `Scheda ${String.fromCharCode(65 + schede.length)}`, esercizi: [] }; schede.push(cur); }
      cur.esercizi.push({ nome: m[1].trim(), serie: Number(m[2]), min: Number(m[3]), max: Number(m[4] || m[3]) });
    } else if (!/\d/.test(line) || /^(scheda|giorno|day|workout|allenamento)/i.test(line)) {
      cur = { nome: line.replace(/:$/, ""), esercizi: [] }; schede.push(cur);
    }
  }
  return cleanSchede(schede.filter((s) => s.esercizi.length));
}

const jsonFrom = (text) => {
  const a = String(text || "").indexOf("{"), b = String(text || "").lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
};

export async function schedeFromText(env, req, text) {
  const t = String(text || "").slice(0, 6000);
  const r = await ask(env, req, [
    { role: "system", content: "Trasformi la descrizione degli allenamenti in palestra di un utente in schede strutturate. Rispondi SOLO con JSON valido, senza testo prima o dopo." },
    { role: "user", content: `Descrizione dell'utente:\n"""${t}"""\n\nRestituisci {"schede":[{"nome":"Scheda A – Petto e tricipiti","esercizi":[{"nome":"Panca piana con bilanciere","serie":4,"min":8,"max":10,"note":""}]}]}.\nRegole: nomi degli esercizi in italiano, standard e brevi; "min" e "max" sono il range di ripetizioni (se l'utente dà un numero solo, min = max); niente tempi di recupero; massimo 6 schede e 15 esercizi per scheda; non inventare esercizi che l'utente non ha scritto. Se il nome della scheda manca, usa "Scheda A", "Scheda B"…` },
  ]);
  const parsed = r.errore ? null : jsonFrom(r.text);
  const ai = parsed ? cleanSchede(parsed.schede) : null;
  if (ai && ai.schede.length) return { ...ai, fonte: "ia" };
  const rules = parseSchedeText(t);
  return rules.schede.length ? { ...rules, fonte: "regole" } : { errore: r.errore || "Non sono riuscito a capire le schede: prova a scrivere un esercizio per riga, tipo «Panca piana 4x8-10»." };
}

// ---------- daily recommendation ----------
// What was done in the last days: check-ins (activity of the day before), gym sets, swim/bike distance from the Watch.
async function recentSports(db, hist) {
  const days = {};
  for (const d of hist) days[d.giorno] = new Set();
  for (let i = 0; i < hist.length; i++) {
    const ck = hist[i + 1]?.checkin;
    if (ck?.attivita) for (const a of ck.attivita.split(",")) if (NOMI[a] || ALTRI_SPORT.includes(a)) days[hist[i].giorno].add(a);
  }
  const from = hist[0].giorno, to = addDay(hist[hist.length - 1].giorno, 1);
  // what you said you did with the day's workout ("Fatto", "Fatto altro")
  const es = await db.prepare("SELECT day, sport FROM esiti WHERE day >= ? AND day < ? AND stato != 'saltato' AND sport IS NOT NULL").bind(from, to).all();
  for (const x of es.results) if (NOMI[x.sport] || ALTRI_SPORT.includes(x.sport)) days[x.day]?.add(x.sport);
  const gym = await db.prepare("SELECT DISTINCT substr(start,1,10) d FROM sets WHERE start >= ? AND start < ?").bind(from, to).all();
  for (const g of gym.results) days[g.d]?.add("palestra");
  const dist = await db.prepare("SELECT metric, day FROM daily WHERE metric IN ('dist_nuoto','dist_bici') AND value > 0 AND day >= ? AND day < ?").bind(from, to).all();
  for (const x of dist.results) days[x.day]?.add(x.metric === "dist_nuoto" ? "nuoto" : "bici");
  return Object.entries(days).map(([giorno, s]) => ({ giorno, sport: [...s] }));
}

const TEMPLATE = {
  nuoto: {
    leggero: { titolo: "Nuoto facile e tecnica", durata_min: 35, struttura: [["Riscaldamento", "300 m stile libero lento, respirazione ogni 3 bracciate"], ["Tecnica", "6 × 50 m andature (2 × gamba con tavoletta, 2 × braccio unico, 2 × stile completo allungato) con 20\" di pausa"], ["Parte centrale", "4 × 100 m a ritmo facile, conversazione possibile"], ["Defaticamento", "200 m dorso o stile a piacere, molto lento"]] },
    medio: { titolo: "Nuoto aerobico", durata_min: 45, struttura: [["Riscaldamento", "400 m misti lenti"], ["Tecnica", "4 × 50 m andature (gambe, braccio unico, 3-5-7 respirazioni) con 20\" di pausa"], ["Parte centrale", "6 × 200 m a ritmo medio e costante (fiato corto ma controllato) con 30\" di pausa"], ["Defaticamento", "200 m facile"]] },
    intenso: { titolo: "Ripetute in vasca", durata_min: 50, struttura: [["Riscaldamento", "400 m progressivi + 4 × 25 m in accelerazione"], ["Tecnica", "4 × 50 m andature a scelta, ben eseguite"], ["Parte centrale", "10 × 100 m veloci (ritmo che riesci a tenere su tutte) con 30\" di pausa"], ["Defaticamento", "300 m molto facile"]] },
  },
  bici: {
    leggero: { titolo: "Uscita di recupero", durata_min: 45, struttura: [["Riscaldamento", "10' agilità a 90-100 pedalate/min, rapporto leggero"], ["Parte centrale", "30' in pianura, intensità bassa: puoi parlare senza fatica (zona 1-2)"], ["Defaticamento", "5' molto facile"]] },
    medio: { titolo: "Fondo medio", durata_min: 75, struttura: [["Riscaldamento", "15' progressivi"], ["Tecnica", "3 × 1' agilità a 110 pedalate/min con 2' facili"], ["Parte centrale", "45' a ritmo medio costante (zona 2-3), respiro regolare"], ["Defaticamento", "10' facile"]] },
    intenso: { titolo: "Intervalli in bici", durata_min: 70, struttura: [["Riscaldamento", "15' progressivi + 3 accelerazioni da 20\""], ["Parte centrale", "5 × 4' forte (zona 4, parli a fatica) con 3' facili, oppure 4 salite da 4-5'"], ["Defaticamento", "15' agilità facile"]] },
  },
  corsa: {
    leggero: { titolo: "Corsa lenta", durata_min: 30, struttura: [["Riscaldamento", "5' camminata veloce"], ["Parte centrale", "20' di corsa lentissima: devi poter parlare (zona 2)"], ["Defaticamento", "5' camminata e mobilità"]] },
    medio: { titolo: "Corsa con andature", durata_min: 45, struttura: [["Riscaldamento", "10' corsa lenta"], ["Tecnica", "Andature: 2 × 30 m skip basso, skip alto, calciata, corsa balzata; poi 4 allunghi da 80 m"], ["Parte centrale", "20' a ritmo medio costante"], ["Defaticamento", "10' lento + stretching"]] },
    intenso: { titolo: "Ripetute di corsa", durata_min: 50, struttura: [["Riscaldamento", "15' lento + andature (skip, calciata) + 3 allunghi"], ["Parte centrale", "6 × 3' forte (zona 4) con 2' di corsa lenta"], ["Defaticamento", "10' lento"]] },
  },
  palestra: {
    leggero: { titolo: "Palestra leggera", durata_min: 45, struttura: [["Come", "Fai la scheda con circa il 60-70% dei carichi abituali, 2 serie per esercizio, lasciando 4 ripetizioni in riserva: oggi conta la tecnica"]] },
    medio: { titolo: "Palestra normale", durata_min: 60, struttura: [["Come", "Scheda completa ai carichi abituali, fermati a 2-3 ripetizioni dal cedimento (RPE 7-8)"]] },
    intenso: { titolo: "Palestra: si spinge", durata_min: 70, struttura: [["Come", "Scheda completa: punta al massimo del range di ripetizioni o aggiungi carico; ultime serie vicino al cedimento (RPE 9)"]] },
  },
};

function ruleBased(ctx) {
  const { sport, intensita } = ctx.scelta;
  const t = TEMPLATE[sport][intensita];
  return { sport, intensita, titolo: t.titolo, durata_min: t.durata_min, struttura: t.struttura.map(([fase, dettaglio]) => ({ fase, dettaglio: withBpm(dettaglio, ctx.zone) })),
    scheda: sport === "palestra" ? ctx.prossimaScheda?.nome || null : null, perche: ctx.perche, fonte: "regole" };
}

// Next routine: rotation order (the one after the last one done), skipping routines whose muscles are still tired
export async function nextScheda(db, schede) {
  const last = await db.prepare("SELECT workout FROM sets WHERE workout IS NOT NULL AND workout != '' ORDER BY start DESC LIMIT 1").first();
  const idx = last ? schede.findIndex((s) => s.nome === last.workout) : -1;
  const fat = await muscleFatigue(db);
  const order = schede.map((_, i) => schede[(idx + 1 + i) % schede.length]);
  const prossimaScheda = order.length ? order.reduce((best, s) => (routineFatigue(s, fat) < routineFatigue(best, fat) - 0.5 ? s : best), order[0]) : null;
  return { prossimaScheda, fat };
}

// Picks sport and intensity from the data; the AI then designs the session within these limits.
function choose(today, recent, sports, exclude) {
  // during the set-up period the score is not reliable yet: medium intensity, by feel
  const setup = today.settaggio && !today.settaggio.pronto;
  const r = setup ? null : today.recupero.score, alarm = setup ? null : today.allarme, lvl = setup ? null : today.carico?.consiglio?.livello;
  let intensita = lvl === "dura" ? "intenso" : lvl === "normale" ? "medio" : lvl ? "leggero" : r == null ? "medio" : r >= 67 ? "intenso" : r >= 34 ? "medio" : "leggero";
  if (alarm) intensita = "leggero";
  // a match or team training yesterday (football, padel…) already loaded the legs: no hard session today
  const ieri = recent[recent.length - 2]?.sport || [];
  if (intensita === "intenso" && ieri.some((s) => ALTRI_SPORT.includes(s))) intensita = "medio";
  let pool = sports.filter((s) => s !== exclude);
  if (!pool.length) pool = sports;
  // with low recovery or an alarm prefer low-impact endurance (swim, bike) over heavy lifting
  if (intensita === "leggero" && pool.some((s) => s !== "palestra")) pool = pool.filter((s) => s !== "palestra");
  const lastDone = (s) => { for (let i = recent.length - 1; i >= 0; i--) if (recent[i].sport.includes(s)) return recent.length - 1 - i; return 99; };
  const yesterday = recent[recent.length - 2]?.sport || [];
  pool.sort((a, b) => (yesterday.includes(a) ? 1 : 0) - (yesterday.includes(b) ? 1 : 0) || lastDone(b) - lastDone(a));
  const sport = pool[0] || "nuoto";
  const perche = alarm ? `${alarm.titolo}: oggi solo qualcosa di leggero.` : setup ? "Kairo è in settaggio: seduta di media intensità, regolati sulle sensazioni." : r == null ? "Recupero non ancora disponibile: seduta di media intensità." :
    `Recupero ${r}${today.carico?.stato && today.carico.stato !== "calibrazione" ? `, carico ${today.carico.stato}` : ""}; ${lastDone(sport) === 99 ? `${NOMI[sport].toLowerCase()} non lo fai da un po'` : `ultima volta ${lastDone(sport) === 1 ? "ieri" : `${lastDone(sport)} giorni fa`}`}.`;
  return { sport, intensita, perche, lastDone: Object.fromEntries(sports.map((s) => [s, lastDone(s)])) };
}

export async function recommendWorkout(env, req, { hist, profile, profileText, schede, force = false, exclude = null }) {
  const today = hist[hist.length - 1];
  const key = "A:" + today.giorno;
  if (!force) {
    const cached = await env.DB.prepare("SELECT text FROM advice WHERE day = ?").bind(key).first();
    if (cached) try { return { ...JSON.parse(cached.text), cache: true }; } catch (_) {}
  }
  const sports = profile.sport && profile.sport.length ? profile.sport : ["palestra", "nuoto", "bici", "corsa"];
  const recent = await recentSports(env.DB, hist);
  const scelta = choose(today, recent, sports, exclude);
  const { prossimaScheda, fat } = await nextScheda(env.DB, schede);
  const stanchi = fat.filter((f) => f.stato !== "fresco").map((f) => `${f.muscolo} ${f.stato}`).join(", ");
  const zone = hrZones(hrMax(profile));
  const ctx = { scelta, perche: scelta.perche, prossimaScheda, zone };

  const c = today.carico || {};
  const giorni = recent.map((d) => `${d.giorno}: ${d.sport.join(", ") || "riposo o nessun dato"}`).join("\n");
  const prompt = `Dati di oggi (${today.giorno}):
- Recupero: ${today.settaggio && !today.settaggio.pronto ? "non ancora affidabile (Kairo è in settaggio): non citarlo" : `${today.recupero.score ?? "n/d"} (${today.recupero.stato})`}.
- Carico: stato ${c.stato || "n/d"}, rapporto 7/28 giorni ${c.rapporto ?? "n/d"}${c.consiglio ? `, fascia consigliata oggi ${c.consiglio.min}-${c.consiglio.max} (${c.consiglio.titolo})` : ""}.
- ${today.allarme ? `ALLARME: ${today.allarme.titolo}.` : "Nessun allarme."}
- Sport che pratica (puoi proporre SOLO questi): ${sports.join(", ")}.${profile.altri_sport?.length ? `\n- Pratica anche ${profile.altri_sport.join(", ")} (partite o allenamenti di squadra: non li proponi tu, ma se li ha fatti ieri o li farà presto tienine conto e non caricare le gambe).` : ""}
- Ultimi giorni:\n${giorni}
- Zone di frequenza cardiaca di questa persona (bpm): ${zonesText(zone)}. Per nuoto, bici e corsa scrivi l'intensità anche in bpm con queste zone.
- Muscoli ancora affaticati dalle ultime sedute: ${stanchi || "nessuno"}${stanchi ? " (non proporre sedute che li caricano di nuovo)" : ""}.
- Schede di palestra: ${schede.length ? schede.map((s) => `${s.nome} (${s.esercizi.map((e) => e.nome).slice(0, 6).join(", ")})`).join("; ") : "nessuna"}${prossimaScheda ? `; la prossima in rotazione è "${prossimaScheda.nome}"` : ""}.
- Proposta calcolata dalle regole: ${scelta.sport}, intensità ${scelta.intensita}.${exclude ? ` L'utente ha chiesto un'alternativa a ${exclude}: non proporre ${exclude}.` : ""}

Proponi l'allenamento di oggi. Puoi cambiare sport rispetto alla proposta delle regole se ha senso (rotazione, obiettivi), ma NON aumentare l'intensità oltre "${scelta.intensita}".
Rispondi SOLO con JSON: {"sport":"nuoto|bici|corsa|palestra","intensita":"leggero|medio|intenso","titolo":"max 5 parole","durata_min":45,"struttura":[{"fase":"Riscaldamento","dettaglio":"..."},{"fase":"Tecnica","dettaglio":"andature o esercizi tecnici specifici"},{"fase":"Parte centrale","dettaglio":"..."},{"fase":"Defaticamento","dettaglio":"..."}],"scheda":"nome della scheda se palestra, altrimenti null","perche":"una frase sul perché di questa scelta"}.
Per nuoto, bici e corsa scrivi una seduta concreta con distanze o tempi, intensità descritta in modo semplice (es. "puoi parlare", "fiato corto") e andature/tecnica. Per la palestra non scrivere esercizi (ha le sue schede): indica quale scheda e come gestire carichi e intensità in 1-2 fasi.`;
  let rec = null;
  const r = await ask(env, req, [{ role: "system", content: `Sei l'allenatore di Kairo. Rispondi solo con JSON valido.\n${profileText}` }, { role: "user", content: prompt }]);
  const j = r.errore ? null : jsonFrom(r.text);
  if (j && sports.includes(j.sport) && INTENSITA.includes(j.intensita) && j.sport !== exclude) {
    const order = INTENSITA.indexOf(scelta.intensita);
    const struttura = (Array.isArray(j.struttura) ? j.struttura : []).slice(0, 8).map((x) => ({ fase: clip(x?.fase, 40), dettaglio: clip(x?.dettaglio, 300) })).filter((x) => x.fase && x.dettaglio);
    if (struttura.length) rec = {
      sport: j.sport, intensita: INTENSITA[Math.min(INTENSITA.indexOf(j.intensita), order)], titolo: clip(j.titolo, 60) || TEMPLATE[j.sport][j.intensita].titolo,
      durata_min: Math.max(10, Math.min(180, Math.round(Number(j.durata_min)) || 45)), struttura,
      scheda: j.sport === "palestra" ? (schede.find((s) => s.nome === j.scheda)?.nome || prossimaScheda?.nome || null) : null,
      perche: clip(j.perche, 240) || scelta.perche, fonte: "ia", modello: r.model,
    };
  }
  if (!rec) rec = ruleBased(ctx);
  if (rec.sport !== "palestra") rec.zone = zone;
  await env.DB.prepare("INSERT INTO advice(day,text,provider,model,created) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET text=excluded.text, provider=excluded.provider, model=excluded.model, created=excluded.created")
    .bind(key, JSON.stringify(rec), rec.fonte, rec.modello || null, new Date().toISOString()).run();
  return rec;
}
