// Database schema. Applied automatically on the first request (idempotent),
// so a fresh deployment needs no manual migration step.
export const SCHEMA_VERSION = 1;

export const SCHEMA = [
  // Point samples (HRV, resting HR, SpO2, respiration, weight, heart rate…)
  `CREATE TABLE IF NOT EXISTS samples (
     metric TEXT NOT NULL, ts TEXT NOT NULL, value REAL NOT NULL,
     PRIMARY KEY (metric, ts))`,
  `CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts)`,
  // Daily totals (steps, calories, distances, nutrition)
  `CREATE TABLE IF NOT EXISTS daily (
     metric TEXT NOT NULL, day TEXT NOT NULL, value REAL NOT NULL,
     PRIMARY KEY (metric, day))`,
  // Hourly totals (active calories per hour)
  `CREATE TABLE IF NOT EXISTS hourly (
     metric TEXT NOT NULL, hour TEXT NOT NULL, value REAL NOT NULL,
     PRIMARY KEY (metric, hour))`,
  // Sleep stages
  `CREATE TABLE IF NOT EXISTS sleep (
     start TEXT PRIMARY KEY, end TEXT NOT NULL, stage TEXT NOT NULL)`,
  // Daily check-in
  `CREATE TABLE IF NOT EXISTS checkin (
     day TEXT PRIMARY KEY, energia INTEGER, dolori INTEGER, umore INTEGER,
     attivita TEXT, rpe INTEGER, durata_min INTEGER, note TEXT, updated TEXT)`,
  // Import log
  `CREATE TABLE IF NOT EXISTS imports (
     id INTEGER PRIMARY KEY AUTOINCREMENT, received TEXT NOT NULL,
     modulo TEXT, esportato TEXT, righe INTEGER, versione TEXT)`,
  // Daily coach advice cache
  `CREATE TABLE IF NOT EXISTS advice (
     day TEXT PRIMARY KEY, text TEXT NOT NULL, provider TEXT, model TEXT, created TEXT)`,
  // Key/value settings (access-code hash, AI usage counters, schema version)
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
];

let ensured = false;
export async function ensureSchema(db) {
  if (ensured) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  // columns added after the first release (ignore "duplicate column" errors)
  try { await db.prepare("ALTER TABLE imports ADD COLUMN versione TEXT").run(); } catch (_) {}
  await db.prepare("INSERT INTO settings(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(String(SCHEMA_VERSION)).run();
  ensured = true;
}
