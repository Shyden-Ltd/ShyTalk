---
id: SHY-0330
status: In Progress
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0330: A journey step passes even when the driver did nothing at all

## User Story

As a **developer reading a journey-matrix result**, I want a step to fail when
the driver could not perform it, so that a green cell means the app worked
rather than that the runner reached the end of a function.

## Why

**P0. This invalidates every matrix result ever produced.**

Measured on develop, by scanning `manual-qa-runner.js`: **116 step handlers**
call a driver method, discard its return value, and unconditionally
`return { ok: true }`.

```js
await ctx.uiDriver.androidTap(tag);
return { ok: true };            // whatever androidTap said, the step "passed"
```

Splitting those 116 by what they actually call:

| | sites | distinct methods | what happens today |
| --- | --- | --- | --- |
| **stub-only** | **98** | **95** | the step does **nothing** and reports PASS |
| real implementation | 18 | 16 | a genuine failure is swallowed and reports PASS |

**The stub-only half is the serious one.** Every driver wires its unimplemented
methods to a stub that logs and returns `false`
(`android-adb-driver.js:263-270`, and the same in `ios-simctl-driver.js` and
`web-playwright-driver.js`):

```js
driver[methodName] = async (...args) => {
  console.error(`[android-driver] stub:${methodName}(...) — not implemented yet`);
  return false;
};
```

So the **entire 114-method missing-driver inventory is invisible in pass/fail
terms**. A journey step that calls a method nobody has written reports PASS.

**This is why the matrix has been undiagnosable.** SHY-0328 recorded 256
`not implemented yet` lines in a run whose steps were not failing on them —
they passed, the journey continued in a state nobody had actually produced, and
it died several steps later on missing data. Three weeks of "why is the matrix
0-pass" was chasing the wrong question: the real defect is that **a pass has
never been evidence of anything**.

**A second, compound defect on the iOS path.** The runner calls
`ctx.uiDriver.iosTap(tag)` with a STRING (`manual-qa-runner.js:2958`), and its
comment at `:2945` says "the iOS variant delegates to `iosTap(identifier)`".
That was true when `ios-simctl-driver.js:234` (`iosTap = async (id)`) was the
only iOS driver. But `ios-appium-driver.js:310` defines
**`iosTap = async (x, y)`** taking numeric COORDINATES — its string-based method
is `iosTapByTag`. Under `--driver appium`, or `--driver all` with `WDA_TEAM_ID`
(the transport enabled on 2026-08-18), every iOS tap therefore sends
`x="<tag>", y=undefined`, Appium rejects the malformed pointer action, the
driver returns false — and the runner discards it. **Every iOS tap is a no-op
reporting PASS.**

One method name, two incompatible contracts, chosen by which driver loaded.

## Acceptance Criteria

### Happy path

- [ ] A step whose driver method reports failure FAILS, naming the persona, the method and the reason.
- [ ] A step calling an unimplemented (stub) driver method FAILS rather than passing.
- [ ] A step whose driver genuinely succeeded still passes.

### Error paths

- [ ] A driver that returns `undefined` (forgot to return) is treated as FAILURE, not success.
- [ ] The failure message identifies which driver method failed, so the run log points at the gap.
- [ ] Reverting any single call site to discard its verdict turns exactly one named test RED (mutation-proven).

### Edge cases

- [ ] `iosTap` is called with the string-based method that BOTH iOS drivers implement, so the meaning does not change with the transport.
- [ ] A step calling a method that legitimately returns non-boolean is not broken by the change.
- [ ] The stub's diagnostic still names the method and the device — it becomes louder, not quieter.

### Performance

- [ ] N/A — a return-value check. No extra I/O.

### Security

- [ ] N/A — test-harness only; no product surface, no credential handling.

### UX

- [ ] N/A — developer-facing. **Expect the matrix pass count to DROP sharply when this lands. That is the fix working**, not a regression: those passes were never real.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] An unimplemented method now surfaces as a named step failure instead of a line in a 20k-line log nobody reads.
- [ ] Per-cell OK counts become meaningful for the first time.

## BDD Scenarios

**Scenario: A step that could not be performed is reported as failed**

- **Given** a journey step that needs an action the test harness cannot yet perform
- **When** the journey runs
- **Then** that step is reported as failed, naming what could not be done

**Scenario: A working step still passes**

- **Given** a journey step the harness can perform
- **When** the journey runs
- **Then** the step passes

**Scenario: Tapping works the same on both iPhone setups**

- **Given** the same journey run against either iPhone automation setup
- **When** a step taps a named control
- **Then** the control is tapped, rather than the step quietly doing nothing

## Test Plan

**RED first.** Measured on develop before any change: 116 discarded-verdict
sites, 98 of them calling stub-only methods.

### Node / Jest — `express-api/tests/scripts/driver-verdict-honoured.test.js`

- **`no step handler discards a driver verdict`** — scans the runner; the defect in one assertion
- `an unimplemented driver method FAILS the step rather than passing`
- `a driver returning false FAILS the step`
- `a driver returning undefined FAILS the step` (forgot-to-return must not read as success)
- `a driver returning true passes the step`
- `the iOS tap step uses the method both iOS drivers implement with the same contract`

### Node / Jest — driver stub contract

- `an unimplemented method throws rather than returning false`
- `the thrown error names the method and the device`

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| any one call site reverted to discard its verdict | `no step handler discards a driver verdict` |
| the stub reverted to `return false` | `an unimplemented driver method FAILS the step` |
| `iosTapByTag` reverted to `iosTap` in the runner | `the iOS tap step uses the method both iOS drivers implement` |
| the verdict check weakened from `!== true` to `if (!x)` | `a driver returning undefined FAILS the step` |

### Real-run proof

- A local matrix run shows step failures naming unimplemented methods, where
  the same run previously reported those steps as passed.

## Out of Scope

- **Implementing the 95 missing driver methods.** This story makes the gap
  VISIBLE and attributable; filling it is the driver-method inventory
  programme, one story per journey.
- Unifying `iosTap`'s two signatures across the iOS drivers. This story routes
  the runner to the method whose contract is already consistent
  (`iosTapByTag`); making `iosTap(x, y)` and `iosTap(id)` stop sharing a name is
  a driver-side refactor with its own blast radius.

## Dependencies

- None. It is independent of SHY-0328, though both touch `manual-qa-runner.js`.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| **The matrix result gets dramatically worse** | Expected and correct — those passes were false. Called out in the AC and the PR so nobody reads the drop as a regression. |
| A method legitimately returning non-boolean is broken | The check is applied per site against the method's actual contract, and the scanning test pins that no site regresses. |
| `!== true` is too strict | It is deliberate: a driver that forgets to return must read as failure. Pinned by its own named test. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Found while reviewing SHY-0328. The reviewer flagged 7 sites
  and explicitly called its sweep "a floor, not a ceiling". Scanning the runner
  mechanically found **116**.
- **2026-08-18** — The stub-returns-false connection is the important one: it
  explains why 256 `not implemented yet` lines in a matrix run did not surface
  as step failures. The missing-driver inventory has been masked by the
  discarded verdicts the whole time.
