// Calcolo delle metriche: sonno, valori notturni, baseline personali, Score di Recupero.
//
// Metodi e fonti (nessuna app pubblica la formula esatta dei suoi punteggi: qui si usano i metodi
// pubblicati e validati che quelle app dichiarano di usare, con soglie tratte dalla letteratura):
// - HRV: logaritmo naturale (Plews et al. 2012-2013), media mobile 7 giorni confrontata con la
//   "normal range" a 60 giorni ± 0,5 DS = smallest worthwhile change (Plews; HRV4Training usa 60 giorni).
// - Struttura del Recupero come la Readiness di Oura: contributi 0-100 per HRV (oggi e bilancio),
//   FC a riposo rispetto alla media a lungo termine, sonno della notte, bilancio di sonno a 14 giorni,
//   più la frequenza respiratoria notturna (usata da Whoop). Fasce finali come Whoop: 67+ verde, 34-66 giallo.
// - Punteggio del sonno con i contributi di Oura (durata, efficienza, profondo, REM, regolarità, orario)
//   e le soglie di AASM/NSF: 7-9 h (Watson 2015), efficienza >= 85% (Ohayon 2017), profondo ~15-20%
//   e REM ~20-25% (Oura; Ohayon 2004), punto medio del sonno tra 00:00 e 03:00 (Oura).
// - Regolarità: Sleep Regularity Index (Phillips et al. 2017) su 7 giorni; riferimento UK Biobank
//   (Windred 2024): mediana 81, intervallo interquartile 73,8-86,3.

const BASELINE_DAYS = 60;   // finestra della media personale
const MIN_BASELINE = 5;     // notti minime per considerare affidabile una baseline
const GAP_MS = 2 * 3600e3;  // pausa oltre la quale due blocchi di sonno sono sessioni diverse

const DAY_MS = 86400e3;
const SLEEP_NEED_MIN = 480;  // fabbisogno di riferimento: 8 h (centro dell'intervallo AASM 7-9 h)
// interpolazione lineare a tratti: points = [[x, y], ...] ordinati per x
const pw = (x, points) => {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i], [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
};
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
const t = (iso) => Date.parse(iso);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const r1 = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

async function load(db, from, to) {
  const r = await db.batch([
    db.prepare("SELECT metric, ts, value FROM samples WHERE ts >= ? AND ts < ? ORDER BY ts").bind(from, addDays(to, 1)),
    db.prepare("SELECT start, end, stage FROM sleep WHERE end >= ? AND start < ? ORDER BY start").bind(from, addDays(to, 1)),
    db.prepare("SELECT metric, day, value FROM daily WHERE day >= ? AND day <= ?").bind(from, to),
    db.prepare("SELECT * FROM checkin WHERE day >= ? AND day <= ?").bind(from, to),
  ]);
  const samples = {};
  for (const s of r[0].results) (samples[s.metric] ||= []).push({ ts: s.ts, ms: t(s.ts), v: s.value });
  const daily = {};
  for (const d of r[2].results) (daily[d.day] ||= {})[d.metric] = d.value;
  const checkin = {};
  for (const c of r[3].results) checkin[c.day] = c;
  return { samples, sleepRows: r[1].results, daily, checkin };
}

// Le fasi possono arrivare da più fonti (Watch, iPhone, altre app) e sovrapporsi: le fondo in una
// sola linea temporale senza sovrapposizioni, così ogni minuto conta una volta sola. Dove le fonti
// si sovrappongono vince la fase più informativa: profondo/REM/leggero > sonno generico > sveglio > a letto.
const PRIORITY = { deep: 6, rem: 5, core: 4, asleep: 3, awake: 2, inbed: 1 };
export function mergeStages(rows) {
  const iv = rows.map((r) => ({ s: t(r.start), e: t(r.end), stage: r.stage, start: r.start, end: r.end }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s);
  if (!iv.length) return [];
  const cuts = [...new Set(iv.flatMap((x) => [x.s, x.e]))].sort((a, b) => a - b);
  // ISO string (con il fuso originale) per ogni istante di taglio
  const isoAt = new Map();
  for (const x of iv) { isoAt.set(x.s, x.start); isoAt.set(x.e, x.end); }
  iv.sort((a, b) => a.s - b.s);
  const out = [];
  let k = 0;
  const active = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    while (k < iv.length && iv[k].s <= a) active.push(iv[k++]);
    for (let j = active.length - 1; j >= 0; j--) if (active[j].e <= a) active.splice(j, 1);
    let best = null;
    for (const x of active) if (x.s <= a && x.e >= b && (!best || PRIORITY[x.stage] > PRIORITY[best])) best = x.stage;
    if (!best) continue;
    const last = out[out.length - 1];
    if (last && last.stage === best && last.endMs === a) { last.end = isoAt.get(b); last.endMs = b; }
    else out.push({ start: isoAt.get(a), end: isoAt.get(b), stage: best, startMs: a, endMs: b });
  }
  return out.map(({ start, end, stage }) => ({ start, end, stage }));
}

