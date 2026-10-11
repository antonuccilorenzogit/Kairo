# Architettura

## Componenti

| Componente | Dove | Ruolo |
|---|---|---|
| Comando **HealthSync** | iPhone | legge Apple Salute, crea un JSON, ne salva una copia in iCloud Drive (`Kairo/`) e lo invia a `POST /api/ingest` |
| **Worker** (`worker/src`) | Cloudflare | riceve i dati, li deduplica, calcola le metriche, parla con l'IA, serve l'app |
| **D1** | Cloudflare | database SQLite; schema creato automaticamente da `schema.js` |
| **Web app** (`worker/public`) | browser | PWA in JavaScript senza build; tiene codice e chiave Groq in `localStorage` |
| **Groq** / **Workers AI** | esterni | modelli linguistici per consiglio e chat |

## Autenticazione
- `POST /api/setup` imposta il codice di accesso solo se il server non ne ha già uno; il server salva l'hash SHA-256.
- Tutte le altre chiamate richiedono `Authorization: Bearer <codice>`.
- La chiave Groq viaggia nell'header `x-groq-key` e non viene salvata sul server.

## API
| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/api/info` | versione e stato della configurazione (pubblico) |
| POST | `/api/setup` | crea il codice di accesso (pubblico, una volta) |
| POST | `/api/ingest` | riceve un JSON di HealthSync |
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
| DELETE | `/api/dati` | cancella tutti i dati (`{"conferma":"CANCELLA"}`) |

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
- **Sonno:** le fasi vengono raggruppate in sessioni (pausa > 2 h = nuova sessione) e assegnate al giorno del risveglio. Punteggio = durata (50, obiettivo 8 h) + efficienza (20) + quota profondo+REM (20, obiettivo 40%) + regolarità dell'orario a 7 giorni (10).
- **Valori notturni:** HRV, respirazione e SpO₂ misurate durante la sessione principale; senza sonno registrato, l'HRV usa le 24 ore precedenti a mezzogiorno.
- **Baseline:** media e deviazione standard dei 60 giorni precedenti (minimo 5 valori). L'HRV è confrontata in scala logaritmica.
- **Score di Recupero:** `50 + 20 × z̄`, dove `z̄` è la media pesata degli z-score: HRV 40%, FC a riposo 25% (segno invertito), sonno 25%, respirazione 10% (segno invertito); limitato tra 0 e 100. È "provvisorio" finché la baseline ha meno di 14 giorni.
