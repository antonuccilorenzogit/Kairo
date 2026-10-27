// Gym load progression. The routines are yours (exercises, sets, rep ranges): Kairo only decides weights and reps
// for the next session from what you actually did. Two methods per exercise:
//
// "classico"  – straight sets: double progression (all sets at the top of the range → more weight; otherwise same
//               weight and more reps; reps beyond the range → a bigger jump, up to +10%), stall after 3 sessions at the same weight → −10% and build back up.
// "top"       – one heavy set (after the warm-up), then back-off sets and an optional drop set. Only the heavy set
//               drives the progression: its reps and the reps left in reserve (RIR) estimate today's max, which gives
//               the back-off weight (to failure) and the next heavy set.
//
// Reps in reserve are stored as the RPE of the heavy set: RPE = 10 − RIR (3+ → 7).

const LOWER = /squat|stacco|deadlift|leg press|pressa|hip thrust|affond|bulgar|rdl|romanian|rumeno|good morning|lunge/i;
const ISOL = /curl|croci|alzat|estension|french|push ?down|kick ?back|calf|polpacc|face pull|shrug|scrollat|pullover|fly|raise|extension|crunch|addom/i;
// weight increments by kind of exercise: big lower-body lifts move faster, small isolation lifts slower
// `inc` is the smallest jump your gym allows (e.g. 1.25 kg plates): every step is a multiple of it
export const kgStep = (kg, name = "", inc = null) => {
  const base = LOWER.test(name) && !/leg curl|leg extension/i.test(name) ? (kg >= 60 ? 5 : 2.5) : ISOL.test(name) ? (kg >= 30 ? 2.5 : 1) : kg >= 20 ? 2.5 : 1;
  // never a bigger jump than intended: 2.5 with 2 kg dumbbells → 2, 1 with 1.25 kg plates → 1.25
  return inc > 0 ? Math.max(inc, Math.floor(base / inc + 1e-9) * inc) : base;
};
export const INCREMENTI = [0.5, 1, 1.25, 2, 2.5, 5];
export const roundTo = (kg, step) => Math.max(step, Math.round(kg / step) * step);
const kgTxt = (kg) => `${String(Math.round(kg * 10) / 10).replace(".", ",")} kg`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// back-off sets: a couple of reps more than the heavy set
export const backoffRange = (ex) => [ex.min + 2, ex.max + 2];

function warmup(top, name, inc = null) {
  if (!top || top < 20) return "Riscaldamento: 1–2 serie leggere sullo stesso movimento.";
  const s = inc || kgStep(top, name), w = (p) => roundTo(top * p, s);
  const steps = [[0.5, 8], [0.7, 4], [0.85, 2]].filter(([p]) => w(p) < top).map(([p, r]) => `${kgTxt(w(p))} × ${r}`);
  return `Riscaldamento: ${steps.join(" · ")}, poi la pesante.`;
}

// ---------- heavy set + back-off (+ drop) ----------
// Autoregulation: the heavy set is done 1–2 reps short of failure and you note how many reps you had left (RIR).
// Reps done + reps left = reps to failure → today's estimated max (Epley). The back-offs (to failure, in their
// range) get the weight that today's max allows, minus the fatigue left by the heavy set — learned from your own
// sessions. The next heavy set comes from the same estimate, within the usual safety limits.
export const DEFAULT_FATIGUE = 0.07; // back-offs about 7% weaker than the heavy set would predict
export const e1rm = (kg, repsToFailure) => kg * (1 + repsToFailure / 30);
export const weightFor = (max, reps) => max / (1 + reps / 30);
export const rirOf = (rpe) => (rpe == null ? null : Math.max(0, Math.min(3, Math.round(10 - rpe))));
export const backoffTarget = (ex) => { const [a, b] = backoffRange(ex); return Math.round((a + b) / 2); };

// fatigue after the heavy set, from the last sessions with a heavy set and its reps in reserve (shrunk towards 7%)
export function learnFatigue(sessions = []) {
  const obs = [];
  for (const ses of sessions.slice(0, 3)) {
    const top = ses.find((x) => x.tipo === "top" && x.kg && x.reps != null && x.rpe != null);
    if (!top) continue;
    const t = e1rm(top.kg, top.reps + rirOf(top.rpe));
    for (const b of ses.filter((x) => x.tipo === "backoff" && x.kg && x.reps)) obs.push(clamp(1 - e1rm(b.kg, b.reps) / t, -0.05, 0.3));
  }
  // prior worth 4 back-off sets: a single odd session does not move it much
  return { fatica: clamp((DEFAULT_FATIGUE * 4 + obs.reduce((a, x) => a + x, 0)) / (4 + obs.length), 0.02, 0.2), serie: obs.length };
}
// back-off weight from today's heavy set
export function backoffFromTop(kg, reps, rir, ex, fatica, step) {
  const max = e1rm(kg, reps + (rir ?? 1.5));
  return roundTo(weightFor(max, backoffTarget(ex)) * (1 - fatica), step);
}

