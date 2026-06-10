---
id: SHY-0072
status: In Progress
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
- [ ] **MERGED ENDPOINT (operator decision 2026-06-10):** `POST /api/translate` serves BOTH caller classes. Anonymous (no `req.auth`): the new public-content flow below. Authenticated chat callers: the EXISTING chat-translation contract (per-user quota, Firestore message-cache behaviour) is preserved EXACTLY — its existing tests in `express-api/tests/routes/translate.test.js` stay green unchanged (characterization contract) — but its provider call is rerouted through the new unified chain + string cache underneath.
- [ ] **Provider chain (operator decision): unofficial Google gtx FIRST → self-hosted LibreTranslate (`LIBRETRANSLATE_URL`, default `http://localhost:5000`) on gtx failure → English fail-silent + queue as final fallback.** Each provider attempt has its own 3s timeout; chain position is logged on fallback (WARN includes which provider served/failed).
- [ ] Anonymous requests accept `{ texts: string[], target: <locale> }` (target ∈ the 20 supported locales; `en` rejected as a no-op with 400 — callers must not burn a request translating English to English).
- [ ] Cache hit path: previously translated (text, target) pairs return from the server-side cache with NO provider call (asserted via provider-mock call counts).
- [ ] Cache miss path: the provider chain is invoked once per unique (text, target); results cache durably to DISK (JSON — firmed over SQLite: zero new deps, ~2K entries; NOT Firestore — free-tier quota). **Two-layer cache (architect Concern 5):** boot loads the COMMITTED seed `express-api/src/data/translation-cache-seed.json` (read-only at runtime; Claude backfill PRs write here) then overlays the RUNTIME cache `express-api/data/translation-cache.json` (gitignored — `express-api/data/` added to `express-api/.gitignore`; created on first write; runtime wins on key collision). Keys are `sha256(text):target`. Atomic writes (write-temp `.tmp` suffix + rename) apply to the runtime file only.
- [ ] **gtx reality (architect-verified live, Concern 2/3):** response is `text/plain` containing JSON shaped `[[["<translated>","<source>",null,null,10]],null,"<src-lang>",...]` — parse via `response.text()` + `JSON.parse`, translation at `body[0][0][0]`. gtx accepts ONE text per call: N misses = N calls via `Promise.allSettled` with per-call 3s timeouts (worst-case latency ~3s for any batch size, never N×3s).
- [ ] Batch requests dedupe internally (same text twice in one request = one provider call) and partial-fill from cache (mixed hit/miss batches only fetch the misses).
- [ ] Response shape `{ translations: { [text]: translated }, missed: string[] }` — `missed` lists texts served as English fallback this call.

### Error paths
- [ ] Full-chain failure (gtx AND LibreTranslate each: non-200, 3s timeout, malformed body = JSON.parse failure on the response text, rate-limit): the affected texts return AS ENGLISH in `translations` and appear in `missed`; HTTP status stays 200 (fail-silent contract — the PAGE must never break); the failure is logged at WARN with provider status (admin-visible per existing log conventions) and the (text, target) is appended to the miss-queue file.
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
- [ ] No secrets involved (gtx keyless; LibreTranslate is our own box). Rate limiting (architect-located): `writeLimiter` (30/min, keys `req.auth?.uid || req.ip` — IP for anonymous) is ALREADY mounted for `/api/translate` at `index.js:176`; no new wiring. Test asserts 429 after the budget from one IP. Size bounds remain the anti-proxy guard.
- [ ] Inputs are never shell-interpolated/eval'd; provider URL is built via URLSearchParams (no string-concat injection).
- [ ] Dev-console visibility AC lives in SHY-0073 (client side); the server contributes a `X-Translation-Missed: <n>` response header the client can read cheaply.

### UX
- [ ] N/A server-side — the fail-silent contract IS the UX guarantee (English, never errors).

