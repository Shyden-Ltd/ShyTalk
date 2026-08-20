# Session handover — 2026-08-21 (part 8)

Supersedes part 7. Read the **open right now** and **operator decisions** sections
before doing anything.

## Open right now

**PR #1909 (SHY-0385, the in-app support form) is pushed, green locally, and was
still running its gate when this session ended.** Merge it when clean, then
dispatch Deploy To Dev. Nothing else is in flight.

**Its gate failed on 2026-08-21 and has been fixed.** `check-pr-story-status.js`
refused the PR because it *modified* SHY-0379 while that story is still `Draft`
— the exemption is add-only, so the six newly filed Drafts passed and the one
rewrite did not. The refinement is parked in
`.project/handoff/2026-08-21-SHY-0379-refined-spec.md` and the story file is back
to develop's version, so **SHY-0379 on disk is knowingly stale — read the parked
spec before picking it up.** SHY-0394 asks whether the gate should learn a
declared spec-only mode; the status was not faked.

## Merged this session

| Story | PR | State |
| --- | --- | --- |
| **SHY-0378** — API signing secrets | #1896 | merged; **dev AND production** provisioned |
| **SHY-0372** — Lucky Spin latched on a refused pull | #1898 | merged, deployed, device-proven |
| **SHY-0384** — the inert Contact support button | #1900 | merged, deployed, device-proven |
| **SHY-0380** — support-ticket queue + admin tab | #1907 | merged, deployed |
| **SHY-0385** — the in-app support form | **#1909** | **open, awaiting gate** |

### Production is provisioned

`ubuntu@213.35.98.160` (`shytalk-api-singapore`), app dir `/home/ubuntu/shytalk-api`
— **not** dev's `express-api`.

`MFA_REMEMBER_SECRET` added (fp `79e1afb1df02`, file == live). `EXPORT_DOWNLOAD_SECRET`
was **already set** — prod was NOT a copy of dev, and a blanket write would have
overwritten a live signing key and killed every outstanding data-export link.
Health 200, restarts 21 → 22, backup at `.env.bak.20260820T131216Z`.

## Operator decisions — do not relitigate

1. **Support is a ticket, not an email.** There is **no support mailbox at all**.
   Every "email support" route in the product points at nothing.
2. **`openEmail` now has zero callers** — dead API across the interface and three
   platform implementations. Removal belongs to the email-route sweep.
3. **Admin ticket actions: resolve + internal note.** No reply path; that is
   EPIC-0012.
4. **The support form must be a PAGE**, not a dialog — categories, screenshot and
   video attachments. Modelled on `ReportUserDialog`, which already does all of
   it. Categories approved: Account & login · Age & verification · Coins, beans &
   purchases · Safety & another user · Something is broken · Something else.
5. **Age-gate state machine** (SHY-0379): under the threshold → hidden entirely;
   at or over **and verified** → visible and usable; at or over and **not**
   verified → visible, prompts verification; verified **under** despite an adult
   DOB → suspended.
6. **A false adult DOB costs the account** (SHY-0389). Warning must ship first.
7. **Age becomes private by default AND existing accounts are migrated**
   (SHY-0391).
8. **Account reset** (SHY-0393): everything except **purchases and their
   entitlements**; admin-actionable **and admin-reversible**.
9. **Merge to develop freely, deploy dev after each. Never force-push or rewrite
   history.**

## Filed, not started

| Story | Pri | Effort | What |
| --- | --- | --- | --- |
| **SHY-0387** | P1 | M | The support **page** — categories + attachments. Supersedes SHY-0385's dialog; its plumbing survives unchanged. |
| **SHY-0379** | P1 | M | Hide age-gated features, per the state machine above. |
| **SHY-0391** | P1 | S | Age private by default + migrate. **Blocks SHY-0388.** |
| **SHY-0388** | P1 | S | DOB-entry warning. **Blocks SHY-0389.** |
| **SHY-0392** | P1 | M | "Is this wrong?" → correct a DOB with ID. |
| **SHY-0389** | P1 | M | Suspend on a verified age mismatch. |
| **SHY-0393** | P1 | L | Account reset, reversible. |
| **SHY-0390** | P2 | XS | Message-report reasons render in English for everyone. |
| **SHY-0386** | P3 | XS | `routes/health.js` has never been mounted. |
| **SHY-0381/0382/0383** | P2–P3 | S/XS | Flaky admin spec · silent `createRoom` · retired emulator host default. |
| **SHY-0394** | P2 | S | The story gate refuses a spec-only refinement of a Draft. Operator call. |