// Raggruppa le fasi in sessioni di sonno e le assegna al giorno del risveglio
function buildSessions(rawRows) {
  const rows = mergeStages(rawRows);
  const sessions = [];
  let cur = null;
  for (const r of rows) {
    const s = t(r.start), e = t(r.end);
    if (!cur || s - cur.endMs > GAP_MS) {
      cur = { startIso: r.start, startMs: s, endIso: r.end, endMs: e, min: { core: 0, deep: 0, rem: 0, awake: 0, asleep: 0, inbed: 0 } };
      sessions.push(cur);
    }
    if (e > cur.endMs) { cur.endMs = e; cur.endIso = r.end; }
    cur.min[r.stage] = (cur.min[r.stage] || 0) + (e - s) / 60e3;
  }
  const byDay = {};
  for (const s of sessions) {
    s.asleepMin = s.min.core + s.min.deep + s.min.rem + s.min.asleep;
    s.spanMin = (s.endMs - s.startMs) / 60e3;
    (byDay[s.endIso.slice(0, 10)] ||= []).push(s);
  }
  return byDay;
}

// Minuti dall'ora 18:00 del giorno prima (gestisce l'addormentamento dopo mezzanotte)
function bedtimeMinutes(iso) {
  const h = Number(iso.slice(11, 13)), m = Number(iso.slice(14, 16));
  let x = h * 60 + m;
  if (x < 18 * 60) x += 1440;
  return x - 18 * 60;
}

function inWindow(list, fromMs, toMs) {
  return (list || []).filter((s) => s.ms >= fromMs && s.ms <= toMs).map((s) => s.v);
}

