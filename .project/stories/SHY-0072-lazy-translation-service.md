---
id: SHY-0072
status: Draft
owner: claude
created: 2026-06-10
priority: P1
effort: M
type: feature
roadmap_ids: []
pr:
epic: EPIC-0002
---

# SHY-0072: Lazy translation service — translate-on-first-view with server cache

## User Story

As a non-English visitor to shytalk.com's public pages, I want dynamic content (starting with roadmap story names/descriptions) translated into my language on demand, so that the public surface stays fully native-quality in all 20 locales without anyone pre-translating content nobody views — and without ever showing me an error when translation isn't available.

## Why

Operator decision 2026-06-10 (memory `feedback-public-translations-lazy-architecture`): public pages are ALWAYS fully translated; GitHub stories are English-only; therefore the web layer needs a translation mechanism for story-derived content. Chosen architecture (over build-time pre-translation and paid APIs): translate on FIRST view per (text, locale), cache server-side, serve cache thereafter; on any failure serve English silently with admin-visible logging; misses queue for Claude build-time backfill. Declared "the right way for translating everything in the future." Strictly $0: unofficial Google endpoint (ToS-grey, accepted with eyes open after the pricing reality check) + free backfill.

## Acceptance Criteria

### Happy path
- [ ] `POST /api/translate` accepts `{ texts: string[], target: <locale> }` (target ∈ the 20 supported locales; `en` rejected as a no-op with 400 — callers must not burn a request translating English to English).
- [ ] Cache hit path: previously translated (text, target) pairs return from the server-side cache with NO provider call (asserted via provider-mock call counts).
- [ ] Cache miss path: the unofficial Google endpoint (`translate.googleapis.com/translate_a/single` `client=gtx`) is called once per unique (text, target); the result is cached (durable across process restarts — disk-backed JSON/SQLite on the Express box, NOT Firestore: free-tier quota is a real constraint and this cache is hot) and returned.
- [ ] Batch requests dedupe internally (same text twice in one request = one provider call) and partial-fill from cache (mixed hit/miss batches only fetch the misses).
- [ ] Response shape `{ translations: { [text]: translated }, missed: string[] }` — `missed` lists texts served as English fallback this call.

### Error paths
- [ ] Provider failure (non-200, timeout ≤3s, malformed body, rate-limit): the affected texts return AS ENGLISH in `translations` and appear in `missed`; HTTP status stays 200 (fail-silent contract — the PAGE must never break); the failure is logged at WARN with provider status (admin-visible per existing log conventions) and the (text, target) is appended to the miss-queue file.
- [ ] Miss-queue file (`express-api/data/translation-miss-queue.jsonl` or equivalent documented path) is append-only JSONL `{text, target, ts, reason}`, deduplicated on append (same text+target not re-queued), and survives restarts. Claude drains it via routine PRs that commit translations directly into the cache seed (the "fallback to claude" — build-time, $0).
- [ ] Unsupported `target` (not in the 20) → 400 with a generic body; never forwarded to the provider.
- [ ] Oversized input (text >2,000 chars or >50 texts/request) → 400 (the public roadmap needs name+description sizes; bounds prevent the endpoint becoming a free-translation proxy for abuse).

