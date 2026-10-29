# Spec Delta

## ADDED Requirements

### Requirement: Album e generi nel backup
Il backup della libreria del dispositivo SHALL includere gli album (titolo, artista, anno, ordine dei brani, origine automatica o manuale, stato della ricerca automatica), le copertine assegnate agli album e i generi dei brani. All'importazione album e generi SHALL essere uniti a quelli presenti senza creare duplicati, con le stesse regole di confronto del raggruppamento automatico.

#### Scenario: Ripristino con album
- **WHEN** l'utente importa su un telefono nuovo un backup con 5 album, di cui 2 con copertina assegnata, e brani con generi
- **THEN** la libreria ha gli stessi 5 album con le stesse copertine, lo stesso ordine dei brani e gli stessi generi

#### Scenario: Album già presente
- **WHEN** l'utente importa un backup con l'album "In Utero" di "Nirvana" e quell'album esiste già sul dispositivo
- **THEN** la libreria contiene un solo album "In Utero" con i brani di entrambi

### Requirement: Compatibilità con i backup precedenti
Un backup prodotto prima dell'introduzione di album e generi SHALL restare importabile: i brani SHALL essere raggruppati in album dai loro metadati come alla migrazione. Un backup che contiene album e generi SHALL restare leggibile dalle versioni dell'app che non li gestiscono, che ignorano quelle informazioni.

#### Scenario: Backup vecchio
- **WHEN** l'utente importa un backup esportato prima dell'aggiornamento, con brani che hanno album nei metadati
- **THEN** i brani vengono importati e raggruppati nei rispettivi album
