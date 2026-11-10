# kakebo

Programmazione mensile delle finanze di casa, ispirata al *kakebo* giapponese (家計簿, il libro dei conti domestico).

Ogni mese, intorno al 10, si inseriscono i saldi dei conti correnti; l'app proietta entrate e uscite fino al 10 del mese successivo e suggerisce **quali bonifici fare tra i conti, e entro quando**, perché nessun conto vada in rosso. Quello che avanza va sul conto di tutti i giorni.

Web app ora, app native iOS/Android più avanti. Self-hosted (Docker) dietro Cloudflare Tunnel + Cloudflare Access: **l'app non ha un login proprio**.

> Il repository è pubblico: non contiene dati reali né segreti. I dati veri vivono solo nel database del container e in `private/` (ignorata da git).

## Struttura

```
packages/core/   motore di calcolo e utilità condivise (TypeScript puro, Vitest)
apps/api/        Hono su Node: API REST, verifica del JWT di Cloudflare Access, serve il web
apps/web/        React + Vite + TanStack Query + Tailwind (design "Il quaderno")
docker/          Dockerfile, compose.yaml, .env.example
.githooks/       hook di pre-commit (file privati e segreti)
.github/         CI, release manuale dell'immagine, Dependabot
```

## Il motore di calcolo

`packages/core` è codice puro, senza I/O, usato da API, web e (poi) app native.

- **Ciclo**: va fino al 10 del mese successivo incluso. Le spese contano per data, le entrate per ciclo: lo stipendio del mese dopo non si conta mai.
- **Saldi con data**: ciò che è datato prima del saldo si considera già compreso (si può smentire); il resto entra nella proiezione.
- **Bonifici suggeriti**: copertura cronologica, con il minor numero di bonifici, senza mai lasciare la fonte scoperta per le sue spese future; ogni bonifico ha "dal" (primo giorno possibile) ed "entro" (il giorno prima della spesa). Margini per conto e arrotondamento configurabili.
- **Avvisi**: se il totale dei conti va sotto zero l'app lo dice, invece di proporre bonifici impossibili. Le voci senza importo vengono segnalate, mai inventate.
- Importi sempre in centesimi interi, date come stringhe `AAAA-MM-GG`.

I test (Vitest + fast-check) controllano un ciclo d'esempio con dati inventati e gli invarianti su cicli casuali; il caso reale gira solo in locale, da `private/fixtures/`.

## Sviluppo

Requisiti: Node 26 e pnpm 12.

```bash
pnpm install
```

```bash
DEV_FAKE_IDENTITY=dev@example.com pnpm dev
```

`pnpm install` attiva anche l'hook di pre-commit (`.githooks/pre-commit`): blocca il commit se in stage ci sono file privati (`private/`, `HANDOFF.md`, Excel, `.env`) o se [gitleaks](https://github.com/gitleaks/gitleaks) trova segreti. Serve gitleaks installato (`winget install Gitleaks.Gitleaks` o `brew install gitleaks`).

Il web gira su http://localhost:5173 e fa da proxy per `/api` verso l'API su `:8080`. `DEV_FAKE_IDENTITY` sostituisce Cloudflare Access **solo in sviluppo**: con `NODE_ENV=production` il server si rifiuta di partire.

```bash
pnpm typecheck && pnpm test && pnpm build
```

## Sicurezza

- Ogni richiesta (tranne `/healthz`) deve portare un JWT di Cloudflare Access valido (`Cf-Access-Jwt-Assertion` o cookie `CF_Authorization`): firma con le chiavi del team, `iss`, `aud` (web o app native), scadenza. Altrimenti **403**.
- Browser (`kakebo.undermix.it`): applicazione Access con policy sulle email. App native (`kakebo-api.undermix.it`, più avanti): applicazione Access con *Service Auth* (un service token per dispositivo).
- Container: utente non root, filesystem in sola lettura, unico volume scrivibile `/data`, una sola porta esposta in LAN verso `cloudflared`.
- Header di sicurezza e CSP restrittiva. Scansione dei segreti (gitleaks) prima di ogni commit e in CI; dipendenze aggiornate con Dependabot.

## Deploy

L'immagine viene pubblicata su GHCR dal workflow **Build image and release** (avvio manuale da *Actions*). Ogni build ha un tag `AAAA.MM.GG-b<N>` (es. `2026.11.10-b1`) più `latest`, e crea una release GitHub con i commit dalla build precedente.

```bash
cd docker
cp .env.example .env
docker compose up -d
```

Con **Portainer** non serve il file `.env`: le stesse variabili (vedi `docker/.env.example`) vanno nella sezione *Environment variables* dello stack.

L'app è pubblicata su `kakebo.undermix.it`. `cloudflared` gira altrove nella LAN: nel tunnel l'hostname punta a `http://<IP-LAN-dell-host-Docker>:8080` (porta e interfaccia configurabili con `KAKEBO_PORT` e `KAKEBO_BIND`). Anche dalla LAN ogni richiesta, tranne `/healthz`, richiede il JWT di Access.

### Backup

I dati stanno in un database SQLite nel volume `kakebo-data` (`/data` nel container). Ogni notte l'app ne scrive una copia coerente (`VACUUM INTO`) in `/data/backup/kakebo-AAAA-MM-GG.db` e tiene le ultime 7; fa la stessa copia anche prima di ogni migrazione. È quella cartella che va salvata con il proprio strumento di backup dei volumi (es. Backrest/restic): il file vivo, in modalità WAL, non va copiato a caldo. Per ripristinare: fermare il container, rimettere la copia come `/data/kakebo.db` (eliminando eventuali `-wal`/`-shm`) e riavviare. *(Dalla fase 3, con il database.)*

## Licenza

[MIT](LICENSE)
