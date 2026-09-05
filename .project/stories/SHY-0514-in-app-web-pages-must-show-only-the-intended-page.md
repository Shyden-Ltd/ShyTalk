---
id: SHY-0514
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0007
---

# SHY-0514: A web page opened inside the app must show only that page and allow no navigation

## User Story

As **somebody reading a ShyTalk web page inside the app** — a legal page, a
policy, anything the app opens — I want to see only that page, with no way to
browse the website or the internet from inside the app, so that the app never
becomes a browser and never offers me a sign-in for an account I am already
using.

## Why

**Reported by the operator, 2026-09-04**, on dev: opening a legal page from the
app shows the website's header with a **Sign In** button, and the page can be
navigated away from. Operator, on the rule: *"there should never be a way to
browse and navigate the internet via the app. it should always only show the
intended page and not allow any kind of navigation."*

The legal pages were where the symptom was seen; the defect is in the one
component every such screen uses, `PlatformWebView`
(`shared/src/commonMain/kotlin/com/shyden/shytalk/core/ui/PlatformWebView.kt`),
rendered by `PrivacyPolicyScreen`, `TermsAndConditionsScreen`,
`CommunityStandardsScreen` and `CyberBullyingPolicyScreen`:

- **Android** (`PlatformWebView.android.kt:64-70`) refuses a navigation only
  when its URL does not start with `Constants.LEGAL_BASE_URL`. Every link on
  the site is therefore allowed — the header logo to the home page, the footer
  to four other pages, the header's Sign In to the portal — and a refused
  external link is swallowed silently: nothing happens, nothing is explained.
  And the allow-list is the **prod** host (`Constants.kt:75`), so on dev the
  same-site rule fails closed by accident rather than by design.
- **iOS** (`PlatformWebView.ios.kt`) has **no navigation policy at all**. Every
  link works, including external ones and the portal sign-in. The app is a
  browser.
- The pages themselves ship the site's chrome: `<header>` with a logo link,
  `shared-header.js` (which renders Sign In or the visitor's name,
  `public/js/shared-header.js:60-130`), and a `<footer>` of links
  (`public/privacy.html:256-260`). Inside the app all of it is wrong: the
  person is already signed in to the app, and there is nowhere they should go.

### The rule to implement

The web view shows **the intended document and nothing else**. Concretely:

1. **The app is the guard.** Both implementations allow only the navigations
   that *are* loading the intended page — the initial request and any server
   redirect it triggers (a locale redirect from EPIC-0010, a `301` from the
   old cyber-bullying path) — plus same-document fragment moves. Once the page
   has loaded, every navigation is refused: link taps, form submits,
   script-driven location changes, new windows, back and forward.
2. **The page is quiet.** Requested with `?embed=1`, a ShyTalk web page renders
   without the site header, the header script, the footer navigation or the
   language switch — only the document. This removes the Sign In button and
   every temptation; the app-side refusal is what makes it a guarantee.
3. **No sign-in inside the app.** The operator asked for the embedded page to
   be signed in as the app's account. With the chrome gone nothing on the
   page needs a session, so no token is handed to web content. If signed-in web
   content inside the app is ever wanted, that is its own story with its own
   security review — recorded here so the ask is not lost.

## Acceptance Criteria

### Happy path

- [ ] Android: `shouldOverrideUrlLoading` allows main-frame navigations only
      while the intended document is loading (initial request and its redirect
      chain) and same-document fragment changes; after `onPageFinished` every
      main-frame navigation returns `true` (refused). `setSupportMultipleWindows`
      stays false so `window.open` cannot escape.
- [ ] iOS: a `WKNavigationDelegate` applies the same policy in
      `decidePolicyForNavigationAction`; `createWebViewWith` returns `null` so
      new windows are refused; back and forward gestures are disabled.
- [ ] The four legal screens open their page with `?embed=1` and the page
      renders only the document: no `shared-header`, no logo link, no footer
      navigation, no language switch.
- [ ] The rule lives in `PlatformWebView` alone; the four screens change only
      the URL they pass.

### Error paths

- [ ] A refused navigation is not silent: the view logs
      `webview:refused <url> (<reason>)` at info and shows nothing to the
      person — the page simply does not move. No toast, because the link should
      never have been there.
- [ ] If the intended page fails to load (offline, dev restriction — SHY-0376),
      the existing loading indicator is replaced by "This page could not be
      loaded" with a retry, on both platforms.

### Edge cases

- [ ] A server redirect during the initial load is followed (asserted with the
      old `/cyber_bullying` path, which the site redirects), and a redirect
      after the page has loaded is refused.
- [ ] A fragment link within the document (`#section`) works; a link to the
      same path with a different query or a different page does not.
- [ ] `?embed=1` on a page that never had chrome (`404.html`) is harmless; the
      page without the parameter is unchanged for ordinary web visitors.
