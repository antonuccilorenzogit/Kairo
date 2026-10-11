// User profile, stored on the server so every device (iPhone, PC) and the coach see the same data.

export const DEFAULT_SLEEP_NEED = 480; // minutes (centre of the AASM 7-9 h range)
export const SPORTS = ["palestra", "nuoto", "bici", "corsa"];

const str = (v, n) => (v == null ? "" : String(v).trim().slice(0, n));
const intIn = (v, lo, hi) => { const n = Number(v); return v === "" || v == null || !Number.isFinite(n) ? null : n >= lo && n <= hi ? Math.round(n) : undefined; };

export function cleanProfile(p) {
  const out = {
    nome: str(p?.nome, 40),
    eta: intIn(p?.eta, 12, 99),
    sesso: p?.sesso === "M" || p?.sesso === "F" ? p.sesso : "",
    obiettivi: str(p?.obiettivi, 500),
    note: str(p?.note, 1000),
    fc_max: intIn(p?.fc_max, 120, 230),                // measured maximum heart rate, if known
    sonno_min: intIn(p?.sonno_min, 360, 600) ?? null,  // personal sleep need
    sveglia: /^\d{2}:\d{2}$/.test(String(p?.sveglia || "")) ? p.sveglia : "",
    sport: Array.isArray(p?.sport) ? [...new Set(p.sport.filter((x) => SPORTS.includes(x)))] : ["palestra", "nuoto", "bici", "corsa"],
    tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(String(p?.tz || "")) ? p.tz : "Europe/Rome",
  };
  const bad = Object.entries(out).filter(([, v]) => v === undefined).map(([k]) => k);
  return bad.length ? { errore: `Valori non validi: ${bad.join(", ")}` } : out;
}

export async function getProfile(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'profilo'").first();
  try { return { ...cleanProfile({}), ...(r ? JSON.parse(r.value) : {}) }; } catch { return cleanProfile({}); }
}

export async function saveProfile(db, p) {
  const clean = cleanProfile(p);
  if (clean.errore) return clean;
  await db.prepare("INSERT INTO settings(key,value) VALUES('profilo',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(clean)).run();
  return clean;
}

// Maximum heart rate: measured value if given, otherwise Tanaka et al. 2001 (208 − 0.7 × age), otherwise 190.
export const hrMax = (p) => p.fc_max || (p.eta ? Math.round(208 - 0.7 * p.eta) : 190);

export function profileText(p) {
  return [
    p.nome ? `Si chiama ${p.nome}.` : "",
    p.eta ? `Ha ${p.eta} anni.` : "",
    p.sesso ? (p.sesso === "F" ? "È una donna." : "È un uomo.") : "",
    p.note ? `Di sé dice: ${p.note}` : "",
    p.obiettivi ? `I suoi obiettivi: ${p.obiettivi}` : "Non ha ancora indicato i suoi obiettivi.",
    p.sport && p.sport.length ? `Sport che pratica: ${p.sport.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}