// Metriche "grezze" di un giorno, senza confronto con la baseline
function rawDay(day, data, sessionsByDay) {
  const sessions = (sessionsByDay[day] || []).slice().sort((a, b) => b.asleepMin - a.asleepMin);
  const main = sessions[0] && sessions[0].asleepMin >= 120 ? sessions[0] : null;
  const napsMin = sessions.filter((s) => s !== main).reduce((a, s) => a + s.asleepMin, 0);

  let winFrom, winTo;
  if (main) { winFrom = main.startMs - 30 * 60e3; winTo = main.endMs; }
  else { winFrom = t(day + "T00:00:00+02:00"); winTo = t(day + "T09:00:00+02:00"); }

  const hrvNight = inWindow(data.samples.hrv, winFrom, winTo);
  const hrvDay = (data.samples.hrv || []).filter((s) => s.ts.startsWith(day)).map((s) => s.v);
  // senza misure notturne uso le 24 h precedenti a mezzogiorno (il Watch misura l'HRV in momenti casuali)
  const hrvFallback = inWindow(data.samples.hrv, t(day + "T12:00:00+02:00") - DAY_MS, t(day + "T12:00:00+02:00"));
  const hrv = hrvNight.length ? mean(hrvNight) : hrvFallback.length ? mean(hrvFallback) : null;
  const fcrList = (data.samples.fcr || []).filter((s) => s.ts.startsWith(day));
  const fcr = fcrList.length ? fcrList[fcrList.length - 1].v : null;
  const resp = main ? mean(inWindow(data.samples.resp, winFrom, winTo)) : null;
  const spo2 = main ? inWindow(data.samples.spo2, winFrom, winTo) : [];

  let sleep = null;
  if (main) {
    const eff = main.asleepMin / main.spanMin;
    const quality = (main.min.deep + main.min.rem) / Math.max(main.asleepMin, 1);
    sleep = {
      inizio: main.startIso, fine: main.endIso,
      durata_min: Math.round(main.asleepMin), a_letto_min: Math.round(main.spanMin),
      fasi_min: { leggero: Math.round(main.min.core + main.min.asleep), profondo: Math.round(main.min.deep),
        rem: Math.round(main.min.rem), veglia: Math.round(main.min.awake) },
      efficienza: r1(eff * 100, 0),
      quota_profondo_rem: r1(quality * 100, 0),
      quota_profondo: r1((main.min.deep / Math.max(main.asleepMin, 1)) * 100, 0),
      quota_rem: r1((main.min.rem / Math.max(main.asleepMin, 1)) * 100, 0),
      pisolini_min: Math.round(napsMin),
      _bed: bedtimeMinutes(main.startIso),
      _wake: bedtimeMinutes(main.endIso),
      _midH: (18 + (bedtimeMinutes(main.startIso) + main.spanMin / 2) / 60) % 24, // ora locale del punto medio
      _contributi: {
        // AASM/NSF: 7-9 h raccomandate; pieno punteggio da 8 h, 0 sotto le 4 h
        durata: pw(main.asleepMin, [[240, 0], [420, 85], [480, 100]]),
        // NSF (Ohayon 2017): >= 85% buona qualità, <= 74% scarsa
        efficienza: pw(eff * 100, [[65, 0], [75, 50], [85, 85], [92, 100]]),
        // profondo: adulti 15-20% del sonno (Oura); REM: 20-25% (circa 1,5 h)
        profondo: pw((main.min.deep / Math.max(main.asleepMin, 1)) * 100, [[0, 0], [10, 60], [15, 100]]),
        rem: pw((main.min.rem / Math.max(main.asleepMin, 1)) * 100, [[0, 0], [15, 70], [20, 100]]),
      },
    };
  }
  const d = data.daily[day] || {};
  return {
    giorno: day,
    notte: { hrv_ms: r1(hrv), hrv_misure: hrvNight.length || hrvFallback.length, hrv_fonte: hrvNight.length ? "notte" : hrvFallback.length ? "24h" : null, hrv_giorno_ms: r1(mean(hrvDay)), fcr_bpm: fcr,
      resp_rpm: r1(resp), spo2_media: r1(mean(spo2)), spo2_min: spo2.length ? Math.min(...spo2) : null },
    sonno: sleep,
    attivita: { passi: d.passi ?? null, kcal_attive: r1(d.kcal_attive, 0), kcal_riposo: r1(d.kcal_riposo, 0),
      dist_km: r1(d.dist_piedi, 2), piani: d.piani ?? null },
    checkin: data.checkin[day] || null,
  };
}

function baseline(values, floor) {
  if (values.length < MIN_BASELINE) return { insufficiente: true, n: values.length };
  return { media: mean(values), dev: Math.max(std(values) || 0, floor), n: values.length };
}

// Sleep Regularity Index (Phillips et al. 2017): probabilità che a 24 h di distanza lo stato
// (sonno/veglia) sia lo stesso, minuto per minuto; SRI = 200·P − 100 (100 = perfettamente regolare).
function sri(masks) {
  const pairs = [];
  for (let i = 1; i < masks.length; i++) {
    const a = masks[i - 1], b = masks[i];
    if (!a || !b) continue;
    let same = 0;
    for (let m = 0; m < 1440; m++) if (a[m] === b[m]) same++;
    pairs.push(same / 1440);
  }
  return pairs.length >= 2 ? 200 * mean(pairs) - 100 : null;
}

// trasforma uno z-score (rispetto alla media personale) in un contributo 0-100: 60 = come al solito
const zScore = (z) => clamp(60 + 20 * clamp(z, -3, 2), 0, 100);

