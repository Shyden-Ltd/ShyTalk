# Handover — part 11 (2026-08-22)

Branch: `feature/SHY-0387-support-page`. **Not pushed at time of writing.**
Everything below is committed locally.

## Operator rules added this session — all recorded in memory

| Rule | Where it now lives |
| --- | --- |
| Test on **both devices IN PARALLEL** — kick off both builds as the FIRST action of a device phase | `feedback-local-both-devices-always` |
| Merge `develop` into the branch on **every switch or return** to a ticket | `feedback-merge-develop-into-branch-on-every-switch-or-return` |
| Merge `main` into `develop` **before the push to develop** (dependabot; release readiness) | `feedback-merge-main-into-develop-before-testing` |
| Use **an agent per device/browser**, in parallel — an explicit carve-out from one-agent-at-a-time | `feedback-parallel-test-agents-per-device-and-browser` |
| Device journeys are **scripted**, never agent-tapped | `feedback-device-journeys-must-be-scripted-not-agent-tapped` |
| **Never `npx tsc`** here — no tsconfig, no typecheck in CI, npx fetches a decoy | `reference-there-is-no-tsc-in-this-repo` |

## What shipped into the branch

**SHY-0396 — a second support request is a choice, never a refusal.**
Server 409 removed; `GET /support-tickets/mine/open`; `POST
/support-tickets/{id}/messages`; `openTicketsAtCreation` recorded server-side.
Client: `RaiseTicketOutcome.AlreadyOpen` and `alreadyHasOpenTicket` deleted,
replaced by `openTickets` + `awaitingDuplicateChoice`. The form states what is
open BEFORE anybody types; Send asks first and offers three answers; "go back"
keeps every character.

**Three defects found and fixed before merge, all in this unmerged branch:**

1. The admin Support tab rendered **nothing at all** in chromium, firefox and
   webkit — `import … from "/js/tabs/users.js"` 404s and a failed ES-module
   import aborts the whole module. From SHY-0387.
2. Every ticket showed a false "Attachments could not be loaded" —
   `apiCall(path)` with no method, so it fetched `<baseUrl>undefined` and threw
   before any request left the page.
3. Follow-ups rendered ~90px indented — `white-space: pre-wrap` picking up the
   template literal's own source indentation.

**A harness defect that was corrupting every web test:**
`local/test-playwright.sh` started `npx serve public -l 8080` — a server RETIRED
by SHY-0180 for dying mid-suite, on the port the **Firestore emulator** owns. So
Playwright's baseURL pointed at Firestore's 404 page. Now uses the stack's own
`serve-web.js` on 8888 and starts nothing of its own.

**Test infrastructure built**

- `J38` in `device-journey-runner.js` — 14 steps, **173s**, green on the real
  phone. Replaces a ~25-minute agent-driven walk.
- `IosDevice` + `parseXcuiNodes` — ONE journey definition, TWO device backends.
  `--platform ios|android`, validated.
- `tests/web/admin-support.spec.ts` — 30 passes across 5 Playwright projects.
  Its absence is why a dead admin tab passed CI.
- Whole-class guards: admin module imports resolve; `apiCall` arity; no runner
  resurrects `npx serve` or binds Firestore's port.

## Evidence page

https://claude.ai/code/artifact/7a12acb2-5ee0-4d9b-b4f2-f7d3374600c7

42 sign-off rows. **Operator sign-off is the remaining gate before merge.**

## Tickets filed from sweeps

| Ticket | What |
| --- | --- |
| SHY-0421 (P1) | A data export omits support tickets entirely — reports and appeals are included, so it is drift. It is a legal answer to a subject access request. |
| SHY-0422 (P1) | Four strings across all 21 locales still tell people to email `shytalk.help@gmail.com`, which the operator said is not monitored — including the Technical Difficulties screen, shown exactly when the API is unreachable. |
| SHY-0423 (P3) | `resolvedCohort` is never recomputed after the date-of-birth gate, and the stale value is persisted into the iOS session cache. No age gate reads it today. |
| SHY-0424 (P3) | "You already have 5 requests open" is a display cap read back as a count. |

## Where to pick up

1. **Operator sign-off** on the evidence page. Nothing merges before it.
2. Merge `main` → `develop`, then `develop` → this branch (the new rules), re-run.
3. Push, then merge to `develop`, then deploy dev.
4. SHY-0420 (attachments, virus scanning, sandboxed admin viewing) is unstarted.
5. SHY-0417, and the 16 journey-gap tickets SHY-0400–0415, unstarted.

## Two things I got wrong, recorded so they do not recur

- **My own guard was green while the admin tab was dead.** It read `support.js`
  as text and asserted it renders follow-ups — true of the source, irrelevant to
  a module the browser refuses to execute. Source-scanning guards can only prove
  what the source SAYS.
- **A guard that could not fail for the case it named.**
  `expect(block).toContain('escapeHtml')` survived a mutation that rendered a
  follow-up raw, because the timestamp beside it is escaped too. Mutation
  testing found it; the assertion is now bound to the message itself.
