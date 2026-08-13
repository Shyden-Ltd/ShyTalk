---
id: SHY-0293
status: In Review
owner: claude
created: 2026-08-13
priority: P1
effort: S
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1732
mvp: false
---

# SHY-0293: The local web server can serve a file outside its web root

## User Story

As a developer running the local stack,
I want the local static server to serve **only** files inside its web root,
So that a request can never read a file next to the root — and so the
develop→main promotion is not carrying three high-severity CodeQL alerts.

## Why

`local/serve-web.js` documents, in its own header, that it returns
"404 for anything unresolved (never path-escapes the web root)". It does not.

CodeQL raised **three high-severity `js/path-injection` alerts** against
PR #1652 (the develop→main promotion) — one on each `fs` sink in the file:
`statSync` (line 106), `readFile` (133), `createReadStream` (176). The file
arrived on `develop` with SHY-0180 and has never been on `main`, so the
promotion is the first time it is scanned against the default branch.

The alerts are **correct**, and four URL forms reproduce the escape:

```
GET /.        → <root>.html
GET /foo/..   → <root>.html
GET /%2e      → <root>.html
GET //.       → <root>.html
```

The containment guard was sound but ran one step too early. It validated
`requested`, the resolved request path — then the candidate list was **derived
from it afterwards**:

```js
const requested = path.resolve(absRoot, `.${decoded}`);
if (requested !== absRoot && !requested.startsWith(absRoot + path.sep))
  return null;             // ← passes: the root IS inside the root
...
candidates.push(`${requested}.html`);   // ← `<root>.html` — a SIBLING
```

When a URL resolves to the root itself, `requested === absRoot`, the guard's
first conjunct is false, the whole condition short-circuits to "allowed" —
legitimately, because the root is inside the root — and the clean-URL candidate
becomes `<root>.html`: a sibling of the web root, outside it.

This is the shape taint-tracking exists to find. The guard was correct about
the value it inspected; the sink consumed a _different_ value derived from it.
Reading the check in isolation says "safe"; following source→sink does not.

Impact is bounded — the server is local-only, binds `localhost`, and the file
must be named exactly `<root>.html` — so this is not a live exposure. It is
still a real escape, it contradicts the file's stated contract, and it blocks a
clean promotion.

## Acceptance Criteria

### Happy path

- [ ] `/`, `/admin/`, `/roadmap.html`, `/admin/reports`, `/admin/js/app.js`
      resolve exactly as before — no regression in clean URLs, directory
      indexes, exact files, or query/fragment stripping.
- [ ] `/.` resolves to `<root>/index.html` — the correct meaning of "the root
      directory" — rather than 404ing. The escape is removed without losing the
      request.

### Error paths

- [ ] A candidate outside the root is skipped, and resolution continues to the
      next candidate rather than aborting — so a blocked escape never costs a
      legitimate result.
- [ ] Malformed percent-encoding (`/%`, `/%zz`) still returns `null` and never
      throws out of the request handler.
- [ ] A directory with no `index.html` still returns `null`.

### Edge cases

- [ ] All four reproducing forms — `/.`, `/foo/..`, `/%2e`, `//.` — resolve to
      something inside the root or to `null`, never to `<root>.html`.
- [ ] The sibling directory `<root>-evil` remains unreachable (the existing
      string-prefix-confusion guard is preserved, not replaced).
- [ ] `..`-prefixed _filenames_ inside the root (e.g. `..foo`) remain
      reachable — the fix must not reject legal names that merely start with
      dots.

### Performance

- [ ] The containment test is a string prefix comparison per candidate — at
      most three per request, no added syscall. The Playwright web suite
      (hundreds of requests/min) shows no measurable change.

### Security

- [ ] Every path reaching an `fs` call passes exactly **one** containment
      check, applied to the final candidate. There is no second, earlier check
      that a reader could mistake for the load-bearing one, and no way to add a
      new candidate shape that skips it.
- [ ] CodeQL reports **zero** `js/path-injection` alerts for
      `local/serve-web.js` on the PR.

### UX

- N/A — local developer tooling with no user-facing surface. The only
  observable change is that `/.` now serves the root index instead of a
  sibling file.

### i18n

- N/A — no user-facing strings; the server emits only HTTP status codes and a
  fixed-ASCII `404 Not Found` body.

### Observability

- [ ] Read errors still log to stderr with the file and `err.code`,
      independent of `--quiet` — the existing observability contract is
      untouched.

## BDD Scenarios

**Scenario: a URL that resolves to the web root cannot reach its sibling**

- **Given** a web root with a file `<root>.html` beside it holding secret text
- **When** `resolveFile(root, '/.')` is called
- **Then** the result is not the path `<root>.html`
- **And** the result is `null` or a path starting with `<root>` + separator

**Scenario: the legitimate meaning of the request is preserved**

- **Given** a web root containing `index.html`
- **When** `resolveFile(root, '/.')` is called
- **Then** the result is `<root>/index.html`

**Scenario: an ordinary traversal is still refused**

- **Given** a web root nested inside a parent directory
- **When** `resolveFile(root, '/../package.json')` is called
- **Then** the result is `null`

**Scenario: a prefix-sharing sibling directory is still refused**

- **Given** a directory `<root>-evil` containing a real file `secret`
- **When** that file is requested via `/../<basename>-evil/secret`
- **Then** the result is `null`

## Test Plan

**RED (written and observed failing before the fix):**

`express-api/tests/scripts/serve-web.test.js` — a `test.each` over the four
reproducing URL forms, "`%s` (%s) must not reach the sibling `<root>.html`".
Observed: **4 failed, 1 passed, 37 skipped** before the change.

