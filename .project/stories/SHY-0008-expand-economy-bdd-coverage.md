---
id: SHY-0008
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: M
type: feature
roadmap_ids: [G017]
pr:
---

# SHY-0008: Expand economy BDD coverage (subscription + gifting + backpack)

## User Story

As the ShyTalk operator, I want **the economy journey corpus to cover the deep flows that currently lack BDD coverage — subscription purchase/management, gifting (room + DM contexts), and backpack item management — by expanding `subscription_management.feature` and creating `gifting.feature` + `backpack.feature`**, so that every economy interaction has an end-to-end behavioural contract verifiable on a real device.

## Why

The existing journey corpus at `app/src/androidTest/assets/features/` has stubs for some economy flows but lacks depth for:

- **Subscription**: only basic subscribe/unsubscribe scenarios; missing renewal, refund, plan-change, trial-conversion, grace-period.
- **Gifting**: no `gifting.feature` exists; the gift flow (sender debits, recipient credits, animation, gift wall update) has zero BDD coverage.
- **Backpack**: no `backpack.feature` exists; users manage owned items (gift-wrappers, themes, badges) here.
- **Coin purchase**: stubs exist but happy path + Play Billing integration + failure modes lack coverage.

Roadmap row G017 (line 47 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. Journey — economy flows uncovered. Location: `app/src/androidTest/assets/features/wallet.feature` + missing. Gap: wallet/gift_wall stubs but gacha/gifting/backpack/coin-purchase/subscription deep flows missing. Fix: Expand `subscription_management.feature`; create `gacha.feature`, `gifting.feature`, `backpack.feature`. Scope: M.

P1 Tier-3 coverage. Note: `gacha.feature` is covered by SHY-0007 (G007+G008 — age-gate + gacha bundle); THIS SHY covers the remaining 3 (subscription deep + gifting + backpack).

## Acceptance Criteria

### Happy path

- [ ] `app/src/androidTest/assets/features/subscription_management.feature` expanded with ≥8 new scenarios beyond current stub:
  - Subscribe to plan (monthly) — happy path; Play Billing success; subscription active state visible in AppSettings.
  - Subscribe to plan (annual) — happy path with annual discount.
  - Cancel subscription — confirmation flow; remains active until period end.
  - Reactivate cancelled subscription — within grace period.
  - Plan change (monthly → annual) — pro-rated charge; new period start.
  - Trial conversion — trial ends; first paid charge; user notified.
  - Renewal failure (payment method declined) — grace period UX; retry CTA.
  - Refund / chargeback — subscription deactivates; benefits revoked.
- [ ] `app/src/androidTest/assets/features/gifting.feature` created with ≥10 scenarios:
  - Send gift from room (any → any seat user); sender balance debits; animation plays.
  - Send gift from DM (private chat to specific user); recipient credited.
  - Insufficient funds — UX shows top-up prompt; no charge.
  - Double-tap send — idempotent (one charge).
  - Send to blocked user — rejected with clear message.
  - Send to self — disallowed.
  - Send during connection loss — queued OR fails clearly.
  - Gift animation choreography — multiple gifts queue in send-order.
  - Gift wall update — recipient sees gift in their wall within 5s.
  - Gift category coverage — emoji, sticker, premium, animated (each works).
- [ ] `app/src/androidTest/assets/features/backpack.feature` created with ≥8 scenarios:
  - Backpack empty state for new user.
  - Backpack populated with purchased items.
  - Item detail expansion (view metadata).
  - Use item (apply theme, equip badge, etc.).
  - Trade/transfer (if supported).
  - Expired/consumed items removed.
  - Pagination for large backpacks.
  - Filter by category.
- [ ] All new scenarios use the existing step-definitions in `app/src/androidTest/java/com/shyden/shytalk/steps/`; new steps added only where existing ones don't cover.
- [ ] `./gradlew connectedDevDebugAndroidTest --tests "*Subscription*" --tests "*Gifting*" --tests "*Backpack*"` passes against local stack with seeded personas.
- [ ] Manual run via `manual-qa-runner.js --feature subscription_management,gifting,backpack` against dev environment passes.

### Error paths

- [ ] **Subscription**: Play Billing service unavailable → scenario asserts retry CTA shown; no silent skip.
- [ ] **Gifting**: backend returns 500 mid-send → scenario asserts refund-attempted indicator + retry CTA.
- [ ] **Backpack**: load failure → empty state with retry, NOT permanent error.
- [ ] **Subscription**: trial-conversion failure (card declined) → grace period scenario covered.
- [ ] **Gifting**: animation handler exception (rare) → scenario asserts reward state still observable (don't lock the user out of UI).

### Edge cases (adversarial)

- [ ] **Subscription**: same plan double-subscribed in 1 second → backend dedupes; UX shows "already subscribed".
- [ ] **Gifting**: gift sent then immediately leave room → race-resolution per SHY-0014's contract.
- [ ] **Gifting**: send 100 gifts in 60 seconds → rate-limit kicks in; user sees throttle message.
- [ ] **Backpack**: item used at exact moment of expiry → server-side enforcement; client UX matches.
- [ ] **Subscription**: timezone change (user crosses date line) → renewal time correctly preserves period.
- [ ] **All three .features**: locale-change mid-flow → text re-renders correctly; no broken layout.

### Performance

- [ ] Each scenario completes within 60s on a dev device against local stack.
- [ ] Full suite (~26 scenarios) completes within 25 minutes.
- [ ] No memory leak after running all scenarios sequentially.

### Security

- [ ] **Subscription**: Play Billing's `purchaseToken` never logged client-side.
- [ ] **Gifting**: recipient UID never exposed via Allure screenshot text capture.
- [ ] **Backpack**: item ownership server-authoritative; client-side display not authoritative.
- [ ] All scenarios use test personas (`local-claude-*`) — never real user accounts.

### UX

- [ ] All scenarios assert observable UX states (loading spinners, success toasts, error banners) — not just data correctness.
- [ ] Subscription cancellation flow has confirmation dialog (asserted in scenario).
- [ ] Gift animations are visible (screenshot captured for Allure).
- [ ] Backpack interactions are tactile (assert button-press states).

### i18n

- [ ] Scenarios run against `en-US` by default; locale-specific runs (covered by separate workflow) verify text rendering in `ja-JP`, `ar`, `zh` (sample non-Latin locales).
- [ ] Currency formatting per locale verified (per SHY-0011 economy VM contract).

### Observability

- [ ] Each scenario produces Allure attachments: screenshot on assertion + logcat slice for the scenario window.
- [ ] CI job summary lists scenario pass/fail per .feature file.
- [ ] Failed scenarios upload device logcat + screen recording (existing infrastructure).
- [ ] Test isolation per [[feedback-test-isolation-no-leaks]]: each scenario uses a fresh persona OR explicitly resets economy state in Background.

## BDD Scenarios

The scenarios below ARE the story-level behavioural contract. The `.feature` files (subscription_management.feature + gifting.feature + backpack.feature) expand these for machine-execution under Cucumber-Android. The story-level scenarios constrain the feature files; if a feature-file scenario doesn't trace back to one below, it's out-of-scope for this SHY.

**Scenario: Subscribe to monthly plan — happy path**

- **Given** test persona "local-claude-001" is signed in
- **And** has no active subscription
- **When** they navigate to Subscription Management
- **And** select "Monthly Plan"
- **And** confirm via Play Billing test card
- **Then** the subscription becomes active within 5 seconds
- **And** AppSettings shows "Premium" badge
- **And** the user's premium features unlock

**Scenario: Cancel subscription — confirmation + grace period**

- **Given** test persona "local-claude-002" has an active monthly subscription
- **When** they tap "Cancel subscription"
- **Then** a confirmation dialog appears
- **When** they confirm
- **Then** the subscription shows "Cancels on YYYY-MM-DD" state
- **And** premium features remain active until that date
- **And** auto-renew is disabled

**Scenario: Gift sent from room — sender debited, recipient credited, animation plays**

- **Given** test persona "local-claude-003" is in room "test-room-X" with persona "local-claude-004"
- **And** has 500 coins
- **When** they tap a 100-coin gift and select recipient 004
- **And** confirm the send
- **Then** their balance shows 400 coins within 2s
- **And** an animation plays in the room
- **And** persona 004's gift wall shows the new gift within 5s

**Scenario: Backpack — use a theme item**

- **Given** test persona has a "Sunset Theme" in their backpack
- **When** they tap the item
- **Then** preview appears
- **When** they tap "Apply"
- **Then** the app theme switches to Sunset within 1s
- **And** AppSettings reflects "Theme: Sunset"
- **And** the item shows "Active" badge in backpack

**Scenario: Gifting rate-limit**

- **Given** the user sends 100 gifts within 60 seconds
- **When** they attempt the 101st gift
- **Then** the UI shows a rate-limit toast
- **And** the gift is NOT sent
- **And** no charge applied

## Test Plan (TDD)

### Red

1. Audit `app/src/androidTest/assets/features/` — list existing .feature files; identify which step-defs are needed for the new scenarios.
2. Expand `subscription_management.feature` with new scenarios.
3. Create `gifting.feature` and `backpack.feature`.
4. Identify missing step-defs; stub them in `app/src/androidTest/java/com/shyden/shytalk/steps/`.
5. Run `./gradlew connectedDevDebugAndroidTest --tests "*Subscription*"` etc. against local stack → RED on scenarios that need new step-defs or hit untested production code.

### Green

1. Implement missing step-defs.
2. Fix any production bugs surfaced by scenarios.
3. Re-run until all 26 scenarios green.
4. Manual run via `manual-qa-runner.js --feature subscription_management,gifting,backpack --device android` against dev environment.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (expands/creates 3 `.feature` files + step-defs, may surface production fixes) → the FULL gauntlet applies. Android-only BDD (iOS via `ios_parity_*` separately); economy = Revenue (correctly NOT `mvp:true`), but a money-flow regression is still high-stakes.

**Frameworks exercised (RED→GREEN):**
- ✅ **Android instrumented BDD** — `subscription_management.feature` (≥8 new) + `gifting.feature` (≥10) + `backpack.feature` (≥8) + step-defs (`connectedDevDebugAndroidTest --tests "*Subscription*" --tests "*Gifting*" --tests "*Backpack*"`) on a **real Android device**, against the local stack with seeded personas; the story's primary RED→GREEN.
- ✅ **Manual-QA journey matrix** — `manual-qa-runner.js --feature subscription_management,gifting,backpack` on the real Android device (incl. double-tap-gift idempotency → exactly-one-charge, and Play-Billing subscribe).
- ✅ **Kotlin JVM unit + detekt + ktlint + iOS shared compile-check** — any production fix passes the unit/static gates + keeps iOS compiling.
- ⬜ **Web E2E / integration / eslint / Express Jest / iOS XCUITest** — N/A (Android-only; backend billing tests are separate); the iOS app runs the regression corpus on the real iPhone as the net.
- ✅ **SonarCloud** — quality gate.

**LOCAL gauntlet:** ~26 scenarios green on a **real Android device** (balance re-checked after each gift for exactly-one-charge) → impact-selected each loop, full corpus at the pre-push gate. Any failure → fix TDD → restart the whole local gauntlet.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; re-run on real Android + real iPhone regression; web = Chrome only. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt — money correctness is foundational.

## Out of Scope

- **Gacha feature** — covered by SHY-0007 (G007+G008).
- **Wallet flow** — already has `wallet.feature` stub; not expanded here.
- **Coin purchase** — adjacent but separate; could be a follow-up SHY.
- **Server-side billing tests** — backend test scope.
- **iOS BDD** — Android-only here; iOS via `ios_parity_*.feature` separately.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **SHY-0011** — economy VMs (provides the in-memory state these BDDs verify against).
- **SHY-0013** — AnimationQueue (gift animation choreography).
- Existing test personas (`local-claude-001..NNN`) via `provision-test-personas.js`.
- Existing step-def framework + ComposeTestRuleHolder.
- Play Billing test integration (verify it works in local stack).

## Risks & Mitigations

- **Risk:** Play Billing test integration in local stack may not support all subscription flows. **Mitigation:** identify which scenarios require real Play Billing; mark them as requiring dev or staging instead; document.
- **Risk:** Scenarios surface real production bugs in untested flows. **Mitigation:** GOOD outcome; fix in this PR or file follow-ups.
- **Risk:** Backpack feature scenarios depend on item-purchase being seeded. **Mitigation:** seed via `provision-test-personas.js` extension; document persona setup.
- **Risk:** Scenarios are flaky on the dev Pixel 7 due to animation timing. **Mitigation:** use IdlingResource for animations; explicit waits, not arbitrary sleeps.

## Definition of Done

- [ ] 3 .feature files have ~26 new scenarios.
- [ ] All scenarios pass on dev Pixel 7 against local stack.
- [ ] Manual run via `manual-qa-runner.js` against dev passes.
- [ ] Allure attachments captured.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): ~26 BDD scenarios green on a **real Android device** (exactly-one-charge proven per gift) + iOS regression on real iPhone → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated; manual-run + dev-smoke outcomes in Notes.

## Notes (running log)

- 2026-06-07 ~21:10 BST — Refined under SHY-0032. P1 Tier 3 coverage; closes economy BDD gap.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-C2` (roadmap_ids: G017).
- 2026-06-12 ~23:55 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): Android economy BDD (subscription/gifting/backpack) → real-device scenarios + manual-qa-runner, balance re-checked for double-charge. DoD auto-merge → judgment-merge. Pickup-fitness: economy correctly lacks `mvp:true` (Revenue excluded from MVP); no dupes/stale found.
