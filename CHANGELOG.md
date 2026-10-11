# Changelog

Tutte le modifiche rilevanti di Kairo. Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il [Semantic Versioning](https://semver.org/lang/it/).

## [Non pubblicato]

### Aggiunto
- **Pagina Corpo**: composizione corporea, qualità del cambiamento (ricomposizione, definizione…), "Motore" con VO₂max, età del cuore e frequenza cardiaca, diario e confronto di due misure.
- Profilo con età e sesso (per età del cuore e riferimenti).
- **Backup automatici** ogni settimana e prima di ogni cancellazione (ultime 8 copie), con download e **ripristino** dalle Impostazioni.
- **23 test automatici** e controllo su GitHub a ogni modifica.

### Migliorato
- **Calcoli basati su metodi pubblicati**: Recupero con la struttura della Readiness di Oura e l'HRV secondo Plews/HRV4Training (media 7 giorni, normal range a 60 giorni); punteggio del sonno con le soglie AASM/NSF e il Sleep Regularity Index; VO₂max con le tabelle della Cooper Institute ed età del cuore come Garmin; riferimenti AHA, ACE e OMS. Nuova scheda "Come si calcola?".
- **Sicurezza**: blocco dopo 5 tentativi sbagliati (15 minuti, poi sempre più a lungo), confronti a tempo costante, codici di almeno 10 caratteri, link di collegamento più lungo con contatore separato, validazione di tutti i dati in ingresso, limiti di dimensione, niente CORS, Content-Security-Policy e altri header di sicurezza.
- **Niente doppioni**: misure con chiave sull'istante (anche con fusi orari diversi), totali giornalieri che non si sommano tra più invii, sonno di più fonti fuso in un'unica linea temporale.
- L'aggiornamento automatico aggiorna anche la configurazione (backup e cron), mantenendo il nome del progetto.

### Corretto
- Cambiando scheda velocemente una pagina lenta poteva sovrascrivere quella nuova.

## [1.3.0] — 2026-10-11

### Migliorato
- **Coach più umano**: interpreta i dati invece di elencarli, guarda i trend (7 giorni contro la media personale), dice cosa va bene, cosa migliorare e propone un obiettivo con azioni concrete.
- Il coach riceve un **quadro generale** già calcolato: VO2max e peso/massa grassa con il loro andamento, HRV e FC a riposo rispetto alla media, notti registrate, passi, nuoto e bici, attività dei check-in.
- Nuovo campo **I tuoi obiettivi** nel profilo: il coach collega i consigli ai tuoi obiettivi (se mancano, ne propone uno).
- Le risposte del coach mostrano grassetti ed elenchi invece dei simboli `**`.
- Nuovi suggerimenti nella chat: «Fammi una valutazione della mia forma», «Su cosa devo lavorare questo mese?».

## [1.2.0] — 2026-10-11

### Semplificato
- **Un solo link per collegare l'iPhone**: il comando HealthSync chiede solo il *link di collegamento* (copiato con un tocco dall'app), non più indirizzo e codice. Il link può solo inviare dati e si rigenera da *Impostazioni*.
- Guida nell'app ridotta a 7 passi chiari; schermata del coach IA con istruzioni passo passo per la chiave Groq.
- Accesso: niente più campo "indirizzo del server", l'app usa sempre il proprio indirizzo.
- Il comando non salva più copie in iCloud Drive (una richiesta di permesso in meno).
- **Aggiornamenti automatici**: le copie installate con *Deploy to Cloudflare* si aggiornano ogni settimana tramite l'azione GitHub *Aggiorna Kairo*.

### Corretto
- Errore 405 salvando la chiave Groq quando nel dispositivo era rimasto un indirizzo del server sbagliato.
- Messaggio chiaro quando il server risponde con qualcosa che non è JSON.

## [1.1.1] — 2026-10-11

### Corretto
- Su iPhone i comandi rapidi si scaricavano come pagina HTML: ora vengono serviti come file `.shortcut` con il nome giusto e non passano dal service worker.

## [1.1.0] — 2026-10-11

### Aggiunto
- Guida passo passo dalla A alla Z dentro l'app (11 passi con avanzamento): comando, permessi, automazioni, storico, installazione, verifica dell'arrivo dei dati.
- **Importa da Salute**: legge l'esportazione dell'app Salute (`esportazione.zip`/`export.zip` o il file `.xml`) direttamente sul dispositivo e invia solo i valori che Kairo usa.
- I file `.shortcut` sono serviti come download per aprirsi correttamente in Comandi.

## [1.0.0] — 2026-10-11

### Aggiunto
- Server su Cloudflare Workers con database D1 creato e aggiornato automaticamente.
- Score di Recupero 0–100 con baseline personali a 60 giorni (HRV notturna, FC a riposo, sonno, respirazione).
- Analisi del sonno: sessioni, fasi, efficienza, regolarità, pisolini, debito di sonno.
- Web app installabile (PWA): Oggi, Recupero, Sonno, Coach, Check-in, Impostazioni, Diagnostica, Guida, Informazioni.
- Coach IA con Groq (chiave sul dispositivo) e riserva automatica su Cloudflare Workers AI.
- Comando HealthSync universale con domande all'importazione e 4 comandi Storico.
- Esportazione e cancellazione dei dati.
