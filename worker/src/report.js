// Weekly report: the last 7 complete days compared with the 7 before.
import { computeHistory } from "./metrics.js";

const avg = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const sum = (a) => a.filter((x) => x != null).reduce((s, x) => s + x, 0);
const r0 = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export async function weeklyReport(db, lastDay) {
  const h = await computeHistory(db, lastDay, 14);
  const cur = h.slice(7), prev = h.slice(0, 7);
  const part = (w) => ({
    carico: sum(w.map((d) => d.carico?.oggi)),
    giorni_allenamento: w.filter((d) => (d.carico?.oggi || 0) >= 40).length,
    recupero: r0(avg(w.map((d) => d.recupero.score))),
    sonno_min: r0(avg(w.map((d) => d.sonno?.durata_min))), notti: w.filter((d) => d.sonno).length,
    hrv: r0(avg(w.map((d) => d.notte.hrv_ms)), 1), fcr: r0(avg(w.map((d) => d.notte.fcr_bpm)), 1),
  });
  const last = h[h.length - 1];
  const vo2 = await db.prepare("SELECT value v, ts FROM samples WHERE metric='vo2max' AND ts <= ? ORDER BY ts DESC LIMIT 1").bind(lastDay + "T23:59").first();
  const vo2old = await db.prepare("SELECT value v FROM samples WHERE metric='vo2max' AND ts <= ? ORDER BY ts DESC LIMIT 1").bind(new Date(Date.parse(lastDay + "T12:00:00Z") - 28 * 86400e3).toISOString().slice(0, 10)).first();
  return {
    da: cur[0].giorno, a: last.giorno,
    settimana: part(cur), precedente: part(prev),
    stato_carico: last.carico?.stato || "calibrazione", rapporto: last.carico?.rapporto ?? null,
    hrv_media_personale: last.recupero.componenti.hrv.baseline, fcr_media_personale: last.recupero.componenti.fc_riposo.baseline,
    vo2max: vo2 ? { valore: r0(vo2.v, 1), quattro_settimane_fa: vo2old ? r0(vo2old.v, 1) : null } : null,
    giorni: cur.map((d) => ({ giorno: d.giorno, carico: d.carico?.oggi ?? null, recupero: d.recupero.score, sonno_min: d.sonno?.durata_min ?? null })),
  };
}
