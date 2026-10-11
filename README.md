<p align="center">
  <img src="docs/banner.png" width="100%" alt="kairo. con Bean, la mascotte">
</p>

<p align="center"><b>Ogni giorno parte da come hai recuperato.</b><br>
Recupero, sonno e allenamento dai dati del tuo Apple Watch, con un coach IA.<br>
Open source, gratuito, i dati restano nel <i>tuo</i> account.</p>

---

## Cos'è Kairo

*Kairós*, in greco, è il **momento giusto**. Kairo legge ogni mattina i dati del tuo Apple Watch (HRV, frequenza cardiaca a riposo, sonno, respirazione, attività) e ti dice **quanto hai recuperato** e **cosa conviene fare oggi**, confrontandoti con la *tua* media personale e non con quella degli altri.

È un'alternativa personale e open source ad app come Bevel, Whoop o Athlytic:

- **Allenamento del giorno dall'IA**: tra i tuoi sport (palestra, nuoto, bici, corsa) sceglie cosa fare, con quale intensità e, per gli sport di resistenza, la seduta completa con tecnica e andature, nei limiti di recupero e carico
- **Modalità infortunio**: descrivi l'infortunio e ogni giorno il coach ti dice se riposare, quali esercizi riabilitativi fare o come allenare il resto del corpo, in base al dolore
- **Palestra**: le tue schede (anche compilate dal coach a partire da una descrizione), allenamento in corso sul telefono anche senza rete con carichi precompilati e progressione, e andamento dei massimali
- **Carico di allenamento** dalla frequenza cardiaca (TRIMP) e dalla fatica percepita in palestra, con il rapporto settimana/mese per migliorare senza esagerare
- **Allarmi** quando HRV, frequenza cardiaca e respirazione segnalano fatica accumulata o un malanno in arrivo
- **Score di Recupero 0–100** con Bean, la batteria che si riempie
- **Sonno**: fasi, efficienza, regolarità, debito e **quanto ti serve stanotte**, con l'orario per andare a letto
- **Corpo**: composizione corporea, VO₂max ed età del cuore
- **Importa dati** da Salute, Hevy e Strong
- **Report settimanale** e **notifiche** essenziali: la mattina e la sera
- **Spiegazioni a richiesta**: tocca un dato per capire cos'è e come ti posizioni
- **Coach IA che ti conosce**: consiglio del giorno e chat che risponde con i tuoi numeri, e **si ricorda** quello che gli racconti (gare, dolori, obiettivi, preferenze) per usarlo nei consigli dei giorni dopo
- **Check-in in 10 secondi**: energia, indolenzimento, umore, cosa hai fatto ieri
- **Importa da Salute**: carica l'esportazione dell'app Salute, letta sul dispositivo
- **Aggiornamenti automatici**: la tua copia si aggiorna da sola ogni settimana
- **Diagnostica completa**: sincronizzazione, dati ricevuti, quota IA, versioni
- **App installabile** su iPhone e PC (PWA), funziona anche offline
- **Costo zero**: tutto sui piani gratuiti di Cloudflare e Groq

## Come funziona

```
 ⌚ Apple Watch ──► 📱 Salute ──► Comando "HealthSync" (automatico, 2 volte al giorno)
                                          │  POST JSON sul tuo link di collegamento
                                          ▼
                        ☁️ Il TUO Cloudflare Worker (gratuito, sempre acceso)
                           ├─ 🗄️ D1: il tuo database
                           ├─ 🧮 calcolo di recupero, sonno, baseline personali
                           ├─ 🤖 IA: Groq (la tua chiave) → riserva Cloudflare AI
                           └─ 🌐 serve la web app Kairo
                                          ▲
                      📱 iPhone / 💻 PC: l'app installata dal browser
```

- **Nessun server centrale**: ognuno pubblica la propria copia di Kairo sul proprio account Cloudflare, gratuito.
- **Le chiavi restano sui tuoi dispositivi**: il codice di accesso e la chiave Groq sono salvati nel browser e inviati solo al tuo server.
- **All'IA arrivano solo riassunti numerici**, mai i dati grezzi, più le tue domande e i ricordi del coach (che vedi e cancelli dalle Impostazioni).

Dettagli tecnici in [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md).

## Installazione (10 minuti, tutto gratis)

