# Handover — part 12 (2026-08-22, evening)

Branch `feature/SHY-0387-support-page`, PR **#1940**. Everything below is
committed. Last pushed commit was `ab5a7f74e78`; there are **local commits
after that** — push before doing anything else.

## The gate

**Operator sign-off on the evidence page is the only thing between this and a
merge.** https://claude.ai/code/artifact/7a12acb2-5ee0-4d9b-b4f2-f7d3374600c7
(60 rows, screenshots enlarge on click, the attachment clip plays with sound.)

## Operator rules added today — all in memory

| Rule | Memory file |
| --- | --- |
| Both devices **in parallel**; kick off BOTH builds first | `feedback-local-both-devices-always` |
| Merge `develop` into the branch on every switch/return | `feedback-merge-develop-into-branch-on-every-switch-or-return` |
| Merge `main` into `develop` **before the push to develop** | `feedback-merge-main-into-develop-before-testing` |
| An agent **per device/browser**, in parallel (carve-out from one-agent-at-a-time) | `feedback-parallel-test-agents-per-device-and-browser` |
| Device journeys are **scripted**, never agent-tapped | `feedback-device-journeys-must-be-scripted-not-agent-tapped` |
| Run tests **headed** — the operator watches | `feedback-run-tests-headed-so-the-operator-can-watch` |
| Never `npx tsc` here (no tsconfig, decoy package) | `reference-there-is-no-tsc-in-this-repo` |
| Jest `expect()` takes ONE argument | `feedback-jest-expect-takes-one-argument` |
| OnePlus screenrecord: use its **default** save location | `reference-oneplus-screenrecord-use-the-default-location` |

## What this branch now carries

**SHY-0396** — a second support request is a choice, never a refusal. 409 gone;
`mine/open`; `messages` append; `openTicketsAtCreation`; three-choice UI; the
form warns before anybody types, capped at two summaries plus "and N more".

**SHY-0387 attachment limits, corrected by the operator:** 10 files, images
**5 MB**, video **30 seconds by DURATION** (this did not exist — nothing read a
duration anywhere). Android reads it via `MediaMetadataRetriever`; iOS writes
the picked data to a temp file for `AVURLAsset`. Both release what they open.

**Message bound 1,000** (was 2,000), counted **live** on the field, client and
server pinned together. Blank/whitespace refused on all three routes in.

**SHY-0419** — Send is now pinned in the Scaffold's `bottomBar`, and ALL
hand-rolled inset arithmetic is gone: `Modifier.imePadding()` on the Scaffold,
counted once, no platform branch.

**SHY-0427** (new, P1) — both iOS pickers lost their delegate to the GC. Held on
the enclosing `object` now. `IosImagePicker` is on develop, so **this shipped**.

## Defects found and fixed that were NOT in this branch's scope

- **The admin CSP had no `media-src`** → video evidence was unplayable on EVERY
  admin tab, reports and appeals included. Now `http:`/`https:`, with the
  mixed-content reasoning written beside the tag.
- **Support thumbnails were never wired** to the lightbox.
- **`local/test-playwright.sh` pointed every web test at the Firestore emulator**
  (`npx serve` — retired by SHY-0180 — on port 8080) and reported PASSED while
  exiting 1.
- **`ios-local-install.sh` shipped Kotlin frozen at 08:11 all day.** It now
  relinks every run and refuses a bundle whose Kotlin is older than any source.
- **`MINIO_ENDPOINT=localhost`** → no iPhone could ever upload. LAN address now;
  `.env.local.example` explains why.

## Tickets filed today

SHY-0421 (data export omits support tickets — P1, DSAR), SHY-0422 (four strings
in 21 locales still point at an unmonitored inbox — P1), SHY-0423, SHY-0424,
SHY-0426 (null `uniqueId` treated as an identity — 192 uses across 29 route
files; support guarded, central fix outstanding), SHY-0427.

## Where to pick up

1. **Push** (there are unpushed commits), then check CI on #1940.
2. Operator sign-off on the evidence page.
3. Merge `main` → `develop`, then `develop` → branch, re-run, merge, deploy dev.
4. **Record device walk videos** using the OnePlus's own recorder and its default
   save location — the operator asked for videos and I wrongly reported it
   impossible. See the memory note.
5. **SHY-0399** — the lifecycle the operator asked about: admin closes, user sees
   it closed, user reopens, **admin is notified again**. Needs its own branch.
   The notification AC is NOT yet in SHY-0399 (it is Draft; the gate refuses
   edits to those) — add it at pickup.

## Two open questions for the operator

- This branch carries four stories. Defensible — each was found by testing the
  one before — but splitting before merge is his call.
- 19 dependabot vulnerabilities on the default branch (2 critical, 12 high).
