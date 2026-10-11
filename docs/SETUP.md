# Guida all'installazione

Tempo: circa 15 minuti. Serve un iPhone con Apple Watch e un computer o un iPhone con browser.

## 1. Pubblica il tuo server Kairo

1. Crea un account gratuito su [Cloudflare](https://dash.cloudflare.com/sign-up) (non serve la carta di credito) e uno su [GitHub](https://github.com/signup).
2. Clicca il pulsante **Deploy to Cloudflare** nel [README](../README.md).
3. Accedi a Cloudflare e a GitHub quando richiesto: Cloudflare copia Kairo nel tuo GitHub, crea il database `kairo` e pubblica il server.
4. Alla fine ottieni un indirizzo tipo `https://kairo.<tuo-sottodominio>.workers.dev`. Salvalo.

> Alternativa da terminale: `cd worker && npm install && npx wrangler deploy`.

## 2. Configura l'app

1. Apri l'indirizzo dal browser.
2. **Crea il codice di accesso** (almeno 8 caratteri). Fallo subito: il primo che apre un server nuovo ne sceglie il codice.
3. **Coach IA (facoltativo):** crea una chiave gratuita su [console.groq.com/keys](https://console.groq.com/keys) e incollala. Resta solo sul tuo dispositivo. Senza chiave Kairo usa il modello gratuito di Cloudflare, meno preciso.

## 3. Installa il comando HealthSync

1. Dall'iPhone, nell'app vai su **Impostazioni → Scarica HealthSync** e tocca **Aggiungi comando**.
2. Alla domanda **Indirizzo** incolla l'indirizzo del tuo server (senza `/` finale).
3. Alla domanda **Codice** inserisci il codice di accesso.
4. Lancia il comando una volta dall'app Comandi e rispondi **Consenti sempre** alle richieste di accesso a Salute e alla rete.
5. In **Impostazioni iPhone → Comandi rapidi → Avanzate** attiva **Consenti condivisione di grandi quantità di dati**.

### Rendilo automatico
In **Comandi → Automazione → +**:
- **Sveglia** → *Quando viene fermata* → esegui **HealthSync** → **Esegui immediatamente**.
- **Caricatore** → *Quando è collegato* → esegui **HealthSync** → **Esegui immediatamente**.

iOS protegge i dati di Salute quando l'iPhone è bloccato: questi due momenti garantiscono che il telefono sia sbloccato o lo sia appena stato.

## 4. Importa lo storico (una volta)

Scarica dalla guida dell'app i comandi **Storico 1A, 1B, 1C e 2** e lanciali uno alla volta con l'app Comandi aperta. Importano un anno di HRV, FC, attività e composizione corporea e 45 notti di sonno. Se uno si interrompe per memoria, aprilo e riduci il numero di giorni nel blocco *Trova campioni*.

## 5. Installa Kairo come app

- **iPhone:** Safari → Condividi → **Aggiungi alla schermata Home**.
- **PC:** Chrome o Edge → icona **Installa** nella barra degli indirizzi.

## Problemi?

Apri **Impostazioni → Diagnostica**: un pallino rosso o giallo indica cosa controllare.

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| "Ultimo invio" vecchio | automazione disattivata o con conferma | imposta *Esegui immediatamente* |
| "Nessun campione di dati trovato" | permesso Salute mancante o dato inesistente | Salute → profilo → App → Comandi → attiva tutto |
| "Condividere N elementi di Salute non è consentito" | protezione iOS | attiva *Consenti condivisione di grandi quantità di dati* |
| Score sempre "in calibrazione" | meno di 5 notti con HRV e FC | dormi con il Watch o importa lo storico |
| Coach "Chiave Groq non valida" | chiave errata o revocata | creane una nuova su console.groq.com |
