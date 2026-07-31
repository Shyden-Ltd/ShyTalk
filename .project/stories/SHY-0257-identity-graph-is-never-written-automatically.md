---
id: SHY-0257
status: In Progress
owner: claude
created: 2026-07-30
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0005
---

# SHY-0257: The identity graph is never written automatically

## User Story

**As a** moderator relying on cascading bans to stop a returning abuser
**I want** the identity graph to record IPs, devices and fingerprints as accounts actually use the service
**So that** a ban follows the person rather than the one identifier a moderator happened to type in.

## Why

Surfaced 2026-07-30 while driving the SHY-0256 defect list down.

`routes/identity-graph.js` is entirely **admin-facing**: create a graph, view
it, update it, delete it, suspend-all, unsuspend-all, unsuspend one node, and
check an identifier. Every one of those requires an admin to already know the
identifiers and enter them.

Nothing populates the graph on its own. There is no binding hook in
`middleware/auth.js`, and nothing outside the admin routes and the test helpers
ever writes `identityGraphs/*`:

```
$ grep -rn "identityGraphs" express-api/src/ | grep -v test-collections
  routes/suggestions-maintenance.js   deleteCollection('identityGraphs')
  routes/test-helpers.js              db.doc(`identityGraphs/${uid}`).set(...)
  routes/identity-graph.js            (admin CRUD only)
```

So the cascading-ban system can only cascade across identifiers a human already
linked by hand. The automatic half — the half that makes it a *graph* — does
not exist.

Ten tests in `tests/routes/identity-graph-write-lifecycle.test.js` describe
that half in detail. Every one of them had an **empty body** and reported as
passing, which is how a whole subsystem stayed unbuilt while its suite was
green (the same shape as SHY-0249). They are now `test.todo`, so they report
honestly and are counted by the defect detector rather than hidden by it.

## Acceptance Criteria

### Happy path

- [ ] A successful web sign-in records the caller's IP, network info and browser fingerprint against their account in the identity graph.
- [ ] A successful app sign-in records IP, network info and device ID.
- [ ] A later sign-in from a NEW IP adds that IP to the existing graph rather than creating a second one.
- [ ] A later sign-in from a NEW device adds that device to the existing graph.

### Error paths

- [ ] A binding failure never blocks sign-in — authentication is not made contingent on graph bookkeeping.
- [ ] A missing or unparseable identifier is skipped rather than written as null.
- [ ] An ISP/geo lookup that times out leaves the IP recorded with null ISP/country, not an absent binding.

### Edge cases

- [ ] Using a SUSPENDED device from a new IP auto-suspends that new IP and adds it to the graph.
- [ ] Using a SUSPENDED network from a new device auto-suspends that new device and writes an audit entry.
- [ ] A device seen on 2 accounts auto-suspends both; on 3 accounts, all three.
- [ ] The graph carries a multi-account flag once detection fires.
- [ ] Private/loopback IPs are not treated as shared-network evidence (`isPrivateIp` already exists for this).
- [ ] Two graphs that come to share an identifier are merged, not left as duplicates.

### Performance

- [ ] Binding adds no synchronous cost to the auth path — it must not turn every request into a graph write.
- [ ] Detection does not scan the whole `identityGraphs` collection per request; the current `GET /admin/bans/check` full-collection scan is acceptable for an admin tool but not for the request path.

### Security

- [ ] Binding data is written server-side only; a client can never assert its own device ID or fingerprint into the graph unverified.
- [ ] The auto-suspend cascade is fail-closed: if the graph cannot be read, the request is refused rather than allowed.
- [ ] Suspension changes made by the cascade are audit-logged with the triggering event and every affected identifier.

### UX

- [ ] A user caught by a cascade sees the same suspension messaging as a directly-suspended user — no new dead end.

### i18n

- [ ] N/A — no new user-facing strings; the existing suspension messaging is reused.

### Observability

- [ ] Every automatic suspension writes an audit entry naming the trigger and the affected identifiers.
- [ ] Binding writes are logged at debug with the correlation id, never with the raw fingerprint.

## BDD Scenarios

**Scenario: an account is bound to what it signs in from**
- **Given** a user signing in from a browser
- **When** authentication succeeds
- **Then** their IP, network info and fingerprint are recorded against their account

