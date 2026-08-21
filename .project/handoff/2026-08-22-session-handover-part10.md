# Handover part 10 — 2026-08-22

Previous: `2026-08-21-session-handover-part9.md`.

## Read this first

**#1940 (SHY-0387) must NOT merge.** The iOS device walk found a P1: the support
form can be filled in and cannot be sent on an iPhone. Details in **SHY-0419**.
Everything else below is done or in flight.

---

## Landed

| What | State |
| --- | --- |
| **#1941 — SHY-0416** (no iOS dev build could sign in) | **MERGED** 15:08Z, deployed to dev |
| Deploy To Dev from `develop` (`32495997153`) | **success**, all jobs green |
| iOS TestFlight from `develop` | **success** — first build carrying the persona credential |
| **#1943 — SHY-0308** (the intermittent ban-test 401) | **OPEN**, CI running, ready to merge on green |

### SHY-0416 is proven, not assumed

The iOS job's env in the real run shows `DEV_QA_PERSONAS_PASSWORD: ***`
(run `32495997153`, "Build, archive, and export iOS app"). Then, on the actual
iPhone: the persona picker appeared, listed P-02…P-10, and **signing in worked**.
That is the first iOS dev build that has ever been able to sign in.

---

## SHY-0308 — root-caused, fixed, PR #1943

Was: `Expected: 403, Received: 401`, intermittent, three unconfirmed hypotheses.

**Cause, confirmed:** `auth/id-token-revoked`. Banning revokes refresh tokens on
purpose (`syncBannedClaim`). `authMiddleware` verifies WITHOUT `checkRevoked`,
so production never consults that — but `firebase-admin` forces the check on
against the Auth emulator (`if (checkRevoked || isEmulator)`, `base-auth.js`),
which is local AND CI. The token was refused before the ban gate ever ran.

Two further teeth: `iat`/`validSince` are second-granular, so even a forced
refresh can be minted in the same second and refused; and the revoke kills the
REFRESH token, so `getIdToken(true)` can keep returning the same dead token.

**Shipped:** the credential check is separated from the standing lookups in both
middlewares; the 401 body now carries `code: token_rejected` or
`standing_unavailable`. Status unchanged, fail-closed unchanged.

**Verified:** webkit 20/20 and chromium 10/10 at `--retries=0`; whole spec file
66/66 across both; Express suite 14,551/14,552. Mutation (exempting
`/suggestions` from the ban gate) is caught on the first response with the
suggestion actually created — and caught at the 403 assertion itself.

**Left for you:** whether a failed standing lookup should keep answering 401 at
all. It is pinned deliberately by the posture unit test, so I did not overturn
it. A 401 tells clients "your session is invalid"; a Firestore blip can
therefore read as a mass sign-out. Written up in the story.

---

## New tickets

| Id | P | What |
| --- | --- | --- |
| **SHY-0419** | **P1, MVP** | iOS: the support form cannot be sent — Send sits behind the keyboard. **Blocks #1940.** |
| SHY-0417 | P2 | Production: a banned user on portal/admin routes gets a bare 401, not the ban notice the docblock promises. |
| SHY-0418 | P2 | Two wall-clock assertions that go red under suite load. |

---

## SHY-0419 in one paragraph

On a real iPhone Air (iOS 27), the keyboard occupies y=609–854 and
`support_send` sits at y=616–665 — inside it, `visible="false"`. Tapping empty
margins, tapping between sections, tapping a category, and the iOS
swipe-down-over-keyboard convention all leave the keyboard up, and the page does
not scroll (a 700 ms drag left the button at y=616). **`imePadding()` was tried
in BOTH orderings, each with a full rebuild and reinstall, and neither moved the
button** — so the working hypothesis is that `WindowInsets.ime` is not reported
on iOS, which would also mean `RoomScreen`, `EmailOtpScreen` and
`PrivateChatScreen` have the same problem unnoticed. The speculative change was
reverted rather than shipped. 15 shared Compose files take text input without
any keyboard handling; the list is in the story.

---

## How to re-walk iOS (this now works end to end)

```bash
bash scripts/ios/build-debug-dev.sh          # builds + installs on the iPhone
xcrun devicectl device process launch --device <coredevice-uuid> com.shyden.shytalk
# Appium is already installed; session caps + a small UI helper are in the
# session scratchpad (ui.py): find/tap by accessibility id, summarise the tree.
```
Route: Profile → `main_settingsButton` → `settings_aboutItem` →
`settings_contactUsLink` → the support page.

Traps met on the way, all real:
- `xcrun devicectl list devices` gives a **coredevice UUID**; `xcodebuild` and
  Appium want the **hardware UDID** from `xcrun xctrace list devices`.
- Tapping an element whose `visible="false"` still returns success and lands
  somewhere else — one such tap typed a stray `t` into the message field.
  Always assert `visible="true"` before tapping.

## Traps met elsewhere today

- **`git push` dies with SIGPIPE (141) after the pre-push hook passes.**
  `git push </dev/null` works. The hook consumes git's ref stdin and the long
  Playwright child then kills the transfer. Use `</dev/null` every time.
- **The pre-push hook computes `CHANGED` against `origin/main`**, but branches
  are cut from `develop`. For any develop-based branch that reports ~291 code
  files and ~25 web files changed, so the full ~1,450-test chromium suite runs
  on every push — even a one-line story edit. ~20–25 min each. Not filed yet;
  worth a ticket.
- **`.project/handoff/**` is NOT in the gate's `NEUTRAL_RE`** (only
  `.project/stories/*.md` is), so pushing a handover to a PR branch makes an
  "unreviewed commit" and the gate refuses. Push the handover BEFORE recording
  the review marker, or bump the marker afterwards.
- **Running `npx prettier --write` from the repo root on `tests/web/**` churns
  the file** — there is no root prettier config, so it applies double-quote
  defaults and rewrote 362 lines, one of which the secret scanner then blocked
  as a new credential. `tests/web/` is not formatter-governed; lint-staged only
  covers `express-api/**/*.js`.
- `admin-users-profile.spec.ts:36` was "1 flaky" in every full run today. Not
  investigated.

## Suggested order next

1. Merge **#1943** on green, then `gh workflow run "Deploy To Dev" --ref develop`.
2. **SHY-0419** — it blocks #1940 and it is the flagship help path.
3. Then #1940, re-walked on the iPhone.