export function proposeTop(ex, last, { scarico = false, incremento = null } = {}) {
  const inc = ex.incremento || incremento || null;
  const nBack = Math.max(0, ex.serie - 1), drop = !!ex.drop;
  const [bmin, bmax] = backoffRange(ex);
  const sets = (top, back, dropKg, nb = nBack, withDrop = drop) => [
    { tipo: "top", kg: top, min: ex.min, max: ex.max },
    ...Array.from({ length: nb }, () => ({ tipo: "backoff", kg: back, min: bmin, max: bmax })),
    ...(withDrop ? [{ tipo: "dropset", kg: dropKg, min: null, max: null }] : []),
  ];
  const all = last?.serie || [];
  const { fatica, serie: learned } = learnFatigue(last?.sessioni || (all.length ? [all] : []));
  const base = { metodo: "top", fatica, bo_target: backoffTarget(ex) };
  const top = all.find((x) => x.tipo === "top") || [...all].filter((x) => x.kg != null && x.tipo !== "dropset" && x.tipo !== "warmup").sort((a, b) => b.kg - a.kg)[0];
  if (!top || top.kg == null || top.reps == null) {
    return { ...base, consiglio: `Prima volta: dopo il riscaldamento fai la pesante da ${ex.min}–${ex.max} ripetizioni lasciandone 1–2 in riserva e segna quante te ne restavano: il peso delle back-off (a cedimento) lo calcola Kairo da lì.`,
      riscaldamento: "Riscaldamento: 2–3 serie in salita, sempre meno ripetizioni.", step: null, serie: sets(null, null, null) };
  }
  const step = kgStep(top.kg, ex.nome, inc), unit = inc || step;
  // reps in reserve only from a heavy set logged as such (older sets carry the RPE of the whole session)
  const rir = top.tipo === "top" ? rirOf(top.rpe) : null;
  const lastTxt = `Ultima pesante: ${kgTxt(top.kg)} × ${top.reps}${rir != null ? ` (${rir >= 3 ? "3+" : rir} in riserva)` : ""}`;
  // the heavy set decides the next weight: the weight for the top of the range with 1–2 reps left, from today's max,
  // never more than 2 increments at a time
  const max = e1rm(top.kg, top.reps + (rir ?? 1));
  const target = roundTo(weightFor(max, ex.max + 1.5), unit);
  let next = top.kg, why;
  const h = last.storia || [];
  if (h.length >= 3 && h.every((x) => x.kg === h[0].kg) && h[0].reps_top != null && h[2].reps_top != null && h[0].reps_top <= h[2].reps_top) {
    next = roundTo(top.kg * 0.9, unit); why = `Ferma da 3 sedute a ${kgTxt(top.kg)}: oggi ${kgTxt(next)}, poi si risale.`;
  } else if (top.reps >= ex.max) {
    if (rir === 0 && top.reps === ex.max) why = `Range chiuso ma senza ripetizioni in riserva: resta a ${kgTxt(top.kg)} finché non te ne avanza una.`;
    else { next = clamp(target, top.kg + step, top.kg + 2 * step); why = `Range chiuso: +${kgTxt(next - top.kg)}.`; }
  } else if (top.reps >= ex.min) {
    if (target >= top.kg + step) { next = top.kg + step; why = `Avevi margine: +${kgTxt(step)}.`; }
    else why = `Stesso carico, punta a ${top.reps + 1} ripetizioni${top.reps + 1 >= ex.max ? ": poi si sale" : ""}.`;
  } else {
    // even counting the reps left you would not reach the range → two increments down, otherwise one
    next = Math.max(step, top.kg - (top.reps + (rir ?? 1) < ex.min ? 2 : 1) * step);
    why = `Sotto il range: scendi a ${kgTxt(next)} e torna a ${ex.min}–${ex.max}.`;
  }
  const fatTxt = learned >= 3 ? ` Calo dopo la pesante imparato su di te: ${Math.round(fatica * 100)}%.` : "";
  if (scarico) {
    const t = roundTo(next * 0.9, unit);
    return { ...base, consiglio: `${lastTxt}. Settimana di scarico: pesante a ${kgTxt(t)} con 3 ripetizioni in riserva, una back-off in meno senza cedimento, niente drop.`,
      riscaldamento: warmup(t, ex.nome, inc), step: unit, scarico: true, serie: sets(t, roundTo(t * 0.85, unit), null, Math.max(0, nBack - 1), false) };
  }
  // back-offs planned for a heavy set at the top of the range with 1–2 reps left; recalculated when you note it
  // the back-off is always lighter than the heavy set (with very light weights the rounding could make them equal)
  const back = Math.min(backoffFromTop(next, ex.max, 1.5, ex, fatica, unit), Math.max(unit, next - unit)), dropKg = roundTo(back * 0.75, unit);
  return { ...base, consiglio: `${lastTxt}. ${why}${fatTxt}${nBack ? ` Back-off a cedimento intorno a ${kgTxt(back)}: il peso giusto lo calcola Kairo quando segni la pesante.` : ""}`,
    riscaldamento: warmup(next, ex.nome, inc), step: unit, serie: sets(next, back, dropKg) };
}