function finalize(days, idx, maskOf) {
  const today = days[idx];
  const prev = days.slice(Math.max(0, idx - BASELINE_DAYS), idx);
  const week = days.slice(Math.max(0, idx - 6), idx + 1);

  // ---- punteggio del sonno (contributi stile Oura, soglie AASM/NSF) ----
  if (today.sonno) {
    const masks = week.map((d) => (d.sonno ? maskOf(d.giorno) : null));
    const s = sri(masks);
    const beds = week.map((d) => d.sonno && d.sonno._bed).filter((x) => x != null);
    const wakes = week.map((d) => d.sonno && d.sonno._wake).filter((x) => x != null);
    const sdBed = beds.length >= 3 ? std(beds) : null, sdWake = wakes.length >= 3 ? std(wakes) : null;
    const c = today.sonno._contributi;
    // regolarità: SRI se ci sono almeno 2 coppie di notti consecutive, altrimenti la costanza di orari (Oura)
    c.regolarita = s != null ? pw(s, [[40, 0], [60, 30], [73.8, 60], [81, 80], [86.3, 95], [90, 100]])
      : sdBed != null ? pw((sdBed + (sdWake ?? sdBed)) / 2, [[0, 100], [30, 85], [60, 60], [120, 0]]) : null;
    // orario: punto medio del sonno ideale tra le 00:00 e le 03:00 (Oura)
    const midH = today.sonno._midH;
    const fromIdeal = midH >= 0 && midH <= 3 ? 0 : midH > 3 && midH < 12 ? midH - 3 : midH >= 12 ? 24 - midH : 0;
    c.orario = pw(fromIdeal, [[0, 100], [1, 85], [2, 65], [4, 20], [6, 0]]);
    const W = { durata: 0.35, efficienza: 0.20, profondo: 0.10, rem: 0.10, regolarita: 0.15, orario: 0.10 };
    const parts = Object.entries(W).filter(([k]) => c[k] != null);
    const wSum = parts.reduce((a, [, w]) => a + w, 0);
    today.sonno.punteggio = Math.round(parts.reduce((a, [k, w]) => a + w * c[k], 0) / wSum);
    today.sonno.contributi = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v == null ? null : Math.round(v)]));
    today.sonno.sri = r1(s, 0);
    today.sonno.regolarita_min = r1(sdBed, 0);
  }

  // ---- bilancio di sonno: media delle ultime 14 notti rispetto al fabbisogno (Oura "Sleep balance") ----
  const last14 = days.slice(Math.max(0, idx - 13), idx + 1).filter((d) => d.sonno);
  const balance = last14.length >= 3 ? mean(last14.map((d) => d.sonno.durata_min)) - SLEEP_NEED_MIN : null;

  // ---- baseline personali (60 giorni, solo giorni precedenti) ----
  const vals = (f) => prev.map(f).filter((x) => x != null && Number.isFinite(x));
  const bHrv = baseline(vals((d) => (d.notte.hrv_ms ? Math.log(d.notte.hrv_ms) : null)), 0.08);
  const bFcr = baseline(vals((d) => d.notte.fcr_bpm), 2);
  const bResp = baseline(vals((d) => d.notte.resp_rpm), 0.4);

  const comp = {};
  // HRV: 60% valore di stanotte, 40% media mobile 7 giorni (cambi entro ±0,5 DS = variazione trascurabile)
  {
    const v = today.notte.hrv_ms, ok = !bHrv.insufficiente;
    let score = null, z = null;
    if (v != null && ok) {
      z = (Math.log(v) - bHrv.media) / bHrv.dev;
      const lnWeek = week.map((d) => d.notte.hrv_ms).filter((x) => x).map(Math.log);
      let zt = 0;
      if (lnWeek.length >= 3) {
        const diff = mean(lnWeek) - bHrv.media, swc = 0.5 * bHrv.dev;
        zt = Math.abs(diff) <= swc ? 0 : (diff - Math.sign(diff) * swc) / bHrv.dev;
      }
      score = 0.6 * zScore(z) + 0.4 * zScore(zt);
    }
    comp.hrv = { valore: v, unita: "ms", peso: 0.35, baseline: ok ? r1(Math.exp(bHrv.media)) : null, z: r1(z, 2), punteggio: score, giorni_baseline: bHrv.n,
      normale: ok ? [r1(Math.exp(bHrv.media - 0.5 * bHrv.dev)), r1(Math.exp(bHrv.media + 0.5 * bHrv.dev))] : null };
  }
  // FC a riposo: rispetto alla media a lungo termine (Oura: cala se 3-5 bpm sopra la media)
  {
    const v = today.notte.fcr_bpm, ok = !bFcr.insufficiente;
    const z = v != null && ok ? -(v - bFcr.media) / bFcr.dev : null;
    comp.fc_riposo = { valore: v, unita: "bpm", peso: 0.20, baseline: ok ? r1(bFcr.media) : null, z: r1(z, 2), punteggio: z == null ? null : zScore(z), giorni_baseline: bFcr.n };
  }
  // sonno della notte: il suo punteggio è già 0-100
  comp.sonno = { valore: today.sonno ? today.sonno.punteggio : null, unita: "punti", peso: 0.25, baseline: null, z: null, punteggio: today.sonno ? today.sonno.punteggio : null };
  // bilancio di sonno a 14 giorni
  comp.bilancio_sonno = { valore: balance == null ? null : Math.round(balance), unita: "min/notte", peso: 0.10, baseline: SLEEP_NEED_MIN,
    punteggio: balance == null ? null : pw(balance, [[-150, 0], [-120, 20], [-60, 65], [-30, 85], [0, 100]]) };
  // respirazione: conta solo l'aumento rispetto alla media (segnale precoce di stanchezza o malanno)
  {
    const v = today.notte.resp_rpm, ok = !bResp.insufficiente;
    const up = v != null && ok ? Math.max(0, (v - bResp.media) / bResp.dev) : null;
    comp.respirazione = { valore: v, unita: "resp/min", peso: 0.10, baseline: ok ? r1(bResp.media) : null, z: v != null && ok ? r1((v - bResp.media) / bResp.dev, 2) : null,
      punteggio: up == null ? null : clamp(70 - 25 * up, 0, 100), giorni_baseline: bResp.n };
  }

  const usable = Object.values(comp).filter((c) => c.punteggio != null);
  const wSum = usable.reduce((s, c) => s + c.peso, 0);
  let score = null;
  if (usable.length && (comp.hrv.punteggio != null || comp.fc_riposo.punteggio != null)) {
    score = Math.round(clamp(usable.reduce((s, c) => s + c.peso * c.punteggio, 0) / wSum, 0, 100));
  }
  const giorniDati = Math.min(bHrv.n, bFcr.n);
  for (const c of Object.values(comp)) if (c.punteggio != null) c.punteggio = Math.round(c.punteggio);
  today.recupero = {
    score,
    stato: score == null ? "calibrazione" : score >= 67 ? "recuperato" : score >= 34 ? "parziale" : "basso",
    calibrazione: giorniDati < 14,
    giorni_baseline: giorniDati,
    componenti: comp,
  };
  return today;
}

