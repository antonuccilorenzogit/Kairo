// Training plan: blocks of 4 weeks (3 that build up, 1 lighter with tests), a fixed weekly calendar and sessions
// whose difficulty grows with what you actually completed. Everything here is rules, no AI: the same data always
// gives the same plan, so the progression is consistent from one day to the next.
//
// Progression per sport and session type: a "level" that goes up by 1 for every session done as planned,
// by 2 when it felt easy, stays when it felt hard (and drops after two hard ones in a row), and drops after a
// break of more than two weeks. Each level adds a little volume or intensity (more repetitions, longer blocks).
// Paces come only from tests (swim CSS, running threshold, cycling threshold heart rate): without a test the
// session is described by feel and heart-rate zones, never with invented paces.
import { hrMax } from "./profile.js";
import { hrZones, getSchede, nextScheda } from "./workout.js";
import { sessionsWithSport } from "./sessions.js";

export const PLAN_SPORTS = ["palestra", "nuoto", "corsa", "bici"];
export const ENDURANCE = ["nuoto", "corsa", "bici"];
export const GOALS = ["generale", "resistenza", "velocita"];
export const LEVELS = { principiante: 0, intermedio: 4, avanzato: 8 };
const NAMES = { palestra: "Palestra", nuoto: "Nuoto", corsa: "Corsa", bici: "Bici" };
const DIST = { nuoto: [200, 10000, 1500], corsa: [1000, 42195, 10000], bici: [10000, 300000, 60000] };
const HARD = { soglia: 3, velocita: 3, test: 3, lungo: 2.5, palestra: 2, facile: 1 };
export const TIPO_NOME = { facile: "Facile", soglia: "Soglia", velocita: "Velocità", lungo: "Lungo", test: "Test", palestra: "Palestra" };

const addDay = (d, n = 1) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay(); // 0 = Sunday
export const mondayOf = (d) => addDay(d, -((dow(d) + 6) % 7));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };
const round50 = (m) => Math.round(m / 50) * 50;
export const fmtPace = (s) => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, "0")}"`;

