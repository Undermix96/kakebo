# kakebo — note per chi sviluppa (anche agenti)

- **Fonte di verità del progetto**: `private/HANDOFF.md` (non versionato). Lì ci sono requisiti, decisioni prese, motore di calcolo, modello dati, fasi e punti aperti. In caso di conflitto vale quel file.
- Design UI: `private/design/project/*.dc.html` (direzione scelta: "Il quaderno"). Token già riportati in `apps/web/src/theme.css`: tienili lì, niente hex sparsi nei componenti.
- Piano leggibile: `private/PIANO-APP.md`.

## Regole non negoziabili

- Il repo è **pubblico**: mai committare dati reali (nomi, importi, l'Excel), `.env`, token. Le fixture nel repo usano dati inventati; quelle reali stanno in `private/`.
- Soldi **sempre in centesimi interi** (`Cents`), mai float. Date come stringhe ISO `YYYY-MM-DD` (fuso Europe/Rome), mai `Date` locale per i giorni.
- Nessun login nell'app: l'autenticazione è Cloudflare Access; l'API verifica sempre il JWT (403 altrimenti).
- UI in italiano; codice, identificatori e commit in inglese.
- Non inventare importi mancanti: una voce senza importo va segnalata.
- GitHub **solo via SSH** (`git@github.com:Undermix96/kakebo.git`), mai remote HTTPS; `gh` solo per le API (workflow, release).
- Non aggirare l'hook `.githooks/pre-commit` (niente `--no-verify`): blocca file privati e segreti (gitleaks).

## Comandi

- `pnpm install` · `pnpm typecheck` · `pnpm test` · `pnpm build`
- Sviluppo: `DEV_FAKE_IDENTITY=dev@example.com pnpm dev`
- Release: workflow manuale `.github/workflows/release.yml` (tag `AAAA.MM.GG-b<N>`): `gh workflow run release.yml --ref main`.
- Deploy: stack Portainer con `docker/compose.yaml`, variabili nello stack (vedi `docker/.env.example`). Web su `kakebo.undermix.it`, API nativa (fase 6) su `kakebo-api.undermix.it`.
