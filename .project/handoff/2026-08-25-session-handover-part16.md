# Session handover — 2026-08-25 (part 16)

Branch `feature/SHY-0387-support-page`. **21 commits from this session, 5 unpushed,
working tree clean.** PR #1940 is OPEN, never merged, `develop` untouched.

## Where it stands: ready for sign-off, blocked on the operator being able to SEE it

Both matrices green on the final code, run back to back with nothing else on the machine:

| Device | Result | Build |
| --- | --- | --- |
| OnePlus CPH2653 | **14/14, exit 0** | APK rebuilt with the final copy |
| iPhone Air (iOS 27.0) | **14/14, exit 0** | reinstalled with the final copy |

Express: **501 suites, 15,550 tests, exit 0**. eslint / prettier / ktlint clean.
All 13 CI gate scripts pass. `shared:jvmTest` green.

## The live blocker — the operator cannot view ANY evidence page

Every artifact renders blank in their Chrome, and so does a plain local page served
from `127.0.0.1`. **This is not a content problem** and the next session should not
rebuild the page again:

- The HTML renders perfectly in Playwright's Chromium on this same machine —
  221 images, both videos `readyState 4`, 28,173px of content.
- `Artifact action:"read"` shows claude.ai stored it intact.
- Chrome 151 has **no crash reports**, **no system proxy**, **no managed policy**.

**Where the evidence points: Chrome extensions.** Seven are installed with request
interception permissions, two of which explain the two halves:

- **VPN for Chrome: NordVPN** — `proxy` + `webRequest`. A Chrome proxy extension
  overrides the system proxy and can route even loopback, which would break the
  local server. That is otherwise very hard to explain.
- **Malwarebytes Browser Guard** — `declarativeNetRequest` + `webRequest`. An
  artifact renders in a sandboxed iframe; a blocker that dislikes that origin leaves
  the outer page up and the frame empty. Exactly "entirely blank".

Also installed: Adblock Plus, Tampermonkey, TopCashback, Bitwarden, Claude.

**NOT yet established:** which of them are actually ENABLED. Chrome keeps that state
somewhere other than the `state` field in `Secure Preferences`, which read as `None`
for all of them. Do not assert any of them is on without checking.

**The test that settles it:** open `http://127.0.0.1:8099/` in an **Incognito**
window (extensions off by default). Works there → an extension; still blank → deeper.

The operator restarted the laptop at this point, which may clear it by itself.

## What survives the restart

- **`~/Desktop/shytalk-signoff/`** — 35MB, the whole evidence bundle. Open
  `index.html` directly; media is referenced relatively, so it works over `file://`
  with no server. **This is the durable copy.**
- Everything in git.
- **Gone:** the `/private/tmp` scratchpad, and the local server on :8099.

Restart the server with:

```bash
cd ~/Desktop/shytalk-signoff && python3 -m http.server 8099 --bind 127.0.0.1
```

## Artifacts published (all blank for the operator so far)

- Sign-off page — https://claude.ai/code/artifact/e500d30b-7f9a-4df3-9830-033886e50615
- 1KB control page — https://claude.ai/code/artifact/4f29583b-1df0-4b65-8559-e961dc8e9e1a
- Load diagnostic — https://claude.ai/code/artifact/834cd92d-456f-4fc5-9774-e21e6a61dc41
- SHY-0451 evidence — https://claude.ai/code/artifact/7bf240a7-8cb4-4954-8767-a0d42de50c2f

The 1KB control page is the useful one: **if that is blank, nothing published reaches
them and the problem is the viewer, not the content.** Still unanswered.

## What was built this session

- **SHY-0451** — the iPhone stall. Root cause was unbounded session creation,
  named in the docstring of an earlier fix as the thing it deliberately did not
  cover. Zero stalls in twelve runs since; longest journey 78.8s against 415s.
- **SHY-0452** — WebDriverAgent wedging. Appium was still holding the dead session.
  Caught live: `releasing 16 known session(s)` → journey PASSED.
- **SHY-0454** — the app no longer takes the blame. Three strings across two screens;
  `DegradedModeScreen` deleted outright; 21 locales.
- **SHY-0455** — `--debug` dumps the screen on passing steps too.
- **SHY-0453** filed (status page, not MVP).
- Four guards that were **already red** on this branch, repaired in separate commits.
- Three CI gates broken for two days while nothing was pushed, repaired.

## Waiting on the operator

1. **Sign-off** on PR #1940 — the whole point, blocked on them seeing the evidence.
2. Whether `DegradedModeBanner` ("Reduced functionality") should also go.
3. Nothing pushed since the last CI run. 5 commits local.

## Standing instruction recorded this session

**CI is not a debugging loop.** Seven pushes chasing CI failures serially cost the
operator hours. Every gate was runnable locally. See
`feedback-ci-is-not-a-debugging-loop.md`.
