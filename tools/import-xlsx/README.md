# import-xlsx

Legge il vecchio Excel del kakebo e prepara un **file di storico** da caricare nell'app
(Impostazioni → Storico → *Carica lo storico dal vecchio Excel*), più un **report di
riconciliazione** da leggere prima di caricarlo.

Il repository è pubblico: Excel, configurazione, storico e report stanno solo in `private/`
(il comando si rifiuta di scrivere altrove).

```bash
pnpm --filter @kakebo/import-xlsx start
```

Opzioni (tutte facoltative, i default puntano a `private/`):

| opzione | default |
| --- | --- |
| `--xlsx` | `private/kakebo.xlsx` |
| `--catalog` | `private/fixtures/catalog-2026-11.json` (per i nomi di conti e voci) |
| `--config` | `private/import-xlsx.config.json` |
| `--out` | `private/history.json` |
| `--report` | `private/history-report.md` |

## Cosa legge

- `Calcolo 10 <mese>. <aa>`: voci con conto (A descrizione, B giorno, C importo, D conto; un
  importo finito in colonna E viene usato e segnalato) e il riepilogo per conto, trovato per
  etichette (*Saldo Attuale*, *Bon. Effett.*).
- `Calcolo new 10 <mese>. <aa>`: movimenti con segno (A, B giorno, C importo, D progressivo;
  riga 1 = saldo iniziale complessivo).
- `Scadenze` (mesi in colonna) e `Debiti` (solo colonne A–D).

Fusione per mese: **date e importi dal "new"**, **conto dal "Calcolo 10"** (abbinamento per
descrizione), altrimenti dal catalogo; le righe del "new" senza corrispettivo diventano
movimenti già avvenuti. Le entrate contano per ciclo (lo stipendio del 9 è del mese), le uscite
per data. Nessun importo viene inventato: quello che manca finisce nel report.

## Configurazione (esempio inventato)

```json
{
  "months": ["2026-09", "2026-10", "2026-11"],
  "draftMonths": ["2026-11"],
  "accountAliases": { "Banca Viola new": "Banca Viola" },
  "defaultAccount": "Conto Giorno",
  "transferSource": "Banca Viola",
  "plannedOn": { "2026-11": "2026-11-09" },
  "knownBalances": { "2026-09": { "Banca Blu": 120.5, "Banca Viola": 1800 } },
  "calendarSkip": ["vecchio fornitore"]
}
```
