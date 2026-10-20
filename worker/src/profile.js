// User profile, stored on the server so every device (iPhone, PC) and the coach see the same data.

export const DEFAULT_SLEEP_NEED = 480; // minutes (centre of the AASM 7-9 h range)
export const SPORTS = ["palestra", "nuoto", "bici", "corsa"];       // Kairo plans these
// sports Kairo does not plan (matches, team training) but counts: load from heart rate, check-in, coach
export const ALTRI_SPORT = ["calcio", "padel", "tennis", "basket", "pallavolo", "arrampicata", "sci", "arti marziali"];

const str = (v, n) => (v == null ? "" : String(v).trim().slice(0, n));
const intIn = (v, lo, hi) => { const n = Number(v); return v === "" || v == null || !Number.isFinite(n) ? null : n >= lo && n <= hi ? Math.round(n) : undefined; };

// Injury mode: while active the daily workout becomes rest / rehab / training for the healthy parts.
export function cleanInjury(i) {
  const dal = /^\d{4}-\d{2}-\d{2}$/.test(String(i?.dal || "")) && Date.parse(i.dal) <= Date.now() + 86400e3 ? i.dal : "";
  return { attivo: i?.attivo === true, descrizione: str(i?.descrizione, 1000), dal, prescrizioni: cleanRx(i?.prescrizioni) };
}

// Doctor's / physio's prescriptions. null = not set: Kairo then reads them from the description.
export function cleanRx(r) {
  const bool = (v) => (v === true || v === false ? v : null);
  const g = Number(r?.gradi);
  return {
    no_carico: bool(r?.no_carico),                                         // no weight on the injured limb
    fino: /^\d{4}-\d{2}-\d{2}$/.test(String(r?.fino || "")) ? r.fino : "", // until when (as prescribed)
    stampelle: bool(r?.stampelle),
    gradi: r?.gradi === "" || r?.gradi == null || !Number.isFinite(g) ? null : Math.max(0, Math.min(180, Math.round(g))), // max range of motion
    altre: str(r?.altre, 500),
  };
}

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
    // smallest weight jump in your gym (lightest plates ×2 on a bar, or the step of the machines): loads are multiples of it
    incremento: [0.5, 1, 1.25, 2, 2.5, 5].includes(Number(p?.incremento)) ? Number(p.incremento) : 1.25,
    sport: Array.isArray(p?.sport) ? [...new Set(p.sport.filter((x) => SPORTS.includes(x)))] : ["palestra", "nuoto", "bici", "corsa"],
    altri_sport: Array.isArray(p?.altri_sport) ? [...new Set(p.altri_sport.filter((x) => ALTRI_SPORT.includes(x)))] : [],
    infortunio: cleanInjury(p?.infortunio),
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
    p.altri_sport && p.altri_sport.length ? `Pratica anche (partite o allenamenti che Kairo non pianifica, ma di cui tiene conto nel carico): ${p.altri_sport.join(", ")}.` : "",
    p.infortunio?.attivo ? `\nÈ INFORTUNATO${p.infortunio.dal ? ` dal ${p.infortunio.dal}` : ""}: ${p.infortunio.descrizione || "non ha descritto l'infortunio"}.
È in MODALITÀ INFORTUNIO: niente allenamenti normali (ignora l'allenamento consigliato calcolato da carico e recupero). Consiglia solo riposo, esercizi riabilitativi dolci o esercizi per le parti del corpo non coinvolte, con dolore massimo 3/10. Non fare diagnosi; se il dolore è forte, peggiora o ci sono gonfiore, formicolio o perdita di forza, consiglia un medico o un fisioterapista.` : "",
  ].filter(Boolean).join("\n");
}
