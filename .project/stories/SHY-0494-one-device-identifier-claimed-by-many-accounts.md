---
id: SHY-0494
status: In Review
owner: claude
created: 2026-08-28
priority: P1
effort: M
type: bug
roadmap_ids: []
---

# SHY-0494: One device's push identifier is claimed by every account that signed in on it

## User Story

As **someone who signs in to ShyTalk on a phone another person has used**,
I want **only my own notifications to arrive on it**,
So that **I never see a message, invite or moderation notice meant for somebody else**.

## Why

Observed on dev, 2026-08-28, immediately after SHY-0244 landed. **Four
accounts hold the same installation ID** `d79NouUmT-KeCnEcX2Msyp` on one
OnePlus: Alice (adult), Vexa (adult), **Marcus (minor)** and **Greta (admin)**.

A Firebase Installation ID identifies the **app instance**, not the person. So
each account that signs in on a device registers the same value, and unless
sign-out removes it, every one of those accounts keeps claiming that phone. A
push addressed to any of them arrives on it.

SHY-0244's own edge-case AC names this exactly: *"Sign-out then sign-in as a
different persona does not deliver the previous user's notifications to the new
session — a cross-account leak here would be a safety defect in a minors-facing
app."* An adult and a minor sharing one device's push channel is that defect.

The same shape existed under the registration-token model — tokens are equally
device-scoped — so this is very likely **pre-existing and merely made visible**
by looking closely during the migration. That does not make it less serious.

**Most likely cause, to be confirmed first:** the journey runner's debug
`signInAs` surface switches persona without going through the normal sign-out
path, and it is `NavGraph`'s `onSignOut` that calls `removePushIdentifier`. If
so the product is sound and the harness is leaking. **Do not assume that** —
the same accumulation would occur for a real user who signs out if the removal
ever fails, since removal is best-effort and logged rather than retried.

## Acceptance Criteria

### Happy path

- [ ] After a person signs out on a real device, their account no longer holds that device's push identifier.
- [ ] After a second person signs in on the same device, only that second account holds it.
- [ ] A notification sent to the first account after they signed out does **not** arrive on that device.

### Error paths

- [ ] If removal fails (offline at sign-out), it is retried — the identifier is not simply abandoned on the account.
- [ ] A retry that can never succeed (account deleted) is bounded and logged, not infinite.

### Edge cases

- [ ] A minor and an adult who have both used one device never both hold its identifier at the same time.
- [ ] Signing in on a second device leaves the first device's identifier intact — this is per-device, not a global reset.
- [ ] An app reinstall does not strand the old identifier on the account forever.

### Security

- [ ] No account retains a push identifier for a device it is not signed in on.
- [ ] The audit trail shows when an identifier was added and removed, so a leak can be reconstructed after the fact.

### Observability

- [ ] A failed removal is visible in the log with the account and the reason.

### UX

- N/A — no user-visible change; this is about who a notification reaches.

### i18n

- N/A — no strings change.

### Performance

- [ ] Removal adds no perceptible delay to sign-out.

## BDD Scenarios

**Scenario: signing out stops that account claiming the phone**
- **Given** somebody is signed in on a phone and receiving notifications
- **When** they sign out
- **Then** their account no longer holds that phone's push identifier

**Scenario: the next person on the phone gets only their own notifications**
- **Given** one person signed out on a phone and another signed in
- **When** a notification is sent to the first person
- **Then** it does not arrive on that phone

**Scenario: an adult and a minor never share a phone's notifications**
- **Given** a minor and an adult have both used the same phone
- **When** the stored identifiers are inspected
- **Then** only the person currently signed in holds that phone's identifier

## Test Plan

**Classification: FULL protocol.** Touches app runtime and backend runtime, and
the failure is a safety one.

### Red (must fail first)

- A device test: sign in as A, sign out, sign in as B, assert only B holds the identifier. RED today.
- An express test: removal failure is retried rather than dropped. RED before the retry exists.

### Green

- Real-device proof on a real Android phone AND a real iPhone: sign in, sign out, sign in as somebody else, and confirm by inspecting the stored identifiers AND by sending a real notification to the first account and observing it does NOT arrive.

### Mutation proof

- Neuter the sign-out removal → the device test fails.
- Make the retry give up on the first failure → the retry test fails.

## Out of Scope

- The choice of identifier model. SHY-0244 settled that; this is about lifecycle.
- Multi-device support, which is deliberate and stays.

## Dependencies

