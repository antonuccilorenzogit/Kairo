# Privacy

Kairo è progettato perché **nessuno, nemmeno l'autore, possa vedere i tuoi dati**.

- **Dove stanno i dati:** nel database D1 del *tuo* account Cloudflare. Non esiste un server centrale di Kairo.
- **Chi può leggerli:** solo chi conosce il tuo codice di accesso. Il server ne conserva l'hash SHA-256, non il codice.
- **Chiavi:** il codice di accesso è salvato nel browser del tuo dispositivo (`localStorage`), sul server solo il suo hash. La chiave Groq è salvata nel database del *tuo* server, così vale su tutti i tuoi dispositivi: l'app ne vede solo le ultime 4 cifre, non entra in backup ed esportazioni e la togli da *Impostazioni → Coach IA → Rimuovi*.
- **Intelligenza artificiale:** al modello (Groq o Cloudflare Workers AI) vengono inviati solo riassunti numerici giornalieri (score, HRV, FC, durata del sonno, check-in), le tue domande, il profilo e i ricordi del coach. I ricordi sono salvati nel tuo database e li vedi, aggiungi e cancelli da *Impostazioni → Cosa ricorda il coach*. Consulta le policy di [Groq](https://groq.com/privacy-policy/) e [Cloudflare](https://www.cloudflare.com/privacypolicy/).
- **Backup:** ogni settimana e prima di ogni cancellazione il server salva una copia compressa nello spazio KV del *tuo* account Cloudflare (le ultime 8); il comando salva inoltre una copia di ogni invio nella cartella `Kairo` del tuo iCloud Drive.
- **Nessun tracciamento:** niente analytics, cookie di terze parti, font o script esterni.
- **Controllo totale:** da Impostazioni puoi esportare tutto in JSON o cancellare tutti i dati dal server.
