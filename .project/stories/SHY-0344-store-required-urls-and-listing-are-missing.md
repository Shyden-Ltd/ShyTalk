---
id: SHY-0344
status: Draft
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0344: The support page a store submission requires does not exist, and neither does the listing

## User Story

As the **ShyTalk operator submitting to the App Store and Play Store**, I want
every URL and listing field the stores demand to exist, resolve and be kept in
the repository, so that submission is filling in known-good values rather than
inventing them at the console.

## Why

**P0. Submission cannot start without these, and one of them is a published
policy requirement rather than a form field.**

**The support page is a 404.** Checked live on 2026-08-18:

| URL | Result |
| --- | --- |
| `https://shytalk.shyden.co.uk/support` | **404** |
| `https://shytalk.shyden.co.uk/contact` | **404** |
| `/privacy.html` | 308 → `/privacy` → **200** |
| `/terms.html` | 308 → `/terms` → **200** |
| `/community-guidelines.html` | 308 → `/community-guidelines` → **200** |
| `/cyber-bullying.html` | 308 → `/cyber-bullying` → **200** |

So the **privacy policy URL is fine** and needs nothing — worth saying plainly,
because it is the field people assume is the problem. The **Support URL** is a
required field in App Store Connect and it has nowhere to point. `public/` holds
`privacy.html`, `terms.html`, `community-guidelines.html`, `cyber-bullying.html`,
`do-not-sell.html`, `roadmap.html` — and no support or contact page at all.

**There is a support email, and it is not a substitute.** `shytalk.help@gmail.com`
is wired into the app (`Constants.CONTACT_EMAIL`, Settings, and every legal page).
That satisfies Google's contact-email requirement. Apple asks for a **URL**.
Separately, and for the operator to weigh rather than for this story to decide: a
consumer Gmail address as the sole complaints route is a weak signal for a
minors-facing product with UK Online Safety Act duties, where a clear and
reachable complaints channel is expected.

**Google requires a deletion route reachable without installing the app.** Play's
data-deletion policy asks for a web page where a user — including one who has
already uninstalled — can request account deletion. In-app deletion exists
(SHY-0341 fixes who can reach it), but there is no web route at all. This is the
requirement most often missed, because the in-app flow looks like it covers it.

**The listing is not in the repository, although publishing is.** Gradle Play
Publisher is configured and live (`app/build.gradle.kts:9`, track `internal`,
`DRAFT`) and it can manage the listing directory — title, short and full
description, graphics, contact email, contact website. `app/src/main/play/`
contains `release-notes/` and nothing else. So every other listing field lives
only in the console: unreviewable, unversioned, and lost if the console entry is
edited by hand. iOS is worse — there is no fastlane or App Store Connect metadata
directory in the tree at all.

**The cost of leaving it.** Each of these is individually small and together they
are a submission that stalls: a required field with no value, a policy
requirement with no page, and listing copy nobody has written or reviewed. They
are also the cheapest items on the MVP list, which is exactly why they should not
be the ones discovered last.

## Acceptance Criteria

### Happy path

- [ ] A support page exists at a stable URL, and it tells a user how to get help and how long a reply takes.
- [ ] A page exists where anyone can request account deletion without installing the app.
- [ ] The store listing text and images live in the repository and are what gets published.
- [ ] Every URL either store requires resolves successfully.

### Error paths

- [ ] A required URL that stops resolving fails a check, rather than being found at submission.
- [ ] A deletion request from the web page that cannot be recorded tells the person it did not work.
- [ ] The deletion page cannot be used to delete somebody else's account.

### Edge cases

- [ ] The support and deletion pages work for a user who has uninstalled the app.
- [ ] They work on a phone browser and on a slow connection.
- [ ] Links that reach a page through a redirect still count as resolving, and the canonical address is the one we publish.
- [ ] A deletion request for an account that does not exist reveals nothing about whether it exists.

### Performance

- [ ] Both new pages load usefully on a slow mobile connection.

### Security

- [ ] The deletion request page proves the requester owns the account before anything is scheduled.
- [ ] Neither page exposes whether an address or account exists.
- [ ] The pages carry the same headers as the rest of the site.

### UX

- [ ] Both pages match the existing site and are reachable from its navigation, not only by typing the address.
- [ ] Checked with eyes at mobile and desktop widths.

### i18n

