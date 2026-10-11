# Installare Kairo

Circa **10 minuti**, una volta sola, tutto gratis. Ti servono:
- un **iPhone** con **Apple Watch**
- un account **[GitHub](https://github.com/signup)** e uno **[Cloudflare](https://dash.cloudflare.com/sign-up)**. Sono gratuiti e non chiedono la carta.

Sono solo due parti: **1. crei il server** (dal PC) e **2. colleghi l'iPhone** (seguendo la guida dentro l'app).

---

## Parte 1 · Crea il tuo server (dal PC, 3 minuti)

1. Nel [README](../README.md#installazione-10-minuti-tutto-gratis) clicca **Deploy to Cloudflare** e accedi a Cloudflare.
2. Nella schermata **Set up your application**:
   - **Git account**: scegli il tuo account GitHub. Se non c'è, clicca *Connect GitHub* e autorizza.
   - **Create private Git repository**: spuntalo, così il tuo codice non è pubblico.
   - **Project name**: lascia `kairo`. Diventa parte del tuo indirizzo.
3. Clicca **Deploy** e aspetta circa un minuto. Il build è finito quando vedi la spunta verde ✓.
4. Clicca la scheda **Overview** in alto, poi **Visit**. L'indirizzo che si apre è la tua app, per esempio `https://kairo.tuonome.workers.dev`. **Mandatelo sull'iPhone** (per esempio via AirDrop, Note o email).

> Se in Overview vedi *"No URLs enabled"* o *"Disabled"*, ricarica la pagina dopo qualche secondo: subito dopo il deploy l'indirizzo non compare ancora.

---

## Parte 2 · Collega l'iPhone (in Safari, 5 minuti)

Apri l'indirizzo **sull'iPhone, in Safari**. L'app ti accompagna da sola:

1. **Crea il codice di accesso** (almeno 8 caratteri) e salvalo nel portachiavi o in Note. Ti servirà per aprire Kairo su altri dispositivi.
2. **Coach IA (facoltativo):** se vuoi un coach più preciso, crea una chiave gratuita su [console.groq.com/keys](https://console.groq.com/keys) e incollala. Puoi anche saltare questo passo: il coach funziona lo stesso con un modello gratuito di Cloudflare.
3. **Segui la Guida** che compare, 7 passi:
   1. **Prima di iniziare:** iPhone → *Impostazioni → App → Comandi → Avanzate* → attiva **Consenti condivisione di grandi quantità di dati**.
   2. **Installa il comando:** tocca **① Copia il link di collegamento**, poi **② Scarica HealthSync** → *Scarica* → apri il file dai download → **Configura comando** → incolla il link → **Aggiungi comando**.
   3. **Prova:** in Comandi tocca *HealthSync* e rispondi **Consenti** alle richieste. Poi nella guida tocca **Controlla se i dati sono arrivati**.
   4. **Automatico:** in *Comandi → Automazione → +* crea **Sveglia → Viene fermata** e **Caricatore → È collegato**, entrambe con **Esegui immediatamente** → *HealthSync*.
   5. **Storico (consigliato):** *Salute → foto → Esporta tutti i dati sanitari → Salva su File*, poi in Kairo **Importa da Salute**.
   6. **Schermata Home:** in Safari *Condividi → Aggiungi alla schermata Home*. Apri l'icona e reinserisci il codice.
   7. **Fatto.**

Dal PC: apri lo stesso indirizzo in Chrome o Edge, accedi con il codice e clicca **Installa**.

---

## Aggiornamenti

La tua copia di Kairo **si aggiorna da sola ogni lunedì**. Lo fa l'azione *Aggiorna Kairo* nel tuo repository GitHub, e Cloudflare ripubblica in automatico. I tuoi dati non vengono toccati.

Per aggiornare subito: GitHub → il tuo repository → **Actions** → **Aggiorna Kairo** → **Run workflow**. Se GitHub chiede di abilitare le Actions, clicca *I understand… enable them*.

La pagina *Impostazioni → Diagnostica* ti dice se c'è una versione nuova.

---

## Notifiche

Apri Kairo **dall'icona sulla schermata Home** (su iPhone le notifiche funzionano solo così, iOS 16.4 o successivo), vai in *Impostazioni → Notifiche → Attiva* e consenti. Ricevi solo due notifiche al giorno: la mattina, appena arrivano i dati della notte, recupero e allenamento consigliato; la sera, circa 30 minuti prima dell'orario consigliato per andare a letto (imposta la sveglia abituale nel profilo).

## Palestra e allenamento del giorno

- In *Impostazioni → Profilo* scegli i tuoi sport (palestra, nuoto, bici, corsa): l'allenamento del giorno nella pagina Oggi sceglie solo tra questi.
- In *Palestra* tocca **✨ Crea con il coach** e descrivi i tuoi allenamenti (es. «Scheda A petto: panca 4x8-10, croci 3x12…»): controlla l'anteprima e salva. Puoi anche crearle o modificarle a mano.
- **Inizia allenamento**: segna kg e ripetizioni di ogni serie e tocca ✓. La seduta resta sul telefono anche senza rete; a fine allenamento indica quanto è stato duro (1–10).

## Allenamenti di forza da Hevy o Strong

In Hevy: *Profilo → Impostazioni → Esporta e importa dati → Esporta allenamenti*; in Strong: *Profilo → Impostazioni → Esporta dati*. Poi in Kairo: *Impostazioni → Importa dati* e scegli il file `.csv` (il formato viene riconosciuto da solo). Ripetilo quando vuoi (per esempio una volta al mese): le serie già importate non vengono duplicate. I progressi compaiono nella pagina *Palestra*.

## Backup

Kairo salva da solo una copia dei tuoi dati **ogni lunedì** e **prima di ogni cancellazione**, e tiene le ultime 8. In *Impostazioni → Backup* puoi:
- **Backup ora**: crea subito una copia;
- toccare un backup per **scaricarlo** (file `.json.gz`, da tenere anche sul PC o su iCloud);
- **Ripristina**: scegli un backup o un'esportazione JSON. I dati vengono aggiunti a quelli presenti, senza doppioni.

## Problemi frequenti

| Cosa vedi | Cosa fare |
|---|---|
| Il pulsante *Scarica HealthSync* scarica una pagina e non il comando | Chiudi e riapri Safari, poi riprova. In *Diagnostica* la versione dell'app deve essere almeno 1.1.1 |
| Il comando dà **errore 401** | Il link non è giusto. In Kairo: *Guida → passo 2 → Copia link*. Poi in Comandi tieni premuto *HealthSync* → *Modifica* → sostituisci il testo nel primo blocco |
| *"Condividere N elementi di Salute non è consentito"* | Attiva *Consenti condivisione di grandi quantità di dati* (Guida, passo 1) |
| *"Nessun campione di dati trovato"* | App Salute → foto → *App* → *Comandi* → attiva tutto |
| La chiave Groq dà errore | Ricopiala per intero da console.groq.com: inizia con `gsk_` e non ha spazi. Oppure salta il passo, il coach funziona lo stesso |
| *"Il server ha risposto in modo inatteso"* | Ricarica la pagina; se continua apri *Impostazioni → Diagnostica* e copia il report |
| *"Troppi tentativi sbagliati"* | hai sbagliato il codice 5 volte: aspetta il tempo indicato (dalla stessa rete) e riprova con il codice giusto |
| *"Backup automatici non attivi"* | la tua copia è stata installata prima della 1.4: l'aggiornamento automatico del lunedì li attiva da solo |
| Lo score resta "in calibrazione" | Servono almeno 5 notti con il Watch, oppure importa lo storico da Salute |
| "Ultimo invio" vecchio in Diagnostica | In *Comandi → Automazione* controlla che le due automazioni siano attive e su *Esegui immediatamente* |

---

## Alternativa per sviluppatori

```bash
git clone https://github.com/antonuccilorenzogit/Kairo && cd Kairo/worker
npm install
npx wrangler deploy
```

Oppure da Cloudflare: *Workers & Pages → Create → Import a repository*, scegli il repository e imposta **Path** (root directory) su `/worker`.
