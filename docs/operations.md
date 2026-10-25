# Operations

## Judge access

Registration is closed in production. Judges share one private lobby link that shows numbered seats; choosing an available seat signs them into that seat's own synthetic workspaces without a password.

- **Seats are exclusive.** Claims are atomic, so two judges never receive the same seat. An HttpOnly seat cookie returns a judge to their seat after signing out, and nobody else can claim it.
- **Tokens stay out of logs.** The token sits in the URL fragment, so it never appears in request URLs. The page removes it from the address bar and history straight away, and exchanges it once, in an HTTPS request body, for an ordinary session. Until a seat is chosen, the lobby keeps it in that tab's session storage so a refresh still works, then clears it.
- **Only hashes are stored.** Link hashes live in a separate namespace from sessions, so a link cannot act as a session or the reverse. A session started from a link ends no later than the link.
- **Attempts are rate limited** per client IP, and the 256-bit token makes guessing impractical.
- **Operators** can release an abandoned seat, revoke a seat or close the lobby with `scripts/access-link.ts`. Entry, release, revocation and closing are serialized with transaction-scoped advisory locks, so a revoked or closed seat never keeps a session created at the same moment. Releasing a seat ends its sessions but keeps its workspaces and analyses used.

Individual access links work the same way for a single account. Links are delivered privately and never published.

## Configuration

`APP_ORIGIN` must match the browser origin exactly; every state-changing request must come from it. Sessions are HttpOnly, SameSite cookies and require HTTPS in production. Passwords use salted scrypt hashes. Sign-in allows 15 failed attempts per email in 15 minutes; after that even the correct password is refused until the window passes. Successful sign-ins do not count.

Set `ALLOW_REGISTRATION=false` in protected hosting settings. Previews always enforce closed registration, derive their origin from `VERCEL_URL` when `APP_ORIGIN` is unset, and refuse to start with live AI credentials.

## Hosting

Production runs on Vercel with pooled Neon PostgreSQL, a restricted runtime role and certificate-verified TLS. `/api/health` reports database and migration readiness and the build commit without returning workspace data.

`vercel.json` deploys only `main` and the provisioned `codex/hosted-preview-security-tests` branch. A preview branch needs its own synthetic-only database and branch-specific secrets before its deployments are enabled. Apply migrations with a separate migrator role. The Gemini key is production-only; previews and CI cannot perform live analysis.

The Dockerfile provides a standalone non-root runtime and a separate `migrate` target. Inject `DATABASE_URL` at runtime, supply the exact HTTPS `APP_ORIGIN`, and pass `--build-arg MOSAIC_BUILD_COMMIT=<full-sha>` for traceable builds.

## Backups

`npm run db:backup` writes a consistent logical backup to the ignored local backup directory. Backups contain account and workspace data and exclude sessions. Restore is tested against a fresh, empty database with matching migration hashes; the restore function refuses existing data and requires a target name ending in `_restore_test`. Hosted backups are operator-managed.

## Recovery behaviour

After an unconfirmed apply, use "Check original operation" or retry the original selection. Its key, revision and selection survive a refresh in the same tab; closing the tab can discard that state, but committed activity stays in the database. Apply requires browser session storage for this.

Undo may restore only some fields and reports the conflicts. Untouched created tasks are archived rather than deleted, and decision records remain.

## Publication checks

Run `npm run check:publication` before staging or publishing. It inspects tracked, staged and candidate paths, rejects symlinks and private material, and checks for configured secret values without printing them. `npm run build && npm run check:package` inspects the standalone output too. Neither command publishes anything.
