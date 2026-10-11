# Privacy

Kairo è progettato perché **nessuno, nemmeno l'autore, possa vedere i tuoi dati**.

- **Dove stanno i dati:** nel database D1 del *tuo* account Cloudflare. Non esiste un server centrale di Kairo.
- **Chi può leggerli:** solo chi conosce il tuo codice di accesso. Il server ne conserva l'hash SHA-256, non il codice.
- **Chiavi:** codice di accesso e chiave Groq sono salvati nel browser del tuo dispositivo (`localStorage`). Uscendo da Impostazioni vengono rimossi.
- **Intelligenza artificiale:** al modello (Groq o Cloudflare Workers AI) vengono inviati solo riassunti numerici giornalieri (score, HRV, FC, durata del sonno, check-in) e le tue domande. Consulta le policy di [Groq](https://groq.com/privacy-policy/) e [Cloudflare](https://www.cloudflare.com/privacypolicy/).
- **Backup:** il comando salva una copia di ogni invio nella cartella `Kairo` del tuo iCloud Drive.
- **Nessun tracciamento:** niente analytics, cookie di terze parti, font o script esterni.
- **Controllo totale:** da Impostazioni puoi esportare tutto in JSON o cancellare tutti i dati dal server.