### i18n
- [ ] All 20 locale codes accepted exactly as the site's language selector emits them. Single source (architect Concern 4): new `express-api/src/utils/supported-locales.js` (CommonJS export), pinned by a GREP-based test against `public/js/language-selector.js` (browser IIFE — cannot be require()d) asserting every server entry appears there.

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
**Green:** rework `express-api/src/routes/translate.js` (merged: anonymous flow added; authenticated chat contract preserved, provider call rerouted through the chain) + `express-api/src/utils/translation-cache.js` (two-layer) + `translation-provider.js` (chain: gtx → LibreTranslate; gtx mock MUST replicate the real nested-array text/plain shape, NOT LibreTranslate's `{translatedText}`) + `supported-locales.js` + miss-queue util + health hook + seed file `express-api/src/data/translation-cache-seed.json` (`{}`) + `.gitignore` entry.
**Additional red cases (architect Concerns 3/8 + merge):** Promise.allSettled partial failure (A,C fail; B succeeds → A,C missed, B translated, 200); chain fallback (gtx 503 → LibreTranslate serves → no miss-queue entry); both-fail (→ English + queue); EXISTING chat tests run UNCHANGED as the characterization gate before any route edit.
**Verify-by-running:** local stack curl per BDD; one REAL unofficial-endpoint smoke locally (single word, documented in Notes — proves the gtx contract at implementation time; CI uses mocks only).

## Out of Scope

- Client-side consumption, the dev-console error surface, and the gated GitHub links (SHY-0073).
- Translating anything beyond raw text strings (no HTML/markdown-aware segmentation yet).
- Admin UI for the queue (the health integer + JSONL file suffice; UI is a future story if backlog grows).
- Standing up/relocating the LibreTranslate container itself (assumed at `LIBRETRANSLATE_URL`; if unreachable it's simply a dead chain link — the design degrades gracefully). Verifying it runs on prod is an operator-side check, noted in Dependencies.

## Dependencies

- SHY-0073 depends on THIS. Pickup-fitness-review COMPLETED 2026-06-10 (first formal run — found the route collision + live-verified gtx shape + located writeLimiter/locale-list/cache-layout). 
- OPERATOR-SIDE (non-blocking, fail-silent covers it): confirm LibreTranslate is live on prod (`ssh ubuntu@213.35.98.160 'curl -s -m5 http://localhost:5000/languages'`) — my prod-read was correctly classifier-scoped out.

## Risks & Mitigations

- **Risk:** gtx endpoint breaks/blocks server IPs. **Mitigation:** by design — cache keeps served locales alive, English fail-silent for new content, queue + Claude backfill closes gaps; revisit provider only then.
- **Risk:** cache grows unbounded. **Mitigation:** scope is name+desc strings (~95×20 ≈ 2K entries now); add an entry-count WARN at 50K (future story if ever hit).
- **Risk:** abuse as a free proxy. **Mitigation:** size/count bounds + per-IP rate limit + only the 20 site locales.

## Definition of Done

- [ ] All AC checked; red→green; full express suite green; shellcheck N/A (JS only); reviewer ZERO before push; auto-merged.
- [ ] Real-endpoint smoke evidence in Notes; `status: Done` deferred to release cut; SHY-INDEX + EPIC-0002 synced.

## Notes (running log)

- 2026-06-10 ~12:05 BST — **Reviewer cycle 1: 1 Critical + 3 Important, all applied (one with a twist).** (CRITICAL, verified via git check-ignore) the `.gitignore` `data/` pattern recursively matched `src/data/` — the committed seed (and every future Claude backfill commit) would have been silently ignored → scoped to `/data/`, verified both directions. (Imp-2's twist) the miss-queue separator was ALREADY NUL — but as a RAW \x00 BYTE in source (my earlier sed-style fixes wrote the byte, making the file binary-classified, which is exactly why the reviewer's grep misread it as a space) → rewritten as the proper `'\u0000'` escape, file back to UTF-8 text. (Imp-3) added a fresh-path pin that `detectedSourceLang` carries the provider's real detection (cache-hit 'unknown' degradation documented as in-spec). (Imp-4) added the route-level anonymous 429 test (NODE_ENV=production + fresh writeLimiter, wired exactly as index.js mounts it). Full suite re-verified green after all fixes.

- 2026-06-10 ~11:30 BST — **TDD red→green complete; FULL express suite 11,881/11,881 (was 11,787 — +94 tonight).** New: provider chain (9 tests incl. fake-timer timeout + soft-fail-on-wrong-shape, the property keeping legacy chat mocks green), two-layer cache (10), public flow (18: batching/dedupe/partial-fill, fail-silent 200+WARN+queue+header, 7×400s, anonymous-chat-shape 401, wiring pins). Chat characterization: 32 tests green with exactly TWO documented intended adjustments — (1) the 502 probe text made unique (the unified cache now serves same-process repeats of translated strings: the upgrade, not a leak), (2) health body gains translationQueueLength (3 additive assertion updates; the sweep-body assertion untouched). Test-env default paths fall back to per-process tmpdirs (no repo data/ pollution, no cross-run leakage). **Live smoke (Verify-by-running):** real gtx call for 'roadmap'→de returned the documented nested-array shape; module end-to-end: {ok:true, provider:'gtx', translated:'Roadmap', detectedSourceLang:'en'}. Anonymous gate fixed mid-TDD: non-chat-shaped anonymous bodies route to public validation (400s), only explicit {text/targetLang} shapes 401.

- 2026-06-10 ~10:45 BST — **Pickup-fitness-review (architect) — APPROVE-WITH-CHANGES, 8 concerns, all applied; rule vindicated on first formal run.** CRITICAL discovery: `POST /api/translate` already existed (authenticated chat translation via self-hosted LibreTranslate + Firestore quota) — unknown to the spec and all design rounds. Operator decisions on the two blockers: (1) provider = **gtx first → LibreTranslate fallback** ("3 but in reverse"); (2) **MERGE into one endpoint** (anonymous public flow + preserved chat contract; auth-bypass risk accepted with the characterization gate as the gate). Also applied: live-verified gtx shape (`text/plain`, `body[0][0][0]`, single-text-per-call → Promise.allSettled ≤3s); two-layer cache layout named (committed seed + gitignored runtime); writeLimiter pinned (index.js:176 mount, IP-keyed for anonymous); grep-based locale pin via new supported-locales.js. Story flipped Draft → In Progress.

- 2026-06-10 ~10:15 BST — Authored fully-refined from the operator's three-round design (ask-freely session): lazy-on-first-view, server cache, fail-silent English + admin log + miss queue + Claude build-time backfill; unofficial Google endpoint accepted after the $0 pricing reality check. Architecture memory: feedback-public-translations-lazy-architecture.
