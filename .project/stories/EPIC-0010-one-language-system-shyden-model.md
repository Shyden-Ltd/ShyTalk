---
id: EPIC-0010
status: Draft
owner: claude
created: 2026-08-06
priority: P1
title: One language system — the shyden.co.uk model, MVP languages only
child_shys: [SHY-0285, SHY-0286, SHY-0287, SHY-0288, SHY-0289]
---

# EPIC-0010: One language system — the shyden.co.uk model, MVP languages only

## Vision

ShyTalk has four different answers to "what language is this?" — a floating
globe modal that swaps text in the browser, a `?lang=` query flag, a lazy
server-side translation service for roadmap content, and 20 locale files in the
app. They disagree with each other, none of them is indexable, and a visitor
cannot send someone a link to the Vietnamese privacy policy because no such URL
exists.

shyden.co.uk answers it once, and the answer is boring in the way infrastructure
should be: **every page exists, as a real page, at a real URL, in every language
it supports.** English at `/privacy`, Vietnamese at `/vi/privacy`. The page is
built, not assembled in the browser. `hreflang`, `canonical` and `og:locale`
tell search engines the pages are translations of one another rather than
near-duplicates. A link in the header goes to the *same page* in the other
language — never the homepage. Strings live in one typed table per locale, with
English as the reference, so a missing translation is caught before it ships
rather than rendering an English sentence to a Vietnamese reader.

This epic replaces every other language mechanism ShyTalk has with that one, and
narrows the supported set to the five MVP languages: **English, Mandarin, Bahasa
Indonesia, Vietnamese, Thai**.

The app gets the honest version of the same idea. It has no URLs, so it takes
the part that transfers: it renders in the language of the phone it is running
on, and there is no in-app language picker at all. A person who wants ShyTalk in
Thai sets their phone to Thai — which they have already done.

## Scope

**In:**

- A build step for `public/` that generates one real page per locale per source
  page (5 x 8 = 40), replacing hand-written HTML.
- Typed string tables per locale, English as the reference; a missing key fails
  the build.
- `hreflang` (all five + `x-default`), `canonical`, `og:locale` on every page.
- A header language control that switches to the same page in another language,
  and locale-aware internal links throughout.
- A sitemap declaring the language relationships.
- Removal of: `public/js/language-selector.js`, the `?lang=` flag, the per-page
  `*-translations.js` files, `suggestions-i18n.js`, and the `localStorage`
  language preference.
- The app follows the device locale; the in-app language selection is deleted.
- Deletion of the 15 non-MVP locales from both surfaces.

**Out:**

- **Dynamic, user-generated content.** Roadmap story titles, suggestions-board
  posts and chat messages are translated at runtime by the lazy translation
  service (SHY-0072/0073, EPIC-0002). That service stays. This epic is about the
  *product's own copy* — the words ShyTalk itself wrote, which are known at
  build time. Conflating the two is what produced four systems in the first
  place.
- Adding a sixth language. The MVP set is fixed here; growing it later is a
  matter of adding a string table and rebuilding.
- Right-to-left layout. Arabic and Hebrew leave with the other 15 locales, so
  no RTL surface remains. If a RTL language returns, that is its own story.

## Child SHYs

- **SHY-0285** — Locale-routed build for the website, proven on one page
- **SHY-0286** — Convert the remaining seven pages to locale routing
- **SHY-0287** — Delete the old web language machinery
- **SHY-0288** — The app follows the device language; remove in-app selection
- **SHY-0289** — Retire the 15 non-MVP locales from both surfaces

## DoD at Epic Level

- [ ] Every ShyTalk web page resolves at five real URLs, one per MVP language,
      and each is served as built HTML with no client-side text swapping.
- [ ] Every page declares `canonical`, four `hreflang` alternates plus
      `x-default`, and `og:locale`, all asserted by value rather than by count.
- [ ] The language control moves between translations of the SAME page, proven
      for every page and every locale pair.
- [ ] `grep -r` finds no reference to `language-selector.js`, `?lang=`,
      `applyLanguage`, or the removed `*-translations.js` files.
- [ ] The app renders in the device language for all five MVP languages on a
      real Android device and a real iPhone, and contains no language picker.
- [ ] Exactly five locales exist in `composeResources` and in the web string
      tables; the other 15 are gone from the tree.
- [ ] A missing or blank translation in any of the five fails the build or a
      test — demonstrated by deliberately removing one.
- [ ] The full pre-merge gauntlet is green for each child story.

## Notes

**2026-08-06 — operator decisions, taken before any code:**

- Website adopts the FULL shyden model (real per-locale URLs), not a
  same-URL redress. Chosen knowingly: it needs a build step introduced for
  `public/`, and it is the only option that makes non-English pages linkable and
  indexable.
- App follows the device language with NO picker.
- The 15 non-MVP locales are DELETED, not merely unbuilt — recoverable from git
  if a language returns.
- MVP set is FIVE: en, zh, id, vi, th. This corrects SHY-0194, whose title
  named only four (it omitted Thai).

**Operator asked for "a new ticket".** Under the one-story-one-PR rule this
cannot be one PR — a build system, 40 generated pages, an app change and a
15-locale deletion are separate reviewable units. So it is this epic plus five
child stories; the epic is the single thing to track.

**What happens to the existing language tickets:**

| Ticket | Status | Disposition |
|---|---|---|
| SHY-0181 site-wide `?lang=` flag | In Review (merged) | Shipped; this epic DELETES the feature it added. History stands — a merged story is not cancelled. |
| SHY-0025 locale parity key-set test | In Review (merged) | Shipped; its parity check is superseded by the reference-locale build failure in SHY-0285. |
| SHY-0182 app opens env-correct web pages in the app's language | Draft | CANCELLED — superseded. The app no longer has "the app's language" separate from the device's, and locale-aware URLs are SHY-0285/0286. The environment half is unrelated and survives in EPIC-0007. |
| SHY-0184 bundled legal-acceptance text | Draft | CANCELLED — superseded. Legal copy becomes build-time strings in five locales like every other page. |
| SHY-0194 retire 17 locales | Draft | CANCELLED — superseded by SHY-0289, which retires 15 and keeps five (0194 kept four). |
| SHY-0222 i18n testing | Draft | CANCELLED — superseded. Key parity and placeholder safety become build-time guarantees; pseudo-localisation and RTL are moot once RTL locales are gone. |
| EPIC-0002 roadmap migration + lazy translation | In Progress | UNAFFECTED. It owns runtime translation of user-generated content, which is explicitly out of scope here. |
| EPIC-0007 correct web surface (locale + environment) | In Progress | Its LANGUAGE half is absorbed here. Its ENVIRONMENT half (never crossing dev/prod URLs) is untouched and remains its own concern. |
