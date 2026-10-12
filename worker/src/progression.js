// Gym load progression. The routines are yours (exercises, sets, rep ranges): Kairo only decides weights and reps
// for the next session from what you actually did. Two methods per exercise:
//
// "classico"  – straight sets: double progression (all sets at the top of the range → more weight; otherwise same
//               weight and more reps), stall after 3 sessions at the same weight → −10% and build back up.
// "top"       – one heavy set (after the warm-up), then back-off sets and an optional drop set. Only the heavy set
//               drives the progression: its reps and how it felt decide the next weight; back-off weights follow it
//               as a percentage that adapts to the reps you did in the back-offs.
//
// How it felt is stored as the RPE of the heavy set: easy 7, right 8.5, at the limit 10.

const LOWER = /squat|stacco|deadlift|leg press|pressa|hip thrust|affond|bulgar|rdl|romanian|rumeno|good morning|lunge/i;
const ISOL = /curl|croci|alzat|estension|french|push ?down|kick ?back|calf|polpacc|face pull|shrug|scrollat|pullover|fly|raise|extension|crunch|addom/i;
// weight increments by kind of exercise: big lower-body lifts move faster, small isolation lifts slower
export const kgStep = (kg, name = "") => (LOWER.test(name) && !/leg curl|leg extension/i.test(name) ? (kg >= 60 ? 5 : 2.5) : ISOL.test(name) ? (kg >= 30 ? 2.5 : 1) : kg >= 20 ? 2.5 : 1);
export const roundTo = (kg, step) => Math.max(step, Math.round(kg / step) * step);
export const FEEL = { facile: 7, giusta: 8.5, limite: 10 };
const feelOf = (rpe) => (rpe == null ? null : rpe <= 7.5 ? "facile" : rpe >= 9.5 ? "limite" : "giusta");
const kgTxt = (kg) => `${String(Math.round(kg * 10) / 10).replace(".", ",")} kg`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// back-off sets: a couple of reps more than the heavy set
export const backoffRange = (ex) => [ex.min + 2, ex.max + 2];
export const DEFAULT_BACKOFF = 12; // % lighter than the heavy set

function warmup(top, name) {
  if (!top || top < 20) return "Riscaldamento: 1–2 serie leggere sullo stesso movimento.";
  const s = kgStep(top, name), w = (p) => roundTo(top * p, s);
  const steps = [[0.5, 8], [0.7, 4], [0.85, 2]].filter(([p]) => w(p) < top).map(([p, r]) => `${kgTxt(w(p))} × ${r}`);
  return `Riscaldamento: ${steps.join(" · ")}, poi la pesante.`;
}

// ---------- heavy set + back-off (+ drop) ----------
export function proposeTop(ex, last, { scarico = false } = {}) {
  const nBack = Math.max(0, ex.serie - 1), drop = !!ex.drop;
  const [bmin, bmax] = backoffRange(ex);
  const sets = (top, back, dropKg, nb = nBack, withDrop = drop) => [
    { tipo: "top", kg: top, min: ex.min, max: ex.max },
    ...Array.from({ length: nb }, () => ({ tipo: "backoff", kg: back, min: bmin, max: bmax })),
    ...(withDrop ? [{ tipo: "dropset", kg: dropKg, min: null, max: null }] : []),
  ];
  const all = last?.serie || [];
  const top = all.find((x) => x.tipo === "top") || [...all].filter((x) => x.kg != null && x.tipo !== "dropset" && x.tipo !== "warmup").sort((a, b) => b.kg - a.kg)[0];
  let ratio = 1 - (ex.backoff || DEFAULT_BACKOFF) / 100;
  if (!top || top.kg == null || top.reps == null) {
    return { metodo: "top", consiglio: `Prima volta: dopo il riscaldamento fai la pesante da ${ex.min}–${ex.max} ripetizioni lasciandone 1–2 in riserva, poi ${nBack ? `${nBack} back-off circa ${ex.backoff || DEFAULT_BACKOFF}% più leggere` : "basta"}. Dalla prossima volta i carichi li calcola Kairo.`,
      riscaldamento: "Riscaldamento: 2–3 serie in salita, sempre meno ripetizioni.", ratio, step: null, serie: sets(null, null, null) };
  }
  // how it felt only from a heavy set logged as such (older sets carry the RPE of the whole session)
  const step = kgStep(top.kg, ex.nome), feel = top.tipo === "top" ? feelOf(top.rpe) : null;
  const lastTxt = `Ultima pesante: ${kgTxt(top.kg)} × ${top.reps}${feel ? ` (${feel === "limite" ? "al limite" : feel})` : ""}`;
  // back-off percentage that follows your back-off reps: all at the top of their range → a bit heavier, below → lighter
  const backs = all.filter((x) => x.tipo === "backoff" && x.kg != null && x.reps != null);
  let backNote = "";
  if (backs.length) {
    ratio = backs.reduce((a, x) => a + x.kg, 0) / backs.length / top.kg;
    if (backs.every((x) => x.reps >= bmax)) { ratio += 0.025; backNote = " Back-off tutte in cima al range: un po' più pesanti."; }
    else if (backs.some((x) => x.reps < bmin)) { ratio -= 0.05; backNote = " Back-off sotto il range: un po' più leggere."; }
  }
  ratio = clamp(ratio, 0.7, 0.95);
  // the heavy set decides the next weight
  let next = top.kg, why;
  const h = last.storia || [];
  if (h.length >= 3 && h.every((x) => x.kg === h[0].kg) && h[0].reps_top != null && h[2].reps_top != null && h[0].reps_top <= h[2].reps_top) {
    next = roundTo(top.kg * 0.9, step); why = `Ferma da 3 sedute a ${kgTxt(top.kg)}: oggi ${kgTxt(next)} con ripetizioni pulite, poi si risale.`;
  } else if (top.reps >= ex.max) {
    const extra = top.reps - ex.max;
    if (feel === "facile" || extra >= 2) { next = top.kg + 2 * step; why = `Molto facile: +${kgTxt(2 * step)}.`; }
    else if (feel === "limite" && extra === 0) { why = `Range chiuso ma al limite: resta a ${kgTxt(top.kg)} finché non ti viene più facile.`; }
    else { next = top.kg + step; why = `Range chiuso: +${kgTxt(step)}.`; }
  } else if (top.reps >= ex.min) {
    why = `Stesso carico, punta a ${top.reps + 1} ripetizioni${top.reps + 1 >= ex.max ? ": poi si sale" : ""}.`;
  } else {
    next = Math.max(step, top.kg - (feel === "limite" && top.reps < ex.min - 1 ? 2 : 1) * step);
    why = `Sotto il range: scendi a ${kgTxt(next)} e torna a ${ex.min}–${ex.max}.`;
  }
  if (scarico) {
    const t = roundTo(next * 0.9, step), b = roundTo(t * ratio, step);
    return { metodo: "top", consiglio: `${lastTxt}. Settimana di scarico: pesante a ${kgTxt(t)} lontano dal cedimento, una back-off in meno, niente drop.`,
      riscaldamento: warmup(t, ex.nome), ratio, step, serie: sets(t, b, null, Math.max(0, nBack - 1), false) };
  }
  const back = roundTo(next * ratio, step), dropKg = roundTo(back * 0.75, step);
  return { metodo: "top", consiglio: `${lastTxt}. ${why}${backNote}${nBack ? ` Back-off a ${kgTxt(back)} (−${Math.round((1 - back / next) * 100)}%).` : ""}`,
    riscaldamento: warmup(next, ex.nome), ratio, step, serie: sets(next, back, dropKg) };
}

