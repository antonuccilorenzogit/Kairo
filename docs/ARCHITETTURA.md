# Architettura

## Componenti

| Componente | Dove | Ruolo |
|---|---|---|
| Comando **HealthSync** | iPhone | legge Apple Salute, crea un JSON, ne salva una copia in iCloud Drive (`Kairo/`) e lo invia a `POST /api/ingest` |
| **Worker** (`worker/src`) | Cloudflare | riceve i dati, li deduplica, calcola le metriche, parla con l'IA, serve l'app |
| **D1** | Cloudflare | database SQLite; schema creato automaticamente da `schema.js` |
| **Web app** (`worker/public`) | browser | PWA in JavaScript senza build; tiene codice e chiave Groq in `localStorage` |
| **Groq** / **Workers AI** | esterni | modelli linguistici per consiglio e chat |

## Sicurezza
- `POST /api/setup` imposta il codice di accesso solo se il server non ne ha già uno (inserimento atomico: chi arriva per primo vince); il server salva l'hash SHA-256. Codici nuovi: almeno 10 caratteri, niente sequenze banali.
- Tutte le altre chiamate richiedono `Authorization: Bearer <codice>`, tranne il link di collegamento. I confronti sono a tempo costante.
- **Blocco dei tentativi:** dopo 5 tentativi sbagliati in 15 minuti l'indirizzo IP è bloccato per 15 minuti (risposta 429 con `Retry-After`), poi 30, 60… fino a 24 ore. Durante il blocco anche il codice giusto viene rifiutato. Il link di collegamento ha un contatore separato, così un comando con un link vecchio non blocca l'app.
- **Link di collegamento**: `/api/sync/<token>` con un token casuale di 32 caratteri. Accetta solo l'invio dei dati (POST). Si rigenera da *Impostazioni*.
- **Validazione:** vengono salvate solo metriche conosciute, con data valida (dal 2000 a domani) e valori plausibili (es. HRV 1–400 ms, FC 20–250 bpm); il resto viene scartato e contato. Corpo massimo 20 MB, al massimo 60.000 valori per invio. Check-in: scale 1–5, RPE 1–10, attività da un elenco.
- Nessun header CORS (solo l'app sullo stesso dominio e l'app Comandi usano l'API); pagine con Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, nessun referrer.
- La chiave Groq viaggia nell'header `x-groq-key` e non viene salvata sul server. Gli errori interni non mostrano dettagli tecnici.

## Niente doppioni
- **Misure puntuali** (HRV, FC, peso…): chiave unica sull'istante (`metric` + secondi dall'epoca), quindi lo stesso valore inviato più volte, anche con un fuso orario diverso, resta una riga sola.
- **Totali giornalieri e orari** (passi, calorie…): Salute li manda già sommati; Kairo tiene il valore più alto visto per quel giorno, quindi più invii nella stessa giornata non si sommano.
- **Sonno:** le fasi di fonti diverse (Watch, iPhone, altre app) vengono fuse in un'unica linea temporale senza sovrapposizioni, dove vince la fase più informativa (profondo/REM/leggero > sonno generico > sveglio > a letto): ogni minuto conta una volta.
- **Ripristino** da backup: unisce i dati senza duplicare e senza sovrascrivere dati più recenti.

## Backup
- Ogni lunedì alle 03:17 UTC (cron) e prima di ogni cancellazione Kairo salva una copia compressa di tutti i dati nello spazio KV `BACKUP`; tiene le ultime 8.
- Da *Impostazioni → Backup* si crea un backup, si scarica (`.json.gz`) o si ripristina da un file (backup o esportazione JSON).
- In più D1 conserva da sé la cronologia del database (Time Travel) per gli ultimi giorni: `npx wrangler d1 time-travel restore kairo --timestamp=…`.

