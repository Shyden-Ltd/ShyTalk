# Session handover — 2026-08-20 (part 2)

Durable state. Written so the session can be cleared. Do not rely on scrollback.
Supersedes the sequencing in `2026-08-20-session-handover.md` where they differ.

## Operator instructions given THIS session (later ones win)

1. **Work order:** relationships removal → PR queue → EPIC-0004. Chosen
   explicitly over "EPIC-0004 first", with `#1856` merged on the way.
2. **New standing rules, added to global `~/.claude/CLAUDE.md`:**
   - Learn proactively from everything, *especially* negative signals. A review
     flag is a permanent instruction, not a one-off fix. Sweep the whole project.
   - Code to industry standards; **fix dirty code on sight**, don't defer it.
   - **Never merge into `main` directly.** Ticket → branch → `develop`.
   - **Deploy `develop` to dev after every merge**, as part of the merge.
   - **Tester build notes must name the last ticket**, while still saying it is a
     deploy from `develop`.
   - **Board changes must reflect on the dev and live roadmap pages
     immediately, autonomously.**
3. **Anti-dating guardrail added to the project `CLAUDE.md`** (`~/CLAUDE.md`) —
   watch every surface for dating drift, never propose romantic-pairing features
   under any name, raise it rather than quietly building it. Note "language
   partner" is legitimate vocabulary; romantic pairing is not.
4. **Slogan copy chosen:** "Learn languages. Share cultures."
5. **Locale retirement (SHY-0289) comes BEFORE the slogan change (SHY-0364).**

## Merged this session (4)

| PR | Story |
| --- | --- |
| #1856 | SHY-0358 — remove CLAUDE.md (+ the two dangling reads the audit missed) |
| #1859 | files SHY-0360, SHY-0361 |
| #1860 | SHY-0362 — **develop was failing ktlint**, blocking every app-touching PR |
| — | dev deploy run `32289832760` dispatched with ticket-bearing build notes |

## Open PRs — exact next action

| PR | Story | Next action |
| --- | --- | --- |
| **#1858** | SHY-0359 remove Relationships | CI running. Gate from `ShyTalk-0359`, merge. |
| **#1861** | SHY-0363 Gradle 10 deprecation | CI running. Gate from `ShyTalk-0363`, merge. |
| **#1865** | files SHY-0364 + index rows | CI running. Docs-only. Gate, merge. |
| **#1846** | SHY-0144 splash retirement | CI running. Locale pin 839→838 fixed. Gate from `ShyTalk-0144`, merge. |
| **#1853** | SHY-0147 MFA-remember | **BLOCKED on operator dismissal of CodeQL alert 55** (command below). Everything else is green. |
| #1582 | SHY-0151 | CI clean, self-held. Device-prove increment 1 on the iPhone, then merge. NOT DONE. |
| #1527 | SHY-0152/0142 | Stale, needs a look. |
| #1520 / #1519 | dependabot | Merge on green (authorised). |

### The one operator action outstanding

```
gh api -X PATCH repos/Shyden-Ltd/ShyTalk/code-scanning/alerts/55 -f state=dismissed -f dismissed_reason="false positive" -f dismissed_comment="SHY-0147: flagged value is a 30-day DURATION used as a cookie maxAge, not part of the cookie value. The cookie is a signed bearer token: httpOnly + Secure + SameSite=strict + HMAC-SHA256 + bounded expiry + server-side revocation. Three different names all flagged identically."
```

The comment is **276 chars against a 280 cap** — do not lengthen it.

## Findings worth keeping

- **`develop` was failing ktlint** (SHY-0362). Two unused `FieldPath` imports
  left by SHY-0338. The lint job is gated on `app_changed` and merged branches do
  not re-run PR checks, so the breakage silently transferred to the *next*
  person's PR — it was found on #1853, which contains no Kotlin at all. **When a
  red gate reports something the diff cannot explain, check `develop` itself.**
- **Renaming does NOT clear CodeQL alert 55. Proven, do not retry.** Three
  constant names — `MFA_REMEMBER_DEFAULT_TTL_MS`, `MFA_TRUST_WINDOW_MS`,
  `MFA_REVERIFY_AFTER_MS` — were flagged identically. The second rename was made
  this session, disproved, and **reverted**; the declaration in
  `express-api/src/utils/mfa-remember.js` now carries a
  `DO NOT RENAME THIS TO CHASE THE CODEQL ALERT` block listing all three.
- **The CLAUDE.md removal audit was wrong.** It claimed nothing read the file
  programmatically; `check-no-new-stubs.test.js:783` did `readFileSync` at
  describe-collection time, taking down `test-backend`, `SonarCloud` **and**
  `PR Gate` on one root cause. An exhaustiveness claim must search every tree,
  **tests included** — grep over `.github/` will never reveal it.
- **`generate-roadmap-json.js` was dead code with a lying docstring** claiming
  deploy workflows ran it. Its test was already in `testPathIgnorePatterns`, so
  it had never run in any suite. Both deleted in SHY-0359.
- **`voice_chat_reimagined` is live on the SIGN-IN SCREEN**
  (`SignInScreen.kt:276`), not just the website. Its twin `splash_tagline` was
  removed by SHY-0144; this one survived.
- **Locale retirement never happened.** 21 locale directories are still present.
  SHY-0194 was **CANCELLED** (superseded); **SHY-0289 is still Draft**.
- **`SHY-INDEX.md` had drifted 31 stories behind.** Operator chose to **generate**
  it as part of SHY-0360 rather than backfill by hand.
- The dev deploy's **Dev Sanity Check** failed on a 40 KB/s apt mirror inside a
  6-minute cap — **not a product failure**. Dev API verified healthy directly,
  serving the exact merged sha. Caching the Playwright browsers would fix the
  class; not yet ticketed.

## Traps hit this session

- **A fresh worktree has no `node_modules`.** Hit twice. `npm test` exits 1 with
  a *module-not-found*, and a grep-filtered check renders that as **silent
  success** — read the raw exit code.
- **`json.dumps` destroys deliberate formatting.** Re-serialising
  `scripts/roadmap-translations.json` turned a 1-line change into **4,901 lines**;
  it is single-line-per-feature on purpose. Reverted and edited as text.
- **`| tail` swallows the exit code.** `gh pr merge` "failed" while actually
  having merged; only a direct state query tells the truth.
- **The pre-push gate takes 15–25 min** on branches touching `public/`
  (Playwright, 1428 tests). Docs-only branches skip it entirely. **Never run two
  pushes at once** — both gates fight over the same local stack.
- `.project/plans/` is gitignored but its files are **tracked**; `git add` warns
  and stages anyway.

## NOT started

- **SHY-0289** — retire the 15 non-MVP locales. Gates SHY-0364.
- **SHY-0364** — the slogan change. Copy is decided.
- **SHY-0360 / SHY-0361** — filed, Draft.
- **#1582 iOS device proof**, **SHY-0145**, **SHY-0146** (the iOS 27.0 runtime IS
  installed — 7.8 GB, Ready; only simulator *devices* are missing, and
  `xcrun simctl create` makes one in seconds. The earlier "needs a multi-GB
  download" note is stale).
- **SHY-0357** — the vacuity problem: `suggestions-board.spec.ts` has 112
  assertions behind `if (count > 0)` guards, so a blank page passes. Still unfiled.
- Playwright-browser caching for the dev sanity check.
