# Changelog

Tutte le modifiche rilevanti di Kairo. Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il [Semantic Versioning](https://semver.org/lang/it/).

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
