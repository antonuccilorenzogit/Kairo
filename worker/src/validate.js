// Validation of incoming data: only known metrics, valid timestamps and plausible values are stored.
// Anything else is discarded and counted, so a malformed request can never corrupt the database.

// [kind, min, max] — units as sent by HealthSync (km for walk/bike distance, m for swimming)
export const METRICS = {
  hrv: ["sample", 1, 400], fcr: ["sample", 20, 200], fc: ["sample", 20, 250], fc_camminata: ["sample", 30, 220],
  resp: ["sample", 3, 60], spo2: ["pct", 50, 100], vo2max: ["sample", 5, 95],
  peso: ["sample", 20, 350], grasso_pct: ["pct", 1, 75], massa_magra: ["sample", 10, 200], bmi: ["sample", 8, 80],
  passi: ["daily", 0, 150000], kcal_attive: ["daily", 0, 15000], kcal_riposo: ["daily", 0, 10000],
  dist_piedi: ["daily", 0, 300], piani: ["daily", 0, 1000], dist_bici: ["daily", 0, 1000],
  dist_nuoto: ["daily", 0, 50000], bracciate: ["daily", 0, 100000],
  kcal_cibo: ["daily", 0, 20000], proteine: ["daily", 0, 1000], carboidrati: ["daily", 0, 2000],
  grassi: ["daily", 0, 1000], acqua: ["daily", 0, 20000],
  trimp: ["daily", 0, 3000], // training load already computed (history imported from Health)
  kcal_ora: ["hourly", 0, 5000],
  sonno: ["sleep"],
};
export const MAX_ROWS_PER_REQUEST = 60000;
export const MAX_BODY_BYTES = 20 * 1024 * 1024;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const MIN_MS = Date.parse("2000-01-01T00:00:00Z");

// Returns the epoch milliseconds of a valid timestamp, or null.
export function parseTs(ts) {
  if (typeof ts !== "string" || !ISO.test(ts)) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > Date.now() + 2 * 86400e3) return null;
  return ms;
}

// Sleep stage names arrive in the phone's language (or as Health identifiers): map them to stable codes.
export function stageCode(s) {
  const t = String(s || "").toLowerCase().trim();
  if (t.includes("profond") || t.includes("deep") || t.includes("tief") || t.includes("profund")) return "deep";
  if (t.includes("rem")) return "rem";
  if (t.includes("principal") || t.includes("core") || t.includes("leggero") || t.includes("kern") || t.includes("básico") || t.includes("basico")) return "core";
  if (t.includes("veglia") || t.includes("sveglio") || t.includes("awake") || t.includes("wach") || t.includes("despierto")) return "awake";
  if (t.includes("letto") || t.includes("bed") || t.includes("bett") || t.includes("cama")) return "inbed";
  return "asleep";
}

const split = (s) => (s == null ? [] : String(s).split(";").map((x) => x.trim()).filter((x) => x !== ""));
const num = (s) => Number(String(s).replace(",", "."));

// Turns a HealthSync payload into clean rows. Returns { samples, daily, hourly, sleep, discarded }.
export function parsePayload(payload) {
  const out = { samples: [], daily: [], hourly: [], sleep: [], discarded: 0, unknown: [] };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return out;
  const keys = Object.keys(payload).filter((k) => k.endsWith("_valori")).map((k) => k.slice(0, -7));
  let rows = 0;
  for (const key of keys) {
    const spec = METRICS[key];
    const vals = split(payload[`${key}_valori`]), dates = split(payload[`${key}_date`]), ends = split(payload[`${key}_fine`]);
    if (!spec) { out.unknown.push(key.slice(0, 40)); out.discarded += vals.length; continue; }
    const n = Math.min(vals.length, dates.length);
    out.discarded += Math.max(vals.length, dates.length) - n;
    for (let i = 0; i < n; i++) {
      if (++rows > MAX_ROWS_PER_REQUEST) { out.discarded++; continue; }
      const ts = dates[i], ms = parseTs(ts);
      if (ms == null) { out.discarded++; continue; }
      if (spec[0] === "sleep") {
        const endMs = parseTs(ends[i]);
        // a valid stage lasts more than 0 and at most 24 hours
        if (endMs == null || endMs <= ms || endMs - ms > 86400e3) { out.discarded++; continue; }
        out.sleep.push([ts, ends[i], stageCode(vals[i])]);
        continue;
      }
      let v = num(vals[i]);
      if (!Number.isFinite(v)) { out.discarded++; continue; }
      if (spec[0] === "pct" && v > 0 && v <= 1) v *= 100; // Health sometimes reports percentages as fractions
      const [kind, lo, hi] = spec;
      if (kind === "daily" && v === 0) { out.discarded++; continue; } // Shortcuts fills days without data with 0
      if (v < lo || v > hi) { out.discarded++; continue; }
      if (kind === "daily") out.daily.push([key, ts.slice(0, 10), v]);
      else if (kind === "hourly") out.hourly.push([key, ts.slice(0, 13), v]);
      else out.samples.push([key, ts, Math.floor(ms / 1000), v]);
    }
  }
  return out;
}

// Check-in: every field is optional, but when present it must be in range.
const ACTIVITIES = new Set(["palestra", "nuoto", "bici", "calcio", "corsa", "camminata", "altro", "riposo"]);
export function cleanCheckin(c, fallbackDay) {
  const int = (v, lo, hi) => (v == null || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : undefined);
  const day = c && typeof c.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.day) ? c.day : fallbackDay;
  const out = {
    day,
    energia: int(c?.energia, 1, 5), dolori: int(c?.dolori, 1, 5), umore: int(c?.umore, 1, 5),
    rpe: int(c?.rpe, 1, 10), durata_min: int(c?.durata_min, 0, 900), sonno_min: int(c?.sonno_min, 60, 900),
    attivita: c?.attivita == null ? null : String(c.attivita).split(",").map((x) => x.trim()).filter((x) => ACTIVITIES.has(x)).join(",") || null,
    note: c?.note == null ? null : String(c.note).slice(0, 1000),
  };
  const bad = Object.entries(out).filter(([, v]) => v === undefined).map(([k]) => k);
  return bad.length ? { errore: `Valori non validi: ${bad.join(", ")}` } : out;
}