Serve: un **iPhone con Apple Watch** e due account gratuiti, **[GitHub](https://github.com/signup)** e **[Cloudflare](https://dash.cloudflare.com/sign-up)**.

**1. Crea il tuo server** (meglio dal PC)

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/antonuccilorenzogit/Kairo/tree/main/worker"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

Clicca il pulsante, accedi a Cloudflare, scegli il tuo account GitHub e premi **Deploy**. Dopo un minuto apri **Overview → Visit**: quello è l'indirizzo della tua app (tipo `https://kairo.tuonome.workers.dev`).

**2. Apri l'indirizzo sull'iPhone, in Safari**, crea il tuo codice di accesso e segui la **Guida** che compare: ti accompagna passo passo (copia un link, scarica un comando, crea due automazioni).

Fine. La guida dettagliata, con le soluzioni ai problemi più comuni, è in [docs/SETUP.md](docs/SETUP.md).

## Costi

| Servizio | Piano | Uso tipico di Kairo |
|---|---|---|
| Cloudflare Workers | gratuito, 100.000 richieste/giorno | 100–200 al giorno |
| Cloudflare D1 | gratuito, 5 GB · 5 milioni di righe lette e 100.000 scritte al giorno | ~1 MB per anno di dati · meno del 10% delle letture |
| Workers AI (riserva) | gratuito, ~280 risposte/giorno | solo se Groq non è disponibile |
| Groq | gratuito, ~1.000 richieste e 200.000 token al giorno | 10–30 richieste al giorno |

Se superi il limite di Groq (per esempio molti messaggi di fila in un minuto), Kairo passa da solo al modello di riserva.

## Privacy e sicurezza

- I dati di salute sono salvati **solo nel tuo database Cloudflare**.
- L'app si apre solo con il tuo codice di accesso (salvato come hash SHA-256). Dopo 5 tentativi sbagliati l'accesso si blocca per 15 minuti, poi sempre più a lungo.
- Il comando dell'iPhone usa un link di collegamento separato che può solo inviare dati, e che puoi rigenerare quando vuoi.
- Solo dati validi e plausibili entrano nel database, e **niente viene contato due volte**, anche se lo stesso dato arriva più volte o da più fonti.
- **Backup automatici** ogni settimana e prima di ogni cancellazione; puoi scaricarli e ripristinarli dalle Impostazioni.
- Nessun tracciamento, nessuna analytics, nessun font o script esterno: anche il font è incluso nel progetto.
- Puoi **esportare** tutti i dati in JSON o **cancellarli** dalle Impostazioni.

Leggi [docs/PRIVACY.md](docs/PRIVACY.md).

## Diagnostica

La pagina *Impostazioni → Diagnostica* controlla: raggiungibilità e latenza del server, versione dell'app e del server rispetto all'ultima release su GitHub, ultimo invio da iPhone per ogni comando, freschezza di ogni metrica, dimensione del database, chiave e modello IA, **richieste Groq rimaste oggi** e quando si azzerano, modello di riserva, installazione come app e funzionamento offline. Il pulsante *Copia report diagnostico* produce un riepilogo senza chiavi, da allegare alle segnalazioni.

## Domande frequenti

**Funziona con Android o con altri smartwatch?** Non ancora: i dati arrivano da Apple Salute tramite l'app Comandi. Il server accetta però qualsiasi JSON nel [formato documentato](docs/ARCHITETTURA.md#formato-dei-dati): un'integrazione con Health Connect è benvenuta.

**Devo dormire con il Watch?** È fortemente consigliato: sonno, respirazione e HRV notturna sono la base dello score. Senza, Kairo usa l'HRV delle ultime 24 ore e la FC a riposo.

**Perché i nomi dei dati nel comando sono in inglese?** Comandi usa identificatori interni in inglese indipendenti dalla lingua del telefono (per esempio `Active Calories`, non `Active Energy`).

**Kairo è un dispositivo medico?** No. Gli score sono stime basate sui sensori del Watch e non sostituiscono il parere di un medico.

## Sviluppo

```bash
git clone https://github.com/antonuccilorenzogit/Kairo && cd kairo/worker
npm install
npx wrangler dev          # server + app in locale su http://localhost:8787
npx wrangler deploy       # pubblica sul tuo account
```

- `worker/src/` — server (router, metriche, coach IA, schema del database)
- `worker/public/` — web app (JavaScript senza build, PWA)
- `tools/build_shortcuts.py` — genera e firma i comandi rapidi (non serve un Mac)
- `shortcuts/` — i comandi già firmati

Vedi [CONTRIBUTING.md](CONTRIBUTING.md) per contribuire.

## Licenza

[MIT](LICENSE) © [antonuccilorenzogit](https://github.com/antonuccilorenzogit) e contributori. Il font Nunito è distribuito con licenza SIL Open Font License 1.1. Apple, Apple Watch, Salute e Comandi sono marchi di Apple Inc.; Kairo non è affiliato ad Apple.