- [ ] Both pages ship in every launch locale, and the rendered text is asserted, not just the key.
- [ ] Listing text is provided for every locale the stores will show it in.

### Observability

- [ ] A web deletion request is logged the same way an in-app one is, so both can be reconstructed.
- [ ] A broken required URL is noticed by a check rather than by a reviewer.

## BDD Scenarios

**Scenario: Someone who needs help can find it**

- **Given** a person who has a problem with the app
- **When** they open the support page linked from the store listing
- **Then** they are told how to get help and when to expect a reply

**Scenario: Someone who uninstalled can still ask to be deleted**

- **Given** a person who has removed the app from their phone
- **When** they ask for deletion on the website and prove the account is theirs
- **Then** their deletion is scheduled and they are told when it becomes permanent

**Scenario: A required link that breaks is noticed**

- **Given** the set of links the stores require
- **When** one of them stops resolving
- **Then** a check fails and names the broken link

## Test Plan

**RED first.** Two of these fail the moment they are written: `/support` and the
web deletion route both 404 today.

### Node / Jest — `express-api/tests/scripts/store-required-urls.test.js`

- `every store-required URL resolves` — **the gap, in one assertion**; `/support` fails today
- `a web account-deletion route exists`
- `the listing directory carries the fields Play Publisher will publish`
- `each required URL is recorded once, in one place`

### Playwright — `tests/` (chromium + one mobile browser)

- `the support page renders and offers a route to help`
- `the deletion request page refuses a request it cannot verify`
- `both pages render in every launch locale`
- `both pages are usable at the smallest mobile width`

### Express / Jest — `express-api/tests/routes/`

- `a verified web deletion request schedules deletion exactly as the in-app one does`
- `an unverified web deletion request schedules nothing`
- `a request for a non-existent account discloses nothing`

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the support page removed | `every store-required URL resolves` |
| the deletion page's verification step removed | `an unverified web deletion request schedules nothing` |
| one locale's page content deleted | `both pages render in every launch locale` |
| the listing directory emptied | `the listing directory carries the fields Play Publisher will publish` |
| the deletion response made to differ for unknown accounts | `a request for a non-existent account discloses nothing` |

### Real-run proof

- Both pages fetched over the public internet after deploy, not only in a local build.

## Out of Scope

- Who may complete an in-app deletion — SHY-0341.
- Privacy declarations — SHY-0343. Age rating — SHY-0342.
- Rewriting the legal pages; their reachability is confirmed and their wording is
  the legal review's ([[project-gdpr-export-osa17-legal-review]]).
- Replacing the support email address, which is the operator's decision.
- Screenshots and promotional graphics as creative work; this story provides the
  place they live and the check that they are present.

## Dependencies

- **SHY-0341** — the web deletion route should schedule deletion through the same
  path as the in-app flow, so it inherits whatever identity check that story
  settles on. Land 0341 first.
- Locale routing on the site (SHY-0285, SHY-0286) determines how the new pages
  are served per language.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| A web deletion route becomes an account-destruction vector | Ownership is proved before anything is scheduled; asserted, and in the mutation table. |
| Required URLs rot after launch | A check asserts every one of them resolves, and they are recorded in one place rather than copied. |
| Listing copy drifts from the console | The repository is the source Play Publisher publishes from. |
| The new pages miss a locale | Asserted per locale on rendered text, and mutation-proven. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Both pages fetched successfully over the public internet after deploy.
- [ ] Screenshots at mobile and desktop widths, in at least two locales.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18 20:3x WIB** — Filed at operator request. Every URL result in the
  table above was fetched live, not assumed. The finding that matters most is the
  negative one: **the privacy policy URL is fine.** `/privacy.html` 308s to
  `/privacy` and returns 200, as do terms, community guidelines and
  cyber-bullying. That field needs no work, and this story says so rather than
  bundling it in.

- **2026-08-18** — `/support` and `/contact` both 404. `public/` has no support or
  contact page. The support email `shytalk.help@gmail.com` is real and wired in
  three places, but Apple's Support URL field wants a page.

- **2026-08-18** — The web deletion route is the requirement most likely to be
  missed, because in-app deletion exists and looks like it covers it. Play asks
  for a route reachable **without** the app, for people who have already
  uninstalled.

- **2026-08-18** — Gradle Play Publisher is wired and can publish the listing
  directory; `app/src/main/play/` holds only `release-notes/`. So the mechanism
  is there and unused, which is the cheapest kind of gap to close.
