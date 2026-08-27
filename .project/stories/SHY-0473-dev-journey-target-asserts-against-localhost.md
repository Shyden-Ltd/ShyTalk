---
id: SHY-0473
status: In Review
owner: unassigned
created: 2026-08-27
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0473: A `--target dev` run asserts against localhost while the phone talks to dev

## User Story

As **whoever gates a release on the dev journey matrix**, I want a dev run to
question the dev environment, so that a green dev report is evidence about dev
rather than about the laptop that ran it.

## Why

`device-journey-runner.js` takes `--target local|dev`. The target decides the
package, the APK, the gradle task and the port tunnelling, and `dev` is
explicitly untunnelled — `reversePorts: []`, commented *"dev backend is remote;
no tunnelling"*. So on `dev` the phone genuinely talks to the remote dev API.

The runner's own assertions do not.

```
const AUTH_EMU_URL = 'http://localhost:9099/identitytoolkit.googleapis.com/...?key=demo';
const API_BASE_URL = 'http://localhost:3000';
```

Both constants are module-level and target-blind. `getIdToken()` mints from the
**local Auth emulator**; `apiCall()` calls **localhost:3000**. Between them they
back more than thirty assertions across the matrix — the cohort gate, the
economy, suspension, moderation, the conversation rules.

The failure is not that a dev run errors. It is that it **passes**. With a local
stack running — which is the normal state of the machine that runs the matrix —
a `--target dev` run puts the phone on dev, asserts the server rules against
localhost, and reports green. Half the journey questions one backend and half
questions another, and nothing in the output says so.

This is SHY-0457's lesson with the target swapped. That guard asks whether a
journey touched *the device*; nothing asks whether it touched *the target*.

### Scope of the exposure

It is not confined to `kind: 'api-contract'` journeys. `kind` is read in exactly
one place — the touch-the-device guard — and never gates on target, so
`kind: 'ui'` journeys such as J-VEXA and J-GRETA mix on-device steps with
localhost API assertions in the same run.

### How it stayed hidden

The dev leg has never been runnable here. Dev personas authenticate with
`PERSONAS_PASSWORD`, generated per-environment and kept in
`~/.shytalk/dev-personas-credentials`, which is absent on this machine. The dev
matrix was therefore never run, so the constants were never exercised against a
target that would have exposed them. The gap was invisible because nobody had
walked into it — see [[feedback-a-green-run-only-proves-the-paths-it-walked]].

## Acceptance Criteria

### Happy path

- [ ] The API base and the auth endpoint are read from the selected target, not
      from module-level constants.
- [ ] A `local` run behaves exactly as it does today: Auth emulator, port 3000.

### Error paths

- [ ] A `dev` run with no persona password **refuses to start**, naming the
      variable and where the value lives.
- [ ] The refusal happens before the app is installed, so it costs seconds
      rather than a build.

### Edge cases

- [ ] Choosing `dev` while a local stack is running cannot produce a green run,
      which is the exact case that made this defect silent.
- [ ] A target added later without an API base fails loudly rather than
      inheriting localhost.

### Performance

- [ ] Configuration only; no change to matrix runtime.

### Security

- [ ] The persona password is read from the environment or the credentials
      file, never committed, and never printed — not in the refusal message,
      the diagnostics, or the run header.
- [ ] The dev Firebase client key is read from the same `google-services.json`
      the dev APK is built from, so the runner cannot drift from the app.

### UX

- [ ] The run header states which API base and which auth endpoint are in use,
      so the target is legible without reading the source.

### i18n

- [ ] None: test-harness only.

### Observability

- [ ] A run that cannot reach its API base says which base it tried, rather
      than surfacing a bare connection error.

## BDD Scenarios

**Scenario: A dev run questions dev**

- **Given** the tester chooses the dev environment
- **When** the journeys check what the server allows
- **Then** the answers come from dev

**Scenario: The tester lacks the dev sign-in details**

- **Given** a tester with no dev credentials
- **When** they start a dev run
- **Then** they are told what is missing before anything is installed

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Each target resolves to its own API base and auth endpoint; no constant survives. |
| Unit | A dev run with no password refuses, and the message names the variable. |
| Unit | The refusal contains no password, asserted against a planted value. |
| Unit | An unknown or incomplete target refuses rather than defaulting to localhost. |
| Device (real) | The `local` matrix still passes 15/15 on the OnePlus — the change is a refactor for that path. |

## Out of Scope

- Running the dev matrix itself. That needs the dev persona password, which is
  an operator action, and is tracked separately.
- The `Dev Smoke Tests` Playwright suite, which already runs against dev in CI
  with its own credentialed secrets and is unaffected.

## Dependencies

- None. The dev API base already exists in `app/build.gradle.kts`, and the dev
  client config already exists in `app/src/dev/google-services.json`.

## Risks & Mitigations

- **Risk:** the refactor changes behaviour for `local`, the path the release
  gate actually uses. **Mitigation:** the local matrix is re-run on a real
  device, and the unit suite pins the local values to what they are today.
- **Risk:** a future target is added with a partial config and silently
  inherits a default. **Mitigation:** an AC and a test require a loud failure.

## Definition of Done

- [ ] The constants are gone and the values come from the target.
- [ ] A dev run without credentials refuses, before install.
- [ ] The local matrix passes 15/15 on a real device.
- [ ] Unit tests cover resolution, refusal, and password redaction.

## Notes

Found while attempting the dev leg of the release gate for the v0.98.0 → next
promotion. The local leg was 15/15 on a real OnePlus; the dev leg could not be
walked honestly, which is what led to reading the runner's target handling.

Related: [[feedback-web-urls-env-derived-never-cross]] is the same rule for the
web surface — a URL belongs to an environment, and a constant is how the two
get crossed.
