// Personal sleep need (the "base" of tonight's need), learned from your nights.
//
// No app publishes how it estimates it. Kairo uses the two methods of the sleep literature:
// 1. Plateau ("how much sleep is enough"): sleeping more improves the next morning up to a point, then
//    stops helping. For every night: total sleep in 24 h (the night + the previous day's naps) against
//    the next morning (HRV versus your baseline and energy in the check-in — never the Recovery score,
//    which already contains sleep: that would be circular), corrected for the previous day's training
//    load. A linear-plateau model finds the knee; a bootstrap gives its uncertainty.
// 2. Free waking: when you wake up on your own (well after your usual alarm) and you are not in debt,
//    you sleep about what you need (sleep-extension studies: Klerman & Dijk 2005, Kitamura 2016).
// Nights tagged alcohol/illness/travel and nights entered by hand are left out. With too few nights,
// or no clear knee, Kairo says so and uses the 8-hour reference: never an unreliable number.

export const NEED_LIMITS = { min: 420, max: 570 };   // 7 h – 9 h 30
export const NEED_MIN_NIGHTS = 30;                   // nights with sleep and a next-morning signal
const FREE_WAKE_NIGHTS = 6;
const KNOTS = Array.from({ length: 13 }, (_, i) => 390 + i * 15); // 6 h 30 → 9 h 30
const EXCLUDE = /alcol|malanno|viaggio/;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hm = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

// small deterministic random generator: same data → same estimate
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// least squares of y = a + b·min(x, k) for every knot: the knot with the smallest error and b > 0
function fitPlateau(pts) {
  let best = null;
  for (const k of KNOTS) {
    const u = pts.map((p) => Math.min(p.x, k)), mu = mean(u), my = mean(pts.map((p) => p.y));
    let sxx = 0, sxy = 0;
    pts.forEach((p, i) => { sxx += (u[i] - mu) ** 2; sxy += (u[i] - mu) * (p.y - my); });
    if (!sxx) continue;
    const b = sxy / sxx, a = my - b * mu;
    if (b <= 0) continue;
    const sse = pts.reduce((s, p, i) => s + (p.y - a - b * u[i]) ** 2, 0);
    // t statistic of the slope: is the morning really better after more sleep, or is it noise?
    const t = b / Math.sqrt(sse / Math.max(1, pts.length - 2) / sxx);
    if (!best || sse < best.sse) best = { k, a, b, sse, t };
  }
  return best;
}

/**
 * days: computed days (oldest first) with sonno, pisolini, checkin, recupero.componenti.hrv.z
 * load: training load of each day (same index), or null
 * profile: { sveglia }
 * Returns { min, fonte, margine, notti, metodi, mancano }.
 */
