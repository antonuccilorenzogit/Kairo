# Changelog

Tutte le modifiche rilevanti di Kairo. Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il [Semantic Versioning](https://semver.org/lang/it/).

## [1.23.0] — 2026-10-13

### Migliorato
- **Pesante + back-off autoregolate.** La pesante si fa a 1–2 ripetizioni dal cedimento e dopo averla spuntata segni quante ripetizioni ti restavano (**0 · 1 · 2 · 3+ in riserva**, al posto di facile/giusta/al limite). Ripetizioni fatte + in riserva stimano il tuo massimale di oggi (Epley) e da lì Kairo calcola subito il peso delle back-off **a cedimento** nel loro range, e del drop. Esempio, pesante 100 kg × 7: con 3+ in riserva back-off a 97,5 kg, con 1 a 92,5 kg, con 100 × 5 e 0 in riserva a 85 kg. Se correggi peso o ripetizioni della pesante, le back-off si ricalcolano.
- **Calo dopo la pesante imparato su di te**: parte da circa 7% e si aggiusta con le ultime 3 sedute (back-off migliori del previsto → più pesanti la volta dopo, peggiori → più leggere).
- **Pesante della volta dopo dal massimale stimato**: il peso per fare il massimo del range con 1–2 in riserva, entro i limiti di sempre (+1/+2 incrementi, resta se eri senza riserva al minimo utile, −10% dopo 3 sedute ferme, scarico nella quarta settimana del piano).
- **Fatica dei muscoli**: le serie a cedimento (back-off, drop, pesante senza riserva) contano 1,3 e si smaltiscono più lentamente (fino a 72 ore), così la scheda dello stesso muscolo non torna troppo presto.

## [1.22.2] — 2026-10-13

### Corretto
- **Troppe letture del database** (avviso di Cloudflare: 76% del limite gratuito di 5 milioni di righe al giorno). Cloudflare D1 conta ogni riga che una query scorre, non solo quelle restituite:
  - il calcolo del recupero scorreva anche tutta la frequenza cardiaca grezza (migliaia di righe al giorno) per scartarla: ora legge solo HRV, FC a riposo, respirazione e ossigeno attraverso la chiave (metrica, data);
  - Stato di Kairo (aperto anche da ogni visita alle Impostazioni) contava tutte le righe di tutte le tabelle a ogni apertura: ora i conteggi si rifanno una volta al giorno, e ciò che deve essere aggiornato (ultimi dati arrivati) usa gli indici;
  - lo storico calcolato resta in memoria finché nessuna richiesta scrive dati: aprire più pagine di seguito non lo ricalcola ogni volta;
  - il promemoria serale non ricalcola niente dopo che è già stato inviato;
  - le ultime sedute di ogni esercizio si trovano con un indice, senza scorrere tutte le serie mai registrate.
- **Letture del database in Stato di Kairo**: totale di oggi e di ieri, le funzioni che leggono di più e un avviso sopra il 60% del limite.

## [1.22.1] — 2026-10-12

### Corretto
- **Il pisolino contava due volte**: toglieva i suoi minuti sia dal debito di sonno sia dal sonno di stanotte. Ora conta una volta sola, insieme alla notte che lo segue (la stessa regola della stima del fabbisogno): stanotte ti serve meno sonno e vai a letto più tardi, ma il debito non cala subito. Domani mattina pisolino e notte vengono contati insieme: se hai dormito quanto serviva, il debito scende della rata di stanotte.
- **Debito di sonno come saldo**: prima contava solo le notti corte degli ultimi 7 giorni e le notti più lunghe non lo ripagavano. Ora è il saldo dei 7 sonni rispetto al tuo fabbisogno: le notti corte lo aumentano, quelle più lunghe lo riducono (al massimo un'ora per notte). Pagina Sonno e notifica della sera usano lo stesso numero.

## [1.22.0] — 2026-10-12

### Cambiato
- **Nuovo aspetto «Strumento»**: fondo quasi nero, superfici scure con bordi sottili, un solo colore d'accento (l'arancione) e i colori di stato (verde, giallo, rosso) più luminosi per leggersi sul nero. Pulsanti principali arancioni, barra in basso traslucida come su iOS.
- **Testo arrotondato e più deciso**, come in iOS: su iPhone e Mac Kairo usa il carattere di sistema arrotondato (SF Pro Rounded); altrove Nunito. Numeri a larghezza fissa, così i valori non «ballano».
- Solo grafica: funzioni, pagine e calcoli sono gli stessi della 1.21.0.

## [1.21.0] — 2026-10-12

### Migliorato
- **Il sonno che ti serve, stimato davvero** (con «Sonno che ti serve: Automatico» nel profilo). Prima era la mediana delle notti dopo cui il Recupero era verde: un calcolo circolare (il Recupero contiene già il sonno) che misurava le abitudini più che il bisogno e scambiava per «corte ma sufficienti» le notti dopo un pisolino. Ora Kairo usa i due metodi della ricerca sul sonno:
  - **come ti svegli dopo ogni notte**: sonno delle 24 ore (notte + pisolini del giorno prima) contro la mattina dopo (HRV rispetto alla tua media ed energia del check-in, mai lo score di Recupero), corretto per l'allenamento del giorno prima. Cerca il punto oltre cui dormire di più non migliora più la mattina;
  - **i risvegli senza sveglia** dopo notti senza debito: in quelle notti dormi circa quello che ti serve.
- Servono almeno 30 notti con il Watch e un segnale del mattino; le notti con alcol, malanno o viaggio restano fuori. Se i dati non mostrano un punto chiaro, Kairo tiene il riferimento di 8 ore e lo dice: mai un numero inventato. La pagina Sonno mostra da dove viene la base («la tua, stimata da 42 notti, ±15 min»).

## [1.20.1] — 2026-10-12

### Migliorato
- **Aggiornamento automatico ogni notte** invece che ogni lunedì: l'azione *Aggiorna Kairo* gira verso le 6 italiane e, se non c'è una versione nuova, non fa nulla. Vale per le copie nuove; per quelle già installate basta cambiare una riga (vedi `docs/SETUP.md`, *Aggiornamenti*).

## [1.20.0] — 2026-10-12

### Aggiunto
- **Pisolini.** Quelli registrati dal Watch arrivano da soli; se il Watch non li registra si segnano dalla pagina Sonno («+ Segna un pisolino», con orario di inizio e fine). Un pisolino registrato sia dal Watch sia a mano conta una volta sola.
  - **Conta minuto per minuto** (come Whoop, Oura e Rise): un pisolino di un'ora toglie un'ora dal debito di sonno della settimana e un'ora dal sonno che ti serve stanotte (mai sotto le 6 ore), quindi l'ora per andare a letto si sposta più tardi. Lo dicono la pagina Sonno, la card in Oggi e la notifica della sera. Funziona anche durante il settaggio.
  - **Recupero**: quello di oggi non cambia (è la fotografia del mattino). Dal giorno dopo il pisolino conta nel debito di sonno della settimana e nel bilancio di 14 notti.
  - Nel grafico degli ultimi 7 giorni il pisolino è la parte chiara sopra la barra.
- **Infortunio: esercizi fatti?** Nella scheda dell'infortunio i pulsanti «Fatti ✓», «In parte», «Saltati». Il coach ne tiene conto: se li salti o li fai solo in parte, il giorno dopo non aumenta.

## [1.19.1] — 2026-10-12

### Corretto
- **Scaricare HealthSync dall'app sulla schermata Home**: il link si apriva in un browser interno che non sa salvare file (pagina bianca). Ora si apre direttamente in Safari, dove il download funziona; in più c'è «Copia il link e aprilo in Safari».
- **Collegamento iPhone** ha il pulsante «Scarica HealthSync» con i passi per sostituire il comando vecchio e ricollegare le automazioni.

## [1.19.0] — 2026-10-12

### Aggiunto
- **Palestra: pesante + back-off (+ drop).** Per ogni esercizio della scheda scegli «Serie uguali» o «Pesante + back-off»: serie totali, range di ripetizioni della pesante, quanto sono più leggere le back-off (8–25%) e un drop set finale facoltativo. Le schede restano le tue.
- **La progressione guarda la serie pesante**: dopo averla fatta segni com'era (facile / giusta / al limite). Con le ripetizioni in cima al range o oltre sale (+1 incremento, +2 se era facile o hai fatto 2 ripetizioni in più); al limite resta finché non diventa più facile; dentro il range punta a una ripetizione in più; sotto il range scende. Ferma da 3 sedute → −10% e si risale.
- **Back-off e drop calcolati dalla pesante**: le back-off hanno 2 ripetizioni in più della pesante e una percentuale che si adatta a come sono andate (tutte in cima al range → un po' più pesanti, sotto → più leggere); il drop è −25% dalle back-off, a cedimento. Se cambi il peso della pesante durante la seduta, back-off e drop si ricalcolano.
- **Riscaldamento suggerito** in chili (50% × 8, 70% × 4, 85% × 2) prima della pesante.
- Le serie si salvano con il loro tipo (pesante, back-off, drop): progressi e fatica muscolare li contano correttamente. Le schede create con il coach riconoscono «top set», «back-off» e «drop set».

### Migliorato
- La progressione è calcolata dal server con regole fisse (stessa logica per schede vecchie e nuove) ed è coperta da test.
- Nella settimana di scarico del piano: pesante −10%, una back-off in meno e niente drop.

## [1.18.0] — 2026-10-12

### Aggiunto
- **Piano di allenamento** (Impostazioni → Piano di allenamento): scegli quante sedute a settimana di palestra, nuoto, corsa e bici, i giorni in cui puoi allenarti, il tempo nei feriali e nel weekend e, per ogni sport di resistenza, l'obiettivo (forma generale, resistenza su una distanza, velocità) e il livello di partenza. Tutto è calcolato con regole fisse, senza IA: stessi dati, stesso piano.
- **Blocchi da 4 settimane**: tre che salgono e una di scarico con i test. Circa 80% di sedute facili e 20% dure; le sedute dure sono distanziate, i lunghi vanno nel weekend, mai due sedute dello stesso sport nello stesso giorno. Se le sedute non stanno nei giorni scelti, Kairo dice quali restano fuori.
- **Sedute vere per nuoto, corsa e bici**: facile/tecnica, soglia, velocità, lungo e test, con riscaldamento, parte centrale e defaticamento, nel tempo che hai quel giorno. **Progressione**: ogni seduta fatta alza il livello di quel tipo di seduta (+2 se era facile, fermo se era dura, giù dopo due dure di fila o dopo una pausa lunga) e la prossima volta la seduta è più lunga o più intensa.
- **Ritmi solo dai test**: nuoto 400 + 200 m (CSS), corsa e bici 30 minuti (ritmo e FC di soglia). Senza test le sedute sono a sensazione e con le zone di battito, mai con ritmi inventati. I test aggiornano ritmi e zone e mostrano i progressi.
- **Seduta di oggi in home**: titolo, perché, struttura, cosa ha registrato il Watch (tempo, distanza, passo, FC) ed esito con «facile / giusta / dura / saltata» e i risultati del test.
- **Adattamenti automatici**: una seduta dura saltata si sposta al primo giorno libero della settimana; con recupero rosso o un allarme la seduta dura di oggi si scambia con una facile (non durante il settaggio). Con l'infortunio il piano va in pausa e, quando sei guarito, riparte dal blocco 1.
- **Pagina Piano**: blocco e settimana, calendario con esiti, riferimenti dai test con il confronto con il test precedente, volume registrato dal Watch nelle ultime 8 settimane.
- **Sedute riconosciute**: HealthSync 1.3.0 manda le distanze di nuoto, bici e corsa ora per ora; Kairo le abbina alle sedute rilevate dal battito e ne ricava sport, distanza e passo. **Va scaricato di nuovo HealthSync** (Impostazioni → Collegamento iPhone); Stato di Kairo avvisa se hai quello vecchio.

### Migliorato
- **Palestra: progressione dei carichi più precisa.** Incrementi diversi per tipo di esercizio (+5 kg sui grandi multiarticolari delle gambe sopra i 60 kg, +1 kg sui piccoli di isolamento), +2 incrementi se il range è chiuso con margine (RPE ≤ 7), −1 incremento se sei sotto il range, e nella settimana di scarico −10% e una serie in meno. Le schede restano le tue.
- Il coach conosce il piano (blocco, settimana, sedute, riferimenti, progressi dei test): lo spiega e motiva, non lo cambia.
- Durante il settaggio, senza piano, nessun allenamento consigliato basato sullo score (e nessuna chiamata all'IA); con il piano le sedute ci sono, perché non dipendono dallo score.
- Il backup comprende anche serie di palestra, schede, piano, esiti del piano, test e profilo.

## [1.17.0] — 2026-10-12

### Aggiunto
- **Settaggio iniziale**: finché non ci sono 14 notti con l'HRV, 10 notti con il Watch, 10 giorni con la FC a riposo e l'età (o la FC massima) nel profilo, Kairo non mostra score di recupero, allenamento consigliato, messaggio del coach e notifica del punteggio. In home restano solo ciò che è già affidabile: sonno, palestra, check-in e, se attivo, il piano dell'infortunio. Una scheda «Settaggio · giorno N» mostra quante notti mancano.
- **Pagina Settaggio** (da home o Impostazioni): avanzamento dei dati e lista di cosa impostare (età/FC massima, invio automatico, sport, schede, sveglia), Respira e check-in consigliati, e **«Ricomincia da oggi»** (nuovo Watch, lungo stop): le medie ripartono da quel giorno. A settaggio completato non torna indietro da solo.
- **Altri sport**: calcio, padel, tennis, basket, pallavolo, arrampicata, sci, arti marziali. Kairo non li pianifica, ma compaiono nel check-in e nell'esito, il coach li conosce e dopo una partita non propone sedute intense. Il carico arriva comunque dal battito registrato dal Watch.

### Migliorato
- Durante il settaggio il coach in chat non cita recupero e carico e parla di sonno, palestra e di come completare il settaggio; l'allenamento proposto resta a intensità media.

## [1.16.0] — 2026-10-12

### Migliorato
- **Score di Recupero più serio: solo 5 ingredienti** misurati dal Watch: HRV 40% (26–40% secondo quante misure ha fatto il Watch), sonno 25% (75% la notte, 25% il bilancio delle ultime 14 notti), FC a riposo 20%, carico 10% (ieri rispetto al tuo giorno tipico e rapporto 7/28 giorni), respirazione 5%. Meno pesi = meno rumore con dati scarsi.
- **Come ti senti fuori dallo score**: l'energia del check-in compare in una scheda accanto al Recupero, non dentro. Così lo score è solo fisiologia e si può controllare se ci azzecca.
- **Avvisi invece di ingredienti**: stabilità dell'HRV (7 giorni) e ossigeno notturno compaiono solo quando sono fuori dal normale; l'ossigeno basso conta anche nell'allarme malanno.
- **Nuova base dopo l'infortunio**: con la modalità infortunio attiva le medie personali usano solo i giorni dopo l'infortunio (dal terzo giorno, se ci sono almeno 5 notti), perché il corpo è in un'altra fase. Sotto lo score: «Rispetto ai giorni dopo l'infortunio».
- **HRV del mattino al centro**: prima del check-in Kairo chiede «1 minuto di Respira sul Watch, ancora a letto»; quando c'è mostra «HRV del mattino ✓». Dopo 5 mattine diventa il valore principale.
- **Verifica dello score non circolare**: «Lo score funziona per te?» usa le sedute in palestra oppure, senza palestra (es. infortunio), l'energia del check-in, che non entra nel calcolo.
- I giorni già bloccati con la formula precedente vengono ricalcolati una volta con quella nuova.

## [1.15.2] — 2026-10-12

### Corretto
- **Il recupero non cambia più durante il giorno**: si blocca appena ci sono il check-in e la notte completa, nello stesso momento in cui il coach scrive il messaggio, così score e messaggio restano coerenti. I dati che arrivano dopo (FC a riposo di Apple, misure di giorno, pisolini) contano da domani nelle tue medie. Modificando il check-in recupero e messaggio si rifanno insieme. Nel foglio della precisione: «Lo score di oggi è definitivo, calcolato alle …».

## [1.15.1] — 2026-10-12

### Migliorato
- **Pagina Recupero minimal**: sotto lo score solo «precisione alta/media/bassa»; toccandola si apre perché è così (misure di HRV rispetto al tuo solito, FC a riposo, medie in costruzione) e tra quanti giorni sarà massima. Tolti incertezza, tendenza e riepilogo ripetuto. La stima di domani compare solo quando è personale (dopo 8 notti piene), cioè quando è precisa. In home: «Recupero · ▼ N da ieri · precisione bassa» solo quando serve.

## [1.15.0] — 2026-10-12

### Migliorato
- **Stima di domani personale**: «se stanotte dormi quello che ti serve, domani tra X e Y». Dopo 8 notti piene Kairo impara dal tuo storico come rispondi a una buona dormita (retta tra lo score del giorno prima e quello dopo una notte piena, con il ritorno verso la tua media) e calcola il margine dagli errori passati; prima usa una stima generica (sonno pieno e HRV a metà strada verso la tua media) con margine ±12.
- **Precisione massima tra N giorni**: un solo riquadro con barra di avanzamento dice quanti giorni di fila con il Watch, anche di notte, servono perché score e stima siano al massimo della precisione.

## [1.14.0] — 2026-10-12

### HRV più efficace e dati in attesa spiegati
- **Misura del mattino separata**: l'HRV misurata entro 60 minuti dal risveglio (es. 1 minuto di Respira) è una serie a sé con la sua media personale, perché il respiro guidato alza l'HRV. Dopo 5 mattine diventa il valore principale; prima non altera il punteggio.
- **Con poche misure pesa di più la media dei 7 giorni** (Plews): stanotte 60% con 3+ misure, 50% con il tuo numero abituale, 30% con meno del solito.
- **Affidabilità rispetto al tuo solito numero di misure** (il Watch ne fa da 1 a 5 a notte, dipende dalla persona), non a una soglia fissa.
- **Stabilità dell'HRV** solo su valori affidabili (mattine o notti con almeno 2 misure); l'allarme «HRV instabile» non scatta con dati scarsi.
- **Dati in arrivo**: in Recupero un riquadro spiega che non devi fare niente e quanti giorni mancano per ogni dato (medie personali, FC nel sonno, stabilità, respirazione, misura del mattino); ogni voce dice «tra N giorni» invece di «nessun dato».

## [1.13.0] — 2026-10-12

### Recupero più serio e più resistente
- **Stabilità dell'HRV**: coefficiente di variazione a 7 giorni confrontato con il tuo (Plews); nuovo allarme «HRV instabile» quando oscilla molto più del solito mentre la media cala.
- **Medie personali robuste**: mediana e deviazione robusta (MAD), senza i giorni segnati con alcol, malanno o viaggio.
- **Come ti senti** (energia, indolenzimento, umore del check-in) entra nello score con peso 10% (Saw et al. 2016).
- **Misura del mattino**: valgono anche le misure HRV fino a 60 minuti dopo il risveglio, così un Respira di 1 minuto a letto rende il dato più affidabile.
- **Etichette nel check-in**: alcol, malanno, viaggio, stress, cena tardi, allenamento serale; spiegano il punteggio e le prime tre escono dalle medie.
- **Attività di ieri e bilancio di attività** (7/28 giorni) come contributi, come nella Readiness di Oura.
- **Ossigeno notturno**: un calo rispetto al tuo solito abbassa lo score.
- **Meno salti**: con poche misure lo score cambia al massimo di 15 punti da ieri; incertezza (±) e tendenza a 3 giorni accanto al valore.
- **Verifica personale**: «Lo score funziona per te?» confronta il tuo rendimento in palestra nei giorni verdi e negli altri.
- **Spiegazione**: cosa ha pesato di più oggi (in punti) e stima di domani se stanotte dormi quello che ti serve.
- Pesi: HRV 30% (24% con 2 misure, 17% con 1), sonno 20%, FC a riposo 15%, come ti senti 10%, bilancio di sonno, respirazione e stabilità HRV 5%, attività di ieri 4%, bilancio di attività e ossigeno 3%.

## [1.12.0] — 2026-10-12

### Migliorato
- **HRV più affidabile**: mediana delle misure notturne (un valore storto non sposta più il punteggio) e peso nel recupero in base a quante misure ha fatto il Watch (3+ → 0,35, 2 → 0,28, 1 o solo di giorno → 0,20). Il recupero mostra l'**affidabilità** (alta, media, bassa).
- **Allenamenti rilevati dal battito**: periodi di almeno 10 minuti sopra il 60% della FC massima diventano sessioni con durata, FC media e carico, anche senza avviare l'allenamento sul Watch; lo sport è dedotto da distanze di nuoto e bici. Il check-in le mostra e precompila durata e sport; il coach le conosce.
- **Carico della palestra senza RPE**: le sedute importate senza fatica percepita o durata contano con RPE 7 e circa 3 minuti per serie, invece di zero.
- **Esito dell'allenamento del giorno**: «Fatto ✓», «Fatto altro» (con lo sport) o «Saltato»; entra nella rotazione degli sport.
- **Zone di frequenza cardiaca in bpm** (dalla tua FC massima) nelle sedute di nuoto, bici e corsa, anche nelle indicazioni dell'IA.
- **Progressione più furba**: dopo 3 sedute ferme allo stesso carico propone uno scarico del 10%; con il range chiuso ma RPE 9,5–10 non aumenta.
- **Esercizi da collegare**: in Palestra gli esercizi che Kairo non riconosce si collegano a un muscolo una volta per tutte (o «nessuno» per cardio e stretching).
- **Pagina Settimana chiara**: legenda completa (carico e colori del recupero), giorni toccabili con i numeri, freccia del carico neutra, «notti registrate su 7».
- **Sonno necessario personale**: con «Automatico» nel profilo Kairo impara quanto ti serve dalle notti dopo cui ti svegli recuperato (mediana di almeno 8 notti, tra 7 e 9,5 ore).
- **Avviso di aggiornamento** nell'app quando c'è una versione nuova; **chat più leggera**: contesto di 14 giorni tenuto pronto per 30 minuti.

## [1.11.0] — 2026-10-12

### Cambiato
- **Prima il check-in**: finché non fai il check-in del mattino la pagina Oggi mostra solo l'invito a farlo (o «Oggi salto il check-in»). Messaggio del coach e allenamento del giorno vengono scritti una volta sola, dopo il check-in e con tutte le informazioni: niente più doppia generazione. Anche la notifica del mattino invita al check-in. I testi aspettano anche la **notte completa** (le fasi del sonno del Watch, che arrivano qualche minuto dopo la sveglia; dalle 10 vengono scritti comunque): finché manca, le schede dicono «Aspetto la notte completa · tocca per aggiornare» e lanciano HealthSync. Così vengono scritti una sola volta, con tutti i dati, e non serve più rifarli quando arriva la notte.

## [1.10.2] — 2026-10-12

### Migliorato
- La finestra della «notte passata» è quella vera del tuo sonno, la stessa del recupero: da 30 minuti prima di addormentarti al risveglio. HRV, FC e respirazione misurate dopo il risveglio non fanno più rigenerare consiglio e allenamento (se il sonno non è ancora arrivato vale la finestra 18:00–12:00).

## [1.10.1] — 2026-10-12

### Migliorato
- Consiglio del coach e allenamento del giorno si rifanno **solo se arrivano dati della notte appena passata** (dalle 18 di ieri a mezzogiorno di oggi): l'HRV misurata di giorno non li fa più rigenerare, così più invii di HealthSync al giorno non consumano IA.

## [1.10.0] — 2026-10-12

### Aggiunto
- **FC a riposo pronta alla sveglia**: Kairo calcola la frequenza più bassa mentre dormi (media di 10 minuti nelle fasi di sonno), come Oura e Whoop, appena arrivano battiti e sonno, e la usa nel recupero confrontandola solo con le tue altre notti (dopo 5 notti; prima usa la FC a riposo di Apple, che arriva durante la giornata). Le ultime 60 notti vengono calcolate da sole al primo invio.
- **Pulsante ↻ nella pagina Oggi**: lancia HealthSync; tornando in Kairo la pagina si aggiorna con i dati nuovi.

## [1.9.1] — 2026-10-12

### Corretto
- **Notte incompleta al risveglio**: il Watch elabora le fasi del sonno qualche minuto dopo la sveglia, quindi il primo invio poteva avere la notte a metà. Ora quando arrivano dati nuovi della notte (fasi, HRV, FC a riposo, respirazione) consiglio del coach e allenamento del giorno vengono rifatti; la notifica del mattino aspetta la notte completa (dopo le 10 parte comunque); nella pagina Oggi la riga del sonno dice «Il Watch sta elaborando la notte · tocca per aggiornare», che lancia HealthSync, e al ritorno la pagina si aggiorna. Nella guida c'è una terza automazione consigliata: *Ora del giorno*, 30 minuti dopo la sveglia.

## [1.9.0] — 2026-10-11

### Aggiunto
- **Fatica per gruppo muscolare**: dalle serie registrate Kairo sa quali muscoli sono stanchi (serie delle ultime 72 ore, con peso che cala col passare delle ore) e quante serie hai fatto a settimana per muscolo (fascia 10–20, Schoenfeld 2017). Ogni esercizio pesa soprattutto sul muscolo principale: per la panca petto 1, tricipiti 0,3, spalle 0,2 serie. L'allenamento del giorno sceglie la scheda con i muscoli più freschi e l'IA evita di ricaricare quelli stanchi; il coach ne tiene conto; nella pagina Palestra c'è la scheda «Muscoli».

## [1.8.2] — 2026-10-11

### Corretto
- Toccando il messaggio del coach nella pagina Oggi si apre il **messaggio completo** (prima portava alla chat, dove non c'era); da lì «Parla con il coach» apre la chat.
- Se l'orario per andare a letto è già passato, la pagina Oggi dice «È ora di andare a letto» invece di un orario passato.

## [1.8.1] — 2026-10-11

### Migliorato
- **Tutto uguale su iPhone e PC**: la chiave Groq ora è salvata sul tuo server, così anche sul PC il coach usa Groq e non il modello di riserva. Chi l'aveva sul telefono se la ritrova spostata da sola al primo avvio. L'app ne mostra solo le ultime 4 cifre; non entra in backup ed esportazioni; si toglie da *Impostazioni → Coach IA*. Memoria del coach, profilo, chat, infortunio, schede e dati erano già sincronizzati.

## [1.8.0] — 2026-10-11

### Migliorato
- **Impostazioni a menu**: una lista pulita divisa in Tu, App, Dati e Altro; ogni riga mostra lo stato (es. notifiche attive, ultimo invio, ultimo backup) e si apre nella sua pagina: Profilo, Sport e infortunio, Cosa ricorda il coach, Notifiche, Coach IA, Collegamento iPhone, Backup ed esportazione, Codice di accesso e account.
- **Stato di Kairo** (prima Diagnostica): in alto «Tutto funziona» o quante cose sono da sistemare; sotto 7 controlli in parole semplici (server, versione, iPhone, dati del Watch, coach IA, backup, questo telefono), ognuno con cosa fare se c'è un problema. I dati tecnici sono in «Dettagli tecnici».

## [1.7.0] — 2026-10-11

### Migliorato
- **Pagina Oggi minimal, tutta in una schermata**: schede più compatte per recupero, sonno (una riga, con l'orario per andare a letto solo la sera), coach (messaggio in 3 righe), check-in e settimana (una riga ciascuno).
- **Allenamento del giorno compatto**: l'allenamento del giorno (o il piano dell'infortunio) è una scheda di due righe, cioè cosa fare, sport, durata e intensità (o dolore e giorno). Toccandola si apre il dettaglio con la seduta completa, «Inizia scheda», «Altra proposta», il carico di allenamento e, in modalità infortunio, la scala del dolore, le indicazioni del medico e gli avvisi.

## [1.6.1] — 2026-10-11

### Migliorato
- **Le indicazioni del medico sono vincoli assoluti**, per tutti: nel foglio dell'infortunio c'è la sezione *Indicazioni del medico* (niente carico e fino a quando, stampelle, movimento massimo in gradi, altre indicazioni). Se sono scritte solo nella descrizione («divieto di carico per 30 giorni», «stampelle», «flessione limitata a 90°») Kairo le riconosce da solo.
- Il server **controlla il piano dell'IA**: se propone qualcosa che viola un vincolo (esercizi in piedi, camminate o in appoggio senza carico, angoli oltre il limite, braccia con le stampelle) lo scarta e usa una seduta sicura che li rispetta. Le sedute di riserva sono verificate dai test per ogni zona del corpo.
- La scheda del giorno mostra le *Indicazioni del medico rispettate*; il coach (anche in chat) le riceve come vincoli.
- Esercizi spiegati in italiano semplice, fattibili nella situazione reale, senza blocchi di riempimento; parte alta da seduto per gli infortuni alle gambe.

## [1.6.0] — 2026-10-11

### Aggiunto
- **Modalità infortunio**: in *Impostazioni → I tuoi sport* (o dalla pagina Oggi, «Ti sei fatto male?») attivi **🩹 Infortunio** e descrivi cosa ti è successo e da quando. Finché è attiva il coach non propone allenamenti normali: ogni giorno, in cima alla pagina Oggi, ti dice se **riposare**, quali **esercizi riabilitativi** fare o come **allenare il resto del corpo**, in base a quanto ti fa male (0–10) e ai giorni passati. Regole di sicurezza da PEACE & LOVE (Dubois & Esculier 2020) e dal pain-monitoring model (Silbernagel 2007): riposo nei primi giorni o con dolore da 7/10 in su, esercizi solo con dolore fino a 3/10; l'IA può essere più prudente delle regole, mai meno. Il coach, la chat e la notifica del mattino ne tengono conto; «Sono guarito» la disattiva.

## [1.5.0] — 2026-10-11

### Aggiunto
- **Il coach ricorda**: quando in chat gli racconti qualcosa di importante (una gara con la data, un dolore, un obiettivo, una preferenza) se lo segna e lo usa in tutti i consigli successivi: chat, messaggio del mattino, resoconto della settimana e allenamento del giorno. Sotto la risposta compare «📌 Me lo segno: …». Quando una cosa non vale più la dimentica da solo. In *Impostazioni → Cosa ricorda il coach* puoi vedere, aggiungere ed eliminare i ricordi. La memoria è inclusa nei backup.

### Migliorato
- Meno letture e scritture sul database: nuovi indici per sonno e totali giornalieri, i dati reinviati uguali non vengono riscritti, il controllo della notifica serale gira solo la sera.

## [1.4.0] — 2026-10-11

### Aggiunto
- **Allenamento del giorno dall'IA**: sceglie tra i tuoi sport (palestra, nuoto, bici, corsa, attivabili in Impostazioni) cosa fare, con quale intensità (leggero, medio, intenso) e, per nuoto, bici e corsa, la seduta completa con riscaldamento, tecnica e andature, parte centrale e defaticamento; per la palestra quale scheda. Recupero, carico e allarmi limitano l'intensità; «Altra proposta» cambia sport; senza IA usa sedute tipo.
- **Sezione Palestra** (nella barra in basso): schede con serie e range di ripetizioni, **compilate dal coach** a partire da una descrizione; **allenamento in corso** sul telefono anche senza rete, con carichi dell'ultima volta e suggerimento di progressione, RPE della seduta a fine allenamento; progressione dei massimali.
- **Importa dati** da Salute, Hevy e **Strong** in un'unica pagina.
- **Carico di allenamento**: TRIMP di Edwards dalla frequenza cardiaca (FC max misurata o stimata con Tanaka) e session-RPE di Foster per la palestra; rapporto acuto:cronico 7/28 giorni con stato (scarico, mantenimento, costruzione, attenzione, eccesso) e grafico di 28 giorni.
- **Allarmi** di malanno in arrivo o fatica accumulata, mostrati solo quando servono.
- **Sonno: quanto ti serve stanotte** e a che ora andare a letto (base + carico del giorno + debito); **notti senza Watch** con le ore dichiarate nel check-in.
- **Report settimanale** con il resoconto del coach.
- **Forza**: massimale stimato con Epley, record e serie per settimana; le sedute con RPE entrano nel carico.
- **Notifiche** (solo due al giorno): recupero e allenamento consigliato la mattina, orario per andare a letto la sera. Web Push senza servizi esterni.
- **Profilo e conversazione con il coach salvati sul server**: uguali su iPhone e PC; nuovi campi FC massima, sveglia, sonno necessario.
- **Pagina Corpo**: composizione corporea, qualità del cambiamento (ricomposizione, definizione…), "Motore" con VO₂max, età del cuore e frequenza cardiaca, diario e confronto di due misure.
- Profilo con età e sesso (per età del cuore e riferimenti).
- **Backup automatici** ogni settimana e prima di ogni cancellazione (ultime 8 copie), con download e **ripristino** dalle Impostazioni.
- **45 test automatici** e controllo su GitHub a ogni modifica.

### Migliorato
- **Pagina Oggi essenziale**: recupero, allenamento di oggi, sonno, coach, check-in. I dettagli (HRV, FC, passi) sono nelle pagine dedicate; la respirazione compare solo quando abbassa il recupero.
- Il recupero non supera di oltre 20 punti il segnale di HRV e FC a riposo: un buon sonno non compensa un sistema nervoso in allarme.
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