- [ ] A page that arrives via EPIC-0010 locale routing (`/en/privacy`) keeps
      `embed=1` across the redirect, so the document stays quiet.

### Performance

- [ ] No extra requests; the embed mode is a class on `<html>` set before first
      paint, not a second stylesheet, so the header never flashes in.

### Security

- [ ] A static pin asserts that `WebView(` and `WKWebView(` are constructed
      only inside the two `PlatformWebView` actuals — every in-app web page
      goes through the guarded component, now and later.
- [ ] No credential, token or cookie of the app is passed to the web view.
- [ ] JavaScript stays enabled (the pages need it for translations) but file
      access stays off and the policy refuses `javascript:` and `intent:` URLs
      explicitly.

### UX

- [ ] The page fills the screen below the app's own top bar and back button;
      with the chrome gone the document starts at the top, no blank band where
      the header was.

### i18n

- [ ] The "could not be loaded" message and its retry exist in all five
      shipped locales; the pages themselves keep their existing translations.

### Observability

- [ ] Refusals are logged with the URL and reason on both platforms
      (`os_log` public on iOS, per the device-log rule) so a link that should
      not exist is visible in a journey's device log.

## BDD Scenarios

**Scenario: A legal page shows only the document**

- **Given** somebody signed in to the app
- **When** they open the privacy policy from Settings
- **Then** they see the policy text and nothing else — no Sign In, no site menu, no footer links

**Scenario: A link on the page goes nowhere**

- **Given** somebody reading a policy inside the app
- **When** they tap a link in its text to another page
- **Then** the page does not change

**Scenario: An outside link goes nowhere either**

- **Given** somebody reading a policy inside the app
- **When** they tap a link to another website
- **Then** the page does not change and no browser opens

**Scenario: The page still arrives when the site moves it**

- **Given** a policy whose address the website has changed
- **When** somebody opens it from the app
- **Then** they see the policy at its new address, still with nothing else around it

**Scenario: The website itself is unchanged for visitors**

- **Given** somebody reading the same policy in a normal browser
- **When** the page loads
- **Then** they see the usual site header and footer

**Scenario: A page that cannot load says so**

- **Given** somebody with no connection
- **When** they open a policy from the app
- **Then** they are told the page could not be loaded and can try again

## Test Plan

### Red

- `app/src/androidTest/.../PlatformWebViewNavigationPolicyTest.kt` — loads a
  fixture page served by the local stack with a same-site link, an external
  link, a fragment link and a redirecting path; asserts the URL after each tap,
  that the redirect on initial load is followed, and that the refusal log line
  fires. Real device, per the device rule.
- iOS: the same fixture walked by the journey driver on the iPhone (new journey
  `J-webview-lock`): tap the same-site and external links, assert the page URL
  via the accessibility tree and the `webview:refused` line in the device log.
- `tests/web/embed-mode.spec.ts` — every legal page with `?embed=1` has no
  `shared-header`, no footer nav, no language switch; without it, all present.
- `shared/src/jvmTest/.../WebViewIsConstructedOnlyInsideTheGuardedComponentTest.kt`
  — source scan pin across `androidMain`, `iosMain` and `app/`.
- Rendered "could not be loaded" text asserted in all five locales.

### Green

- Android policy with a loading-phase flag and redirect detection
  (`WebResourceRequest.isRedirect`, main-frame check); iOS delegate; embed
  class on `<html>` honoured by `shared-header.js` and the legal page CSS; the
  four screens pass `?embed=1`; strings.

## Out of Scope

- Signing the web view in as the app's account — deliberately not done; see
  the rule above and Notes.
- The dev-site access restriction — SHY-0376.
- Which host the pages come from — SHY-0376's resolver and SHY-0512.
- The header's sign-in flash for ordinary web visitors — SHY-0282.

## Dependencies

- None to start. SHY-0376 is needed to walk the journey on dev; the local stack
  suffices for the Android instrumented test and the web spec.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A future screen opens a web page with a raw `WebView` and skips the guard | The construction-site pin fails the build. |
| Refusing everything breaks the locale redirect | Redirects are allowed only during the initial load; the redirect case is a named test. |
| Hiding chrome by CSS alone still leaves tappable links | The app-side refusal is the guarantee; the web side only removes the invitation. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Device-proven on both phones: every legal page opens quiet; footer and
      external links do nothing; the redirect case passes.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed from two operator reports the same afternoon: first
  the legal pages showing Sign In and allowing navigation, then the general
  rule that the app must never be a browser. The operator also asked for the
  embedded page to be signed in as the app's account; with the chrome removed
  nothing on the page needs a session, so this story does not hand the app's
  credentials to web content. If signed-in web content inside the app is wanted
  later, file it separately with a security review.