### Edge cases
- [ ] Texts containing HTML-meaningful characters round-trip unescaped through the service (escaping is the RENDERER's job at insertion; the service stores/returns raw text — documented in the route header).
- [ ] Identical text requested for two locales concurrently: both fetch independently; cache keys are (sha256(text), target).
- [ ] Provider returns the input unchanged (Google sometimes echoes for unknown words): cached as-is — an echo is a valid translation, not a miss.
- [ ] Cache file corruption (truncated write/invalid JSON at boot): service starts with an empty cache + ERROR log, never crashes (fail-open to re-translation, fail-silent to users).

### Performance
- [ ] Cache hits answer in <10ms server-side (memory-mapped/loaded-at-boot index); misses bounded by the 3s provider timeout.
- [ ] Cache writes are atomic (write-temp + rename) so a crash mid-write can't corrupt the store.

### Security
- [ ] No secrets involved (unofficial endpoint is keyless); the endpoint is PUBLIC but rate-limited per IP (reuse the repo's existing Express rate-limit middleware pattern) so it can't be farmed as a free translation proxy beyond the size bounds.
- [ ] Inputs are never shell-interpolated/eval'd; provider URL is built via URLSearchParams (no string-concat injection).
- [ ] Dev-console visibility AC lives in SHY-0073 (client side); the server contributes a `X-Translation-Missed: <n>` response header the client can read cheaply.

### UX
- [ ] N/A server-side — the fail-silent contract IS the UX guarantee (English, never errors).

### i18n
- [ ] All 20 locale codes accepted exactly as the site's language selector emits them (single source: reuse the canonical locale list from the repo, not a hand-typed copy — pinned by a test importing/grepping the same list the web uses).

### Observability
- [ ] WARN log per provider failure with `{event: 'translate_provider_fail', target, status, queued}`; INFO summary per process-hour is NOT required (avoid log spam — per-failure only).
- [ ] Miss-queue length surfaces in the existing `/api/system/health` payload (one integer — admins see backlog at a glance).

## BDD Scenarios

**Scenario: first view translates and caches**
- **Given** an empty cache and a working provider mock
- **When** `POST /api/translate {texts:["Age-gating per feature"], target:"de"}` runs twice
- **Then** the provider mock is called exactly once
- **And** both responses carry the German translation with empty `missed`

**Scenario: provider dies — visitors never know**
- **Given** the provider mock returns 503
- **When** a translation is requested for `fr`
- **Then** the HTTP response is 200 with the English text and `missed` listing it
- **And** a WARN `translate_provider_fail` log fires and the miss-queue gains one deduplicated line

**Scenario: mixed batch partial-fills from cache**
- **Given** text A cached for `ja` and text B uncached
- **When** both are requested for `ja`
- **Then** the provider is called only for B and the response contains both translations

**Scenario: queue dedupe survives repeats**
- **Given** the provider is down
- **When** the same text+target misses three times
- **Then** the miss-queue contains exactly one entry for it

## Test Plan

**Red first** (`express-api/tests/routes/translate.test.js`, supertest + provider mock via dependency-injected fetch/undici — mirror the route-test harness conventions; plus unit tests for the cache module `express-api/tests/utils/translation-cache.test.js`): every AC above has a named case — cache hit/miss/partial, dedupe, fail-silent 200 + WARN spy + queue append + queue dedupe, 400s (en/unsupported/oversize/too-many), atomic-write (simulate crash via temp-file inspection), corrupt-cache boot recovery, rate-limit pin, locale-list single-source pin, health-payload integer.
**Green:** `express-api/src/routes/translate.js` + `express-api/src/utils/translation-cache.js` + provider client `translation-provider.js` (3s timeout, gtx endpoint) + health hook + miss-queue util.
**Verify-by-running:** local stack curl per BDD; one REAL unofficial-endpoint smoke locally (single word, documented in Notes — proves the gtx contract at implementation time; CI uses mocks only).

## Out of Scope

- Client-side consumption, the dev-console error surface, and the gated GitHub links (SHY-0073).
- Translating anything beyond raw text strings (no HTML/markdown-aware segmentation yet).
- Admin UI for the queue (the health integer + JSONL file suffice; UI is a future story if backlog grows).
- Provider alternatives (LibreTranslate self-host etc.) — revisit only if the gtx endpoint dies (the cache + English-fallback + backfill make that a degradation, not an outage).

## Dependencies

- None hard. SHY-0073 depends on THIS. The Express rate-limit middleware pattern already exists in-repo (locate at pickup-review).
- Pickup-review gate (per the new every-story rule) must verify: the gtx endpoint's CURRENT response shape (it drifts), the canonical locale-list location, and the existing rate-limiter to reuse.

## Risks & Mitigations

- **Risk:** gtx endpoint breaks/blocks server IPs. **Mitigation:** by design — cache keeps served locales alive, English fail-silent for new content, queue + Claude backfill closes gaps; revisit provider only then.
- **Risk:** cache grows unbounded. **Mitigation:** scope is name+desc strings (~95×20 ≈ 2K entries now); add an entry-count WARN at 50K (future story if ever hit).
- **Risk:** abuse as a free proxy. **Mitigation:** size/count bounds + per-IP rate limit + only the 20 site locales.

## Definition of Done

- [ ] All AC checked; red→green; full express suite green; shellcheck N/A (JS only); reviewer ZERO before push; auto-merged.
- [ ] Real-endpoint smoke evidence in Notes; `status: Done` deferred to release cut; SHY-INDEX + EPIC-0002 synced.

## Notes (running log)

- 2026-06-10 ~10:15 BST — Authored fully-refined from the operator's three-round design (ask-freely session): lazy-on-first-view, server cache, fail-silent English + admin log + miss queue + Claude build-time backfill; unofficial Google endpoint accepted after the $0 pricing reality check. Architecture memory: feedback-public-translations-lazy-architecture.
