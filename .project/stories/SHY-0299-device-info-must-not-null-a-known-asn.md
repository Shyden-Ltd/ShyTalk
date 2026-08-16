---
id: SHY-0299
status: Draft
owner: claude
created: 2026-08-16
priority: P1
effort: S
type: bug
roadmap_ids: []
epic: EPIC-0005
mvp: true
---

# SHY-0299: A geo blip must not erase a device's known ASN

## User Story

As a **safety operator**, I want a device's recorded ASN to survive a failed
geolocation lookup, so that **an ASN-scoped ban keeps matching** instead of
silently switching off for that device the next time a third party has a bad
minute.

## Why

`POST /api/device-info` records the caller's network details on their device
binding. It builds the document with `asn: geo.asn || null`
(`express-api/src/routes/device-info.js:70`) and writes it with
`tx.set(docRef, deviceDoc, { merge: true })` (`:128`).

Under `merge: true`, an explicit `null` **overwrites** the stored value — it
is not the same as omitting the field. So any launch where the geo lookup
fails replaces a known-good ASN with `null`.

Those stored values are what the authenticated per-request ban gate reads:

```js
// express-api/src/utils/bans.js:346
const asns = [...new Set(bindingsSnap.docs.map((d) => d.data().asn).filter((asn) => !!asn))];
```

A nulled binding contributes no ASN, so `networkBanMatches` cannot match an
`asn`-typed ban for that device. `getUserDeviceStanding` then caches the
standing for 5 minutes, so a single blip disables ASN-ban matching for that
device for up to ~5.5 minutes.

Found by review during SHY-0143 and confirmed pre-existing. SHY-0143 made it
*deterministic* rather than intermittent for the duration of a failure: its
`getIpGeo` negative cache holds a failed lookup for 30 seconds, so every
launch inside that window now nulls the field, where previously each request
re-rolled the dice and a success could repair it.

Three tests currently pin the clobber as the contract
(`express-api/tests/unit/device-info.unit.test.js:143,155,165,185` —
`toMatchObject({ isp: null, asn: null })`), which is why nothing caught it.

## Acceptance Criteria

### Happy path

- [ ] A successful geo lookup writes `asn`, `isp`, `country` and `region` onto
      the device binding exactly as today.
- [ ] A device binding that already carries an ASN still carries it after a
      request whose geo lookup FAILED.
- [ ] A later successful lookup updates the stored ASN to the new value.

### Error paths

- [ ] `getIpGeo` returning `{}` (non-ok, thrown, `status !== 'success'`,
      non-IPv4, or rate-limit paused) omits the geo keys from the written
      document rather than writing `null` for them.
- [ ] A first-ever binding with a failed geo lookup is still created, simply
      without geo fields — device-info's other work (binding, cap, ban report)
      is unaffected.

### Edge cases

- [ ] A partial geo result — `asn` present, `country` absent — writes the
      present fields and omits the absent ones, rather than nulling `country`.
- [ ] A geo result whose `asn` is an empty string is treated as absent
      (`getIpGeo` already maps `as: ""` to `null`).
- [ ] A device whose ASN genuinely changes (roaming, VPN on) is updated, not
      merged into a set — the field is last-known, not a history.

### Performance

- [ ] No additional Firestore reads or writes: the fix is which keys the
      existing `tx.set` carries.

### Security

- [ ] `bans.js`'s `asns` list is non-empty for a device whose last SUCCESSFUL
      lookup produced an ASN, regardless of how many failed lookups followed.
- [ ] An ASN-scoped ban matches such a device on the request immediately after
      a failed lookup.
- [ ] No change to fail-open posture where the ASN was never known: absence of
      data must not become a ban.

### UX

- [ ] N/A — no user-facing surface; the endpoint's response shape is unchanged.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] When a geo lookup fails and a previously-stored ASN is therefore
      preserved, that is logged at debug with the deviceId, so a support
      question about "why is this device still banned" is answerable from
      logs.

## BDD Scenarios

**Scenario: a failed lookup preserves the recorded ASN**
- **Given** a device binding recorded with ASN `AS64500`
- **When** the same device posts device-info and the geo lookup fails
- **Then** the stored binding still reports ASN `AS64500`

