---
id: SHY-0341
status: Draft
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0341: You cannot delete your account unless you happen to have set a PIN

## User Story

As **any ShyTalk user who wants to leave**, I want the Delete Account button to
actually delete my account, so that I am not stopped by a credential I was never
asked to create and cannot supply.

## Why

**P0, store-blocking, and a legal exposure.**

The delete flow exists and looks complete: Settings → Account → **Delete
account** → confirmation → PIN → scheduled deletion after a 30-day grace period,
swept by cron. It is well built. It also **cannot be completed by a large share
of our users**, and we would not find out until they tried.

`express-api/src/routes/users.js`, `POST /api/users/:uniqueId/delete`:

```js
if (!user.pinHash) {
  return res.status(400).json({ error: 'No PIN set for this account' });
}
```

**Almost nobody has a `pinHash`.** Setting a PIN is not part of signing up. Both
Android navigation graphs register the PIN-setup screen — `SharedNavGraph.kt:667`
and the legacy `NavGraph.kt:779`, which SHY-0024 is tracked to delete and which
`MainActivity` still mounts — and **both reach it from the same single place:
Settings → Security → *Reset PIN*.** `setupPin()` is called from exactly one view
model, `PinSetupViewModel`. Verified by grepping every caller in every source
set. **A user who never opened Security Settings has no PIN, and therefore no way
out.**

