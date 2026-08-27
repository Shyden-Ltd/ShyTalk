---
id: SHY-0372
status: In Review
owner: shyden
created: 2026-08-20
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0372: Lucky Spin goes dead after cancelling the age dialog

## User Story

As **someone who opens Lucky Spin before verifying my age**, I want the wheel to
still work after I close the age prompt, so that I am not stuck staring at a
screen where nothing responds.

## Why

**Reported by the operator, 2026-08-20.** Open Lucky Spin → tap any play button
→ the age-verification prompt appears → tap Cancel → **every play button is now
dead.** No spin, no prompt, no error. The only way out is to close and reopen the
overlay, which is not discoverable — it reads as the app being broken.

### Root cause

`LuckySpinOverlay.kt` enters the spinning state **optimistically**, before it
knows the pull was accepted:

```kotlin
phase = SpinPhase.ANIMATING     // LuckySpinOverlay.kt:631 and :708
GachaSoundPlayer.playSpinStart()
when (tier.count) { 1 -> onSpin(); else -> onQuickSpin(tier.count) }
```

The only thing that unsticks it is this recovery effect:

```kotlin
LaunchedEffect(gachaState.isPulling) {          // LuckySpinOverlay.kt:177
    if (!gachaState.isPulling && phase == SpinPhase.ANIMATING && …) resetBoard()
}
```

It is **keyed on `isPulling`**. `GachaViewModel.pull()` surfaces the age dialog
and returns *before* `isPulling` is ever set true, so `isPulling` never
**changes** — the effect never re-runs, `phase` stays `ANIMATING`, and the
composable renders the spinning branch, where the play buttons do not exist.
Dismissing the dialog clears the ViewModel state correctly; the overlay simply
never hears about it.

### It is not only the age gate

**Every early return in `pull()` latches the wheel the same way**, because none
of them touch `isPulling`:

| Early return in `GachaViewModel.pull()` | Reachable? |
| --- | --- |
| age restriction (sub-18 / unverified) | yes — the reported path |
| `coinBalance < cost` → "not enough coins" | yes |
| unknown tier (`pullCosts[count] == null`) | only on a config mismatch |

The fix must clear the whole class, not just the reported path — otherwise the
next person reports the same bug through the coin path.

## Acceptance Criteria

### Happy path

- [ ] Cancelling the age prompt returns the wheel to its normal idle state; the
      play buttons respond immediately.
- [ ] Tapping play again re-shows the age prompt (it must not be suppressed
      after the first dismissal).
- [ ] Once age verification succeeds, tapping play spins normally.
- [ ] A successful spin is unaffected — the wheel still animates on tap with no
      added delay.

### Error paths

- [ ] A pull refused for **insufficient coins** leaves the wheel usable, and the
      existing "not enough coins" message is shown.
- [ ] A pull refused for an unknown tier leaves the wheel usable.
- [ ] A network failure mid-pull still recovers to idle, as it does today.

### Edge cases

- [ ] Rapid double-tap on a play button does not fire two pulls, and does not
      latch the wheel if the second is refused.
- [ ] Cancel → verify → return to the room → tap play: works without reopening
      the overlay.
- [ ] The 10× and 100× quick-spin buttons behave identically to the 1× button in
      every case above. Both call sites set `phase` optimistically
      (`LuckySpinOverlay.kt:631` and `:708`).

### Performance

- [ ] No added latency on the accepted path — the wheel must not wait for a
      server round-trip before it starts animating.

### Security

- [ ] The 18+ gate keeps its current strength. The prompt must still appear on
      **every** attempt while unverified, and must never be dismissible into a
      spin. A null or unresolved user stays fail-closed.
- [ ] No coins are charged on any refused pull.

### UX

- [ ] A refused pull never leaves a control that looks tappable but is not.

### i18n

- [ ] No new user-facing strings. If the fix adds any, they go to the **5 MVP
      locales only** (en, zh, id, vi, th) — not the retired `values-*` dirs.

### Observability

- [ ] A refused pull is logged with its reason, so "the wheel is dead" is
      diagnosable from a log rather than by reproducing it.

## Device proof — OnePlus CPH2653 (Android 16), dev, 2026-08-20