// ---------- settings ----------
export function cleanPlan(p = {}) {
  const sedute = {};
  for (const s of PLAN_SPORTS) sedute[s] = int(p?.sedute?.[s], 0, 6, 0);
  const giorni = [...new Set((Array.isArray(p?.giorni) ? p.giorni : [1, 2, 3, 4, 5, 6, 0]).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))];
  const obiettivi = {};
  for (const s of ENDURANCE) {
    const o = p?.obiettivi?.[s] || {}, [lo, hi, d] = DIST[s];
    obiettivi[s] = { tipo: GOALS.includes(o.tipo) ? o.tipo : "generale", distanza: int(o.distanza, lo, hi, d), livello: o.livello in LEVELS ? o.livello : "principiante" };
  }
  return {
    attivo: p?.attivo === true,
    inizio: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.inizio || "")) ? mondayOf(p.inizio) : null,
    sedute, giorni: giorni.length ? giorni : [1, 3, 5],
    minuti: { feriale: int(p?.minuti?.feriale, 20, 240, 60), weekend: int(p?.minuti?.weekend, 20, 360, 90) },
    obiettivi, doppie: p?.doppie === true,
  };
}
export async function getPlan(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'piano'").first();
  try { return cleanPlan(r ? JSON.parse(r.value) : {}); } catch { return cleanPlan({}); }
}
export async function savePlan(db, input, today) {
  const p = cleanPlan(input);
  if (p.attivo && !Object.values(p.sedute).some((n) => n > 0)) return { errore: "Scegli almeno una seduta a settimana" };
  const old = await getPlan(db);
  if (p.attivo && !p.inizio) p.inizio = old.inizio || mondayOf(today);
  await db.batch([
    db.prepare("INSERT INTO settings(key,value) VALUES('piano',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(p)),
    // the calendar of this week and the next ones is rebuilt with the new settings (past weeks stay as they were)
    db.prepare("DELETE FROM piano_settimane WHERE settimana >= ?").bind(mondayOf(today)),
  ]);
  return p;
}
export async function restartPlan(db, today) {
  const p = await getPlan(db);
  p.inizio = mondayOf(today); p.attivo = true;
  return savePlan(db, p, today);
}

// ---------- blocks ----------
export function blockOf(plan, week) {
  const w = Math.max(0, Math.round((Date.parse(week) - Date.parse(plan.inizio || week)) / (7 * 864e5)));
  const settimana = (w % 4) + 1;
  return { blocco: Math.floor(w / 4) + 1, settimana, scarico: settimana === 4, indice: w };
}

// Session types of the week for one endurance sport: about 80% easy, 20% hard (polarised training).
export function weekTypes(n, goal, weekIdx) {
  const q = goal === "resistenza" ? "soglia" : goal === "velocita" ? "velocita" : weekIdx % 2 ? "velocita" : "soglia";
  const q2 = q === "soglia" ? "velocita" : "soglia";
  if (n <= 0) return [];
  // one session a week: alternates long and hard (only hard when the goal is speed)
  if (n === 1) return [goal === "velocita" || weekIdx % 2 ? q : "lungo"];
  const base = [q, "lungo", "facile", "facile", q2, "facile"];
  return base.slice(0, n);
}

// ---------- weekly calendar ----------
// Hard sessions as far apart as possible (circular week), long sessions at the weekend, easy ones in between.
export function scheduleWeek(plan, week, refs) {
  const { indice, scarico, blocco, settimana } = blockOf(plan, week);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const days = order.filter((d) => plan.giorni.includes(d));
  const list = [];
  for (const s of ENDURANCE) {
    const types = weekTypes(plan.sedute[s], plan.obiettivi[s].tipo, indice);
    // a test replaces the first hard session: when there is no reference yet, and in the lighter 4th week
    const qi = types.findIndex((t) => t === "soglia" || t === "velocita");
    if ((!refs[s] || scarico) && types.length) types[qi >= 0 ? qi : 0] = "test";
    types.forEach((t) => list.push({ sport: s, tipo: t }));
  }
  for (let i = 0; i < plan.sedute.palestra; i++) list.push({ sport: "palestra", tipo: "palestra" });
  list.forEach((x) => (x.peso = HARD[x.tipo]));
  // more sessions than days: without doubles the easiest ones are left out
  const slots = days.length * (plan.doppie ? 2 : 1);
  list.sort((a, b) => b.peso - a.peso);
  const escluse = list.splice(slots).map((x) => ({ sport: x.sport, tipo: x.tipo }));
  const at = Object.fromEntries(days.map((d) => [d, []]));
  const pos = (d) => order.indexOf(d);
  const dist = (a, b) => { const x = Math.abs(pos(a) - pos(b)); return Math.min(x, 7 - x); };
  const hardDays = () => days.filter((d) => at[d].some((x) => x.peso >= 2));
  const free = (d) => at[d].length < (plan.doppie ? 2 : 1);
  const place = (x, cands) => {
    // never the same sport twice a day; two hard sessions on the same day only if there is no other way
    const ok = cands.filter((d) => free(d) && !at[d].some((y) => y.sport === x.sport));
    let c = ok.filter((d) => !(x.peso >= 2 && at[d].some((y) => y.peso >= 2)));
    if (!c.length) c = ok;
    if (!c.length) return false;
    const score = (d) => {
      const hd = hardDays().filter((h) => h !== d);
      const minHard = hd.length ? Math.min(...hd.map((h) => dist(h, d))) : 7;
      const sameSport = days.filter((e) => e !== d && at[e].some((y) => y.sport === x.sport));
      const minSame = sameSport.length ? Math.min(...sameSport.map((e) => dist(e, d))) : 7;
      // hard: far from the other hard days; easy: on a free day, away from the same sport
      return (x.peso >= 2 ? minHard * 10 : (at[d].length ? -50 : 0) + (at[d].some((y) => y.peso >= 2) ? -5 : 0)) + minSame + (at[d].length ? -20 : 0) - pos(d) * 0.01;
    };
    c.sort((a, b) => score(b) - score(a));
    at[c[0]].push(x);
    return true;
  };
  const weekend = days.filter((d) => d === 6 || d === 0);
  const skip = (x) => escluse.push({ sport: x.sport, tipo: x.tipo });
  for (const x of list.filter((y) => y.tipo === "lungo")) if (!place(x, weekend.length ? weekend : days) && !place(x, days)) skip(x);
  for (const x of list.filter((y) => y.tipo !== "lungo" && y.peso >= 2)) if (!place(x, days)) skip(x);
  for (const x of list.filter((y) => y.peso < 2)) if (!place(x, days)) skip(x);
  const sedute = [];
  for (const d of days) at[d].forEach((x, i) => sedute.push({ id: `${week}-${x.sport}-${pos(d)}${i}`, giorno: addDay(week, pos(d)), sport: x.sport, tipo: x.tipo }));
  sedute.sort((a, b) => a.giorno.localeCompare(b.giorno) || HARD[b.tipo] - HARD[a.tipo]);
  return { settimana: week, blocco, n_settimana: settimana, scarico, sedute, escluse };
}

export async function getWeek(db, plan, week, refs) {
  const r = await db.prepare("SELECT dati FROM piano_settimane WHERE settimana = ?").bind(week).first();
  if (r) try { return JSON.parse(r.dati); } catch (_) {}
  const w = scheduleWeek(plan, week, refs);
  await saveWeek(db, w);
  return w;
}
const saveWeek = (db, w) => db.prepare("INSERT INTO piano_settimane(settimana,dati,created) VALUES(?,?,?) ON CONFLICT(settimana) DO UPDATE SET dati=excluded.dati")
  .bind(w.settimana, JSON.stringify(w), new Date().toISOString()).run();

// ---------- references from tests ----------
export function cleanTest(sport, r = {}) {
  const n = (v) => (v === "" || v == null ? null : Number(v));
  if (sport === "nuoto") {
    const t400 = n(r.t400), t200 = n(r.t200);
    if (!(t400 >= 240 && t400 <= 1500 && t200 >= 100 && t200 <= 700 && t400 > t200 * 1.8)) return { errore: "Tempi non validi: 400 m tra 4' e 25', 200 m tra 1'40\" e 11'40\"" };
    return { t400, t200, css: Math.round((t400 - t200) / 2) };
  }
  if (sport === "corsa") {
    const d = n(r.distanza_m), fc = n(r.fc_media);
    if (!(d >= 3000 && d <= 12000)) return { errore: "Distanza in 30' non valida (tra 3 e 12 km)" };
    if (fc != null && !(fc >= 100 && fc <= 220)) return { errore: "FC media non valida" };
    return { distanza_m: d, fc_media: fc, soglia_skm: Math.round(1800 / (d / 1000)), lthr: fc };
  }
  if (sport === "bici") {
    const fc = n(r.fc_media), km = n(r.km);
    if (!(fc >= 100 && fc <= 220)) return { errore: "FC media degli ultimi 20' non valida" };
    return { fc_media: fc, km: km >= 5 && km <= 30 ? km : null, lthr: fc };
  }
  return { errore: "Sport non valido" };
}
export async function references(db) {
  const r = await db.prepare("SELECT day, sport, dati FROM test_sport ORDER BY day").all();
  const refs = {}, storia = { nuoto: [], corsa: [], bici: [] };
  for (const x of r.results) { try { const v = { giorno: x.day, ...JSON.parse(x.dati) }; refs[x.sport] = v; storia[x.sport]?.push(v); } catch (_) {} }
  return { refs, storia };
}

// heart-rate zones: from the threshold heart rate of the test when there is one (Friel), otherwise from max HR
export function zonesFor(sport, ref, hrmax) {
  if (ref?.lthr && sport !== "nuoto") {
    const p = sport === "bici" ? [0.81, 0.9, 0.94, 1.0, 1.06] : [0.85, 0.9, 0.95, 1.0, 1.06];
    const l = ref.lthr, lo = [0.6, ...p.slice(0, 4)];
    return [1, 2, 3, 4, 5].map((z, i) => ({ z, min: Math.round(l * lo[i]), max: Math.round(l * p[i]) - (i < 4 ? 1 : 0) }));
  }
  return hrZones(hrmax);
}
const zt = (zs, a, b = a) => `zona ${a}${b !== a ? "-" + b : ""}: ${zs[a - 1].min}-${zs[b - 1].max} bpm`;

// ---------- progression level ----------
// Done: an outcome "fatto" for the planned session, or a session of that sport recognised on that day.
export async function history(db, from, to, tz) {
  const [w, e] = await db.batch([
    db.prepare("SELECT dati FROM piano_settimane WHERE settimana >= ? AND settimana <= ? ORDER BY settimana").bind(mondayOf(from), to),
    db.prepare("SELECT day, seduta, stato, sensazione FROM esiti_piano WHERE day >= ? AND day <= ?").bind(from, to),
  ]);
  const esiti = Object.fromEntries(e.results.map((x) => [x.seduta, x]));
  const det = await sessionsWithSport(db, from, to, tz);
  const gym = await db.prepare("SELECT DISTINCT substr(start,1,10) d FROM sets WHERE start >= ? AND start < ?").bind(from, addDay(to)).all();
  const gymDays = new Set(gym.results.map((x) => x.d));
  const out = [];
  for (const row of w.results) {
    let wk; try { wk = JSON.parse(row.dati); } catch (_) { continue; }
    for (const s of wk.sedute) {
      if (s.giorno < from || s.giorno > to) continue;
      const es = esiti[s.id];
      const auto = s.sport === "palestra" ? gymDays.has(s.giorno) : det.some((x) => x.giorno === s.giorno && x.sport === s.sport);
      const fatta = es ? es.stato === "fatto" : auto;
      out.push({ ...s, scarico: wk.scarico, fatta, saltata: es?.stato === "saltato", sensazione: es?.sensazione || null, rilevata: auto });
    }
  }
  return out;
}

export function levelOf(hist, sport, tipo, start = 0) {
  let L = start, lastDay = null, prevHard = false;
  for (const s of hist) {
    if (s.sport !== sport || !s.fatta) continue;
    if (lastDay) { const gap = (Date.parse(s.giorno) - Date.parse(lastDay)) / 864e5; if (gap > 14) L = Math.max(0, L - Math.floor(gap / 7) + 1); }
    lastDay = s.giorno;
    if (s.tipo !== tipo || s.scarico) continue;
    if (s.sensazione === "dura") { if (prevHard) L = Math.max(0, L - 1); prevHard = true; continue; }
    prevHard = false;
    L += s.sensazione === "facile" ? 2 : 1;
  }
  return L;
}

// ---------- sessions ----------
const DRILLS = [["braccio singolo", "6 battute di gambe + 1 bracciata"], ["pugni chiusi", "recupero a gomito alto"], ["gambe sul fianco", "catch-up"], ["3-5-7 respirazioni", "scivolata lunga"]];

function swim(tipo, L, goal, ref, maxMin, scarico) {
  const css = ref?.css;
  const p = (off, feel) => (css ? `${fmtPace(css + off)}/100 m` : feel);
  const per100 = css ? css + 25 : 150; // seconds per 100 m including the pauses, to estimate the duration
  const k = scarico ? 0.6 : 1;
  const fit = (fixed, rep, n, min) => { while (n > min && ((fixed + rep * n) / 100) * per100 / 60 > maxMin) n--; return n; };
  if (tipo === "test") return { titolo: "Test in vasca: 400 + 200", obiettivo: "Misura il tuo ritmo di soglia (CSS): da qui escono i ritmi delle prossime sedute.",
    struttura: [["Riscaldamento", "400 m facili + 4 × 50 m progressivi"], ["Test 1", "400 m al massimo che riesci a tenere costante: segna il tempo"], ["Recupero", "5' facili"], ["Test 2", "200 m al massimo: segna il tempo"], ["Defaticamento", "200 m facili"]], volume: 1400 };
  if (tipo === "facile") {
    const n = fit(1000, 200, Math.max(2, Math.ceil(clamp(2 + Math.floor(L / 2), 2, 8) * k)), 1), dr = DRILLS[L % DRILLS.length];
    return { titolo: "Tecnica e fondo", obiettivo: "Efficienza in acqua: la tecnica fa risparmiare più energia di qualsiasi allenamento.",
      struttura: [["Riscaldamento", "300 m misti facili"], ["Tecnica", `6 × 50 m alternando ${dr[0]} e ${dr[1]}, 20" di pausa`], ["Parte centrale", `${n} × 200 m a ${p(15, "ritmo comodo, respiri ogni 3 bracciate")}, 20" di pausa`], ["Defaticamento", "200 m dorso o rana facili"]], volume: 1000 + 200 * n };
  }
  if (tipo === "soglia") {
    if (L <= 10) { const n = fit(800, 100, Math.max(4, Math.ceil(clamp(6 + L, 6, 16) * k)), 4);
      return { titolo: `${n} × 100 a ritmo soglia`, obiettivo: "Alza il ritmo che riesci a tenere a lungo.", struttura: [["Riscaldamento", "400 m facili + 4 × 50 m progressivi"], ["Parte centrale", `${n} × 100 m a ${p(0, "ritmo sostenuto ma uguale su tutte (fatica 7/10)")}, 15" di pausa`], ["Defaticamento", "200 m facili"]], volume: 800 + 100 * n }; }
    const m = fit(600, 200, Math.max(3, Math.ceil(clamp(4 + Math.floor((L - 10) / 2), 4, 10) * k)), 3);
    return { titolo: `${m} × 200 a ritmo soglia`, obiettivo: "Resistenza al ritmo di gara.", struttura: [["Riscaldamento", "400 m facili + 4 × 50 m progressivi"], ["Parte centrale", `${m} × 200 m a ${p(2, "ritmo sostenuto e costante (fatica 7/10)")}, 20" di pausa`], ["Defaticamento", "200 m facili"]], volume: 600 + 200 * m };
  }
  if (tipo === "velocita") {
    const n = fit(900, 50, Math.max(6, Math.ceil(clamp(8 + L, 8, 20) * k)), 6);
    return { titolo: `${n} × 50 veloci`, obiettivo: "Velocità e potenza di bracciata.", struttura: [["Riscaldamento", "400 m facili + 4 × 50 m progressivi"], ["Parte centrale", `${n} × 50 m a ${p(-4, "forte ma con la bracciata pulita (fatica 8/10)")}, 30" di pausa`], ["Sprint", "4 × 25 m al massimo, 45\" di pausa"], ["Defaticamento", "200 m facili"]], volume: 900 + 50 * n };
  }
  // long: continuous swim towards the target distance
  const cap = goal.tipo === "resistenza" ? Math.max(1000, goal.distanza * 1.2) : 1500;
  let c = clamp(round50((500 + 100 * L) * (scarico ? 0.7 : 1)), 400, cap);
  while (c > 400 && ((c + 400) / 100) * (css ? css + 10 : 140) / 60 > maxMin) c -= 50;
  return { titolo: `${c} m continui`, obiettivo: goal.tipo === "resistenza" ? `Verso i tuoi ${goal.distanza} m senza fermarti.` : "Resistenza aerobica.",
    struttura: [["Riscaldamento", "200 m facili"], ["Parte centrale", `${c} m senza fermarti a ${p(8, "un ritmo che potresti tenere ancora a lungo")}`], ["Defaticamento", "200 m facili"]], volume: c + 400 };
}

function run(tipo, L, goal, ref, zs, maxMin, scarico) {
  const sp = ref?.soglia_skm;
  const p = (off) => (sp ? ` (circa ${fmtPace(sp + off)}/km)` : "");
  const k = scarico ? 0.65 : 1;
  if (tipo === "test") return { titolo: "Test dei 30 minuti", obiettivo: "Misura il tuo ritmo di soglia: da qui escono ritmi e zone delle prossime sedute.",
    struttura: [["Riscaldamento", "15' facili + 3 allunghi da 20\""], ["Test", "30' al massimo che riesci a tenere costante: alla fine segna la distanza e la FC media"], ["Defaticamento", "10' facili"]], volume: 55 };
  if (tipo === "facile") {
    const m = Math.min(maxMin, Math.round(clamp(25 + 3 * L, 25, 60) * k));
    return { titolo: `Corsa facile ${m}'`, obiettivo: "Base aerobica: il cuore diventa più efficiente senza stancarti.",
      struttura: [["Corsa", `${m}' facili, ${zt(zs, 2)}${p(80)}: devi riuscire a parlare`], ...(L >= 3 && !scarico ? [["Allunghi", "4 × 20\" in progressione con 1' camminando"]] : [])], volume: m };
  }
  if (tipo === "soglia") {
    let T = Math.round(clamp(12 + 2 * L, 12, 40) * k); while (T > 12 && T + 27 > maxMin) T -= 2;
    const r = T <= 18 ? 3 : T <= 30 ? 3 : 4, each = Math.round(T / r);
    return { titolo: `${r} × ${each}' a soglia`, obiettivo: "Alza il ritmo che riesci a tenere a lungo.",
      struttura: [["Riscaldamento", "15' facili + 3 allunghi"], ["Parte centrale", `${r} × ${each}' ${zt(zs, 4)}${p(0)}, 2' di corsa lenta tra una e l'altra`], ["Defaticamento", "10' facili"]], volume: 25 + r * each + (r - 1) * 2 };
  }
  if (tipo === "velocita") {
    let n = Math.max(3, Math.ceil(clamp(4 + Math.floor(L / 2), 4, 8) * k)); while (n > 3 && 25 + n * 5 > maxMin) n--;
    return { titolo: `${n} × 3' veloci`, obiettivo: "Potenza aerobica (VO2max): ti fa andare più forte su tutte le distanze.",
      struttura: [["Riscaldamento", "15' facili + 3 allunghi"], ["Parte centrale", `${n} × 3' ${zt(zs, 5)}${p(-15)}, 2' di corsa lenta`], ["Defaticamento", "10' facili"]], volume: 25 + n * 5 };
  }
  const easy = sp ? (sp + 75) / 60 : 7; // minutes per km at easy pace
  const cap = goal.tipo === "resistenza" ? clamp((goal.distanza / 1000) * easy, 60, 150) : 90;
  const m = Math.min(maxMin, Math.round(clamp(45 + 5 * L, 45, cap) * (scarico ? 0.7 : 1)));
  return { titolo: `Lungo ${m}'`, obiettivo: goal.tipo === "resistenza" ? `Verso i tuoi ${goal.distanza / 1000} km.` : "Resistenza aerobica.",
    struttura: [["Corsa", `${m}' a ritmo facile e costante, ${zt(zs, 2)}${p(70)}`], ...(goal.tipo === "resistenza" && L >= 6 && !scarico ? [["Finale", `ultimi 10' un po' più svelti, ${zt(zs, 3)}`]] : [])], volume: m };
}

function bike(tipo, L, goal, ref, zs, maxMin, scarico) {
  const k = scarico ? 0.65 : 1;
  if (tipo === "test") return { titolo: "Test dei 30 minuti", obiettivo: "Misura la tua frequenza di soglia: da qui escono le zone delle prossime sedute.",
    struttura: [["Riscaldamento", "15' progressivi"], ["Test", "30' al massimo che riesci a tenere costante su strada piatta o rulli: segna la FC media degli ultimi 20' e i km"], ["Defaticamento", "10' facili"]], volume: 55 };
  if (tipo === "facile") {
    const m = Math.min(maxMin, Math.round(clamp(45 + 5 * L, 45, 120) * k));
    return { titolo: `Fondo ${m}'`, obiettivo: "Base aerobica.", struttura: [["Bici", `${m}' ${zt(zs, 2)}, agilità 85-95 pedalate al minuto`]], volume: m };
  }
  if (tipo === "soglia") {
    let T = Math.round(clamp(16 + 4 * L, 16, 60) * k); while (T > 16 && T + 35 > maxMin) T -= 4;
    const r = T <= 24 ? 2 : 3, each = Math.round(T / r);
    return { titolo: `${r} × ${each}' a soglia`, obiettivo: "Alza la potenza che tieni a lungo.",
      struttura: [["Riscaldamento", "15' progressivi"], ["Parte centrale", `${r} × ${each}' ${zt(zs, 4)}, 5' facili tra un blocco e l'altro`], ["Defaticamento", "10' facili"]], volume: 25 + T + (r - 1) * 5 };
  }
  if (tipo === "velocita") {
    let n = Math.max(3, Math.ceil(clamp(4 + Math.floor(L / 2), 4, 8) * k)); while (n > 3 && 25 + n * 6 > maxMin) n--;
    return { titolo: `${n} × 3' forti`, obiettivo: "Potenza aerobica (VO2max).", struttura: [["Riscaldamento", "15' progressivi"], ["Parte centrale", `${n} × 3' ${zt(zs, 5)}, 3' facili`], ["Defaticamento", "10' facili"]], volume: 25 + n * 6 };
  }
  const cap = goal.tipo === "resistenza" ? clamp((goal.distanza / 1000 / 25) * 60, 120, 300) : 150;
  const m = Math.min(maxMin, Math.round(clamp(75 + 10 * L, 75, cap) * (scarico ? 0.7 : 1)));
  return { titolo: `Lungo ${m}'`, obiettivo: goal.tipo === "resistenza" ? `Verso i tuoi ${goal.distanza / 1000} km.` : "Resistenza aerobica.",
    struttura: [["Bici", `${m}' ${zt(zs, 2)}, ritmo regolare; mangia e bevi ogni 30'`]], volume: m };
}

// Full description of one planned session
export function sessionDetail(s, { plan, hist, refs, hrmax }) {
  const weekend = [0, 6].includes(dow(s.giorno));
  const maxMin = weekend ? plan.minuti.weekend : plan.minuti.feriale;
  if (s.sport === "palestra") return { ...s, titolo: "Palestra", struttura: [], durata_min: null };
  const goal = plan.obiettivi[s.sport], ref = refs[s.sport];
  const tipoLiv = s.tipo === "test" ? "soglia" : s.tipo;
  const L = levelOf(hist.filter((h) => h.giorno < s.giorno), s.sport, tipoLiv, LEVELS[goal.livello]);
  const zs = zonesFor(s.sport, ref, hrmax);
  const d = s.sport === "nuoto" ? swim(s.tipo, L, goal, ref, maxMin, s.scarico) : s.sport === "corsa" ? run(s.tipo, L, goal, ref, zs, maxMin, s.scarico) : bike(s.tipo, L, goal, ref, zs, maxMin, s.scarico);
  const durata = s.sport === "nuoto" ? Math.round((d.volume / 100) * ((ref?.css ? ref.css + 25 : 150) / 60)) : d.volume;
  return { ...s, titolo: d.titolo, obiettivo: d.obiettivo, struttura: d.struttura.map(([fase, dettaglio]) => ({ fase, dettaglio })), livello: L,
    volume: d.volume, unita: s.sport === "nuoto" ? "m" : "min", durata_min: durata, ritmi: ref ? "dal test" : "a sensazione (fai il test per i ritmi)" };
}

// ---------- the plan of today ----------
// Missed key sessions move to the next free day of the week; with a red recovery (or an alarm) today's hard session
// swaps with an easy one later in the week. Each change is saved, so the week does not flip back and forth.
export async function planToday(env, { day, tz, profile, today }) {
  const db = env.DB, plan = await getPlan(db);
  if (!plan.attivo) return null;
  const week = mondayOf(day);
  const { refs } = await references(db);
  const w = await getWeek(db, plan, week, refs);
  const hist = await history(db, addDay(day, -120), day, tz);
  const doneIds = new Set(hist.filter((h) => h.fatta || h.saltata).map((h) => h.id));
  let changed = false;
  const hard = (s) => HARD[s.tipo] >= 2.5;
  // 1. key sessions missed on past days → next day without a hard session
  for (const s of w.sedute) {
    if (s.giorno >= day || doneIds.has(s.id) || !hard(s) || s.spostata_da || s.persa) continue;
    const target = [0, 1, 2, 3, 4, 5, 6].map((i) => addDay(week, i)).filter((g) => g >= day && plan.giorni.includes(dow(g)))
      .find((g) => !w.sedute.some((x) => x.giorno === g && hard(x)) && w.sedute.filter((x) => x.giorno === g).length < 2);
    if (!target) { s.persa = true; changed = true; continue; }
    // an easy session of the same sport on that day makes room
    const easy = w.sedute.findIndex((x) => x.giorno === target && x.sport === s.sport && x.tipo === "facile");
    if (easy >= 0) w.sedute.splice(easy, 1);
    s.spostata_da = s.giorno; s.giorno = target; changed = true;
  }
  // 2. red recovery or alarm (when the score is reliable): today's hard session swaps with a later easy one
  const setup = today?.settaggio && !today.settaggio.pronto;
  const red = !setup && (today?.allarme || (today?.recupero?.score != null && today.recupero.score < 34));
  if (red && w.controllato !== day) {
    w.controllato = day; changed = true;
    for (const s of w.sedute.filter((x) => x.giorno === day && hard(x) && x.sport !== "palestra")) {
      const swap = w.sedute.find((x) => x.giorno > day && x.tipo === "facile");
      if (swap) { const g = swap.giorno; swap.giorno = day; swap.adattata = "scambiata con la seduta dura di oggi"; s.giorno = g; s.adattata = `spostata: oggi recupero ${today.allarme ? "con allarme" : "basso"}`; }
      else { s.tipo_originale = s.tipo; s.tipo = "facile"; s.adattata = `resa facile: oggi recupero ${today.allarme ? "con allarme" : "basso"}`; }
    }
  }
  if (changed) { w.sedute.sort((a, b) => a.giorno.localeCompare(b.giorno)); await saveWeek(db, w); }
  const hrmax = hrMax(profile);
  const ctx = { plan, hist, refs, hrmax };
  const todays = w.sedute.filter((s) => s.giorno === day).map((s) => sessionDetail({ ...s, scarico: w.scarico }, ctx));
  // gym: today's routine from the rotation (muscles still tired are skipped), lighter in the 4th week
  for (const s of todays.filter((x) => x.sport === "palestra")) {
    const schede = await getSchede(db);
    const { prossimaScheda } = await nextScheda(db, schede);
    Object.assign(s, { scheda: prossimaScheda?.nome || null, esercizi: prossimaScheda?.esercizi.length || null, titolo: prossimaScheda ? `Palestra · ${prossimaScheda.nome}` : "Palestra",
      obiettivo: w.scarico ? "Settimana di scarico: il corpo assorbe il lavoro delle ultime 3 settimane." : "Progressione dei carichi: la scheda ti dice quando aumentare.",
      struttura: [
        { fase: "Scheda", dettaglio: prossimaScheda ? prossimaScheda.esercizi.map((e) => `${e.nome} ${e.metodo === "top" ? `1 pesante ${e.min}-${e.max} + ${Math.max(0, e.serie - 1)} back-off${e.drop ? " + drop" : ""}` : `${e.serie}×${e.min}${e.max !== e.min ? "-" + e.max : ""}${e.drop ? " + drop" : ""}`}`).join(" · ") : "Crea le tue schede nella pagina Palestra" },
        { fase: "Carichi", dettaglio: w.scarico ? "Scarico: −10% sui carichi e una serie in meno per esercizio, ripetizioni pulite." : "Kairo ti dà carico e ripetizioni di ogni serie: con pesante + back-off sale guardando la pesante (ripetizioni e com'era), con serie uguali quando chiudi il range su tutte." }] });
  }
  const esiti = (await db.prepare("SELECT seduta, stato, sensazione, risultato FROM esiti_piano WHERE day = ?").bind(day).all()).results;
  // what the Watch recorded today for the same sport (time, distance, pace): shown with the session
  const det = await sessionsWithSport(db, day, day, tz);
  for (const s of todays) {
    const e = esiti.find((x) => x.seduta === s.id);
    if (e) s.esito = { stato: e.stato, sensazione: e.sensazione, risultato: e.risultato ? JSON.parse(e.risultato) : null };
    const r = det.filter((x) => x.sport === s.sport);
    if (r.length) s.registrato = { minuti: r.reduce((a, x) => a + x.minuti, 0), distanza_m: r.reduce((a, x) => a + (x.distanza_m || 0), 0) || null,
      fc_media: Math.round(r.reduce((a, x) => a + x.fc_media * x.minuti, 0) / Math.max(1, r.reduce((a, x) => a + x.minuti, 0))),
      passo_s100: r[0].passo_s100 ?? null, passo_skm: r[0].passo_skm ?? null, velocita_kmh: r[0].velocita_kmh ?? null };
  }
  const next = w.sedute.find((s) => s.giorno > day);
  return { piano: true, blocco: w.blocco, n_settimana: w.n_settimana, scarico: w.scarico, sedute: todays,
    prossima: next ? { giorno: next.giorno, sport: next.sport, tipo: next.tipo } : null, escluse: w.escluse || [] };
}

// ---------- outcome ----------
export async function saveOutcome(db, day, b) {
  const plan = await getPlan(db);
  // the session id starts with its week (a session moved to another day keeps its id)
  const week = /^\d{4}-\d{2}-\d{2}/.test(String(b?.seduta || "")) ? String(b.seduta).slice(0, 10) : mondayOf(day);
  const r = await db.prepare("SELECT dati FROM piano_settimane WHERE settimana = ?").bind(week).first();
  const w = r ? JSON.parse(r.dati) : null;
  const s = w?.sedute.find((x) => x.id === b?.seduta);
  if (!plan.attivo || !s) return { errore: "Seduta non trovata" };
  if (s.giorno > day) return { errore: "Questa seduta è nei prossimi giorni" };
  const stato = ["fatto", "saltato"].includes(b.stato) ? b.stato : null;
  const sensazione = ["facile", "giusta", "dura"].includes(b.sensazione) ? b.sensazione : null;
  if (!stato) return { errore: "Esito non valido" };
  let test = null;
  if (s.tipo === "test" && stato === "fatto" && b.risultato) {
    test = cleanTest(s.sport, b.risultato);
    if (test.errore) return test;
  }
  const now = new Date().toISOString();
  const st = [db.prepare("INSERT INTO esiti_piano(day,seduta,sport,tipo,stato,sensazione,risultato,created) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(day,seduta) DO UPDATE SET stato=excluded.stato, sensazione=excluded.sensazione, risultato=excluded.risultato, created=excluded.created")
    .bind(s.giorno, s.id, s.sport, s.tipo, stato, sensazione, test ? JSON.stringify(test) : null, now)];
  if (test) st.push(db.prepare("INSERT INTO test_sport(day,sport,dati,created) VALUES(?,?,?,?) ON CONFLICT(day,sport) DO UPDATE SET dati=excluded.dati, created=excluded.created").bind(s.giorno, s.sport, JSON.stringify(test), now));
  await db.batch(st);
  return { ok: true, stato, sensazione, test };
}

// ---------- overview (Plan page and coach) ----------
export async function planOverview(env, { day, tz, profile }) {
  const db = env.DB, plan = await getPlan(db);
  const { refs, storia } = await references(db);
  const out = { config: plan, riferimenti: refs, test: storia, pausa: !!profile.infortunio?.attivo };
  if (!plan.attivo) return out;
  const week = mondayOf(day);
  const w = await getWeek(db, plan, week, refs);
  const hist = await history(db, addDay(day, -120), addDay(week, 6), tz);
  const ctx = { plan, hist, refs, hrmax: hrMax(profile) };
  out.settimana = { ...w, sedute: w.sedute.map((s) => {
    const h = hist.find((x) => x.id === s.id) || {};
    const d = sessionDetail({ ...s, scarico: w.scarico }, ctx);
    return { id: s.id, giorno: s.giorno, sport: s.sport, tipo: s.tipo, titolo: d.titolo, durata_min: d.durata_min, fatta: !!h.fatta, saltata: !!h.saltata, sensazione: h.sensazione || null, adattata: s.adattata || (s.spostata_da ? `spostata dal ${s.spostata_da}` : null) };
  }) };
  out.livelli = Object.fromEntries(ENDURANCE.filter((s) => plan.sedute[s] > 0).map((s) => [s, Object.fromEntries(["facile", "soglia", "velocita", "lungo"].map((t) => [t, levelOf(hist, s, t, LEVELS[plan.obiettivi[s].livello])]))]));
  // what the Watch recorded, week by week (last 8 weeks): volume and average pace per sport
  const det = await sessionsWithSport(db, addDay(week, -49), addDay(week, 6), tz);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = addDay(week, -7 * i), we = addDay(ws, 6);
    const x = det.filter((s) => s.giorno >= ws && s.giorno <= we);
    const agg = (sp) => { const a = x.filter((s) => s.sport === sp && s.distanza_m); const m = a.reduce((t, s) => t + s.distanza_m, 0), min = a.reduce((t, s) => t + s.minuti, 0); return a.length ? { sedute: a.length, metri: m, minuti: min } : null; };
    weeks.push({ settimana: ws, nuoto: agg("nuoto"), corsa: agg("corsa"), bici: agg("bici"), palestra: x.filter((s) => s.sport === "palestra").length });
  }
  out.registrato = weeks;
  return out;
}

