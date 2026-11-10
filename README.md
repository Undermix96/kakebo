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
```

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
- Browser: applicazione Access con policy sulle email. App native: applicazione Access con *Service Auth* (un service token per dispositivo).
- Container: utente non root, filesystem in sola lettura, unico volume scrivibile `/data`, una sola porta esposta in LAN verso `cloudflared`.
- Header di sicurezza e CSP restrittiva. Scansione dei segreti (gitleaks) in CI.

## Deploy

L'immagine viene pubblicata su GHCR dal workflow **Build image and release** (avvio manuale da *Actions*). Ogni build ha un tag `AAAA.MM.GG-b<N>` (es. `2026.11.10-b1`) più `latest`, e crea una release GitHub con i commit dalla build precedente.

```bash
cd docker
cp .env.example .env
docker compose up -d
```

Con **Portainer** non serve il file `.env`: le stesse variabili (vedi `docker/.env.example`) vanno nella sezione *Environment variables* dello stack.

L'app è pubblicata su `kakebo.undermix.it`. `cloudflared` gira altrove nella LAN: nel tunnel l'hostname punta a `http://<IP-LAN-dell-host-Docker>:8080` (porta e interfaccia configurabili con `KAKEBO_PORT` e `KAKEBO_BIND`). Anche dalla LAN ogni richiesta, tranne `/healthz`, richiede il JWT di Access.

## Licenza

[MIT](LICENSE)
