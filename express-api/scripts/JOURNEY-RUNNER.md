# ShyTalk on-device journey-test runner

`device-journey-runner.js` drives the **real ShyTalk app on a connected phone**
through end-to-end user journeys and writes a **detailed pass/fail report** you
can read — so you run one command and read one report instead of tapping
through every step by hand.

It is a **hybrid** runner. Each journey can assert on three layers at once:

1. **UI** — taps/inspects the live app via `adb` + `uiautomator` (Compose
   `testTag`s show up as `resource-id`s in the dump; dialogs are matched by
   their visible text).
2. **Firestore** — reads the local emulator directly (via `firebase-admin`) to
   confirm the database state behind each action.
3. **Server / API** — signs in as each persona (real Firebase ID token from the
   Auth emulator) and calls the `express-api`, so it verifies the **rules the
   server enforces** (the OSA cohort gate, admin override, moderation) — which
   are _not_ visible in the UI alone.

> Translations of this guide live in `journey-runner-locales/` (20 languages).

---

## 1. Prerequisites

| You need                       | How                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** running     | for the Firebase emulators + LiveKit/MinIO                                                                                                            |
| **The local stack up**         | `bash local/start.sh` (from the repo root) — starts Firebase emulators + the express-api. Leave it running.                                           |
| **Personas seeded**            | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotent; seeds the P‑02…P‑19 test cast with password `localdev123`) |
| **A phone connected**          | `adb devices` must list one (USB cable **or** wireless `adb`). An Android emulator also works.                                                        |
| **Java 21+ & the Android SDK** | only needed the first time, so the runner can build the app if the APK is missing                                                                     |

The runner builds the `local` debug APK itself if it isn't already built.

---

## 2. Run it

From the repo root:

```sh
# Run the whole suite against the local stack
node express-api/scripts/device-journey-runner.js

# See the list of journeys without running anything
node express-api/scripts/device-journey-runner.js --list

# Run only specific journeys
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Force a fresh APK build first
node express-api/scripts/device-journey-runner.js --rebuild

# Full option list
node express-api/scripts/device-journey-runner.js --help
```

Options: `--target local|dev` (default `local`) · `--serial <adb-serial>`
(default: auto-select) · `--journeys <ids>` · `--rebuild` · `--no-reset` (skip
the clean reinstall in the smoke journey) · `--out <dir>` · `--list` · `--help`.

The runner pins **one** adb serial for every command, so it works even when a
phone shows up twice (USB + wireless). For the `local` target it sets up
`adb reverse` tunnels so the on-device app reaches the stack on your machine.

---

## 3. See the results

When it finishes it prints a summary and writes, under `journey-results/`:

| File                            | What                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Read this** — per-journey, per-step ✅/❌ with the reason, the on-screen testTags, and a screenshot link for every step |
| `latest-report.json`            | the same data, machine-readable                                                                                           |
| `runs/<runId>/*.png`            | a screenshot of every step (pass _and_ fail)                                                                              |
| `runs/<runId>/report.{md,json}` | the archived report for that specific run                                                                                 |

Exit code is `0` when every journey passed, `1` when any failed. On a failure
the step records exactly what was on screen, so you can see _why_ without
re-driving the phone.

---

## 4. What the journeys cover

Run `--list` for the live set. At a glance the suite covers:

- **Smoke** — clean install → legal acceptance → sign-in, backend reachable.
- **Cohort sign-in** — adult / minor / admin personas sign in via the in-app
  dev persona picker; identity is confirmed against the debug overlay and the
  Firestore `cohort` field.
- **OSA cohort gate** — a minor cannot follow or view an adult (server returns
  `404`, and the Firestore write never happens), while same-cohort actions
  succeed — proving the gate is cohort-specific, not a blanket block.
- **Admin** — cohort-override is staff-only (a regular member is rejected with
  `422`; a staff account succeeds and writes a regulatory audit row).
- **Moderation** — report → admin suspend (+ audit) → appeal → unsuspend, fully
  server-enforced, with idempotent cleanup.

Authentication in journeys always uses the **in-app dev persona picker** — never
real Google/Apple sign-in.

> **Note on the journey specs.** The Gherkin plans in
> `.project/test-plans/manual/j01-j19` are partly _aspirational_: they reference
> UI the shipped app doesn't have (e.g. an email/password signup screen, hidden
> minor tabs, a discovery screen). The runner therefore maps each journey's real
> intent against the **actual** app + Firestore + API, and records such
> divergences as findings rather than failing on fiction.

---

## 5. Troubleshooting

| Symptom                                               | Fix                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `No adb device found`                                 | Plug in / pair the phone; check `adb devices`.                                                               |
| Stuck reaching SignIn / "backend NOT reachable"       | The local stack isn't up or the `adb reverse` tunnels didn't set — restart `bash local/start.sh` and re-run. |
| `persona "<email>" not found in picker`               | Personas aren't seeded — run the seed command in §1.                                                         |
| `Firestore assertions: ON` missing / DB steps skipped | DB asserts run only for `--target local`.                                                                    |
| APK build fails                                       | Open the printed `gradle-build.log`; ensure Java 21+ and the Android SDK are installed.                      |
| A step fails on a screen you didn't expect            | Open the screenshot named in `latest-report.md` for that step.                                               |

---

## 6. Adding a journey

Journeys are plain objects with a `run(device, reporter, ctx)` method, composed
from the shared helpers:

- `signInAs(device, reporter, ctx, email, nameToken)` — sign in a persona via
  the picker and ride the first-launch interstitials to Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, and `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Server: `getIdToken(email)` → a persona's ID token, then
  `apiCall(method, path, { token, body })`.

Wrap each assertion in `reporter.step(device, 'name', async () => { … })` — it
times the step, screenshots it, records pass/fail, and on failure captures the
on-screen testTags. Add the new object to the `all` array in `buildJourneys`.

Pure logic (parsing, selectors, arg handling) is unit-tested in
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`);
the device/Firestore/API layers are integration-tested by running the suite on
a real device.
