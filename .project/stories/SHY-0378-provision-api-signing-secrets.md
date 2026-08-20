---
id: SHY-0378
status: In Progress
owner: shyden
created: 2026-08-20
priority: P1
effort: M
type: infra
roadmap_ids: []
mvp: true
---

# SHY-0378: The two API signing secrets are unset, so signatures use a public key

## User Story

As **someone whose account is protected by two-factor authentication**, I want
the "remember this browser" and "download my data" links to be signed with a key
only Shyden holds, so that nobody can forge one for my account.

## Why

**Raised as an outstanding operator action, 2026-08-20** (session handover part
6, carried forward from SHY-0369 and SHY-0370, which both scoped provisioning
out).

`MFA_REMEMBER_SECRET` and `EXPORT_DOWNLOAD_SECRET` are unset on the dev VM. Both
are HMAC-SHA256 signing keys. When unset, the code falls back to a fixed string
that is **committed in this repository**:

| Secret | Fallback when unset | Signs |
| --- | --- | --- |
| `MFA_REMEMBER_SECRET` | `dev-mfa-remember-secret` | the cookie that lets a browser skip the 2FA prompt for 30 days |
| `EXPORT_DOWNLOAD_SECRET` | `dev-export-secret` | the token on a personal-data download link, valid 48 hours |

Anyone who can read this repository can therefore mint a valid
"skip-two-factor" cookie or a valid data-download link **for any account on
dev**. The whole point of the MFA-remember cookie is that it cannot be forged,
so on dev today it protects nothing.

This is not an outage — dev is up and the fallbacks keep it serving. It is a
security gap, and it becomes a **production blocker**: in production the same
code throws rather than falling back, so the affected features fail closed until
the secrets exist.

### Not a value anyone "has"

These are not credentials issued by a provider that can be looked up in a
console. They are random keys that have never been generated. The work is to
generate them, install them, and make that repeatable — not to find them.

### The trap this must not fall into

The service reads its configuration file only at start-up, and anything already
in the process environment **wins over the file**. So a value can sit correctly
in the file and still not be the one in use. Confirmation therefore has to come
from the running service, never from the file alone. This is the same shape of
mistake as the 2026-08-19 outage: a change that looked applied and was not.

## Acceptance Criteria

### Happy path

- [ ] After provisioning, both secrets are present on the target environment and
      the running service is actually using them — not merely present in a file
      the service never re-read.
- [ ] The service is healthy afterwards, proven by a real request returning a
      healthy response.
- [ ] The same procedure works unchanged for production, not just dev.

### Error paths

- [ ] If a secret is already set, provisioning **leaves it alone** and says so.
- [ ] If the service fails to come back up, the previous configuration is
      restored automatically and the failure is reported loudly.
- [ ] If the target cannot be reached, nothing is half-applied.

### Edge cases

- [ ] Running the procedure twice in a row changes nothing the second time.
- [ ] A setting present **twice** is reported, and collapsed only when both
      copies agree; if they disagree it refuses, because choosing a winner is
      not its call.
- [ ] Collapsing a duplicate must not change which value the service uses.
- [ ] A configuration file with no trailing newline is still amended correctly.

### Performance

- [ ] The service is unavailable only for the moment of a normal restart.

### Security

- [ ] **No secret value is ever printed** — not to the screen, a log, a build
      record, shell history, or a ticket. Confirmation is by fingerprint only.
- [ ] Each generated key is at least 256 bits from a cryptographically secure
      source, and each environment gets a **different** key.
- [ ] No secret value is committed to the repository.
- [ ] Rotation is possible but deliberate, and whoever runs it is told the cost
      up front: everyone signed out of "remember this browser", every
      outstanding download link dead.
- [ ] The backup of the previous configuration is readable only by its owner.

### UX

- [ ] Nobody using ShyTalk sees anything change, except that a forged link or
      cookie minted from the public key no longer works.

### i18n

- [ ] No user-facing copy is added, so no translation work arises.

### Observability

- [ ] The procedure states, per setting, whether it added it, left it alone, or
      refused — enough to know what happened without seeing any value.
- [ ] A timestamped backup of the previous configuration is kept on the target.

## BDD Scenarios

**Scenario: A signing key that was never set gets one of its own**

- **Given** a link is signed with a key published in the repository
- **When** Shyden provisions the signing keys for an environment
- **Then** that environment signs with a key only it holds
- **And** a link forged with the published key is refused

**Scenario: An existing key is never replaced by accident**

- **Given** an environment already has its own signing key
- **When** Shyden runs the provisioning again
- **Then** the key is left untouched and reported as already set

**Scenario: A setting that disagrees with itself is refused**

- **Given** one setting appears twice with two different values
- **When** Shyden runs the provisioning
- **Then** it refuses to choose and reports the conflict

**Scenario: A service that fails to restart is put back as it was**

- **Given** provisioning has just changed the configuration
- **When** the service does not come back healthy
- **Then** the previous configuration is restored and the failure is reported

## Test Plan

| Layer | What it proves |
| --- | --- |
| Script unit tests (`express-api/tests/scripts/`) | Every file-mutation rule, against real temporary files: add-when-absent, leave-when-present, idempotence on re-run, duplicate collapse only when values agree, refusal when they disagree, missing trailing newline, backup created with owner-only permissions. |
| Secret-quality tests | Generated values are ≥256 bits, hex, and two consecutive runs never produce the same value. |
| Leak tests | Neither stdout nor stderr contains a generated value in any code path, including every failure path. |
| Restore test | A forced unhealthy restart restores the previous file byte-for-byte and exits non-zero. |
| Live verification (dev) | `/api/health` returns 200 after provisioning, and the running service's fingerprint for each secret matches the file's — proving the process re-read it. |

Real files and a real service throughout; no mocked filesystem and no stubbed
health check.

## Out of Scope

- Moving the API to a managed secret store. Worth doing; not this ticket.
- Production provisioning is **enabled** by this ticket but **run by the
  operator** when production is cut.
- The hardcoded development fallbacks themselves. They keep local work
  frictionless and are correct as long as production refuses them.
- The `.husky/pre-push` base-ref defect noted in the handover.

## Dependencies

- SSH access to the target host with the deploy key.
- SHY-0369 and SHY-0370 (both merged) made these secrets lazily resolved, so a
  missing one no longer kills start-up. Without those, provisioning production
  would be the only thing standing between a typo and an outage.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A secret value leaks into a log or shell history | Values are generated on the target and never travel through a command line or an output stream; tests assert no code path prints one. |
| The restart picks up the file but the process keeps an older value | Verification reads the fingerprint from the **running service**, not the file. |
| Collapsing the duplicate silently changes which key is used | The last occurrence wins at load time (verified against the loader in use), so the collapse keeps the last; and it only runs when both copies agree. |
| A bad edit leaves the API down | Timestamped backup taken first; automatic restore on an unhealthy restart. |
| Rotation logs everyone out of trusted browsers unexpectedly | Rotation is opt-in via an explicit flag that states the cost before acting. |

## Definition of Done

- [ ] Script and tests merged to `develop`, all checks green.
- [ ] Dev provisioned; `/api/health` returns 200; both secrets confirmed live on
      the running service by fingerprint.
- [ ] The duplicate setting resolved or explicitly reported as conflicting.
- [ ] Handover and story updated with what was applied — never with values.
- [ ] Production procedure documented and ready for the operator to run.

## Notes

- Superseded operator actions 1 and 2 from
  `.project/handoff/2026-08-20-session-handover-part6.md`.
- The loader's duplicate-key precedence (**last wins**) was confirmed
  empirically against the version in use, not assumed from documentation.
