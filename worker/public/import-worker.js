/* Kairo — reads an Apple Health export (export.zip / esportazione.zip or the .xml inside it)
 * entirely on this device and turns it into the same rows the HealthSync shortcut sends.
 * Runs in a Web Worker so the page stays responsive while gigabytes of XML stream by.
 * Nothing leaves the device from here: the page uploads the result to *your* server. */
"use strict";

// Health identifier → [kairo key, kind]. kind: sample | daily | pct
const MAP = {
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: ["hrv", "sample"],
  HKQuantityTypeIdentifierRestingHeartRate: ["fcr", "sample"],
  HKQuantityTypeIdentifierWalkingHeartRateAverage: ["fc_camminata", "sample"],
  HKQuantityTypeIdentifierRespiratoryRate: ["resp", "sample"],
  HKQuantityTypeIdentifierOxygenSaturation: ["spo2", "pct"],
  HKQuantityTypeIdentifierVO2Max: ["vo2max", "sample"],
  HKQuantityTypeIdentifierHeartRate: ["fc", "sample"],
  HKQuantityTypeIdentifierBodyMass: ["peso", "sample"],
  HKQuantityTypeIdentifierBodyFatPercentage: ["grasso_pct", "pct"],
  HKQuantityTypeIdentifierLeanBodyMass: ["massa_magra", "sample"],
  HKQuantityTypeIdentifierBodyMassIndex: ["bmi", "sample"],
  HKQuantityTypeIdentifierStepCount: ["passi", "daily"],
  HKQuantityTypeIdentifierActiveEnergyBurned: ["kcal_attive", "daily"],
  HKQuantityTypeIdentifierBasalEnergyBurned: ["kcal_riposo", "daily"],
  HKQuantityTypeIdentifierDistanceWalkingRunning: ["dist_piedi", "daily"],
  HKQuantityTypeIdentifierFlightsClimbed: ["piani", "daily"],
  HKQuantityTypeIdentifierDistanceCycling: ["dist_bici", "daily"],
  HKQuantityTypeIdentifierDistanceSwimming: ["dist_nuoto", "daily"],
  HKQuantityTypeIdentifierSwimmingStrokeCount: ["bracciate", "daily"],
  HKQuantityTypeIdentifierDietaryEnergyConsumed: ["kcal_cibo", "daily"],
  HKQuantityTypeIdentifierDietaryProtein: ["proteine", "daily"],
  HKQuantityTypeIdentifierDietaryCarbohydrates: ["carboidrati", "daily"],
  HKQuantityTypeIdentifierDietaryFatTotal: ["grassi", "daily"],
  HKQuantityTypeIdentifierDietaryWater: ["acqua", "daily"],
};
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis";
const STAGE = { AsleepCore: "core", AsleepDeep: "deep", AsleepREM: "rem", Awake: "awake", InBed: "inbed", AsleepUnspecified: "asleep", Asleep: "asleep" };

// Units are converted to the ones the shortcut stores: km (walk/bike), m (swim), kcal, kg, g, mL.
const KM = { km: 1, m: 0.001, mi: 1.609344, ft: 0.0003048, yd: 0.0009144 };
const UNIT = {
  dist_piedi: KM, dist_bici: KM,
  dist_nuoto: { m: 1, km: 1000, yd: 0.9144, mi: 1609.344, ft: 0.3048 },
  kcal_attive: { kcal: 1, Cal: 1, kJ: 1 / 4.184 }, kcal_riposo: { kcal: 1, Cal: 1, kJ: 1 / 4.184 }, kcal_cibo: { kcal: 1, Cal: 1, kJ: 1 / 4.184 },
  peso: { kg: 1, lb: 0.45359237, g: 0.001, st: 6.35029 }, massa_magra: { kg: 1, lb: 0.45359237, g: 0.001, st: 6.35029 },
  proteine: { g: 1, mg: 0.001 }, carboidrati: { g: 1, mg: 0.001 }, grassi: { g: 1, mg: 0.001 },
  acqua: { mL: 1, L: 1000, fl_oz_us: 29.5735, cup_us: 236.588 },
};

// "2026-10-10 07:00:00 +0200" → "2026-10-10T07:00:00+02:00"
const iso = (s) => s.slice(0, 10) + "T" + s.slice(11, 19) + s.slice(20, 23) + ":" + s.slice(23, 25);
function attr(s, name) {
  const i = s.indexOf(" " + name + '="');
  if (i < 0) return null;
  const a = i + name.length + 3;
  return s.slice(a, s.indexOf('"', a));
}