- Builds on **SHY-0244** (merged 2026-08-28).
- A real Android device and a real iPhone, plus dev Firebase.

## Risks & Mitigations

- **Risk: the fix is applied to the product when the leak is only in the test harness**, leaving the real gap unfixed and a harness still lying. **Mitigation:** first reproduce through the ORDINARY sign-out path on a real device, not through `signInAs`. Fix whichever actually leaks; if both, fix both.
- **Risk: an over-eager removal signs a user out of push on their OTHER devices.** **Mitigation:** removal is scoped to the identifier of the device performing the sign-out.

## Definition of Done

- [ ] Reproduced through the ordinary sign-out path before any fix is written.
- [ ] Only the currently signed-in account holds a device's identifier, proven on a real Android device and a real iPhone.
- [ ] A notification to the signed-out account is observed NOT arriving.
- [ ] Full pre-merge gauntlet green.
- [ ] Status flipped to `In Review` before merge; `released_in:` set at release.

## Notes (running log)

- **2026-08-28** — Found while proving SHY-0244 on dev. Four accounts on one
  OnePlus all held `d79NouUmT-KeCnEcX2Msyp`, among them a minor and an admin.
  Not caused by SHY-0244 — device-scoped identifiers behave the same way under
  the token model — but surfaced by it, and named directly by SHY-0244's own
  edge-case AC.

- **2026-08-30 — reproduced first, and the leading hypothesis was WRONG.**

  The story guessed the journey runner's debug `signInAs` was bypassing the
  sign-out that removes the identifier. It is not. `signOutFlow` in the runner
  drives the **real UI**: profile tab → settings → Sign Out → confirm. No debug
  bypass anywhere. So this is product behaviour, and the story was right to
  demand a reproduction before a fix.

  **Root cause: ordering, not the removal code.** `onSignOut` fired the removal
  into a coroutine scope and then, synchronously, tore down auth and navigated
  away. The removal lost two races at once:

  1. its scope (`rememberCoroutineScope()` **inside** the settings composable)
     was cancelled by the very navigation sign-out triggers; and
  2. the credential authorising the request was revoked before it landed.

  Both are silent — removal is best-effort and logged — so the only symptom is
  somebody receiving a stranger's notifications.

  **Two implementations, one concern.** iOS routed sign-out through
  `PushTokenManager.clearToken`; Android had its own duplicate in
  `AndroidPlatformNavCallbacks` and never registered `PushTokenManager` at all.
  Both were fire-and-forget, so both leaked.

  ### The fix

  - `PlatformNavCallbacks.removeFcmToken` is now **`suspend`**. As a plain
    function, every caller could fire it and move on; suspending makes "await
    this before signing out" the only way to call it. The compiler immediately
    flagged the real call site — the silent race became a build error.
  - `SignOutCoordinator` holds the policy: release, **then** sign out, with a
    bounded wait so a dead network cannot trap somebody in the app. It takes
    the release as a lambda, so it needs no DI and does not care that the two
    platforms reach their push layer differently.
  - Both sign-out sites now run on a scope remembered at the **NavGraph** level,
    which survives the navigation, rather than the settings screen's own.

  Tests pin the **order**, not the call — asserting "removal was called" would
  have passed against the broken code, which called it too. Three mutations
  (sign out first; skip the release; drop the timeout) all caught.

  Gate: `:app:testDevDebugUnitTest` + `:shared:jvmTest` + `:shared:compileKotlinIosArm64` + `detekt` green.

- **Residue cleared on dev** the same day: all four accounts had
  `d79NouUmT-KeCnEcX2Msyp` removed via `DELETE /api/notifications/token`, so the
  cross-account state no longer exists there.

- **2026-08-30 — DEVICE-PROVEN on dev.** Deployed, rebuilt the dev APK and ran
  the full Android matrix on the OnePlus, which signs in and out as several
  personas in sequence — the exact motion that produced the residue.

  | | Accounts left holding the device's identifier |
  | --- | --- |
  | Before the fix | **4** — Alice (adult), Vexa (adult), **Marcus (minor)**, **Greta (admin)** |
  | After the fix | **1** — Alice, the persona still signed in when the run ended |

  One is the correct answer: a device belongs to whoever is signed in on it. A
  minor and an admin no longer claim a phone they signed out of.

  (The identifier value differs between the runs because the app was
  reinstalled; an FID is per app instance.)

  Matrix result: **8/8 on dev**, the first fully green dev run.