Walked as **[SEED] Marcus (P-04 minor power)**, UID 60000010, cohort `minor`,
in room `SHY0372dev`. Build `0.97.15-b9ac76d549e2 (176)`, branch
`bug/SHY-0372…`, commit `9ac76d5*`, talking to dev `api 487ef30`.

| Step | Result |
| --- | --- |
| Tap **1x SPIN** | "Feature unavailable" age prompt appears |
| Tap **Cancel** | **Wheel returns to idle; 1x / 10x / 100x all present** |
| Tap **1x SPIN** again | Prompt appears **again** — not suppressed |
| Tap **Cancel** again | **Wheel recovers again** |
| Tap **10x SPIN** | Prompt appears |
| Tap **Cancel** | Wheel recovers; all three buttons present |
| Coin balance throughout | **350 → 350** — nothing charged on any refused pull |

The second cancel is the one that matters. It is the on-device form of
`two identical refusals signal twice, not once`: a flag, or keying recovery on
the error text, would have latched the wheel on that tap. Both optimistic call
sites were exercised — 1x (`LuckySpinOverlay:708`) and quick-spin (`:631`).

### The `local` half of the protocol could not be walked

Not because of this change. On the `local` flavour
`HomeViewModel.createRoom():369` does `authRepository.currentUserId ?: return`,
and Firebase Auth is not established against the local emulator, so no room can
be created and Lucky Spin is unreachable. Two incidental findings recorded for
separate tickets:

1. **`createRoom` fails silently** — the early return sits *above* its own
   `logI`, so tapping Create closes the dialog and produces no room, no error,
   and no log line. Same silent-failure class as this bug.
2. **The `local` flavour still defaults to `10.0.2.2`** (`app/build.gradle.kts:155`),
   the Android *emulator's* host alias, five weeks after emulators were retired
   (2026-07-15). Real-device local builds need `-PlocalHost=localhost` plus
   `adb reverse`; the default now costs ten minutes to rediscover.

## BDD Scenarios

**Scenario: The wheel still works after declining age verification**

- **Given** someone opens Lucky Spin without having verified their age
- **When** they close the age prompt
- **Then** the play buttons work again and the prompt reappears

**Scenario: A refused spin leaves the wheel usable**

- **Given** someone does not have enough coins to spin
- **When** they tap play
- **Then** they are told why, and the wheel is still usable

## Test Plan

**RED first.** The reproduction is the operator's, and it is deterministic.

1. **Failing test at the overlay level:** drive `LuckySpinOverlay` with a state
   where the pull is refused (age dialog surfaces, `isPulling` never flips), tap
   play, then assert the play button is still present and enabled. **Fails
   today.**
2. Same test for the insufficient-coins refusal, and for 10× / 100×.
3. Assert the age prompt re-appears on the second tap — the fix must not achieve
   "the button works" by suppressing the gate.
4. Assert no coins are deducted on either refusal.
5. Android androidTest Gherkin for the reported journey: open Lucky Spin →
   play → cancel → play → prompt appears.
6. Device-verify on the real OnePlus, and on the real iPhone (the overlay is
   commonMain, so both platforms carry the defect).

## Out of Scope

- Redesigning the age-verification flow itself (SHY-0146 / the verification
  submit screen).
- The Lucky Spin visual design.

## Dependencies

- None. `GachaViewModel` already exposes everything the overlay needs.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Making `phase` wait for `isPulling` adds a visible delay before the wheel moves | Do not gate the animation on the server. Drive the reset off the refusal instead — the accepted path keeps its optimistic start. |
| Fixing only the reported path | AC and tests cover every early return in `pull()`, which is the actual class. |
| Weakening the 18+ gate while making the button responsive | An explicit AC and test that the prompt reappears on every attempt. |

## Definition of Done

- [ ] Reported journey passes on a real Android device and a real iPhone.
- [ ] Story `In Review` before merge; CI green by name; merged to develop; dev
      deploy dispatched and its health gate observed passing.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20 — reported by the operator**, root-caused the same day to the
  optimistic `phase = ANIMATING` at `LuckySpinOverlay.kt:631`/`:708` combined
  with a recovery effect keyed on a value the refusal path never changes.
