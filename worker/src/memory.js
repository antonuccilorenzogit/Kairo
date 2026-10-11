// Coach memory: short durable facts about the person ("gara di 10 km il 2026-11-15", "spalla destra delicata").
// The coach adds them during the chat with [[RICORDA: …]] / [[DIMENTICA: …]] tags (removed from the reply);
// the person can view, add and delete them in Settings. Every coach prompt receives the list.

export const MAX_ITEMS = 60;
export const MAX_LEN = 240;

const clean = (s) => String(s ?? "").replace(/[\u0000-\u001f\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

export async function listMemory(db) {
  return (await db.prepare("SELECT id, testo, fonte, creato FROM memoria ORDER BY id").all()).results;
}

// Adds a fact (ignored if identical to an existing one). When full, the oldest facts written
// by the coach go first; the ones the person wrote are kept.
export async function addMemory(db, testo, fonte = "coach") {
  const t = clean(testo);
  if (t.length < 3) return { errore: "Testo troppo corto" };
  const r = await db.prepare("INSERT INTO memoria(testo,fonte,creato) VALUES(?,?,?) ON CONFLICT(testo) DO NOTHING")
    .bind(t, fonte === "utente" ? "utente" : "coach", new Date().toISOString().slice(0, 10)).run();
  const n = (await db.prepare("SELECT count(*) n FROM memoria").first()).n;
  if (n > MAX_ITEMS) {
    await db.prepare("DELETE FROM memoria WHERE id IN (SELECT id FROM memoria ORDER BY fonte = 'utente', id LIMIT ?)").bind(n - MAX_ITEMS).run();
  }
  return { ok: true, aggiunto: (r.meta?.changes ?? 1) > 0, testo: t };
}

export async function deleteMemory(db, id) {
  if (id === "tutto") { await db.prepare("DELETE FROM memoria").run(); return { ok: true }; }
  if (!Number.isInteger(Number(id))) return { errore: "id non valido" };
  await db.prepare("DELETE FROM memoria WHERE id = ?").bind(Number(id)).run();
  return { ok: true };
}

// Removes the facts that contain every keyword given by the coach (at most 3 at a time, as a safety net).
async function forget(db, keywords) {
  const words = clean(keywords).toLowerCase().split(" ").filter((w) => w.length >= 3).slice(0, 6);
  if (!words.length) return [];
  const items = await listMemory(db);
  const hit = items.filter((m) => words.every((w) => m.testo.toLowerCase().includes(w))).slice(0, 3);
  for (const m of hit) await db.prepare("DELETE FROM memoria WHERE id = ?").bind(m.id).run();
  return hit.map((m) => m.testo);
}

const TAG = /\[\[\s*(RICORDA|DIMENTICA)\s*:\s*([\s\S]*?)\]\]/gi;

// Splits the coach's reply into the visible text and the memory instructions.
export function extractTags(text) {
  const ricorda = [], dimentica = [];
  const testo = String(text || "").replace(TAG, (_, kind, body) => {
    (kind.toUpperCase() === "RICORDA" ? ricorda : dimentica).push(clean(body));
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { testo, ricorda: ricorda.filter(Boolean).slice(0, 3), dimentica: dimentica.filter(Boolean).slice(0, 3) };
}

// Applies the tags of a reply; returns the visible text and what changed.
export async function applyTags(db, text) {
  const t = extractTags(text);
  const dimenticati = [];
  for (const k of t.dimentica) dimenticati.push(...(await forget(db, k)));
  const ricordati = [];
  for (const r of t.ricorda) { const x = await addMemory(db, r, "coach"); if (x.aggiunto) ricordati.push(x.testo); }
  return { testo: t.testo, ricordati, dimenticati };
}

// Block for the system prompt.
export function memoryText(items) {
  if (!items.length) return "";
  return "\n\nCOSA SAI DI LUI (memoria delle conversazioni passate, data in cui l'hai saputo)\n" +
    items.map((m) => `- [${m.creato}] ${m.testo}`).join("\n");
}

export const MEMORY_RULES = `

MEMORIA
Hai una memoria che dura tra una conversazione e l'altra. Quando la persona ti dice qualcosa di utile anche in futuro (obiettivi, gare o eventi con data, dolori o infortuni, preferenze di allenamento, orari, attrezzatura, come ha reagito a un allenamento, impegni che cambiano la settimana), aggiungi IN FONDO alla risposta una riga così:
[[RICORDA: frase breve e autonoma, in terza persona]]
- Trasforma le date relative in date vere (oggi è {OGGI}): «tra 3 settimane» → la data.
- Non salvare cose già presenti in COSA SAI DI LUI, numeri che Kairo misura già (HRV, sonno, carico) o chiacchiere passeggere.
- Se una cosa in memoria non è più vera (dolore passato, obiettivo cambiato, gara già fatta), aggiungi [[DIMENTICA: parole chiave del ricordo]] e, se serve, il nuovo [[RICORDA: …]].
- Massimo 2 tag per risposta. Non scrivere i tag in nessun altro punto e non spiegarli; puoi dire in modo naturale che te lo segni.
- Usa quello che ricordi quando è pertinente (es. «mancano 2 settimane alla gara»), senza ripeterlo ogni volta.`;
