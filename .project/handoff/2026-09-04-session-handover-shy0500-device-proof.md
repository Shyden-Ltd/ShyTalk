# Handover — 2026-09-04 (after the review loop; branch NOT yet pushed)

Branch `story/SHY-0500-instant-cold-start`, PR #2129 into develop. Every
commit is green on `:shared:jvmTest`, `:app:testDevDebugUnitTest`,
`:app:compileDevDebugAndroidTestKotlin`, `compileKotlinIosArm64`, ktlint,
detekt, jest (65/65 across the runner and iOS driver suites), eslint and
prettier. **Nothing is pushed**: the push happens once, after the review loop
is declared finished and `Reviewed-up-to:` in the story is bumped to HEAD.

## What is proven

- **Android device proof: 6/6 journeys green** on the OnePlus (CPH2653,
  Android 16), run `journey-results/runs/local-2026-09-03T19-05-01-168Z`
  (report.json, 64 screenshots, walk video, four `J40-first-frame-*.png`).
  APK built at `13d0e02`. J40 is the story's device proof: signed in /
  invalidated / offline / signed out, each read from the screen AND the app's
  own log. The evidence page for the operator's sign-off is generated from
  those frames (scratchpad `build-evidence-page.py`, every claim written after
  opening its screenshot) and published as the artifact "SHY-0500 Cold Start
  Proof".
- **iPhone: 3/6, deferred by the operator** ("no devices available"). The
  three reds each had a cause, all fixed and pinned. The rerun needs the phone
  on **USB** (its link dropped twice after iOS 27.0) and the per-boot
  UI-automation consent approved on-device. Until it runs green the story's
  Definition of Done is open and it does not merge.
- **Nothing since `13d0e02` is device-proven.** The review rounds changed
  runtime behaviour (claim gate, one-shot redirect, navigate on redirect,
  ban/dead-session hold); a J40 re-run on BOTH phones at the branch head is
  owed, local first, then dev after the deploy.

## The review loop (eleven rounds against `origin/develop`)

Every real finding was fixed with a failing test first; the story's Notes
carry the full record, including the four findings verified NOT to be defects
and the two objections answered from the record. The commits, newest first:

- `7a5d22cd5a4` round 10 — only a Stay releases the claim gate; every redirect
  leaves it to the host, which settles after `popUpTo(0)`.
- `1d340b4f626` round 9 — doc: a live session with no resolved identity draws
  sign-in and `AuthViewModel`'s migration path resolves it (as before).
- `8ac2a17278f` round 8 — `local/stop.sh` stops only node/java/firebase
  listeners and names what it leaves alone.
- `9d8a3d9a09d` round 7 — the sequencer's dead `run()` removed.
- `934a4ba85ce` round 6 — a throw inside `confirm()` fails closed; the
  cascade's defaults (App-Lock on by default, lock required without a
  timestamp) documented.
- `f6625e9c062` round 5 — a ban never releases the room list's reads; J40's
  account-disabling lever refuses anything but a `demo-` project on its own
  named app.
- `2a2d069d7a8` round 4 — verdict applied before any other await; no silent
  `awaitPersistedSession()` default; a failed iPhone log capture fails loudly.
- `66e1087a818` round 3 — a new draw releases an abandoned gate; ban paths
  pinned on both platforms.
- `5d7274611d2` round 2 — re-readable iPhone log; honest iOS timeout log;
  `confirm()` directly after the draw.
- `b802458f740` round 1 — `ColdStartClaimGate`, one-shot session-expired
  message, iOS navigates on a redirect, `checkNotNull` on confirm-before-draw.

Rounds 10 and 11 re-raised two decisions already recorded (a throw holds the
gate; the offline Stay reads from cache) and one product point (a mandatory
update draws after the shell — the UX criterion's exception list now names
it). If the next round produces only recorded decisions, the loop is finished:
bump `Reviewed-up-to:`, push once, watch CI.

## Two follow-ups worth filing (not this story)

- After an OFFLINE cold start, confirm the claim when the network returns
  instead of waiting for the SDK's hourly refresh.
- Cache the last minimum-version verdict locally so a mandatory update can be
  drawn first too.
- The husky pre-push hook diffs `origin/main...HEAD` and runs the full
  Playwright suite even for `git push --delete` (memory
  `feedback-pre-push-hook-runs-playwright-even-for-a-ref-delete`).

## Operator report — dev admin page "Your account could not be identified"

Triaged and answered. The message is `rejectMissingIdentity` (403
`no_identity`): the caller's Firebase uid has no `users` document with a
matching `firebaseUid` on dev. The admin persona works: signed in against
`FIREBASE_DEV_API_KEY` with the ROTATED password from
`~/.shytalk/dev-personas-credentials` (NOT `dev-personas.env`, which still
holds the pre-rotation value — memory
`reference-dev-persona-password-lives-in-dev-personas-credentials`),
`GET /api/portal/me` answers 200 `isAdmin: true` (uniqueId 90000001). So the
middleware is healthy and the failure is specific to the account the operator
used; the dev API log had no "no resolved identity" line in its pm2 output.
Dev still serves `47255b6a64f` — #2131 (SHY-0289) is merged on develop but not
deployed; the deploy is owed and is part of the next develop merge.

## Branch cleanup (operator-requested, 2026-09-04)

104 local branches deleted after a `git bundle` backup
(`~/.shytalk/backups/branch-cleanup-2026-09-04*.bundle` + `.txt` map), 18
stale stashes dropped, local develop/main fast-forwarded. The permission
classifier refused worktree removal and remote deletion; the operator has the
one-line command (four worktrees, two tmp branches, eleven remote branches via
`gh api -X DELETE`). Kept: SHY-0146 (iOS integrity, in flight), SHY-0227
(pushed deliberately by an earlier session), SHY-0335 (self-mute fix, Draft
story), the handover branch behind PR #2136, and this branch.

## Next steps, in order

1. Run one more `/code-review low origin/develop`; if it only re-raises
   recorded decisions, bump `Reviewed-up-to:` to HEAD in the story, commit.
2. `git push </dev/null` once (the pre-push hook runs Playwright when the
   stack is up — expect minutes), then watch PR #2129's checks BY NAME.
3. Evidence page: republish with the final review state; operator sign-off.
4. When a phone is on USB: J40 on both phones at the branch head (local),
   then the iPhone core set; then merge to develop, deploy to dev, J40 on dev.