// Short text for the coach: the plan, today's session, references and how the levels are moving
export function planText(o, todayPlan) {
  if (!o.config.attivo) return "";
  if (o.pausa) return "PIANO DI ALLENAMENTO: in pausa per l'infortunio.";
  const w = o.settimana, lines = [];
  lines.push(`PIANO DI ALLENAMENTO (deciso da Kairo con regole fisse: non cambiarlo, spiegalo e motiva): blocco ${w.blocco}, settimana ${w.n_settimana} di 4${w.scarico ? " (scarico + test)" : ""}.`);
  if (todayPlan?.sedute?.length) lines.push(`Oggi: ${todayPlan.sedute.map((s) => `${NAMES[s.sport]} – ${s.titolo}${s.adattata ? ` (${s.adattata})` : ""}`).join("; ")}.`);
  else lines.push("Oggi: riposo dal piano.");
  lines.push(`Settimana: ${w.sedute.map((s) => `${s.giorno.slice(5)} ${NAMES[s.sport]} ${TIPO_NOME[s.tipo].toLowerCase()}${s.fatta ? " ✓" : s.saltata ? " saltata" : ""}`).join(", ")}.`);
  const r = o.riferimenti;
  const refs = [r.nuoto ? `nuoto CSS ${fmtPace(r.nuoto.css)}/100 m` : null, r.corsa ? `corsa soglia ${fmtPace(r.corsa.soglia_skm)}/km` : null, r.bici ? `bici FC soglia ${r.bici.lthr}` : null].filter(Boolean);
  lines.push(refs.length ? `Riferimenti dai test: ${refs.join(", ")}.` : "Nessun test fatto: i ritmi sono a sensazione finché non fa i test.");
  for (const sp of ENDURANCE) {
    const h = o.test[sp];
    if (h.length >= 2) { const a = h[h.length - 2], b = h[h.length - 1];
      lines.push(sp === "nuoto" ? `Nuoto: CSS da ${fmtPace(a.css)} a ${fmtPace(b.css)}/100 m.` : sp === "corsa" ? `Corsa: soglia da ${fmtPace(a.soglia_skm)} a ${fmtPace(b.soglia_skm)}/km.` : `Bici: FC soglia da ${a.lthr} a ${b.lthr}.`); }
  }
  return lines.join("\n");
}
