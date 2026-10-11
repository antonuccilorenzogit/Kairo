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

## Modalità infortunio
- Nel profilo: `infortunio = {attivo, descrizione, dal}`; il dolore di ogni giorno (0–10) in `settings.infortunio_dolore` (ultimi 60 giorni). `POST /api/infortunio` lo attiva/modifica/disattiva senza toccare il resto del profilo.
- `POST /api/allenamento/oggi` con l'infortunio attivo restituisce `{infortunio:true, modalita, titolo, struttura, perche, attenzione, dolore, giorni, area}` invece della seduta; `{"dolore":N}` registra il dolore di oggi e rigenera il piano.
- Limite di sicurezza (`allowedMode`): riposo se dolore ≥ 7/10 o nei primi 3 giorni (PEACE & LOVE, Dubois & Esculier 2020); resto del corpo con dolore 4–6 o non indicato; riabilitazione con dolore ≤ 3 (pain-monitoring model, Silbernagel 2007). L'IA sceglie entro il limite (riposo < resto del corpo < riabilitazione), altrimenti valgono le sedute di regola per zona (gambe, braccia/spalle, schiena), ricavata dalla descrizione.
- Il testo dell'infortunio e l'andamento del dolore entrano in ogni prompt del coach.

## Memoria del coach
- Tabella `memoria` (testo unico, fonte `coach` o `utente`, data). Al massimo 60 ricordi: quando è piena escono prima i più vecchi scritti dal coach, mai quelli aggiunti a mano.
- In chat il modello può chiudere la risposta con `[[RICORDA: …]]` o `[[DIMENTICA: parole chiave]]` (massimo 2-3 per risposta). Il server applica i tag e li toglie dal testo; `DIMENTICA` cancella al massimo 3 ricordi che contengono tutte le parole chiave.
- L'elenco dei ricordi entra nel prompt di ogni funzione del coach (chat, messaggio del mattino, resoconto settimanale, allenamento del giorno) dopo il profilo. È incluso in backup ed esportazione.

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
| GET/POST | `/api/profilo` | profilo (età, sesso, obiettivi, FC max, sveglia, sonno necessario, fuso) |
| GET/DELETE | `/api/chat` | conversazione con il coach (salvata sul server) |
| POST | `/api/infortunio` | modalità infortunio (`{"attivo":true,"descrizione":"…","dal":"AAAA-MM-GG"}`, `{"attivo":false}` per disattivarla) |
| GET/POST/DELETE | `/api/memoria` | ricordi del coach · POST `{"testo":"…"}` aggiunge · DELETE `?id=N` (o `?id=tutto`) elimina |
| GET | `/api/settimana?a=` | report dei 7 giorni fino ad `a` · POST `/api/settimana/coach` resoconto del coach |
| GET/POST | `/api/forza` | progressi di forza · salva serie (`{"serie":[…]}`: import da Hevy/Strong o allenamento fatto in Kairo) |
| POST | `/api/allenamento/oggi` | allenamento del giorno (`{"forza":true}` rigenera, `{"altro":true,"escludi":"nuoto"}` propone un altro sport) |
| GET/PUT | `/api/schede` | schede di palestra (e ultima seduta di ogni esercizio) · PUT sostituisce l'elenco |
| POST | `/api/schede/ia` | trasforma una descrizione a parole in schede (non le salva) |
| GET | `/api/push/chiave` · POST/DELETE `/api/push/iscrivi` · POST `/api/push/prova` | notifiche push |

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
  
  Contributo = `60 + 20 × z` (limitato a 0–100). Se un dato manca, gli altri si ridistribuiscono il peso. Il risultato non supera di oltre 20 punti la media di HRV e FC a riposo: il sonno non compensa un sistema nervoso in allarme. Fasce: 67–100 verde, 34–66 giallo, 0–33 rosso (Whoop). È "provvisorio" finché la baseline ha meno di 14 giorni.
