# AI and limits

The model proposes; it never writes. Server code validates every proposal and performs every change only after a person selects it.

## What is sent

Analysis sends the selected source revision, its explicit predecessor, the visible tasks and workspace member IDs and names to the configured provider. The analysis screen says this before you request it. Gemini free-tier content and responses may be used for product improvement and human review under [Google's unpaid-service terms](https://ai.google.dev/gemini-api/terms#unpaid-services), so use synthetic content.

## How output is checked

- Source text is treated as untrusted data; instructions inside it carry no authority.
- The server validates task IDs, dates, fields, revisions and human-edit attribution, and rejects updates to completed or archived tasks.
- Gemini returns citations as a revision ID and an exact quotation. The server searches only the authorized revision, rejects missing or ambiguous matches, derives UTF-16 offsets and runs the strict citation validator. A valid citation proves the passage exists, not that the interpretation is right, so review stays mandatory.
- Entries in "What stays as it is" that name a task the same proposal changes or creates are dropped.
- The prompt (`mosaic-reconcile-10`) proposes Done only for work the source says is finished. A task the source cancels, stops or replaces gets no update at all; its replacement is proposed as a new task and archiving it becomes a question.
- Blocked, incomplete, token-limited or invalid responses cannot create drafts. There are no automatic retries, repairs or provider fallbacks.

## Configuration

Use `AI_PROVIDER=gemini`, the server-only `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash-lite`. Confirm that the key's Google AI Studio project is on the free tier with no billing attached before setting `GEMINI_FREE_TIER_CONFIRMED=true` and `AI_ENABLED=true`; a key alone does not establish that. All USD price settings must stay zero for Gemini.

`GEMINI_MAX_OUTPUT_TOKENS` sets the combined answer and thinking ceiling (default 4,096; range 1,024–65,536). The adapter uses `thinkingLevel: MINIMAL`, requests at most two complete proposals and asks for `application/json` without a provider response schema. Bounded raw responses are stored on the protected analysis run for audit and never appear in API views or logs.

A legacy OpenRouter adapter remains selectable but is never used as a fallback.

## Caps

Every hosted attempt is reserved atomically in PostgreSQL, only one Gemini request runs at a time, and counts include failures and persist across restarts.

| Setting                        | Meaning                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `AI_ALLOWED_ACCOUNT_IDS`       | Production allowlist of accounts that may analyze                   |
| `AI_ACCOUNT_TOTAL_CALL_LIMIT`  | Lifetime attempts per account (at most 10)                          |
| `AI_DAILY_CALL_LIMIT`          | Attempts per account per UTC day                                    |
| `GEMINI_HOSTED_ATTEMPT_LIMIT`  | Total hosted attempts (default 0, at most 100)                      |
| `GEMINI_VALIDATION_CALL_LIMIT` | Attempts under one `GEMINI_VALIDATION_ID` (default 10, at most 100) |

Keep the same `GEMINI_VALIDATION_ID` across restarts and never rotate it to bypass a cap. Raise a cap only under an explicit additional allowance. The supported maximums sit well below the free tier's 500 requests per day for this model. Set `AI_ENABLED=false` and redeploy to stop new analyses; requests already running stay bounded and counted.