export function estimateSleepNeed(days, load = [], profile = {}) {
  // 1. one point per night
  const energies = days.map((d) => d.checkin?.energia).filter((e) => e >= 1 && e <= 5);
  const eMean = energies.length >= 5 ? mean(energies) : null, eSd = energies.length >= 5 ? sd(energies) || 1 : null;
  const loads = load.filter((x) => x != null && x > 0);
  const usualLoad = loads.length >= 7 ? median(loads) : null;
  const nights = [];
  days.forEach((d, i) => {
    if (!d.sonno || d.sonno.manuale || !d.sonno.durata_min || EXCLUDE.test(d.checkin?.tag || "")) return;
    const x = d.sonno.durata_min + (days[i - 1]?.pisolini?.totale_min || 0);
    const parts = [];
    const hz = d.recupero?.componenti?.hrv?.z;
    if (hz != null && Number.isFinite(hz)) parts.push(clamp(hz, -3, 3));
    if (eMean != null && d.checkin?.energia) parts.push(clamp((d.checkin.energia - eMean) / eSd, -3, 3));
    nights.push({ x, y: parts.length ? mean(parts) : null, r: usualLoad && load[i - 1] != null ? load[i - 1] / usualLoad : null, d, i });
  });

  // 2. plateau: next morning versus sleep, corrected for yesterday's load
  let plateau = null;
  const pts = nights.filter((n) => n.y != null);
  if (pts.length >= NEED_MIN_NIGHTS) {
    const withR = pts.filter((p) => p.r != null);
    if (withR.length >= 20) {
      const mr = mean(withR.map((p) => p.r)), my = mean(withR.map((p) => p.y));
      const sxx = withR.reduce((s, p) => s + (p.r - mr) ** 2, 0);
      const beta = sxx ? withR.reduce((s, p) => s + (p.r - mr) * (p.y - my), 0) / sxx : 0;
      for (const p of pts) if (p.r != null) p.y -= beta * (p.r - mr); // a heavy day lowers the morning, not the sleep
    }
    const fit = fitPlateau(pts);
    // the knee must have nights on both sides, otherwise the data cannot tell where it is
    const below = fit ? pts.filter((p) => p.x < fit.k - 20).length : 0, above = fit ? pts.filter((p) => p.x > fit.k + 10).length : 0;
    if (fit && fit.t >= 3 && below >= 5 && above >= 5 && fit.k > KNOTS[0] && fit.k < KNOTS[KNOTS.length - 1]) {
      const rand = rng(pts.length * 7919 + Math.round(pts.reduce((s, p) => s + p.x, 0)));
      const ks = [];
      for (let b = 0; b < 200; b++) {
        const sample = pts.map(() => pts[Math.floor(rand() * pts.length)]);
        const f = fitPlateau(sample);
        if (f) ks.push(f.k);
      }
      ks.sort((a, b) => a - b);
      if (ks.length >= 100) {
        const q = (p) => ks[Math.floor(p * (ks.length - 1))];
        const margin = (q(0.9) - q(0.1)) / 2;
        if (margin <= 40) plateau = { k: median(ks), margine: margin, notti: pts.length };
      }
    }
  }

  // 3. free waking without debt
  let free = null;
  const wakes = nights.filter((n) => n.d.sonno.fine).map((n) => hm(n.d.sonno.fine));
  const alarm = profile.sveglia ? Number(profile.sveglia.slice(0, 2)) * 60 + Number(profile.sveglia.slice(3)) : wakes.length >= 7 ? median(wakes) : null;
  if (alarm != null && nights.length >= 10) {
    const typical = median(nights.map((n) => n.x));
    const fw = nights.filter((n, j) => {
      if (!n.d.sonno.fine || hm(n.d.sonno.fine) < alarm + 45) return false;
      const prev = nights.slice(Math.max(0, j - 3), j);
      return prev.length >= 2 && mean(prev.map((p) => p.x)) >= typical - 15; // not catching up on a debt
    }).map((n) => n.x);
    if (fw.length >= FREE_WAKE_NIGHTS) {
      const m = median(fw), mad = median(fw.map((v) => Math.abs(v - m))) * 1.4826;
      free = { k: m, margine: Math.max(10, mad / Math.sqrt(fw.length) * 1.5), notti: fw.length };
    }
  }

  const methods = [plateau && "come ti svegli dopo ogni notte", free && "i risvegli senza sveglia"].filter(Boolean);
  if (!plateau && !free) {
    return { min: null, fonte: "predefinito", margine: null, notti: pts.length, metodi: [], mancano: Math.max(0, NEED_MIN_NIGHTS - pts.length) };
  }
  // both: weighted by their precision
  let k, margin;
  if (plateau && free) {
    const w1 = 1 / Math.max(plateau.margine, 5) ** 2, w2 = 1 / Math.max(free.margine, 5) ** 2;
    k = (plateau.k * w1 + free.k * w2) / (w1 + w2); margin = Math.max(5, Math.sqrt(1 / (w1 + w2)));
  } else ({ k, margine: margin } = plateau || free);
  return {
    min: clamp(Math.round(k / 5) * 5, NEED_LIMITS.min, NEED_LIMITS.max),
    fonte: "imparato", margine: Math.round(Math.max(5, margin) / 5) * 5,
    notti: Math.max(plateau?.notti || 0, free?.notti || 0), metodi: methods, mancano: 0,
  };
}