- **Carico di allenamento:** TRIMP di Edwards (1993) dalla FC grezza: minuti in zona × peso (50–60% FCmax = 1 … 90–100% = 5), ogni campione vale fino al successivo (massimo 5 minuti); FCmax misurata o stimata con Tanaka et al. (2001), 208 − 0,7 × età. Calcolato all'arrivo dei dati e salvato in `daily.trimp`. Per la palestra, session-RPE di Foster (2001): RPE × minuti dal check-in del giorno dopo o dalle serie con RPE, riportato alla scala TRIMP con un fattore personale (mediana dei giorni con entrambi, altrimenti 2). Carico del giorno = il maggiore dei due.
- **Rapporto acuto:cronico** (Gabbett 2016): media degli ultimi 7 giorni / media degli ultimi 28 (fino a ieri; almeno 4 e 14 giorni con dati). < 0,8 scarico, 0,8–1,0 mantenimento, 1,0–1,3 costruzione, 1,3–1,5 attenzione, > 1,5 eccesso.
- **Allenamento consigliato:** fascia di carico per oggi in multipli della media a 28 giorni: recupero verde 0,9–1,5, giallo 0,5–1,0, rosso 0–0,5; con rapporto > 1,3 il massimo scende a 0,8, con rapporto < 0,8 e recupero verde sale a 1,6. Livello: seduta dura (massimo ≥ 1,4), normale (≥ 0,95), leggera (≥ 0,6), riposo attivo.
- **Allarmi:** "malanno" se per due giorni di fila l'HRV è ≥ 1 DS sotto la media e la FC a riposo ≥ 1 DS sopra (o la respirazione ≥ 1 DS sopra); "sovraccarico" se da tre giorni l'HRV è sotto l'intervallo normale e il rapporto acuto:cronico supera 1,3.
- **Fabbisogno di sonno stanotte** (principio di Whoop): base (profilo, predefinito 8 h) + fino a 45 minuti se il carico di oggi supera il solito + un settimo del debito degli ultimi 7 giorni (massimo 60 minuti). Orario per andare a letto = sveglia − fabbisogno − 15 minuti per addormentarsi. Notti senza Watch: le ore dichiarate nel check-in (conta solo la durata).
- **Allenamento del giorno:** prima le regole scelgono sport e intensità massima: intensità da allenamento consigliato (dura → intenso, normale → medio, leggera/riposo → leggero) o dal recupero; con un allarme sempre leggero e niente pesi; tra gli sport attivi nel profilo vince quello fatto meno di recente (check-in, serie di palestra, distanze di nuoto e bici dal Watch), evitando quello di ieri; per la palestra la scheda successiva a quella fatta per ultima. Poi l'IA scrive la seduta (JSON validato): può cambiare sport tra quelli attivi ma l'intensità viene sempre limitata a quella delle regole. Senza IA si usano sedute tipo per ogni sport e intensità. Una proposta al giorno, in cache.
- **Allenamento in palestra:** la seduta vive nel telefono (localStorage) finché non la termini; serie con kg e ripetizioni precompilate dall'ultima volta; doppia progressione (tutte le serie al massimo del range → +2,5 kg, +1 kg sotto i 20 kg). A fine seduta l'RPE della sessione entra nel carico (session-RPE). Senza rete il salvataggio resta in coda e viene inviato alla prima occasione.
- **Forza:** massimale stimato con la formula di Epley, peso × (1 + ripetizioni/30), sulla serie migliore di ogni seduta (1–12 ripetizioni, riscaldamento escluso).
- **VO₂max:** classificazione con le tabelle della Cooper Institute (le stesse di Garmin). **Età del cuore:** l'età in cui il tuo VO₂max sarebbe al 50° percentile (media tra 40° e 60°), interpolata tra le decadi, minimo 20 anni, come la Fitness Age di Garmin.
- **Composizione corporea:** categorie di massa grassa dell'American Council on Exercise; BMI secondo l'OMS; FC a riposo secondo l'American Heart Association (60–100 normale, 40–60 sportivi).
