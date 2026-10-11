# Contribuire a Kairo

Grazie per l'interesse! Ogni contributo è benvenuto: segnalazioni, traduzioni, nuove metriche, integrazioni.

## Segnalare un problema
Apri una [issue](../../issues) e allega il **report diagnostico** (app → Impostazioni → Diagnostica → *Copia report diagnostico*). Il report non contiene chiavi né dati di salute.

## Sviluppo locale
```bash
cd worker
npm install
npx wrangler dev        # http://localhost:8787 con un database D1 locale
```
Per provare l'importazione puoi inviare un JSON di esempio:
```bash
curl -X POST http://localhost:8787/api/setup -H 'content-type: application/json' -d '{"codice":"codice-di-prova"}'
curl -X POST http://localhost:8787/api/ingest -H 'authorization: Bearer codice-di-prova' --data-binary @esempio.json
```

## Test
```bash
cd worker
npm test                # 23 test automatici: sicurezza, doppioni, sonno, backup, migrazioni, calcoli
```
I test usano un database SQLite in memoria con la stessa interfaccia di D1 e girano su GitHub a ogni push. Una modifica è pronta solo se passano tutti.

## Linee guida
- La web app non ha passaggi di build: JavaScript moderno, nessuna dipendenza esterna a runtime.
- Testi dell'interfaccia in italiano; codice e commenti in inglese.
- Nessun dato di salute deve lasciare il server dell'utente, tranne i riassunti numerici inviati al modello IA scelto dall'utente.
- Le formule delle metriche stanno in `worker/src/metrics.js`: se le cambi, spiega il motivo (con fonti) nella pull request.

## Comandi rapidi
I comandi si rigenerano con `python3 tools/build_shortcuts.py worker/public/shortcuts`. I tipi di dato usano gli identificatori interni di Comandi: verificali su un iPhone reale prima di aggiungerne di nuovi.