// ---------- straight sets (double progression) ----------
export function proposeClassic(ex, last, { scarico = false } = {}) {
  const make = (kg, n = ex.serie) => Array.from({ length: n }, (_, i) => ({ tipo: "normal", kg: kg ?? last?.serie?.[i]?.kg ?? null, min: ex.min, max: ex.max }));
  const all = (last?.serie || []).filter((x) => x.tipo !== "warmup");
  if (!all.length) return { metodo: "classico", consiglio: "Prima volta: scegli un carico con cui arrivi al range con 2 ripetizioni in riserva.", riscaldamento: null, serie: make(null) };
  const done = all.filter((x) => x.reps != null);
  const kg = Math.max(...all.map((x) => x.kg || 0)) || null;
  const st = (k) => kgStep(k, ex.nome);
  const allTop = done.length >= Math.min(ex.serie, all.length) && done.every((x) => x.reps >= ex.max);
  const lastTxt = `Ultima volta: ${all.map((x) => `${x.kg != null ? kgTxt(x.kg) + " × " : ""}${x.reps ?? "–"}`).join(", ")}`;
  const h = last.storia || [], rpe = h[0]?.rpe;
  let next = kg, why;
  if (kg && h.length >= 3 && h.every((x) => x.kg === h[0].kg) && h[0].reps != null && h[2].reps != null && h[0].reps <= h[2].reps) { next = roundTo(kg * 0.9, st(kg)); why = `Fermo da 3 sedute allo stesso carico: oggi ${kgTxt(next)} con ripetizioni pulite, poi si risale.`; }
  else if (kg && done.some((x) => x.reps < ex.min - 1)) { next = Math.max(0, kg - st(kg)); why = `Sotto il range: scendi a ${kgTxt(next)} e torna a ${ex.min}–${ex.max}.`; }
  else if (kg && allTop && rpe != null && rpe >= 9.5) why = `Range chiuso ma al limite: resta a ${kgTxt(kg)} finché non ti sembra più facile.`;
  else if (kg && allTop && rpe != null && rpe <= 7) { next = kg + 2 * st(kg); why = `Range chiuso con margine: prova ${kgTxt(next)}.`; }
  else if (kg && allTop) { next = kg + st(kg); why = `Hai chiuso il range: prova ${kgTxt(next)}.`; }
  else why = kg ? `Stesso carico, punta a ${ex.max} ripetizioni.` : "";
  if (scarico && next) { const d = roundTo(next * 0.9, st(next)); return { metodo: "classico", consiglio: `${lastTxt}. Settimana di scarico: ${kgTxt(d)}, una serie in meno, lontano dal cedimento.`, riscaldamento: null, serie: make(d, Math.max(2, ex.serie - 1)) }; }
  return { metodo: "classico", consiglio: `${lastTxt}. ${why}`.trim(), riscaldamento: null, serie: make(next) };
}

export const propose = (ex, last, opts) => (ex.metodo === "top" ? proposeTop(ex, last, opts) : proposeClassic(ex, last, opts));