export async function computeHistory(db, endDay, nDays) {
  const start = addDays(endDay, -(nDays - 1));
  const from = addDays(start, -BASELINE_DAYS - 1);
  const data = await load(db, from, endDay);
  const sessionsByDay = buildSessions(data.sleepRows);
  const days = [];
  for (let d = from; d <= endDay; d = addDays(d, 1)) days.push(rawDay(d, data, sessionsByDay));
  // baseline e punteggi in ordine cronologico (la regolarità usa i giorni precedenti)
  // maschera minuto per minuto (mezzogiorno → mezzogiorno) degli intervalli di sonno, per il SRI
  const asleep = data.sleepRows.filter((r) => r.stage !== "awake" && r.stage !== "inbed").map((r) => [t(r.start), t(r.end)]);
  const maskCache = {};
  const maskOf = (day) => {
    if (maskCache[day]) return maskCache[day];
    const end = t(day + "T12:00:00Z"), start = end - DAY_MS, m = new Uint8Array(1440);
    for (const [s, e] of asleep) {
      if (e <= start || s >= end) continue;
      for (let i = Math.max(0, Math.floor((s - start) / 60e3)); i < Math.min(1440, Math.ceil((e - start) / 60e3)); i++) m[i] = 1;
    }
    return (maskCache[day] = m);
  };
  for (let i = 0; i < days.length; i++) finalize(days, i, maskOf);
  const out = days.filter((d) => d.giorno >= start);
  for (const d of out) if (d.sonno) { delete d.sonno._bed; delete d.sonno._wake; delete d.sonno._midH; delete d.sonno._contributi; }
  return out;
}

export async function computeDay(db, day) {
  const h = await computeHistory(db, day, 1);
  return h[0];
}