**Sequence that matters:** SHY-0391 → SHY-0388 → SHY-0389. The privacy claim on
the warning screen is not true until the age default flips, and suspending
somebody for something they were never warned about is indefensible.

## Traps written into those stories

- **SHY-0379 must key on *known* under-age.** `AgeRestrictionService.computeState()`
  returns `SubEighteen` **both** for a genuine under-age DOB **and** for a
  *missing* one — a fail-closed default. Hiding on the second silently strips
  features from somebody whose DOB merely failed to load.
- **Support must never be hidden by SHY-0379.** It is not age-gated, and hiding
  it strands the person most likely to need it.
- **The profile shows AGE, not a date of birth.** `ProfileScreen.kt` renders
  `age_years_old`. SHY-0392's link sits next to the age; the page corrects the
  date.
- **SHY-0393 needs earned and purchased balances to be distinguishable.** If they
  are one number today, that is the first piece of work, not a detail — it
  decides whether the story is buildable as specified.
- **SHY-0393 must archive, not delete.** Reversibility is the constraint.
  Suspension already does snapshot-and-restore (`preSuspensionDisplayName` etc.);
  follow it rather than invent a second pattern.

## Things that will bite you

- **Locale scope: all 21 files, always.** The MVP-5 rule governs which languages
  the *product ships in*, not which files stay in parity. Both the parity guard
  and a **pinned string count** (now 846, in `locale-string-content.test.js`)
  require every key in every one of the 21 `values-*` directories until SHY-0194
  deletes them. **This wrong inference bit twice in one session** — once on the
  admin panel's `translations.js`, once on Compose resources.
- **The no-stubs ratchet may only shrink.** A route test using `jest.mock` from
  `tests/routes/` is a new offender. Regenerating the baseline is the WRONG fix —
  name the file `*.unit.test.js`, which the ratchet exempts by policy.
- **Gradle up-to-date lies.** A full `:shared:jvmTest` came back green in **6
  seconds** for 1,562 tests. `--rerun-tasks` took 45s. Never trust a suspiciously
  fast green.
- **Backgrounding a task suppresses the operator's notifications.**
  `auto-arm-resume.sh` arms a **2400s** marker on every `run_in_background` and
  never shortens it. Run `bash ~/.claude/scripts/arm-resume.sh 0` **before any
  turn that asks the operator something.**
- **`uiautomator dump` can be stale.** A text field looked empty across three
  attempts and had actually accumulated every string typed into it. Verify by
  re-dumping after a pause, not by re-typing.

## iOS proof is blocked by the device, not by discipline

The iPhone has only `com.shyden.shytalk` at **1.0 (1)** — the prod bundle, stale
— and **TestFlight is not installed**. So there is no route to a dev build except
a local Xcode build needing `-allowProvisioningUpdates` against a real device,
which the never-churn-signing rule makes a bad idea unattended.

**Installing TestFlight once is a one-time operator action** that turns every
future iOS proof into a two-minute update. Until then, "iOS proof owed" is not a
memory failure — the path does not exist.

## The pattern this session kept finding

**A path that does nothing and says nothing.**

| Where | The silence |
| --- | --- |
| SHY-0372 | recovery keyed on a value the failure path never changes |
| SHY-0384 | confirm button wired to dismiss |
| SHY-0382 | early return sitting **above** its own log line |
| SHY-0381 | a retry whose wait cannot fail |
| SHY-0386 | a route file that was never mounted |
| Persona picker | button renders, tap does nothing, and the doc comment claims it logs a refusal it does not |

Each passes review. Each only surfaces on the second interaction. When reviewing
anything here, the question is not "does this work" but "what happens on the path
where it doesn't, and would anyone find out".
