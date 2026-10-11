# Guida completa, dalla A alla Z

Tempo: circa 20 minuti, una volta sola. Servono un **iPhone** con l'app **Comandi**, un **Apple Watch** abbinato e un account gratuito su **Cloudflare**.

La stessa guida c'è anche **dentro l'app**, con i pulsanti per scaricare i file e copiare indirizzo e codice: *Impostazioni → Guida e tutorial*.

---

## Parte 1 · Il server (dal PC o dall'iPhone)

### A. Pubblica il tuo Kairo
1. Crea un account gratuito su [Cloudflare](https://dash.cloudflare.com/sign-up). Non serve la carta di credito.
2. Apri il [README](../README.md) e clicca **Deploy to Cloudflare**.
3. Accedi con Cloudflare (e con GitHub se lo chiede) e conferma. Cloudflare crea per te server, database e IA di riserva.
4. Alla fine ricevi un indirizzo tipo `https://kairo.<tuo-nome>.workers.dev`. **Salvalo**: è l'indirizzo della tua app.

> Da terminale: `cd worker && npm install && npx wrangler deploy`.

### B. Crea il codice di accesso
1. Apri l'indirizzo in **Safari sull'iPhone**.
2. Scegli un **codice di accesso** (almeno 8 caratteri) e salvalo nel portachiavi. Fallo subito: chi apre per primo un server nuovo ne sceglie il codice.
3. **Coach IA (facoltativo, consigliato):** crea una chiave gratuita su [console.groq.com/keys](https://console.groq.com/keys) e incollala. Resta solo sul tuo dispositivo. Senza chiave Kairo usa il modello gratuito di Cloudflare.

---

## Parte 2 · L'iPhone (comando e automazioni)

### C. Prepara l'iPhone
**Impostazioni → App → Comandi → Avanzate** (su iOS meno recenti: *Impostazioni → Comandi rapidi → Avanzate*) e attiva **Consenti condivisione di grandi quantità di dati**.

### D. Scarica HealthSync
1. In Kairo vai su **Impostazioni → Guida**, passo *Scarica HealthSync*, e tocca **Scarica HealthSync**.
2. Safari chiede *«Vuoi scaricare HealthSync.shortcut?»*: tocca **Scarica**.
3. Tocca l'icona dei download nella barra di Safari e poi **HealthSync.shortcut**. Si apre **Comandi**.
   Se non succede: app **File → Download → HealthSync.shortcut**.

Il file è firmato: si apre in Comandi senza impostazioni speciali (iOS 15 o successivo).

### E. Aggiungi il comando
1. Tocca **Configura comando**.
2. **Domanda 1, indirizzo del server:** incolla l'indirizzo (senza `/` finale).
3. **Domanda 2, codice di accesso:** incolla il codice.
4. Tocca **Aggiungi comando**.

Hai sbagliato? Tieni premuto su HealthSync → **Modifica**: i primi due blocchi di testo sono indirizzo e codice.

### F. Primo avvio e permessi
1. In Comandi tocca **HealthSync**.
2. Salute: **Consenti** (se compare l'elenco: **Attiva tutto → Consenti**).
3. Connessione al tuo server: **Consenti sempre**.
4. Salvataggio in iCloud Drive (copia di sicurezza in *iCloud Drive/Kairo*): **Consenti sempre**.
5. Nella guida dell'app tocca **Verifica che i dati siano arrivati**.

### G. Automazione 1: sveglia
**Comandi → Automazione → +** → **Sveglia** → **Viene fermata** → **Esegui immediatamente** (notifica disattivata) → **Avanti** → **HealthSync** → **Fine**.
Senza sveglia: usa **Ora del giorno**, per esempio le 9:00 ogni giorno.

### H. Automazione 2: caricatore
**Comandi → Automazione → +** → **Caricatore** → **È collegato** → **Esegui immediatamente** → **Avanti** → **HealthSync** → **Fine**.

> **Perché le automazioni non sono file da importare?** Apple consente di condividere i *comandi* come file, ma non le *automazioni*: vanno create sull'iPhone. iOS protegge inoltre i dati di Salute quando il telefono è bloccato. Sveglia e caricatore sono due momenti in cui l'iPhone è sbloccato o lo è appena stato.

---

## Parte 3 · Lo storico (una volta)

Così le tue medie personali sono pronte subito, senza aspettare 2 settimane.

### I. Opzione consigliata: Importa da Salute
1. App **Salute** → tocca la tua **foto** in alto a destra → **Esporta tutti i dati sanitari** → **Esporta**. Può richiedere qualche minuto.
2. **Salva su File → Sul mio iPhone → Salva**. Il file si chiama `esportazione.zip` (o `export.zip`).
3. In Kairo apri **Impostazioni → Importa dati da Salute**, scegli il periodo e il file e tocca **Analizza il file**, poi **Invia**.

Il file viene letto **sul tuo dispositivo**: al server arrivano solo i valori che Kairo usa. Niente ECG, percorsi GPS o documenti clinici. Funziona anche dal PC con il file `.zip` o con l'`.xml` estratto. Puoi ripetere l'importazione senza creare duplicati.

### I-bis. Alternativa: i comandi Storico
Scarica dalla guida **Storico 1A, 1B, 1C e 2**, aggiungili come al punto E e avviali una volta, in ordine, tenendo lo schermo acceso. Poi puoi eliminarli.

---

## Parte 4 · Kairo come app

### L. Installa e accedi
- **iPhone:** in Safari tocca **Condividi → Aggiungi alla schermata Home → Aggiungi**. Apri Kairo dall'icona: la prima volta ti chiede di nuovo il **codice**, perché l'app installata ha una memoria separata da Safari.
- **PC:** apri l'indirizzo in **Chrome** o **Edge**, accedi con il codice e clicca **Installa** nella barra degli indirizzi.

Kairo funziona anche a PC spento: il server è sempre acceso su Cloudflare.

### M. Ogni giorno
Dormi con il Watch, spegni la sveglia (i dati arrivano da soli), apri Kairo e fai il check-in.

---

## Problemi?

Apri **Impostazioni → Diagnostica**: un pallino rosso o giallo indica cosa controllare.

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| "Ultimo invio" vecchio | automazione disattivata o con conferma | imposta *Esegui immediatamente* |
| "Nessun campione di dati trovato" | permesso Salute mancante o dato inesistente | Salute → profilo → App → Comandi → attiva tutto |
| "Condividere N elementi di Salute non è consentito" | protezione iOS | punto C |
| Errore 401 nel comando | codice sbagliato o cambiato | punto E, *Modifica* |
| Il file .shortcut non si apre | iOS vecchio o download in Safari interrotto | app File → Download |
| Import: "non è uno ZIP valido" | file sbagliato | scegli `esportazione.zip` o il file `.xml` dentro |
| Score sempre "in calibrazione" | meno di 5 notti con HRV e FC | dormi con il Watch o importa lo storico |
| Coach "Chiave Groq non valida" | chiave errata o revocata | creane una nuova su console.groq.com |
