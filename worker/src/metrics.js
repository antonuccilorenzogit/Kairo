// Calcolo delle metriche: sonno, valori notturni, baseline personali, Score di Recupero.

const BASELINE_DAYS = 60;   // finestra della media personale
const MIN_BASELINE = 5;     // notti minime per considerare affidabile una baseline
const GAP_MS = 2 * 3600e3;  // pausa oltre la quale due blocchi di sonno sono sessioni diverse

const DAY_MS = 86400e3;
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

// Raggruppa le fasi in sessioni di sonno e le assegna al giorno del risveglio
function buildSessions(rows) {
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
      pisolini_min: Math.round(napsMin),
      _bed: bedtimeMinutes(main.startIso),
      _parziale: {
        durata: clamp(main.asleepMin / 480, 0, 1) * 50,
        efficienza: clamp((eff - 0.75) / 0.20, 0, 1) * 20,
        qualita: clamp(quality / 0.40, 0, 1) * 20,
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

function finalize(days, idx) {
  const today = days[idx];
  const prev = days.slice(Math.max(0, idx - BASELINE_DAYS), idx);

  // punteggio sonno con regolarità (orario di addormentamento negli ultimi 7 giorni)
  if (today.sonno) {
    const beds = days.slice(Math.max(0, idx - 6), idx + 1).map((d) => d.sonno && d.sonno._bed).filter((x) => x != null);
    const reg = beds.length >= 3 ? std(beds) : null;
    const p = today.sonno._parziale;
    const regPts = reg == null ? 7 : clamp(1 - reg / 90, 0, 1) * 10;
    today.sonno.regolarita_min = r1(reg, 0);
    today.sonno.punteggio = Math.round(p.durata + p.efficienza + p.qualita + regPts);
  }

  const vals = (f) => prev.map(f).filter((x) => x != null && Number.isFinite(x));
  const bHrv = baseline(vals((d) => (d.notte.hrv_ms ? Math.log(d.notte.hrv_ms) : null)), 0.10);
  const bFcr = baseline(vals((d) => d.notte.fcr_bpm), 1.5);
  const bResp = baseline(vals((d) => d.notte.resp_rpm), 0.3);
  const bSleep = baseline(vals((d) => d.sonno && d.sonno.punteggio), 8);

  const comp = {};
  const add = (name, value, base, transform, sign, weight, unit) => {
    if (value == null) { comp[name] = { valore: null, peso: weight }; return; }
    const x = transform(value);
    const ok = base && !base.insufficiente;
    const z = ok ? (x - base.media) / base.dev : null;
    comp[name] = {
      valore: value, unita: unit, peso: weight,
      baseline: ok ? r1(transform === Math.log ? Math.exp(base.media) : base.media) : null,
      z: r1(z, 2), contributo: z == null ? null : sign * z, giorni_baseline: base.n,
    };
  };
  add("hrv", today.notte.hrv_ms, bHrv, Math.log, +1, 0.40, "ms");
  add("fc_riposo", today.notte.fcr_bpm, bFcr, (x) => x, -1, 0.25, "bpm");
  add("sonno", today.sonno && today.sonno.punteggio, bSleep, (x) => x, +1, 0.25, "punti");
  add("respirazione", today.notte.resp_rpm, bResp, (x) => x, -1, 0.10, "resp/min");

  // se il sonno non ha ancora baseline, uso un riferimento assoluto (75 ± 12)
  if (comp.sonno.valore != null && comp.sonno.contributo == null) {
    comp.sonno.contributo = (comp.sonno.valore - 75) / 12;
    comp.sonno.z = r1(comp.sonno.contributo, 2);
  }

  const usable = Object.values(comp).filter((c) => c.contributo != null);
  const wSum = usable.reduce((s, c) => s + c.peso, 0);
  let score = null;
  if (usable.length && (comp.hrv.contributo != null || comp.fc_riposo.contributo != null)) {
    const zc = usable.reduce((s, c) => s + c.peso * clamp(c.contributo, -3, 3), 0) / wSum;
    score = Math.round(clamp(50 + 20 * zc, 0, 100));
  }
  const giorniDati = Math.min(bHrv.n, bFcr.n);
  today.recupero = {
    score,
    stato: score == null ? "calibrazione" : score >= 67 ? "recuperato" : score >= 34 ? "parziale" : "basso",
    calibrazione: giorniDati < 14,
    giorni_baseline: giorniDati,
    componenti: Object.fromEntries(Object.entries(comp).map(([k, c]) => {
      const { contributo, ...rest } = c; return [k, rest];
    })),
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
  for (let i = 0; i < days.length; i++) finalize(days, i);
  const out = days.filter((d) => d.giorno >= start);
  for (const d of out) if (d.sonno) { delete d.sonno._bed; delete d.sonno._parziale; }
  return out;
}

export async function computeDay(db, day) {
  const h = await computeHistory(db, day, 1);
  return h[0];
}
