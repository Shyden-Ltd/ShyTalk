---
id: SHY-0025
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: XS
type: bug
roadmap_ids: [G042, G052]
pr:
mvp: true
---

# SHY-0025: Locale parity test upgrade (key-set comparison) + PR #1010 string verification

## User Story

As the ShyTalk operator, I want **`express-api/tests/scripts/compose-resources-locale-parity.test.js` upgraded from a count-based to a key-set comparison AND PR #1010's push-permission strings (`notifications_disabled_banner_title`, `notifications_disabled_banner_action`) verified present in all 20 locale files**, so that translation gaps cannot hide behind matching key counts and the freshly-shipped push banner is fully localised.

## Why

Two bundled gaps:

**G042** (line 109): `express-api/tests/scripts/compose-resources-locale-parity.test.js` may compare key COUNTS rather than key SETS. A count-match doesn't catch the case where locale A has keys `{a, b, c}` and locale B has `{a, b, d}` — same count, different keys.

**G052** (line 110): PR #1010's push-permission strings need verification across all 20 locales (`ar, de, es, fr, hi, id, it, ja, km, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh`).

Roadmap rows:

> G042: Sev: 🟡 Polish. Test — locale parity test key-set vs count-only. Location: `express-api/tests/scripts/compose-resources-locale-parity.test.js`. Gap: Need to verify it checks keys not just count. Fix: Read test; upgrade to key-set if count-only (then G042 promotes to Important). Scope: XS.
>
> G052: Sev: 🟡 Polish. Locale — verify PR #1010 push keys in all 20 locales. Location: `shared/src/commonMain/composeResources/values-*/strings.xml`. Gap: Confirm `notifications_disabled_banner_title` + `_action` in all 20. Fix: grep verification. Scope: XS.

P2 Tier-4. XS effort. Two small fixes that close two adjacent polish gaps.

## Acceptance Criteria

### Happy path

**G042 — key-set comparison upgrade:**

- [ ] Read `express-api/tests/scripts/compose-resources-locale-parity.test.js`.
- [ ] If currently count-based: refactor to compare KEY SETS across all 20 locales against a canonical reference (likely `values/strings.xml`).
- [ ] Assertion: every locale has the SAME set of keys (no missing, no extra). Mismatches reported with specific key names.
- [ ] If already key-set-based (false positive in roadmap): document this in the SHY's Notes; close G042 with `no-op verified`.

**G052 — PR #1010 push keys present in all 20 locales:**

- [ ] Add new assertion in the same test (or sibling file): for the specific keys `notifications_disabled_banner_title` + `notifications_disabled_banner_action`, every one of the 20 locale files contains a non-empty entry.
- [ ] If any locale missing the keys, the test fails identifying which locale.

- [ ] `cd express-api && npm test -- compose-resources-locale-parity` passes (after the upgrade).
- [ ] CI workflow runs the test.

### Error paths

- [ ] Test failure reports specific missing keys per locale (not just "mismatch").
- [ ] Test failure reports specific extra keys per locale (e.g. a stray translation that shouldn't exist).
- [ ] Empty-string values count as MISSING (not as present-but-empty).

### Edge cases

- [ ] Locale fallback (e.g. `zh-CN` fallback to `zh`) — verify the test handles fallbacks correctly (or excludes them from strict parity).
- [ ] Plural forms (`%d items`) where a locale needs multiple variants — verify the test understands plural forms vs key absence.
- [ ] RTL locale keys (`ar`, `he`) — verify present and non-empty.

### Performance

- [ ] Test runs within 5s.

### Security

- [ ] N/A — read-only test.

### UX

- [ ] N/A — internal test infrastructure.

### i18n

- [ ] The whole SHY IS i18n; covered by AC above.

### Observability

- [ ] Test failure messages enumerate specific missing/extra keys.
- [ ] CI job summary reports parity status per locale (PASS / N keys missing).

## BDD Scenarios

**Scenario: Key-set parity check catches a missing translation**

- **Given** the reference `values/strings.xml` has 100 keys
- **And** `values-ja/strings.xml` has 99 keys (missing one)
- **When** the parity test runs
- **Then** the test FAILS
- **And** the failure message names the missing key + locale (`ja`)

**Scenario: PR #1010 keys present in all 20 locales**

- **Given** the SHY's verification assertion
- **When** the test runs against current locale files
- **Then** all 20 locales contain `notifications_disabled_banner_title` + `_action` with non-empty values
- **And** the assertion passes

**Scenario: Empty value counted as missing**

- **Given** a locale file has `<string name="X"></string>` (empty body)
- **When** the parity test runs
- **Then** the empty entry is treated as missing
- **And** test fails with "key X is empty in locale Y"

**Scenario: Extra keys flagged**

- **Given** a locale has key `X` but the reference does not
- **When** the test runs
- **Then** the test fails with "extra key X in locale Y"

## Test Plan (TDD)

### Red

1. Read the current `compose-resources-locale-parity.test.js` source.
2. Identify if it's count-only OR key-set; document.
3. If count-only:
   - Construct a failing assertion (e.g. mutate a test locale file to have a different key set with same count) → confirm count-only test passes (regression-prone) → that's the RED state.
4. For G052: grep current `values-*/strings.xml` files for `notifications_disabled_banner_title`; if any locale missing, RED for that locale.

### Green

1. Refactor test to compare KEY SETS.
2. Add the G052 assertion.
3. If any locale missing the PR #1010 keys, ADD the translations (or coordinate with operator for translation source).
4. Re-run → GREEN on all 20 locales.

## Out of Scope

- **Adding new translations** (other than PR #1010 keys if missing) — only verification.
- **Restructuring the resources file format** — only the test.
- **Translation quality review** — only presence + non-empty.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **PR #1010** (already merged) — the source feature.
- 20 locale files (verify all present).

## Risks & Mitigations

- **Risk:** Test surfaces gaps in many keys across many locales (not just PR #1010). **Mitigation:** GOOD outcome; fix in this PR; if too many gaps, file follow-up SHYs for non-PR-#1010 gaps; G042 still upgrades.
- **Risk:** PR #1010 keys were never translated (operator dependency for translation source). **Mitigation:** if missing, mark this SHY blocked on translation supply; document.
- **Risk:** Plural forms cause false positives. **Mitigation:** read existing test for plural handling; preserve.

## Definition of Done

- [ ] Test upgraded to key-set comparison.
- [ ] All 20 locales pass parity check.
- [ ] PR #1010 keys verified in all 20 locales.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`bug` → auto-merge once green).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; parity-coverage summary in Notes.

## Notes (running log)

- 2026-06-07 ~21:31 BST — Refined under SHY-0032. Tier 4 polish; two adjacent gaps bundled.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-I3` (G042, G052).