What that user experiences: the Delete account button is shown unconditionally
(`AppSettingsScreen.kt:921`, in the `else` arm of "is a deletion already
scheduled"). They tap it. They confirm. They are asked for a PIN they do not
have. The dialog will not submit while the field is empty, so they guess, and
get back **"No PIN set for this account"** — a message that names the obstacle
and not the remedy. There is no link to set one. It is a dead end wearing the
clothes of a working feature.

**The same screen proves the check is not a house rule.** Request my data —
`POST /api/users/:uniqueId/data-export`, sitting a few pixels above — requires
`requireOwner` and nothing else. So of the two data-protection rights we offer in
one place, **access works for everyone and erasure works for PIN-holders**. That
asymmetry is not defensible to a regulator, and it is not deliberate.

**Why it blocks the release:**

- **Apple, Guideline 5.1.1(v)** — an app with account creation must let the user
  initiate deletion *in the app*. A button that refuses is a rejection, and it is
  one a reviewer finds in about ninety seconds, because they will have made a
  fresh test account and that account has no PIN.
- **Google Play, Data deletion policy** — same requirement, plus a deletion route
  reachable from outside the app.
- **UK/EU GDPR Article 17** — erasure obstructed by a credential the controller
  never issued.

**The identity check itself is right and stays.** Deletion is destructive and
irreversible after the grace period; an unlocked borrowed phone should not be
able to end someone's account. What is wrong is treating an *optional* credential
as the *only* credential. The fix is to verify identity with the strongest
credential the account actually has: the PIN when one is set, and otherwise a
fresh re-authentication of the provider they signed in with. That is the standard
control, it is what a reviewer expects to see, and it points the same way as
SHY-0196, which moves App-Lock onto the device OS credential.

## Acceptance Criteria

### Happy path

- [ ] A user who has never set a PIN can complete account deletion from inside the app.
- [ ] Before it goes ahead, they confirm who they are using the credential they already have.
- [ ] A user who does have a PIN is asked for it, exactly as today.
- [ ] After confirming, they are told plainly what happens next and when it becomes permanent.

### Error paths

- [ ] Failing the identity check refuses the deletion and says what went wrong, without hinting at whether a PIN exists on the account.
- [ ] A deletion that cannot be recorded is reported as not done — the user is never told their account is scheduled when it is not.
- [ ] Asking to delete an account already scheduled for deletion is treated as already-done, not as a failure.
- [ ] No path through this screen can leave the user unable to delete with no route forward.

### Edge cases

- [ ] Accounts created through every sign-in method we support can be deleted.
- [ ] A user who sets a PIN after starting the flow is asked for it, not for the older check.
- [ ] Deletion still works while the account is suspended or banned — leaving is not a privilege.
- [ ] Cancelling within the grace period still restores the account.

### Performance

- [ ] The identity check adds no perceptible wait to a flow the user only ever performs once.

### Security

- [ ] Deletion always requires a fresh proof of identity. Being signed in is never sufficient on its own.
- [ ] The refusal message does not reveal whether an account has a PIN.
- [ ] The rate limit on identity attempts is at least as strict as the current PIN path's.
- [ ] Every deletion request is recorded in the audit log with how identity was proven.

### UX

- [ ] The user is never asked for a credential they do not have.
- [ ] If we ask for something they must set up first, we take them there and bring them back.
- [ ] Verified with eyes on real devices, both platforms, at the smallest supported resolution.

### i18n

- [ ] Every new or changed string ships in all locale files, with the rendered sentence asserted, not just the key.

### Observability

- [ ] A refused deletion is distinguishable in logs by reason: wrong credential, no credential available, or transport failure.
- [ ] A metric or log line makes it visible if deletions start failing for a whole class of accounts again.

## BDD Scenarios

**Scenario: Someone who never set a PIN can still leave**

- **Given** a user who has never set up a PIN
- **When** they ask to delete their account and confirm who they are
- **Then** their deletion is scheduled and they are told when it becomes permanent

**Scenario: Someone else cannot delete your account from your unlocked phone**

- **Given** a signed-in account on an unlocked phone
- **When** someone asks to delete it and fails the identity check
- **Then** the account is not deleted and nothing about its credentials is revealed

**Scenario: A user with a PIN is asked for their PIN**

- **Given** a user who has set up a PIN
- **When** they ask to delete their account
- **Then** they are asked for their PIN, as before

**Scenario: Changing your mind still works**

- **Given** a user whose account is scheduled for deletion
- **When** they cancel within the grace period
- **Then** their account is restored and they can carry on using it

## Test Plan

**RED first.** The defect is reproducible in one line today: create a user with
no `pinHash`, call `POST /api/users/:uniqueId/delete`, observe
`400 "No PIN set for this account"`.

### Express / Jest — `express-api/tests/routes/users-deletion-*.test.js`

- `an account with no PIN can still be scheduled for deletion` — **the defect, in one assertion**
- `an account WITH a PIN still requires the correct PIN`
- `a wrong credential is refused`
- `the refusal does not disclose whether a PIN is set`
- `deletion still works for a suspended account`
- `a second delete request on an already-scheduled account is idempotent`
- `every accepted deletion writes an audit-log entry naming the identity method`
- `identity attempts are rate limited`

### Kotlin unit — `shared/src/commonTest/.../settings/`

- `the delete flow never asks for a credential the account does not have`
- `a refused deletion surfaces the reason and leaves the account intact`
- `a scheduled deletion shows the date it becomes permanent`

### Journey tests — real devices

- `journey-tests/` scenario: a persona created fresh **with no PIN** walks
  Settings → Account → Delete account through to a scheduled deletion, then
  cancels. Today this scenario cannot pass, which is the point.
- A second scenario covers a persona **with** a PIN, so the fix cannot pass by
  removing the check.
- Walked on real Android (USB adb) AND real iPhone (USB devicectl), local then
  dev, per the Pre-Merge Testing Protocol.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the `!user.pinHash` early-return restored | `an account with no PIN can still be scheduled for deletion` + the no-PIN journey |
| the identity check removed entirely | `a wrong credential is refused` |
| the PIN branch bypassed for PIN-holders | `an account WITH a PIN still requires the correct PIN` |
| the refusal message made to name the missing PIN | `the refusal does not disclose whether a PIN is set` |
| audit-log write removed | `every accepted deletion writes an audit-log entry...` |

## Out of Scope

- Making PIN setup mandatory at signup. That fixes this symptom by imposing a
  credential on every user for the sake of one destructive action, and it does
  nothing for the accounts that already exist.
- The web deletion route Play asks for — separate surface, separate story.
- Changing the 30-day grace period, the deletion sweep, or what gets erased.
- The App-Lock credential redesign itself (SHY-0196).

## Dependencies

- **SHY-0196 (App-Lock = device OS credential)** — not blocking, but they must
  agree. If SHY-0196 retires `pinHash`, this flow must already be asking "what
  can this account prove?" rather than "what is its PIN?". Whichever lands
  second inherits the obligation to keep the other's tests green.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| Weakening the check to fix the block | The check is not removed; a wrong credential is still refused, asserted and mutation-proven in both directions. |
| Re-auth behaves differently per sign-in provider | Every supported provider is covered by an AC and by a test, not just the one the developer used. |
| The refusal leaks whether a PIN exists | Asserted directly, and in the mutation table. |
| SHY-0196 lands first and removes `pinHash` | Named as a dependency; whichever is second keeps the other's tests green. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] Both journey scenarios walked on real Android AND real iPhone, local then dev.
- [ ] Screenshots of the flow on both platforms at the smallest supported resolution.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18 20:0x WIB** — Filed after checking whether in-app deletion existed
  at all, which was the original question. **It does, and it is well built** —
  UI, confirmation, grace period, cron sweep, cancel, status, audit log. The
  story is not "build deletion"; it is that a working feature is gated on a
  credential the signup flow never asks for.

- **2026-08-18** — Established by grep: `setupPin()` is called from ONE view
  model (`PinSetupViewModel`), and there is no enrolment during registration on
  either platform, so a new account has no `pinHash` and cannot be deleted.

- **2026-08-18, corrected in review** — the first draft said `Screen.PinSetup` is
  navigated from exactly ONE site. It is TWO: `SharedNavGraph.kt:667` and the
  legacy `NavGraph.kt:779`, which `MainActivity` still mounts and SHY-0024 is
  tracked to delete. The original grep was scoped to `shared/src/commonMain` and
  missed `app/src`. Both sites sit behind the same Settings → Security → Reset
  PIN entry, so the conclusion is unchanged — but a story whose value is "checked
  rather than assumed" has to be right about what it checked.

- **2026-08-18** — The asymmetry that settles the argument: data **export**
  (`data-export.js:51`) takes `requireOwner` and no PIN; data **erasure**
  (`users.js:1355`) demands one. Same screen, same user, two GDPR rights, one
  reachable.

- **2026-08-18** — A store reviewer hits this on their first attempt, because a
  freshly created review account is exactly the account that has no PIN.