**Scenario: an ASN ban still matches right after a failed lookup**
- **Given** an active ban on ASN `AS64500` and a device bound with that ASN
- **When** that device's next request follows a failed geo lookup
- **Then** the request is refused as an ASN-scoped network ban

**Scenario: a partial geo result does not erase the other fields**
- **Given** a device binding recorded with country `Sweden`
- **When** a lookup returns an ASN but no country
- **Then** the stored binding reports the new ASN and still reports `Sweden`

**Scenario: a first binding with no geo is still created**
- **Given** a device that has never posted device-info
- **When** it posts and the geo lookup fails
- **Then** the binding exists, with no geo fields, and the request succeeds

## Test Plan

**RED first**, in `express-api/tests/unit/device-info.unit.test.js` (the
existing `getIpGeo branches` block — `fetch` is stubbed there by necessity,
the Firestore side is the real emulator):

- `a failed geo lookup does not overwrite a stored ASN` — seed
  `deviceBindings/{id}` with `asn: 'AS64500'`, stub `fetch` → `{ok:false}`,
  POST, then read the doc and assert `asn === 'AS64500'`.
- `a failed geo lookup omits the geo keys from the written document` — assert
  on the object handed to `tx.set`: `expect(written).not.toHaveProperty('asn')`.
- `a partial geo result omits only the absent fields`.
- `a first binding is created without geo fields when the lookup fails`.

The four existing assertions at `:143`, `:155`, `:165`, `:185` currently pin
the clobber and must be flipped from "the field is null" to "the field is
absent".

**Then** in `express-api/tests/routes/device-info.test.js` (real emulator, no
stubs): an ASN-scoped ban matches a device on the request following a failed
lookup — the security AC, end to end.

**Classification:** backend change ⇒ the FULL device + all-browser gauntlet
per CLAUDE.md's backend rule, not a CI-config exemption.

## Out of Scope

- Changing `getIpGeo`'s caching, retry or rate-limit behaviour — SHY-0143
  settled those and they are not implicated here.
- The other `|| null` fields on the same document (`isp`, `country`, `region`,
  and the body-derived telemetry). They have the same shape but no security
  consumer; fix them in the same edit for consistency, but the AC only binds
  on the geo fields.
- Backfilling bindings whose ASN was already nulled. They repair themselves on
  the next successful lookup.

## Dependencies

- `express-api/src/utils/ip-geo.js` (SHY-0143) — the source of `{}` on
  failure, and of the 30-second negative cache that makes this deterministic.
- `express-api/src/utils/bans.js:346` — the reader whose `filter(Boolean)`
  turns a null into "no ASN".
- `getUserDeviceStanding`'s 5-minute cache, which extends the blast radius of
  a single nulled write.

## Risks & Mitigations

- **Risk:** omitting keys under `merge: true` means a field can never be
  cleared. **Mitigation:** none of these fields has a "clear it" use case —
  they are last-known telemetry, and a device that genuinely changes network
  gets a new value on the next successful lookup.
- **Risk:** the four existing assertions are flipped to match the new
  behaviour, which is exactly how a bug gets re-pinned as a contract if the
  reasoning is wrong. **Mitigation:** the security AC is tested end-to-end
  against the real emulator, so the flip has to be justified by a ban actually
  matching, not merely by the shape of a written document.

## Definition of Done

- [ ] RED tests written and observed failing before the fix.
- [ ] `deviceDoc` built without the geo keys when they are absent; the four
      existing assertions flipped to assert absence.
- [ ] The end-to-end ban-matching test passes against the real emulator.
- [ ] Full Express suite + `eslint --max-warnings=0` green.
- [ ] Backend change ⇒ full device + browser gauntlet, LOCAL then DEV.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Status → In Review → judgment-merge → deploy develop to dev.

## Notes (running log)

- **2026-08-16 — filed.** Found by `code-reviewer` round 7 on SHY-0143 and
  confirmed pre-existing by reading `device-info.js:70,128`,
  `bans.js:346`, and the four assertions in `device-info.unit.test.js` that
  pin the current behaviour. Filed rather than folded into SHY-0143 because
  that story was already In Review with a PR open and a `Reviewed-up-to:`
  marker; per the repo's fix-pre-existing rule this is the follow-up PR.
