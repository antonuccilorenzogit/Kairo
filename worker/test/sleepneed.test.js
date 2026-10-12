import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateSleepNeed, NEED_MIN_NIGHTS } from "../src/sleepneed.js";

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

// n nights: sleep between 6 h and 9 h; the morning gets better up to `need`, then stops
function nights(n, need, { seed = 1, wake = "07:00", noise = 0.35, naps = {} } = {}) {
  const r = rng(seed), days = [];
  for (let i = 0; i < n; i++) {
    const x = 360 + Math.round(r() * 180);
    const y = (Math.min(x, need) - need) / 60 + noise * gauss(r);
    const e = Math.round(Math.min(5, Math.max(1, 3.5 + y + 0.5 * gauss(r))));
    days.push({ sonno: { durata_min: x, fine: `2026-09-01T${wake}:00+02:00` }, pisolini: naps[i] ? { totale_min: naps[i] } : null,
      checkin: { energia: e }, recupero: { componenti: { hrv: { z: y } } } });
  }
  return days;
}

test("trova il punto oltre cui dormire di più non serve (7 h 30 e 8 h 30)", () => {
  for (const need of [450, 510]) {
    const found = [];
    for (let seed = 1; seed <= 6; seed++) {
      const e = estimateSleepNeed(nights(60, need, { seed }), [], {});
      if (e.min == null) continue; // not sure enough: it says so instead of guessing
      assert.equal(e.fonte, "imparato");
      // the error stays within the uncertainty it declares (± shown in the app), plus one rounding step
      assert.ok(Math.abs(e.min - need) <= e.margine + 20, `bisogno ${need}, stimato ${e.min} ± ${e.margine}`);
      found.push(Math.abs(e.min - need));
    }
    assert.ok(found.length >= 3, `stima trovata ${found.length} volte su 6`);
    found.sort((a, b) => a - b);
    assert.ok(found[found.length >> 1] <= 15, `errore tipico ${found[found.length >> 1]} min`);
  }
});

test("pochi dati: niente numeri inventati, riferimento di 8 ore e quante notti mancano", () => {
  const e = estimateSleepNeed(nights(12, 450), [], {});
  assert.equal(e.min, null); assert.equal(e.fonte, "predefinito");
  assert.equal(e.mancano, NEED_MIN_NIGHTS - 12);
});

test("se dormire di più non cambia niente, non si inventa un fabbisogno", () => {
  const r = rng(9);
  const days = Array.from({ length: 60 }, () => ({ sonno: { durata_min: 360 + Math.round(r() * 180) }, checkin: { energia: 3 }, recupero: { componenti: { hrv: { z: gauss(r) } } } }));
  assert.equal(estimateSleepNeed(days, [], {}).min, null);
});

test("il pisolino del giorno prima conta nel sonno di quella notte", () => {
  // short nights after a nap: without counting it they would look 'short but enough'
  const days = nights(60, 450, { seed: 5 });
  const withNaps = days.map((d, i) => (i > 0 && i % 4 === 0 ? { ...d, sonno: { ...d.sonno, durata_min: d.sonno.durata_min - 60 } } : d));
  for (let i = 0; i < 60; i++) if (i % 4 === 3) withNaps[i] = { ...withNaps[i], pisolini: { totale_min: 60 } };
  const e = estimateSleepNeed(withNaps, [], {});
  assert.ok(e.min == null || Math.abs(e.min - 450) <= 20, `stimato ${e.min}`);
  // without the nap the same nights would push the estimate down
  const noNap = withNaps.map((d) => ({ ...d, pisolini: null }));
  const e2 = estimateSleepNeed(noNap, [], {});
  assert.ok(e2.min == null || e.min == null || e2.min <= e.min);
});

test("le notti con alcol, malanno o viaggio e quelle segnate a mano restano fuori", () => {
  const days = nights(60, 450, { seed: 7 });
  days[10] = { ...days[10], checkin: { energia: 1, tag: "alcol" } };
  days[11] = { ...days[11], sonno: { durata_min: 300, manuale: true } };
  assert.equal(estimateSleepNeed(days, [], {}).notti, 58);
});

test("risvegli senza sveglia e senza debito: dormi quello che ti serve", () => {
  // no next-morning signal at all: only the nights you woke up on your own count
  const days = Array.from({ length: 40 }, (_, i) => {
    const free = i % 5 === 4;
    return { sonno: { durata_min: free ? 470 + (i % 3) * 5 : 440, fine: `2026-09-01T${free ? "09:10" : "07:00"}:00+02:00` }, checkin: null, recupero: null };
  });
  const e = estimateSleepNeed(days, [], { sveglia: "07:00" });
  assert.equal(e.fonte, "imparato");
  assert.ok(Math.abs(e.min - 475) <= 10, `stimato ${e.min}`);
  assert.deepEqual(e.metodi, ["i risvegli senza sveglia"]);
});

test("stessi dati, stessa stima", () => {
  const d = nights(50, 480, { seed: 11 });
  assert.deepEqual(estimateSleepNeed(d, [], {}), estimateSleepNeed(d, [], {}));
});
