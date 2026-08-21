# Session handover — 2026-08-21 (part 9)

Supersedes part 8. Two PRs are open and one is blocked on a rebuild.

## Open right now

| PR | Story | State |
| --- | --- | --- |
| **#1941** | SHY-0416 — no iOS dev build can sign in | CI running. **Merge this first.** |
| **#1940** | SHY-0387 — support page | Green, Android device-proven, **iOS walk owed** |

**The order matters.** #1941 is what makes the iOS walk possible at all, so it
merges, then a fresh iOS build is dispatched, then #1940 is walked on the iPhone
and merged.

### Exact next steps

```bash
# 1. merge SHY-0416
BASE_REF=origin/develop bash scripts/pre-merge-check.sh 1941   # read the verdict
gh pr merge 1941 --squash --delete-branch
gh workflow run "Deploy To Dev" --ref develop                  # HARD rule: deploy after every develop merge

# 2. rebuild iOS from the SHY-0387 branch WITH the credential now present
git checkout feature/SHY-0387-support-page && git merge develop --no-edit && git push
gh workflow run "Deploy To Dev" --ref feature/SHY-0387-support-page \
  -f ref=feature/SHY-0387-support-page -f backend=false -f web=false \
  -f android-testers=false -f ios-testers=true

# 3. when it lands: operator installs from TestFlight, then walk the iPhone
```

## Merged today

| Story | PR | Note |
| --- | --- | --- |
| SHY-0385 — in-app support form | #1909 | shipped with the never-wired defect FIXED |
| Journey audit — 21 stories, 16 journeys | #1918 | corpus 471 → 784 scenarios |

Both deployed to dev.

## The headline finding: SHY-0416

`deploy-dev.yml` passed `DEV_QA_PERSONAS_PASSWORD` to `distribute-android` and
NOT to the iOS job. `isPersonaPickerAvailable` is `!password.isNullOrEmpty()`, so
**every iOS dev build ever built has been unsign-in-able.** That is the real
reason iOS proof has been permanently "owed" — not TestFlight, not signing, not
discipline.

Then the first fix was itself unreachable: the empty state went inside a dialog
gated on the very credential it explained. That gate was ALSO the cause of "the
button does nothing". Its comment credits it with a security property it never
enforced — the row handler fails closed, and prod hides the button entirely.

## SHY-0387 state

Device-proven on Android, twice, from two different entry points:

| From | Ticket | Proves |
| --- | --- | --- |
| Settings | `cYYSH9aymp1vfjbwClmD` | attachment in storage, 7,858 bytes, `image/png`; admin's signed link fetches the real image |
| Room age wall | `JfLEilMl6WFizZRf4mz9` | `category=age`, `context={reason age_restriction, feature lucky_spin, screen room}` |

**The second walk exists because the first could not prove the wiring.** From
Settings the correct value and the fallback are the SAME value. A reviewer
flagged the nav argument; the room walk is what closes it.

21 of 26 acceptance criteria ticked. The five left are iOS, a responsiveness
measure, an aesthetic call for the operator, and the merge itself.

## Traps confirmed or found today

- **`devicectl device info apps` hides App Store apps.** Needs
  `--include-default-apps`. A previous handover recorded "TestFlight is not
  installed" from the default output. It was installed all along.
- **Appium "xcodebuild failed with code 65" is usually NOT signing.** The real
  error is "Timed out while enabling automation mode" — the phone's
  Settings → Developer → Enable UI Automation. `devicectl` still launches apps,
  which is the tell. Do NOT re-sign WebDriverAgent.
- **A TestFlight IPA cannot be sideloaded** — Beta profile entitlement. The
  workflow artifact is not a shortcut.
- **`local` builds default to `10.0.2.2`**, the retired emulator alias. Always
  `-PlocalHost=localhost` for a real device.
- **The local Express must be restarted** after any route change; check
  `ps -o lstart=` on the pid, not just its cwd.
- **Gradle reports BUILD SUCCESSFUL in ~1s without running.** Mutation tests need
  `--rerun-tasks` or the result is a lie.
- **A 12-space replace pattern is a substring of the same line at 20 spaces.**
  Two passes insert twice. Anchor to line start.

## The pattern this session kept finding

**A control that renders, does nothing, and carries a comment describing
behaviour nobody wrote.** SHY-0384's button, SHY-0385's unwired form, SHY-0400's
video path, the persona picker, the promised empty state. Four of my own guards
were false passes that only mutation testing exposed — one matched an `import`
rather than a call, one matched a different line entirely, one asked "does ANY
client send it" so one platform covered for the other, and one was never applied
because its anchor was multi-line.

**Assert the seam, not the sides. Then mutate it.**

## Journey audit output — 16 tickets, all Draft

SHY-0400 to SHY-0415. Highest value first: **SHY-0404** (nobody ever translates a
message, in a language-learning product), **SHY-0405** (GDPR export and deletion,
both zero), **SHY-0412** (26 endpoints that wipe collections, no test that they
even refuse a non-admin), **SHY-0414** (an untested restore is not a backup),
**SHY-0409** (two-factor never exercised), **SHY-0415** (the app has no
accessibility journey while the web has seven aria specs).

None of the 784 scenarios have been RUN. They are written and Gherkin-clean;
whether every step resolves to a real driver binding is unverified.