## API
| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/api/info` | versione e stato della configurazione (pubblico) |
| POST | `/api/setup` | crea il codice di accesso (pubblico, una volta) |
| POST | `/api/sync/<token>` | riceve un JSON di HealthSync (link di collegamento, senza codice) |
| GET/POST | `/api/collegamento` | legge / rigenera il link di collegamento |
| POST | `/api/ingest` | riceve un JSON (con codice; usato da *Importa da Salute*) |
| GET | `/api/day?d=AAAA-MM-GG` | metriche e score di un giorno |
| GET | `/api/history?days=N` | ultimi N giorni |
| GET | `/api/sonno?d=` | fasi della notte che termina il giorno `d` |
| GET | `/api/hrv-mensile` | media mensile dell'HRV (13 mesi) |
| GET/POST | `/api/checkin` | check-in del giorno |
| POST | `/api/coach/oggi` | consiglio del giorno (in cache per la giornata) |
| POST | `/api/coach/chat` | chat con il coach |
| POST | `/api/ai/test` · GET `/api/ai/modelli` | test e modelli IA |
| GET | `/api/diagnostica` | stato di server, dati, sincronizzazione e IA |
| GET | `/api/export` | esporta tutti i dati in JSON |
| POST | `/api/codice` | cambia il codice |
| DELETE | `/api/dati` | cancella tutti i dati (`{"conferma":"CANCELLA"}`), dopo un backup di sicurezza |
| GET/POST | `/api/backup` | elenco dei backup / crea un backup ora |
| GET | `/api/backup/file?chiave=` | scarica un backup (`.json.gz`) |
| POST | `/api/ripristina` | unisce i dati di un backup o di un'esportazione |
| GET | `/api/corpo` | misure corporee, VO₂max e FC per la pagina Corpo |

## Formato dei dati
HealthSync invia un oggetto piatto. Per ogni metrica `<chiave>`:
- `<chiave>_valori`: valori separati da `;`
- `<chiave>_date`: date ISO 8601 di inizio, separate da `;`
- `<chiave>_fine`: (solo sonno) date di fine

Più `modulo`, `versione`, `esportato`. Esempio:
```json
{"modulo":"HealthSync","versione":"1.0.0","esportato":"2026-10-11T07:42:00+02:00",
 "hrv_valori":"80.1;67.9","hrv_date":"2026-10-11T02:12:04+02:00;2026-10-11T07:03:42+02:00",
 "sonno_valori":"Principale;REM","sonno_date":"…","sonno_fine":"…"}
```
Le metriche giornaliere (`passi`, `kcal_attive`, …) arrivano già sommate per giorno; il server tiene il valore massimo visto per ogni giorno e ignora gli zeri con cui Comandi riempie i giorni senza dati.

## Metriche

Nessuna app (Whoop, Oura, Garmin, Bevel) pubblica la formula esatta dei suoi punteggi. Kairo usa i **metodi pubblicati** che queste app dichiarano di usare e le **soglie della letteratura**; i pesi sono di Kairo e sono tutti in `worker/src/metrics.js`.

- **Sessioni di sonno:** le fasi vengono raggruppate in sessioni (pausa > 2 h = nuova sessione) e assegnate al giorno del risveglio.
- **Punteggio del sonno** (contributi come Oura, 0–100 ciascuno):
  - durata 35%: 7–9 h raccomandate (AASM, Watson et al. 2015), pieno punteggio da 8 h, 0 sotto 4 h;
  - efficienza 20%: ≥ 85% buona qualità, ≤ 74% scarsa (National Sleep Foundation, Ohayon et al. 2017);
  - sonno profondo 10% (≥ 15% del sonno) e REM 10% (≥ 20%), riferimenti Oura;
  - regolarità 15%: Sleep Regularity Index (Phillips et al. 2017) sugli ultimi 7 giorni, scala tarata sulla popolazione UK Biobank (mediana 81, IQR 73,8–86,3; Windred et al. 2024); con meno di 2 coppie di notti consecutive si usa la costanza di orario di letto e risveglio;
  - orario 10%: punto medio del sonno tra 00:00 e 03:00 (Oura).
- **Valori notturni:** HRV, respirazione e SpO₂ misurate durante la sessione principale; senza sonno registrato, l'HRV usa le 24 ore precedenti a mezzogiorno.
- **Baseline:** media e deviazione standard dei 60 giorni precedenti (minimo 5 valori), come la "normal range" di HRV4Training.
- **Score di Recupero** (struttura della Readiness di Oura, fasce di Whoop): media pesata di contributi 0–100, dove 60 = "come al solito":
  - HRV 35%: logaritmo naturale (Plews et al.); 60% valore di stanotte, 40% media mobile a 7 giorni, con variazioni entro ±0,5 DS considerate trascurabili (smallest worthwhile change);
  - FC a riposo 20%: scostamento dalla media a lungo termine;
  - sonno della notte 25%: il punteggio del sonno;
  - bilancio di sonno 10%: media delle ultime 14 notti rispetto a 8 h (Oura "Sleep balance");
  - respirazione notturna 10%: penalizza solo l'aumento rispetto alla media (segnale usato da Whoop).
  
  Contributo = `60 + 20 × z` (limitato a 0–100). Se un dato manca, gli altri si ridistribuiscono il peso. Fasce: 67–100 verde, 34–66 giallo, 0–33 rosso (Whoop). È "provvisorio" finché la baseline ha meno di 14 giorni.
- **VO₂max:** classificazione con le tabelle della Cooper Institute (le stesse di Garmin). **Età del cuore:** l'età in cui il tuo VO₂max sarebbe al 50° percentile (media tra 40° e 60°), interpolata tra le decadi, minimo 20 anni, come la Fitness Age di Garmin.
- **Composizione corporea:** categorie di massa grassa dell'American Council on Exercise; BMI secondo l'OMS; FC a riposo secondo l'American Heart Association (60–100 normale, 40–60 sportivi).