async function locate(file) {
  if (/\.xml$/i.test(file.name)) return { raw: file.stream(), method: 0, total: file.size, name: file.name };
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let e = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("Il file non è uno ZIP valido. Scegli esportazione.zip (o export.zip) creato dall'app Salute.");
  let count = tail.getUint16(e + 10, true), size = tail.getUint32(e + 12, true), off = tail.getUint32(e + 16, true);
  if ((off === 0xffffffff || count === 0xffff) && e >= 20 && tail.getUint32(e - 20, true) === 0x07064b50) {
    const z64 = Number(tail.getBigUint64(e - 12, true));
    const z = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
    count = Number(z.getBigUint64(32, true)); size = Number(z.getBigUint64(40, true)); off = Number(z.getBigUint64(48, true));
  }
  const cd = new DataView(await file.slice(off, off + size).arrayBuffer());
  const dec = new TextDecoder();
  let best = null;
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
    const method = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true), unc = cd.getUint32(p + 24, true), local = cd.getUint32(p + 42, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl));
    for (let q = p + 46 + nl; q + 4 <= p + 46 + nl + xl;) { // ZIP64 extra field
      const id = cd.getUint16(q, true), len = cd.getUint16(q + 2, true);
      if (id === 1) {
        let r = q + 4;
        if (unc === 0xffffffff) { unc = Number(cd.getBigUint64(r, true)); r += 8; }
        if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(r, true)); r += 8; }
        if (local === 0xffffffff) { local = Number(cd.getBigUint64(r, true)); }
      }
      q += 4 + len;
    }
    if (/\.xml$/i.test(name) && !/cda/i.test(name) && !/__MACOSX/.test(name) && (!best || unc > best.unc)) best = { name, method, comp, unc, local };
    p += 46 + nl + xl + cl;
  }
  if (!best) throw new Error("Nello ZIP non c'è il file dei dati di Salute (export.xml / esportazione.xml).");
  const lh = new DataView(await file.slice(best.local, best.local + 30).arrayBuffer());
  const start = best.local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  if (best.method === 8 && typeof DecompressionStream === "undefined") throw new Error("Questo browser non sa aprire gli ZIP: aggiorna iOS (16.4 o più recente) oppure estrai il file .xml e scegli quello.");
  if (best.method !== 0 && best.method !== 8) throw new Error("Compressione ZIP non supportata (" + best.method + ").");
  return { raw: file.slice(start, start + best.comp).stream(), method: best.method, total: best.comp, name: best.name };
}

self.onmessage = async (ev) => {
  const { file, since, fcSince } = ev.data;
  try {
    const src = await locate(file);
    // count compressed bytes for the progress bar
    let read = 0;
    const counter = new TransformStream({ transform(chunk, ctl) { read += chunk.byteLength; ctl.enqueue(chunk); } });
    let stream = src.raw.pipeThrough(counter);
    if (src.method === 8) stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
    const samples = {}, daily = {}, sleep = [];
    let records = 0, kept = 0, first = null, last = null, tick = 0;
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    const re = /<Record ([^>]+)>/g;
    const handle = (s) => {
      s = " " + s;
      records++;
      const type = attr(s, "type");
      const sd = attr(s, "startDate");
      if (!sd || sd < since) return;
      if (type === SLEEP) {
        const v = attr(s, "value") || "";
        const st = STAGE[v.replace("HKCategoryValueSleepAnalysis", "")] || "asleep";
        sleep.push([iso(sd), iso(attr(s, "endDate")), st, attr(s, "sourceName") || ""]);
        kept++; return;
      }
      const m = MAP[type];
      if (!m) return;
      const [key, kind] = m;
      if (key === "fc" && sd < fcSince) return;
      let v = Number(attr(s, "value"));
      if (!Number.isFinite(v)) return;
      const conv = UNIT[key];
      if (conv) { const f = conv[attr(s, "unit")]; if (f == null) return; v *= f; }
      if (kind === "pct" && v <= 1.5) v *= 100;
      const day = sd.slice(0, 10);
      if (!first || day < first) first = day;
      if (!last || day > last) last = day;
      kept++;
      if (kind === "daily") {
        const src = attr(s, "sourceName") || "?";
        const d = (daily[key] ||= {});
        const byDay = (d[day] ||= {});
        byDay[src] = (byDay[src] || 0) + v;
      } else {
        (samples[key] ||= new Map()).set(iso(sd), Math.round(v * 100) / 100);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const cut = buf.lastIndexOf(">");
      if (cut < 0) continue;
      const part = buf.slice(0, cut + 1);
      buf = buf.slice(cut + 1);
      re.lastIndex = 0;
      let mm;
      while ((mm = re.exec(part))) handle(mm[1]);
      if (++tick % 20 === 0) self.postMessage({ type: "progress", read, total: src.total, records, kept });
    }
    if (buf) { re.lastIndex = 0; let mm; while ((mm = re.exec(buf))) handle(mm[1]); }

    // sleep: on nights with real stages (Watch), drop generic "in bed"/"asleep" blocks from other sources
    const staged = new Set(sleep.filter((r) => r[2] === "core" || r[2] === "deep" || r[2] === "rem").map((r) => r[1].slice(0, 10)));
    const sleepOut = sleep.filter((r) => !(staged.has(r[1].slice(0, 10)) && (r[2] === "inbed" || r[2] === "asleep"))).map((r) => r.slice(0, 3));

    // daily totals: each source summed per day, then the largest source (iPhone and Watch count the same steps)
    const out = {};
    for (const [key, days] of Object.entries(daily)) {
      out[key] = Object.entries(days).map(([d, bySrc]) => [d + "T12:00:00", Math.round(Math.max(...Object.values(bySrc)) * 100) / 100]).filter((r) => r[1] > 0);
    }
    for (const [key, map] of Object.entries(samples)) out[key] = [...map.entries()];
    self.postMessage({ type: "done", data: out, sleep: sleepOut, records, first, last, file: src.name });
  } catch (e) {
    self.postMessage({ type: "error", message: e.message || String(e) });
  }
};