Non-tautological by construction: a real `<root>.html` is written with real
content, so a permissive resolver returns _that path_ and fails on the value.
The second assertion is the stronger claim — whatever resolves must be inside
the root — so a fix that merely renames the escape still reds.

**GREEN:** the same suites after the fix — `serve-web.test.js` +
`serve-web-meta-injection.test.js`, **50 passed / 50 total**, every
pre-existing test included.

**Frameworks run:** Jest (`express-api`), eslint `--max-warnings=0`, prettier,
story-frontmatter validator, Playwright web E2E (chromium) — the suite that
actually drives this server.

**Classification:** not CI-config-only and not `*.md`-only. It touches no
product runtime (`app/**`, `shared/**`, `iosApp/**`, `express-api/src/**`,
`public/**`, rules files) — it is local test-harness plumbing — but the web
E2E suite is served _by_ this file, so that suite is the gate that matters and
is run rather than waived.

## Out of Scope

- Symlink containment. `statSync` follows symlinks, so a symlink _inside_ the
  root pointing outside it would still be served. The web root is a
  git-tracked directory with no symlinks, and closing this needs
  `realpathSync` plus a decision about TOCTOU on every request. Filed as a
  follow-up rather than smuggled in here.
- Any change to `serve`-parity behaviour, MIME handling, the SHY-0205
  build-meta injection, or the signal-handling shutdown path.
- The other PR #1652 promotion blocker (`ios-e2e / Build iOS`), which is
  unrelated and tracked separately.

## Dependencies

- None. The change is confined to `local/serve-web.js` and its test file.
- Blocks: PR #1652 (develop→main promotion) reaching a clean CodeQL result.

## Risks & Mitigations

- **Risk:** moving the check to the candidate loop changes which file a URL
  resolves to in some unnoticed case.
  **Mitigation:** the full pre-existing `resolveFile` suite — clean URLs,
  directory indexes, exact files, query/fragment stripping, traversal,
  encoded traversal, malformed encoding, prefix-sharing siblings, extensionless
  directories — runs unchanged and green, plus the live-socket suite.
- **Risk:** removing the early guard leaves a path with no containment test.
  **Mitigation:** the early guard was strictly weaker than the per-candidate
  check it is replaced by; every candidate is now tested, and the loop is the
  only route to an `fs` call in the function.
- **Risk:** a naive `path.relative`-based containment idiom would reject legal
  filenames beginning with `..`.
  **Mitigation:** the check is a `startsWith(absRoot + path.sep)` prefix test
  on an already-normalized absolute candidate, which admits `..foo` and rejects
  `..` and `../x` — and it matches the convention the file and its tests
  already use.

## Definition of Done

- [ ] RED test written and observed failing before the fix.
- [ ] Fix applied; `serve-web.test.js` + `serve-web-meta-injection.test.js`
      green (50/50).
- [ ] Repo swept for the same pattern — no other server builds an `fs` path
      from request input (verified; `serve-web.js` is the only one).
- [ ] eslint `--max-warnings=0`, prettier, actionlint, story validator green.
- [ ] Playwright web E2E (chromium) green against the changed server.
- [ ] `code-reviewer` 100% clean before push.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] CodeQL reports zero `js/path-injection` alerts for the file.
- [ ] Status flipped to `In Review` before merge; merged to `develop`.

## Notes

**2026-08-13** — Found while clearing blockers on PR #1652 (develop→main
promotion). The `CodeQL` check failed in 4s, which usually means a
configuration fault rather than a finding; it was instead three real
high-severity alerts, and the 4s was just the alert-reporting check rather than
the analysis job.

Reproduced before any code was written:

```
"/."            -> <parent>/root.html      ← outside the root
"/foo/.."       -> <parent>/root.html
"/%2e"          -> <parent>/root.html
"//."           -> <parent>/root.html
"/../root.html" -> null (404)              ← the ordinary traversal was fine
```

After the fix all four resolve to `<root>/index.html` — the escape closes and
the request keeps its correct meaning, because the candidate list was already
right and only the filter was wrong.

Worth recording: the alert pointed at the three `fs` sinks, not at the guard on
line 91. That is the useful signal — the guard was correct about the value it
inspected, and wrong about which value reached the sink.

**2026-08-13, PR #1732 pushed.** Full local gate green through `.husky/pre-push`
(lint suite, jest-with-coverage, `:shared:jvmTest`, Playwright chromium
1420 passed / 1 flaky / 38 skipped). CI green by name: **Detect Changes**,
**Analyze JavaScript**, **Build & Test**, `lint`, `test-backend`,
`integration-tests`. **CodeQL passes** — zero `js/path-injection` alerts, so
the fix satisfies the query and not merely the reproducer.

Reviewed-up-to: 7cbb9d713ac

Review was a self-review against the diff rather than a `code-reviewer` agent
dispatch, per the operating instruction in force this session. Recording that
plainly so the audit trail is not read as a clean agent pass.

**First CI attempt failed the Pre-Merge Gate** — "status In Progress, must be
In Review". Working as designed; status flipped here.

One local-harness note, not a product finding: the first Playwright run showed
132 failures, every one an `admin-*` spec with the identical error
`ADMIN_EMAIL and ADMIN_PASSWORD env vars required`. Uniform failure across a
whole feature area is a harness signal, not product debt — a real regression
from a URL-resolution change would fail unevenly. The canonical env lives in
`.github/workflows/playwright-tests.yml`; with it set, the same run is
1420 passed. The fixture throwing rather than proceeding to a blank page is
what made this diagnosable in one read.
