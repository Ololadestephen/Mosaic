# Mosaic

Mosaic keeps team work aligned with changing information. Bring a text brief, review cited proposals, apply selected changes, verify persistence, and undo eligible changes while protecting later edits.

This is an early application, hosted at [Mosaic](https://mosaic-chi-one.vercel.app). It has password-based accounts, isolated workspaces, owner/editor/viewer access, a task board, immutable source revisions, private source derivatives, proposal review, an execution journal and field-aware undo. A server-side Gemini Developer API adapter is implemented. Live Gemini analysis is restricted to individually approved judge accounts with synthetic data and enforced usage caps. Two real hosted generation → cited review → selected apply → refresh → durable receipt → conflict-aware undo lifecycles have passed. These are repeated observations of one scenario, not evidence of broad model reliability. Automated model tests use explicitly labelled fixtures and mocked HTTP; they do not establish live AI accuracy.

## Judge access

Registration is closed. Use your individually supplied judge account at [Sign in](https://mosaic-chi-one.vercel.app/login). Each account is an editor in its own synthetic workspace; credentials are delivered privately and are never published here. Start with “Synthetic judge brief”, analyze its saved revision, inspect the exact source passages, and select which proposals to apply. Refresh to inspect persisted changes and use Activity to preview safe undo. Analysis has a small per-account allowance; failures count and are not retried automatically. Manual work and history remain available after the allowance is exhausted.

Only use synthetic information. The analysis screen explains what is sent to Google before you request it. The model proposes; it cannot apply changes. Later edits can prevent undo, and the application shows those conflicts.

## Run locally

Use Node.js 24 and npm. Install the pinned dependencies with `npm ci`. Then run these in separate terminals:

```sh
npm run local:db
npm run dev
```

Open [Mosaic locally](http://localhost:3000). Create your own account and workspace. Collaborators create separate accounts; the owner can add their registered email as an editor or viewer. No invitations or other messages are sent. The source form includes an explicitly fictional sample brief.

The local database command starts actual PostgreSQL on loopback, applies checksummed SQL migrations and creates distinct development and test databases. It saves randomly generated credentials in ignored local files. Keep that terminal open. Existing local environment configuration is preserved. For an independently configured PostgreSQL database, set `DATABASE_URL` and run `npm run db:migrate`.

## Configuration

Copy names from `.env.example`; configure values only in local environment files or server secrets. `APP_ORIGIN` must match the browser origin exactly. Sessions are HttpOnly, SameSite cookies; production cookies require HTTPS. Passwords use salted scrypt hashes. Email ownership verification, password recovery and managed hosted auth are not implemented.

For authorized free-tier validation, use `AI_PROVIDER=gemini`, the server-only `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-3.5-flash-lite`. Confirm that the key's Google AI Studio project is Free tier with no billing attached before setting `GEMINI_FREE_TIER_CONFIRMED=true` and `AI_ENABLED=true`. A key alone does not establish free-tier eligibility. Assign one UUID as `GEMINI_VALIDATION_ID` for the authorized validation; preserve it across restarts. Do not rotate it to bypass the cap. `GEMINI_VALIDATION_CALL_LIMIT` defaults to ten cumulative requests shared across accounts and workspaces, with a supported maximum of thirteen. Raise it only under an explicitly authorized additional allowance, preserving the same validation ID and all attempt history. Failed calls retain their slot; completed proposals are reused. Per-account daily and frequency limits also apply. Production additionally requires an explicit `AI_ALLOWED_ACCOUNT_IDS` allowlist. `GEMINI_HOSTED_ATTEMPT_LIMIT` defaults to zero and controls the separately approved hosted release allowance; `AI_ACCOUNT_TOTAL_CALL_LIMIT` caps each eligible account's lifetime attempts. Hosted counts include failures and persist across restarts and validation-ID changes. Requests are reserved atomically in PostgreSQL and only one Gemini request can run at a time. The diagnostic allowance and its history are separate and must never be reset to enable release traffic. Set `AI_ENABLED=false` and redeploy to turn off new analysis; already-running requests remain bounded and counted. All three USD settings must remain zero for Gemini validation. There are no automatic retries, repairs or provider fallbacks. A legacy OpenRouter adapter remains explicitly selectable, but is never selected after a Gemini error.

Analysis sends the selected source, its explicit predecessor, visible tasks and workspace member IDs/names to the configured provider. Gemini free-tier content and responses may be used for product improvement and human review under [Google's unpaid-service terms](https://ai.google.dev/gemini-api/terms#unpaid-services). Use synthetic content for validation. Source text is untrusted data. Server code validates IDs, dates, fields, human-edit attribution, exact quotations and record revisions. A valid citation confirms a passage exists; it does not establish interpretation accuracy. Blocked, incomplete and invalid responses cannot create drafts. Only a separate authorized application command writes task changes.

`GEMINI_MAX_OUTPUT_TOKENS` configures Gemini's combined answer/thinking ceiling (default 4,096; application range 1,024–65,536). The adapter uses `thinkingLevel: MINIMAL`, which does not guarantee zero thinking, and requests at most two complete proposals. This budget does not guarantee completion. Token-limited responses are rejected even if their JSON appears complete; no repair or regeneration call follows. The adapter requests `responseMimeType: application/json` without a provider response schema. The prompt defines the JSON structure, while strict application and citation validation remain mandatory. JSON mode does not establish domain or citation validity. Gemini returns citations as `sourceVersionId`, an exact `quote`, and optionally a supplied `passageId`; offset fields are rejected. The server searches only the authorized selected immutable revision, rejects absent or ambiguous matches, derives UTF-16 offsets and runs the existing strict citation validator. Exact quotation proves presence, not interpretation: human review remains required. An additive migration stores bounded raw Gemini response bodies separately on the protected analysis run for audit; raw responses are excluded from application API views and logs.

## Verify

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run check:package
```

Start the local database before integration or browser tests. Browser tests use installed Chrome, a separate local server on port 3100 (override with `MOSAIC_E2E_PORT` if occupied), a dedicated database ending in `_test`, separate signed-in contexts and labelled deterministic AI fixtures. They never call live AI or reset production data. Unit tests mock provider HTTP to exercise failures; PostgreSQL tests exercise real locking, rollback, permissions, idempotency, the shared Gemini cap, safe diagnostics and field lineage. Fixtures do not prove live model accuracy.

Explicit source revisions can be compared side by side, with related proposal and review-flag links; the columns stack on mobile. Citation links focus the exact immutable passage. A comparison never authorizes task changes.

After an unconfirmed apply, use “Check original operation” or retry the original selection. Its key, revision and selection survive refresh in the same browser tab. Closing the tab can discard browser recovery state; committed activity remains in the database. Applying requires available browser session storage so the original operation can be recovered safely.

The core mutable task fields are status, assignee and date. Completed tasks are preserved during AI reconciliation. Apply is atomic for the selected items and closes the proposal; unselected items remain unapplied. Undo may partially restore eligible fields and explicitly reports conflicts. Untouched creations archive rather than disappear; decision records remain. Dates are calendar dates. Citation offsets use zero-based UTF-16 code units in normalized LF text, with an exclusive end offset.

Use `npm run db:backup` for a consistent logical backup under the ignored local backup directory. Backups contain private account/workspace data and exclude sessions. Restore is tested against a fresh, empty PostgreSQL database with matching migration hashes; the included restore function refuses existing data and requires a target name ending in `_restore_test`. Hosted backups and recovery checkpoints are operator-managed; scheduled backups are not provided.

`/api/health` reports database/migration readiness and the build commit without returning workspace data. Source packages and standalone builds are checked for internal documents, local data, secrets files and generated evidence. Keep the supplied ignore rules. Hosting uses Vercel and pooled Neon PostgreSQL with a restricted runtime role and certificate-verified TLS. Judge access is restricted as described above. The TestSprite GitHub App is installed for this repository, and saved scripts use isolated synthetic preview data. A required GitHub Actions workflow replays four AI-independent scripts against the exact PR preview commit: authentication and origin boundaries, manual task and immutable-revision persistence, a historical-revision analyze guard, and a stateful cited review/apply/conflict-aware undo fixture. The guard failed on the pre-fix PR commit and passed after the fix; the authentication case also caught an unkeyed source-creation regression introduced during hardening, which is fixed and covered by an integration test. Branch protection on `main` requires the `TestSprite PR preview` check. The fixture is seeded into the isolated preview database with fresh deterministic IDs for each workflow attempt, so it never resets or shares mutable state with another run; there is no public fixture endpoint. TestSprite executions are not live AI evidence.

A separate native GitHub App event reported two tests passed on PR commit `24d8e80`; see [the App report](https://github.com/Ololadestephen/Mosaic/pull/1#issuecomment-6317832164). That historical smoke result does not establish expanded session-refresh, immutable-source or review/undo coverage. This source defines three expanded native test plans and a disabled-by-default preparation/evidence workflow for the provisioned trusted PR #1. It verifies fresh native run identities, necessary exported assertions and durable database outcomes; it does not launch CLI test executions or create an App status. Use the current PR checks and provider report to establish which cases actually passed at each commit. A workflow definition alone is not validation. Other PRs need isolated preview provisioning and an approved trust policy before receiving hosted secrets.

The expanded local browser checks use a labelled deterministic proposal and exact excerpts attributed to the public TestSprite Season 4 page. Fictional revision-test text is explicitly marked synthetic. These checks validate the application lifecycle, not AI interpretation. CI-only fixture and provider-evidence tools are excluded from runtime deployment inputs and the runtime source package.

## Publication and deployment checks

Run `npm run check:publication` before staging or publishing. It inspects tracked, staged and candidate paths, rejects symlinks and private material, and checks for configured secret values without printing them. Run `npm run build` and `npm run check:package` to inspect the standalone output too. These checks do not publish anything.

The prepared GitHub workflow runs static/unit checks, real disposable PostgreSQL tests and labelled browser fixtures, with no provider keys or repository secrets. It uploads no private test reports. These are deterministic checks, not live AI evidence. Fork PRs must never receive hosted database, deployment or TestSprite credentials; do not use privileged `pull_request_target` execution for their code.

`vercel.json` permits deployments from `main` and the explicitly provisioned `codex/hosted-preview-security-tests` branch only. A trusted preview branch must be provisioned with its own database and branch-specific secrets before enabling its deployments. Configure `ALLOW_REGISTRATION=false` in protected hosting settings; production registration is operator-controlled, and previews enforce closed registration. Apply migrations with a separate migrator and provision restricted synthetic accounts. Vercel previews derive their origin from `VERCEL_URL` when `APP_ORIGIN` is unset and reject live AI credentials. Provision each preview from a separate synthetic-only project, never production records. Credentials belong in the hosting secret store; the Gemini key is production-only and protected; previews and CI have no provider key and cannot perform live analysis.

The Dockerfile offers a standalone non-root runtime and a separate `migrate` target. Inject `DATABASE_URL` at runtime; supply the exact HTTPS `APP_ORIGIN`. For traceable builds pass `--build-arg MOSAIC_BUILD_COMMIT=<full-sha>`. Container builds and hosted operation require target-platform validation.

`MOSAIC_PREVIEW_URL=https://<preview-host> MOSAIC_EXPECTED_COMMIT=<full-pr-head-sha> npm run test:hosted` runs only the prepared AI-independent smoke checks. It verifies the deployed commit before assertions, follows no HTTP redirects, and uses no account credentials or Gemini calls. It does not prove the complete signed-in lifecycle. The required TestSprite PR workflow targets the exact deployed revision and asserts its full commit SHA before login and after the saved-script assertions. Live Gemini validation remains manual and separately authorized.