// ---------- straight sets (double progression) ----------
export function proposeClassic(ex, last, { scarico = false, incremento = null } = {}) {
  const inc = ex.incremento || incremento || null;
  // straight sets, plus an optional drop set to failure at the end (−25% from the last set)
  const make = (kg, n = ex.serie, withDrop = !!ex.drop) => {
    const sets = Array.from({ length: n }, (_, i) => ({ tipo: "normal", kg: kg ?? last?.serie?.filter((x) => x.tipo !== "dropset")?.[i]?.kg ?? null, min: ex.min, max: ex.max }));
    const lastKg = sets[sets.length - 1]?.kg;
    if (withDrop) sets.push({ tipo: "dropset", kg: lastKg ? roundTo(lastKg * 0.75, inc || kgStep(lastKg, ex.nome)) : null, min: null, max: null });
    return sets;
  };
  const all = (last?.serie || []).filter((x) => x.tipo !== "warmup" && x.tipo !== "dropset");
  if (!all.length) return { metodo: "classico", consiglio: "Prima volta: scegli un carico con cui arrivi al range con 2 ripetizioni in riserva.", riscaldamento: null, serie: make(null) };
  const done = all.filter((x) => x.reps != null);
  const kg = Math.max(...all.map((x) => x.kg || 0)) || null;
  const st = (k) => kgStep(k, ex.nome, inc);
  const allTop = done.length >= Math.min(ex.serie, all.length) && done.every((x) => x.reps >= ex.max);
  const lastTxt = `Ultima volta: ${all.map((x) => `${x.kg != null ? kgTxt(x.kg) + " × " : ""}${x.reps ?? "–"}`).join(", ")}`;
  const h = last.storia || [], rpe = h[0]?.rpe;
  let next = kg, why;
  if (kg && h.length >= 3 && h.every((x) => x.kg === h[0].kg) && h[0].reps != null && h[2].reps != null && h[0].reps <= h[2].reps) { next = roundTo(kg * 0.9, st(kg)); why = `Fermo da 3 sedute allo stesso carico: oggi ${kgTxt(next)} con ripetizioni pulite, poi si risale.`; }
  else if (kg && done.some((x) => x.reps < ex.min - 1)) { next = Math.max(0, kg - st(kg)); why = `Sotto il range: scendi a ${kgTxt(next)} e torna a ${ex.min}–${ex.max}.`; }
  else if (kg && allTop) {
    // extra reps beyond the range = you are stronger than the weight: the best set at that weight (usually the last,
    // to failure) gives today's max, and the next weight is the one for the middle of the range (+10% at most)
    const best = Math.max(...done.filter((x) => x.kg === kg).map((x) => x.reps)), extra = best - ex.max, s = st(kg);
    if (extra >= 1) {
      const target = weightFor(e1rm(kg, best), (ex.min + ex.max) / 2);
      next = Math.max(kg + s, Math.min(roundTo(target, s), roundTo(kg * 1.1, s)));
      why = `${best} ripetizioni, ${extra} oltre il range: sali a ${kgTxt(next)}.`;
    } else if (rpe != null && rpe <= 5) { next = kg + 2 * s; why = `Range chiuso con margine: prova ${kgTxt(next)}.`; }
    else { next = kg + s; why = `Hai chiuso il range: prova ${kgTxt(next)}.`; }
  }
  else why = kg ? `Stesso carico, punta a ${ex.max} ripetizioni.` : "";
  if (scarico && next) { const d = roundTo(next * 0.9, st(next)); return { metodo: "classico", consiglio: `${lastTxt}. Settimana di scarico: ${kgTxt(d)}, una serie in meno, lontano dal cedimento.`, riscaldamento: null, serie: make(d, Math.max(2, ex.serie - 1), false) }; }
  return { metodo: "classico", consiglio: `${lastTxt}. ${why}`.trim(), riscaldamento: null, serie: make(next) };
}

export const propose = (ex, last, opts) => (ex.metodo === "top" ? proposeTop(ex, last, opts) : proposeClassic(ex, last, opts));
