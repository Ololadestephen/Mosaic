# Testing

Mosaic's tests are deterministic: none of them call live AI or touch production data, except the read-only TestSprite API suite described below. Fixtures do not prove live model accuracy.

## Local and CI suites

- **Unit tests** cover contracts, citation offsets, proposal validation, prompt rules and provider failures, with provider HTTP mocked.
- **Integration tests** run against real PostgreSQL. They exercise locking, rollback, permissions, idempotency, the shared Gemini cap, safe diagnostics and field lineage. A dedicated suite recreates the production runtime role's table privileges, because the superuser used elsewhere can do things production cannot.
- **Browser tests** use installed Chrome, a separate local server on port 3100 (override with `MOSAIC_E2E_PORT`), a database whose name ends in `_test`, separate signed-in contexts and labelled deterministic AI fixtures. A separate mocked-provider lane runs with `MOSAIC_E2E_MOCK_ANALYSIS=1`.

Start `npm run local:db` before integration or browser tests.

The GitHub workflow `checks.yml` runs static and unit checks, disposable PostgreSQL tests and browser fixtures, with no provider keys or repository secrets. Fork PRs never receive hosted database, deployment or TestSprite credentials, and no workflow uses `pull_request_target`.

## TestSprite

### Strict PR suite (required)

`testsprite-pr.yml` replays four AI-independent scripts against the exact PR preview commit:

1. authentication and origin boundaries
2. manual task and immutable-revision persistence
3. a historical-revision analyze guard
4. a stateful cited review → apply → conflict-aware undo fixture

Before running, the workflow fetches each saved script and stops unless its TestSprite code version and SHA-256 match the reviewed pins in `scripts/testsprite/strict-pins.json`. Afterwards it re-reads the scripts and fails unless they are unchanged and every case is a passing replay of its saved script. TestSprite does not report which script version a replay executed, so this before-and-after check is the evidence. The uploaded summary records the commit, preview origin, run IDs and pinned versions.

The fixture is seeded into the isolated preview database with fresh IDs for each workflow attempt, so it never resets or shares mutable state with another run. There is no public fixture endpoint.

This suite has caught real bugs: the analyze guard failed on the pre-fix commit and passed after the fix, and the authentication case caught an unkeyed source-creation regression, which is now also covered by an integration test.

### GitHub App status on every PR

A TestSprite portal trigger watches for the Vercel preview deployment to complete, then runs the 14 read-only checks in `scripts/testsprite/pr-smoke-plans.jsonl` against that preview and posts the `TestSprite V3` status and a report comment on the PR. The checks cover:

- the landing page, its review preview and navigation
- sign-in, including rejection of unknown credentials, with no way to register
- signed-out redirects from the workspace pages
- the judge lobby and access-link pages refusing missing or made-up links
- the not-found page

They need no account and no fixture, and change no workspace data, so they can run on every PR. They are a smoke test; the strict suite carries the lifecycle assertions.

Earlier, the App also ran three fixture-backed native UI tests on PR #1 ([report](https://github.com/Ololadestephen/Mosaic/pull/1#issuecomment-6376524604)). Their step logs omitted some planned refreshes and intermediate assertions, so they are treated as narrower evidence than the strict suite. The disabled-by-default `testsprite-app-ui.yml` workflow can prepare a fresh fixture and exact plans for those tests on any open PR from the provisioned branch.

### Production API

The four backend tests in `tests/testsprite-api/` check readiness and security headers, signed-out rejection before routing, the origin guard on every state-changing request, and sign-in validation, closed registration and rate limiting. They send no credentials and create no accounts.

After each merge to `main`, and nightly, `testsprite-api.yml` waits until production serves that commit, makes the stored TestSprite code match the reviewed files (TestSprite adds only its fixed public-auth preamble), runs the tests, and fails unless every run is a fresh pass and the stored code and production commit are unchanged afterwards.

## Hosted smoke check

```sh
MOSAIC_PREVIEW_URL=https://<preview-host> MOSAIC_EXPECTED_COMMIT=<full-sha> npm run test:hosted
```

This runs the AI-independent smoke checks against a deployment. It verifies the deployed commit first, follows no redirects and uses no credentials.

## Live AI evidence

Real hosted runs of the full loop (generation → cited review → selected apply → refresh → durable receipt → conflict-aware undo) have passed in production. A judge-seat walkthrough repeated analysis → apply → refresh → undo, and two later runs checked that a cancelled task is neither marked done nor otherwise changed. These are a handful of observations of one scenario, not evidence of broad model reliability.