**Scenario: the graph grows rather than forking**
- **Given** an account already in the graph
- **When** they sign in from an IP never seen before
- **Then** the new IP joins their existing graph instead of starting a second one

**Scenario: a ban follows the person**
- **Given** a device that is already suspended
- **When** it is used from an IP not yet in the graph
- **Then** that IP is added and auto-suspended, and the event is audit-logged

**Scenario: one device, several accounts**
- **Given** a device that has signed into three accounts
- **When** detection runs
- **Then** all three are suspended, the graph is flagged multi-account, and an audit entry records the detection

**Scenario: bookkeeping never blocks the door**
- **Given** the identity graph is unreadable
- **When** a legitimate user signs in
- **Then** they still sign in, and the failure is logged rather than surfaced

## Test Plan

**RED first** — the ten `test.todo` entries already in
`tests/routes/identity-graph-write-lifecycle.test.js` are the specification;
each becomes a real test against the real emulator:

- `login from web` / `login from app` — binding shape per surface
- `second login from new IP` / `new device` — growth, not forking
- `suspended device used with new IP` / `suspended network used with new device` — cascade + audit
- `device linked to 2 accounts` / `3 accounts` / `multi-account flag` / `audit log records detection event`

Plus new tests for the error paths and the fail-closed read, and a middleware
test proving a binding failure does not break sign-in.

**GREEN:** a binding utility called from the auth path (asynchronously, so it
cannot block), graph merge-on-overlap, and the cascade/detection pass.

**Mutation checks:** removing the merge step must fail the "new IP joins the
existing graph" test; making the graph read fail-open must fail the
fail-closed test; dropping the audit write must fail the detection test.

## Out of Scope

- Changing the admin CRUD surface in `routes/identity-graph.js`.
- Device attestation (DeviceCheck / Play Integrity) — tracked separately under
  EPIC-0005; this story records what the client already presents.
- Retroactively building graphs for historical sign-ins.

## Dependencies

- EPIC-0005 (ban enforcement). SHY-0151 is held pending iPhone proof and
  DeviceCheck needs its `.p8`, so the app-side device ID may land behind the
  web-side fingerprint. The story is written so the web half can ship first.

## Risks & Mitigations

- **Risk:** writing to the graph on every sign-in becomes a hot path.
  **Mitigation:** binding is asynchronous and idempotent; the AC forbids
  synchronous cost on the auth path.
- **Risk:** an over-eager cascade suspends innocent users who share a public IP
  (a café, a campus, CGNAT).
  **Mitigation:** `isPrivateIp` already exists; shared-network evidence must be
  corroborated by a device or fingerprint match, never by IP alone.
- **Risk:** fail-closed reads turn a graph outage into a full outage.
  **Mitigation:** fail-closed applies to the SUSPENSION decision only; binding
  failures are swallowed and logged.

## Definition of Done

- [ ] All ten `test.todo` entries are real, passing tests against the emulator.
- [ ] Binding never blocks sign-in, proven by a middleware test.
- [ ] Cascade and multi-account detection audit-logged.
- [ ] Mutations killed.
- [ ] `cd express-api && npm test` green.
- [ ] LOCAL gauntlet green on real Android + real iPhone + all browsers.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-30 — Filed from SHY-0256. The ten specs existed as empty test bodies
  that reported green; converting them to `test.todo` makes the gap visible and
  keeps them counted by `scripts/check-test-defects.js` (which counts `todo`
  precisely so the debt cannot be cleared by relabelling it).
- 2026-07-30 — Three sibling placeholders in the same file claimed to test
  suspension ENFORCEMENT. That is middleware behaviour the file cannot reach,
  and real coverage already exists in `tests/middleware/auth-ban-gate.test.js`,
  `auth-strict.test.js` and `auth-suspension-cache-clear.test.js`. They were
  deleted as duplicates rather than reimplemented.

## Link-strength design (operator decision, 2026-07-31)

The operator approved building this **including** automatic suspension of linked
accounts, with an explicit condition: *"make sure you take extra steps to ensure
a false link cannot occur or is extremely rare."* That condition governs the
whole design, so it is recorded here before any code is written.

