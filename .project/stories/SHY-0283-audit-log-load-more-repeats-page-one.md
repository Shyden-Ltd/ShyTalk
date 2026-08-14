---
id: SHY-0283
status: Draft
owner: claude
created: 2026-08-05
priority: P2
effort: S
type: bug
roadmap_ids: []
public: false
---

# SHY-0283: "Load More" on the audit log shows the same entries again instead of the next ones

## User Story

As **an administrator reading the moderation audit log**,
I want **"Load More" to show me the entries that come after the ones I can already see**,
So that **I can read the whole history instead of the first page repeated forever**.

## Why

The audit log shows one page of entries and offers a **Load More** button. Pressing it adds another copy of the entries already on screen, and pressing it again adds a third. No administrator can ever reach the second page — the older entries are unreachable through the interface.

`public/admin/js/tabs/audit-log.js` keeps the current page in `state.page`, initialised to `1` (line 12). `load(append)` resets it to `1` inside `if (!append)` (line 58) and reads it when building the request (line 75) — but **nothing anywhere in the file ever increases it**. The Load More button calls `load(true)` (line 25), so the reset is skipped and the value stays `1`: every press re-requests the first page. Because `append` is true, the table is not cleared first (`if (!append) tbody.textContent = ''`, line 93), so the same rows are appended beneath themselves (line 94).

The server is not at fault. `express-api/src/routes/admin-audit-log.js` parses `page` (line 72) and computes `offset = (page - 1) * pageSize` (line 153) correctly — it faithfully returns page 1 because page 1 is what it was asked for. The client also never reads `page` or `total` back off the response, so it has no idea it is looping.

This matters beyond inconvenience: the audit log is the record of moderation actions. An administrator investigating an incident older than one page currently cannot retrieve it, and the interface gives no sign that anything is missing — it looks like more data is arriving.

Found during [[SHY-0279]] when its "load more" check was moved off a fixed sleep. The replacement assertion counts rows and requires the count not to fall, which duplicates satisfy just as well as real data, so the check stayed green over the defect. That assertion is deliberately left weak in [[SHY-0279]] and is strengthened here, alongside the fix, so the test and the product change together.

## Acceptance Criteria

### Happy path

- [ ] Pressing Load More adds entries that were not already on screen.
- [ ] Pressing Load More repeatedly keeps walking backwards through the history, a page at a time.
- [ ] Running a new search starts again from the most recent entries.

### Error paths

- [ ] If a Load More request fails, the entries already on screen stay, and the administrator is told the load failed.
- [ ] A failed Load More does not advance the position, so pressing it again retries the same page rather than skipping one.

### Edge cases

- [ ] When there are no further entries, Load More stops being offered.
- [ ] An audit log with exactly one full page of entries does not offer an empty next page.
- [ ] Changing the filters or dates while extra pages are loaded resets the view to the first page of the new results.

### Performance

- [ ] Load More adds one page's worth of rows and does not re-render the rows already on screen.

### Security

- [ ] Paging cannot be used to read entries the administrator's role does not already permit — every page goes through the same authorisation as the first.

### UX

- [ ] The administrator can tell that the newly-added entries are new, because none of them duplicate what was already listed.
- [ ] The automatic refresh of the audit log does not silently discard pages the administrator has already loaded.

### i18n

- [ ] Any new or changed wording on the button or its failure message is provided for all supported locales.

### Observability

- [ ] A failed Load More is recorded with enough detail to tell a rejected request from an empty result.

## BDD Scenarios

**Scenario: Load More reveals older entries**
- **Given** an administrator is viewing a full page of audit entries
- **When** they choose Load More
- **Then** the entries added are ones that were not already listed

**Scenario: Paging keeps going**
- **Given** an administrator has already loaded a second page
- **When** they choose Load More again
- **Then** a third set of previously-unseen entries is added

**Scenario: The end of the history is honest**
- **Given** an administrator has loaded every audit entry
- **When** the last page has been added
- **Then** Load More is no longer offered

**Scenario: A new search starts from the beginning**
- **Given** an administrator has loaded several pages
- **When** they run a new search
- **Then** they see the most recent matching entries only

**Scenario: A failed load keeps what is already on screen**
- **Given** an administrator is viewing loaded audit entries
- **When** a Load More attempt fails
- **Then** the entries already listed remain and the failure is reported

