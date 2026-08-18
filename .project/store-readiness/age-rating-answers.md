# Age rating — answer sheet for both stores (SHY-0342)

**Status: DRAFT FOR OPERATOR REVIEW. Nothing has been submitted.**
Written 2026-08-19. Every answer below cites the feature in this repository that
forces it, so you can check any line rather than take it on trust.

**Target: 13+.** The operator's position is that comparable apps ship the same
feature set at 13+. This sheet is written to test that honestly — where an
answer puts 13+ at risk, it says so plainly rather than quietly choosing the
convenient answer.

---

## What this app actually contains

Verified in the tree, not assumed:

| Capability | Where |
| --- | --- |
| Live voice chat with strangers | LiveKit voice rooms — the core product |
| Direct messages, 1:1 and group | `feature/messaging` |
| User-generated profile content | display name, description, avatar, cover photo, room names |
| Real-money in-app purchases | Play Billing (`libs.versions.toml`), StoreKit (`IosStoreKitPurchase.kt`) |
| Virtual currency | **ShyCoins** — bought with real money (`/economy/purchase` credits `shyCoins`) |
| Gifting | sender spends ShyCoins; recipient receives **ShyBeans** |
| Bean → coin redemption | `/economy/redeem-beans` |
| **Randomised paid reward ("Lucky Spin")** | `feature/gacha` — 1×/10×/100× pulls costing 10/100/1000 **ShyCoins**, random coin-value rewards, escalating celebration by rarity |
| Social graph | followers, following, profile visitors ("stalkers") |
| Age collection | `dateOfBirth` on the user record; per-feature thresholds (SHY-0060) |
| Reporting / moderation | `feature/report`, warnings, suspensions, room moderation |

**No cash-out exists.** No endpoint converts in-app value back into money —
no withdrawal, payout or cash-out route exists anywhere in `express-api/src`
(grepped). Value *does* move between users — `/economy/gift`, `/economy/gift-direct`,
`/economy/gift-batch`, `/economy/backpack-send` — and that is deliberate and
separate: it is in-app value moving in-app, and it is one of the questions the
stores actually ask, so it is stated rather than glossed. What does not exist is
a route out.
Winnings stay inside the app. This is the single most important fact on the
sheet: it keeps the Lucky Spin on the *simulated gambling* side of the line
rather than the real-money-gambling side, which in Indonesia especially is a
different legal universe. **Protect it.** Bean transfer is currently marked
FUTURE; if it ever ships in a form that converts to money, this whole sheet is
void and the legal position changes.

---

## Apple — App Store age rating

| Question | Answer | Why |
| --- | --- | --- |
| Cartoon or fantasy violence | None | No game content of this kind |
| Realistic violence | None | — |
| Sexual content or nudity | None **in shipped content** | But see "user-generated content" below |
| Profanity or crude humour | None in shipped content | Same caveat |
| Alcohol, tobacco, drug use | None | — |
| Horror / fear themes | None | — |
| Mature / suggestive themes | None in shipped content | Same caveat |
| Medical / treatment information | None | — |
| **Contests** | **Yes** | The Lucky Spin is a randomised reward purchased with currency |
| **Gambling (simulated)** | **Yes** | Same. Answering "no" here would be a misdeclaration |
| Gambling with real currency | **No** | No cash-out path exists |
| **Unrestricted web access** | **No** | The app has no general-purpose browser |
| **User-generated content** | **Yes** | Profiles, room names, DMs, live voice |
| **Does the app include moderation and reporting for UGC?** | **Yes** | In-app reporting, moderator mute/kick/ban, warnings, suspensions |

**The two that decide the rating are the last two, and they pull in opposite
directions.**

- **Simulated gambling** is the risk to 13+. Apple's questionnaire distinguishes
  frequency/intensity; a paid randomised-reward mechanic that is central and
  repeatable is not the "infrequent/mild" end.
- **User-generated content with live, unreviewed voice** is the other pressure.
  Apple expects UGC apps to have reporting, blocking and moderation — we have
  all three, which is what keeps a UGC app out of the 17+ bucket.

> ⚠️ **Verify the exact wording in App Store Connect before answering.** Apple
> revised the age-rating questionnaire in 2025 (new capability questions, and a
> 13+/16+/18+ banding). I have not been able to open the console, so the
> question list above is by category, not verbatim. Do not paste it blind —
> match each answer to the question actually shown.

---

## Google Play — IARC questionnaire

IARC is a single questionnaire that produces regional ratings (ESRB, PEGI, USK,
ClassInd, and a generic one covering Indonesia).

| Question | Answer | Why |
| --- | --- | --- |
| Violence | None | — |
| Sexuality | None in shipped content | UGC caveat |
| Language | None in shipped content | UGC caveat |
| Controlled substances | None | — |
| **Does the app contain simulated gambling?** | **Yes** | Lucky Spin |
| **Real gambling / real-money wagering?** | **No** | No cash-out |
| **Does the app offer digital purchases?** | **Yes** | ShyCoins |
| **Does the app include randomised paid items (loot boxes)?** | **Yes** | Lucky Spin — **Play requires the odds to be disclosed in the app** |
| **Does the app allow users to interact or exchange content?** | **Yes** | Voice, DMs, profiles |
| Does it share user location with other users? | **No** | Nationality is a profile field, not location |
| Does it allow users to share personal information? | Yes, by their own choice | Free-text profile fields |

### Two Play obligations that follow, and are not yet met

1. **Loot-box odds disclosure.** Play requires apps offering randomised paid
   items to disclose the odds *before purchase*, in the app. I found no odds
   disclosure in `feature/gacha`. **This is a compliance gap, not a rating
   answer** — it needs its own story.
2. **Interactive-elements declaration.** "Users interact", "digital purchases"
   and "shares info" must be declared alongside the rating.

---

## Honest read on 13+

**Achievable, but not automatic, and it rests on two things staying true.**

- The comparison the operator is drawing is sound: gacha titles commonly carry
  12+/13+ ratings. What earns them that is (a) no real-money gambling, and (b)
  the randomised element being declared honestly rather than hidden.
- We satisfy (a) — **there is no cash-out, and that must stay true**.
- For (b) the answers above are the honest ones. Declaring simulated gambling
  does not automatically force 17+/18+; it is one input among several.
- **The likelier pressure on 13+ is the live unmoderated voice with strangers**,
  not the spin. That is why the moderation answers matter — and why SHY-0340
  (a moderator's mute currently does not stick) is worth fixing *before* you
  answer a questionnaire that asserts moderation works.

### What I recommend

1. Fix **SHY-0340** first. Answering "yes, we have moderation" while a muted
   user can unmute themselves is a claim we cannot support.
2. File the **loot-box odds disclosure** gap as its own story.
3. Then complete both questionnaires from this sheet, with the console open,
   matching each answer to the question actually shown.
4. Record the resulting rating back into this file with the date and the app
   version it was answered against.

---

## What I could not do, and why

I could not open either console. There are no App Store Connect credentials on
this machine, and `play-service-account.json` is an **upload-scoped** service
account (`playupload@shytalk-7ba69`) — the IARC questionnaire is a Play Console
UI flow that no API exposes. The Claude browser extension is not connected
either. Submitting these answers needs you; deciding what they should be did
not.