**The danger is not theoretical.** The original specs include
`fingerprint collision: two devices same fingerprint → both in same graph` —
which, taken literally, is a specification FOR a false link. And IP addresses are
shared by design: carrier-grade NAT, schools, offices, cafés and mobile networks
routinely put thousands of unrelated people behind one address. An identity graph
that links on IP would not occasionally mislink strangers; it would do so
constantly, and then suspend them.

**Identifiers are therefore graded, and only STRONG evidence can cost somebody
their account:**

- **STRONG** — a hardware-backed device identifier (Android ID, iOS
  `identifierForVendor` / DeviceCheck). One of these is a claim about a physical
  device.
- **WEAK** — IP address, browser fingerprint. Corroborating context only. These
  are recorded, and they are *never* sufficient on their own.

**The rules that follow from that grading:**

1. **Auto-suspension cascades follow STRONG edges only.** A shared IP or a
   colliding fingerprint can never, by itself, suspend anyone.
2. **An IP is never a linking identifier.** It is stored as evidence attached to
   a sign-in, not as an edge between accounts.
3. **Shared-infrastructure demotion.** Any identifier (IP or fingerprint) seen
   with more than a threshold of distinct accounts is marked `shared` and
   thereafter confers no link at all. This is what neutralises CGNAT, campus
   networks and popular device/browser combinations — the more an identifier
   looks like infrastructure, the less weight it carries.
4. **Private and reserved ranges are never stored** (10.x, 192.168.x, 127.x,
   169.254.x, and the IPv6 equivalents) — they identify nobody.
5. **Weak signals require corroboration AND a human.** Two independent weak
   signals agreeing may raise a *review candidate*; they never trigger an
   automated action.
6. **Every automated suspension records its evidence** — which identifier, its
   strength, and the accounts involved — so an operator can see exactly why it
   fired, and reverse it.
7. **Automated suspensions are marked as automated** and are reversible, so an
   appeal has something to act on and a bad rule can be undone in bulk.

**Why this ordering matters:** the cost of a missed link is that an abuser needs
a new device. The cost of a false link is that an innocent person — plausibly a
minor, on a school or family network — is locked out of their account by an
automated process with no human in the loop. Those costs are not symmetrical, so
the thresholds are deliberately set to under-link.

## Notes (2026-07-31)

Story moved to In Progress. The 16 remaining `test.todo` markers in
`tests/routes/identity-graph-write-{admin,lifecycle}.test.js` are this story's
acceptance criteria; they stay `todo` until the behaviour above exists, rather
than being deleted to make a count look better.

**2026-07-31 — DELIVERED (server side).**

`src/utils/identity-graph-writer.js` records the identifiers a sign-in presents
and links accounts that genuinely share one, hooked into
`POST /devices/lock-check`. The graph is now built from real traffic instead of
only by hand, so the cascade finally has something to cascade over.

The link-strength design above is implemented as specified. Two of the original
specs were CORRECTED rather than implemented as written, because as written they
described a false link:

- *"fingerprint collision: two devices same fingerprint → both in same graph"* —
  a specification FOR a false link. Fingerprints collide by construction, so they
  are recorded and never link. Asserted by "a COLLIDING fingerprint does NOT link
  two strangers".
- *"suspended network used with new device: new device auto-suspended"* — an IP
  can sit in front of thousands of unrelated people. A suspended network records
  the fact and suspends nobody. Asserted by "a suspended NETWORK does NOT suspend
  anybody".

The private-IP spec was honoured and WIDENED: link-local, IPv6 loopback/ULA and
**carrier-grade NAT (100.64/10)** are excluded too. CGNAT matters most — it puts
an entire mobile network behind one address, which is the most efficient way to
manufacture false links at scale.

**Tests:** 46 real-emulator tests in `tests/utils/identity-graph-writer.test.js`,
plus a wiring test in `tests/routes/devices-lock-check.test.js` — a correct
module that nothing CALLS is the SHY-0246 defect, so the route is asserted to
actually reach it.

**Mutation-verified**, each mutant reintroducing a false-link path and each
killed: letting weak identifiers link (5 tests fail), letting shared
infrastructure link (3), storing carrier-NAT addresses (3), and unplugging the
route hook (1).

**Owed:** the web sign-in path still needs its fingerprint plumbed through
(only the app's device path is wired today), ISP/country enrichment is accepted
but not yet looked up, and the real-device gauntlet.