## Test Plan

**Red (written first, must fail against today's code):**

- `tests/web/admin-audit-log.spec.ts` (extend/replace the current pagination test)
  - `load more requests the next page, not page one again` — waits for a response whose query carries `page=2`, mirroring the `page.waitForResponse` idiom already used at `admin-audit-log.spec.ts:106-112`. **Fails today**: only `page=1` is ever requested.
  - `load more appends entries that are not already on screen` — captures the row identities before the click and asserts the added rows share none of them. **Fails today**: the appended rows are an exact duplicate set.
  - `a second load more advances again` — asserts `page=3` is requested. **Fails today.**
  - `a new search resets paging to the first page` — after paging, re-search and assert `page=1` and no duplicate rows. Guards the fix against resetting in the wrong direction.
  - `load more stops being offered once every entry is loaded` — seeded with fewer entries than two pages.
  - `a failed load more preserves the rows already shown and does not advance` — the real condition is induced by signing the request out of authorisation rather than by intercepting the network.
- `express-api/tests/routes/admin-audit-log-suggestions.test.js` (extend — despite the name this is the general route test for `admin-audit-log.js`, covering spec 11.9 / 11.77)
  - `page 2 returns the entries after page 1 with no overlap` — pins the server contract the client will now actually exercise; expected to PASS today (the server is already correct) and guards it against regression while the client changes.

**Green:** the full `tests/web/admin-audit-log.spec.ts` on all five Playwright projects, plus the admin-console suite, since the audit-log tab shares `apiCall` and the tab-refresh timer with its siblings.

**Real services only:** entries are seeded through the real Express API against the real Firestore emulator and read back through the real admin console — the defect is in what the client asks the server for, which an intercepted or stubbed response would hide entirely.

## Out of Scope

- The 4-second automatic refresh behaviour of the audit-log tab, beyond not discarding already-loaded pages.
- Any change to the audit log's filters, date range, or CSV export.
- The weak row-count assertion in [[SHY-0279]] — it is left as-is there deliberately and replaced here.
- Pagination in other admin tabs; if they share the defect it is filed separately after this lands.

## Dependencies

- None blocking. [[SHY-0279]] must merge first only to avoid a conflict in `tests/web/admin-audit-log.spec.ts`, which it also touches.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Incrementing the page in the wrong place makes a fresh search start from page 2 | An explicit AC + BDD scenario and a red test cover the reset-on-search path |
| The tab's automatic refresh re-fetches page 1 and discards loaded pages | Covered by an AC; the refresh path is asserted not to shrink an expanded table |
| The fix looks right but the test still cannot see it | The red tests assert the request (`page=N`) and row-identity uniqueness, not row counts — counts are exactly what failed to detect this |
| Other admin tabs share the same copied paging idiom | Grep for `state.page` across `public/admin/js/tabs/` during implementation; file follow-ups rather than widening this story |

## Definition of Done

- [ ] Red tests observed failing against unmodified code.
- [ ] An administrator can page through the entire audit log, proven against real seeded data.
- [ ] `code-reviewer` 100% clean; CI green by name; `Reviewed-up-to:` recorded.
- [ ] LOCAL gauntlet green on real Android + real iOS + the full browser matrix (`public/**` is a shipped runtime surface), then DEV, then judgment-merge.

## Notes (running log)

- **2026-08-05 07:35 WIB** — Filed from a `code-reviewer` finding during the [[SHY-0279]] pre-merge review. The finding was verified directly against source before filing: `state.page` has exactly three references in `public/admin/js/tabs/audit-log.js` — the initialiser (line 12), the reset (line 58), and the read (line 75) — and no increment. Server-side paging confirmed correct, so this is purely client state.
- **2026-08-05 07:35 WIB** — Deliberately NOT folded into [[SHY-0279]]. `public/**` is a shipped runtime surface, so the fix needs the full device/browser gauntlet, and the phones are currently unavailable. [[SHY-0279]] is the change that finally unblocks `playwright-web` for the whole PR queue, and holding it behind a gauntlet that cannot run would strand ~30 PRs. The weak assertion is documented in place at `tests/web/admin-audit-log.spec.ts` with a pointer here.
