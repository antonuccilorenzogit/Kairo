// Database schema. Applied automatically on the first request (idempotent),
// so a fresh deployment needs no manual migration step.
export const SCHEMA_VERSION = 5;

export const SCHEMA = [
  // Point samples (HRV, resting HR, SpO2, respiration, weight, heart rate…).
  // `t` is the instant in epoch seconds: the same measurement sent twice, even with a
  // different time-zone offset, maps to the same row (unique index on metric + t).
  `CREATE TABLE IF NOT EXISTS samples (
     metric TEXT NOT NULL, ts TEXT NOT NULL, value REAL NOT NULL, t INTEGER,
     PRIMARY KEY (metric, ts))`,
  `CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts)`,
  // Daily totals (steps, calories, distances, nutrition): one row per metric and day
  `CREATE TABLE IF NOT EXISTS daily (
     metric TEXT NOT NULL, day TEXT NOT NULL, value REAL NOT NULL,
     PRIMARY KEY (metric, day))`,
  // Hourly totals (active calories per hour)
  `CREATE TABLE IF NOT EXISTS hourly (
     metric TEXT NOT NULL, hour TEXT NOT NULL, value REAL NOT NULL,
     PRIMARY KEY (metric, hour))`,
  // Sleep stages. Overlaps between sources (Watch, iPhone, other apps) are resolved when
  // the night is computed, so every minute is counted once.
  `CREATE TABLE IF NOT EXISTS sleep (
     start TEXT NOT NULL, end TEXT NOT NULL, stage TEXT NOT NULL,
     PRIMARY KEY (start, end, stage))`,
  `CREATE INDEX IF NOT EXISTS idx_sleep_end ON sleep(end)`,
  `CREATE INDEX IF NOT EXISTS idx_sleep_start ON sleep(start)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_day ON daily(day)`,
  // Daily check-in
  `CREATE TABLE IF NOT EXISTS checkin (
     day TEXT PRIMARY KEY, energia INTEGER, dolori INTEGER, umore INTEGER,
     attivita TEXT, rpe INTEGER, durata_min INTEGER, note TEXT, updated TEXT, sonno_min INTEGER, tag TEXT)`,
  // Import log
  `CREATE TABLE IF NOT EXISTS imports (
     id INTEGER PRIMARY KEY AUTOINCREMENT, received TEXT NOT NULL,
     modulo TEXT, esportato TEXT, righe INTEGER, versione TEXT)`,
  // Daily coach advice cache
  `CREATE TABLE IF NOT EXISTS advice (
     day TEXT PRIMARY KEY, text TEXT NOT NULL, provider TEXT, model TEXT, created TEXT)`,
  // Key/value settings (access-code hash, sync token, AI usage counters, schema version)
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  // Coach conversation (shared by all your devices)
  `CREATE TABLE IF NOT EXISTS chat (
     id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT, created TEXT NOT NULL)`,
  // Strength training sets (imported from Hevy or logged in Kairo)
  `CREATE TABLE IF NOT EXISTS sets (
     start TEXT NOT NULL, exercise TEXT NOT NULL, set_index INTEGER NOT NULL,
     set_type TEXT, weight REAL, reps INTEGER, rpe REAL, workout TEXT, end TEXT, fonte TEXT,
     PRIMARY KEY (start, exercise, set_index))`,
  // Gym routines ("schede"): exercises with sets and a rep range, as JSON
  `CREATE TABLE IF NOT EXISTS schede (
     id TEXT PRIMARY KEY, nome TEXT NOT NULL, ordine INTEGER NOT NULL, esercizi TEXT NOT NULL, updated TEXT NOT NULL)`,
  // Training sessions detected from heart rate (≥ 10 min above 60% of max HR)
  `CREATE TABLE IF NOT EXISTS sessioni (
     start TEXT PRIMARY KEY, day TEXT NOT NULL, end TEXT NOT NULL, minuti INTEGER NOT NULL, fc_media REAL, trimp INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_sessioni_day ON sessioni(day)`,
  // Outcome of the day's workout ("fatto", "altro", "saltato")
  `CREATE TABLE IF NOT EXISTS esiti (day TEXT PRIMARY KEY, stato TEXT NOT NULL, sport TEXT, created TEXT NOT NULL)`,
  // Coach memory: durable facts about the person (goals, races, injuries, preferences)
  `CREATE TABLE IF NOT EXISTS memoria (
     id INTEGER PRIMARY KEY AUTOINCREMENT, testo TEXT NOT NULL UNIQUE, fonte TEXT NOT NULL, creato TEXT NOT NULL)`,
  // Web-push subscriptions (one per device that enabled notifications)
  `CREATE TABLE IF NOT EXISTS push_subs (
     endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL)`,
  // Failed access attempts per client, for the temporary lock-out
  `CREATE TABLE IF NOT EXISTS auth_fail (
     ip TEXT PRIMARY KEY, n INTEGER NOT NULL, first INTEGER NOT NULL,
     locked_until INTEGER NOT NULL DEFAULT 0, locks INTEGER NOT NULL DEFAULT 0)`,
];

// Upgrades for databases created by older versions. Each step is safe to run again.
const MIGRATIONS = {
  // v1 -> v2: instant key for samples (dedupe), sleep key on the whole interval
  2: [
    "ALTER TABLE samples ADD COLUMN t INTEGER",
    "UPDATE samples SET t = CAST(strftime('%s', ts) AS INTEGER) WHERE t IS NULL",
    "DELETE FROM samples WHERE t IS NOT NULL AND rowid NOT IN (SELECT max(rowid) FROM samples WHERE t IS NOT NULL GROUP BY metric, t)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_samples_metric_t ON samples(metric, t)",
    `CREATE TABLE IF NOT EXISTS sleep_v2 (start TEXT NOT NULL, end TEXT NOT NULL, stage TEXT NOT NULL, PRIMARY KEY (start, end, stage))`,
    "INSERT OR IGNORE INTO sleep_v2(start, end, stage) SELECT start, end, stage FROM sleep",
    "DROP TABLE sleep",
    "ALTER TABLE sleep_v2 RENAME TO sleep",
    "CREATE INDEX IF NOT EXISTS idx_sleep_end ON sleep(end)",
  ],
  // v2 -> v3: hours slept declared in the check-in (nights without the Watch)
  3: ["ALTER TABLE checkin ADD COLUMN sonno_min INTEGER"],
  // v4 -> v5: tags of the check-in (alcohol, illness, travel…), they explain the score and leave the baseline
  5: ["ALTER TABLE checkin ADD COLUMN tag TEXT"],
};

const ready = new WeakSet();
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  try { await db.prepare("ALTER TABLE imports ADD COLUMN versione TEXT").run(); } catch (_) {}
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").first();
  const current = Number(row?.value || 1);
  // a brand-new database already has the latest tables: only old ones need migrating
  const isNew = !row;
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    if (isNew) break;
    for (const sql of MIGRATIONS[v] || []) {
      try { await db.prepare(sql).run(); } catch (e) {
        // "duplicate column" / "no such table" mean the step was already applied
        if (!/duplicate column|no such table|already exists/i.test(String(e.message))) throw e;
      }
    }
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ux_samples_metric_t ON samples(metric, t)").run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(String(SCHEMA_VERSION)).run();
  ready.add(db);
}
