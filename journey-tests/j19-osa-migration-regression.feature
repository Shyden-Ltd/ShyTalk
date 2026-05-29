# j19 — OSA migration regression guards — proves the one-shot migration data
# state is stable forever.
#
# Personas: P-02 Alice (adult), P-04 Marcus (minor), P-06 Hayato (downgraded
#           minor, post-j04), P-10 Theo (adult host)
#
# This journey does NOT run the migration. The migration is a one-shot script
# that executed against dev (and will execute against prod). This journey is
# the steady-state regression guard: every assertion below MUST hold against a
# post-migration database, AND a re-run of the migration script must produce
# zero changes (idempotency). If any assertion fails, the migration is broken
# or has regressed — block prod.
#
# Why this matters: silent data drift in cohort-tagged collections re-exposes
# minors to adult content. The migration is the bridge from pre-OSA legacy
# data to OSA-compliant data. Its correctness is load-bearing for compliance.

Feature: j19 — OSA migration steady-state regression guards
  As a regulator-audited platform with one-shot OSA data migrations
  I want the post-migration database to remain in the expected steady state
  So that any drift or regression that re-exposes legacy cross-cohort data is caught before prod

  Background:
    Given the dev environment migration ran at least once (lastMigrationRunAt is set in "ops/segregation-migration")
    Given the local stack is healthy

  # Fill-1 — PR #666 — migration removed cross-cohort followingIds.
  @blocker @regression @cross-cohort osa17-pr6-migration-following-edges
  Scenario: No user has a cross-cohort entry in followingIds or followerIds
    When a query is run for every "users/*" doc where cohort="adult"
    Then no doc has any entry in "followingIds" whose target user has cohort="minor"
    Then no doc has any entry in "followerIds" whose source user has cohort="minor"
    When a query is run for every "users/*" doc where cohort="minor"
    Then no doc has any entry in "followingIds" whose target user has cohort="adult"
    Then no doc has any entry in "followerIds" whose source user has cohort="adult"

  # Fill-3a — PR #667 — mixed-cohort rooms were closed by the migration. No
  # room in "rooms" with state=OPEN may contain participants from both cohorts.
  @blocker @regression @cross-cohort osa17-pr7-migration-mixed-rooms-closed
  Scenario: No OPEN room contains participants from mixed cohorts
    When a query is run for every "rooms/*" doc with state="OPEN"
    Then for each such room, every userId in participantIds resolves to a user with the same cohort as the room's cohort field
    Then no "rooms/*" doc with state="OPEN" has participantIds containing users with differing cohort

  # Fill-3a (continued) — closed-by-migration rooms are tagged with the audit reason.
  @regression @cross-cohort osa17-pr7-migration-closed-rooms-tagged
  Scenario: Mixed rooms closed by migration carry the audit reason
    When a query is run for "rooms/*" docs with state="CLOSED" and closedBy="migration"
    Then every such doc has field "closedReason" equal to "osa_mixed_cohort_migration"
    Then every such doc has field "closedAt" set to a value within the migration window

  # Fill-3b — PR #668 — pre-OSA cross-cohort conversations are frozen.
  @blocker @regression @cross-cohort osa17-pr8-migration-conversations-frozen
  Scenario: All cross-cohort conversations from pre-OSA epoch are flagged frozen=true
    When a query is run for every "conversations/*" doc
    Then for each conversation where participantIds contains users with differing cohort, the doc has field "frozenAtMigration" equal to true
    Then for each frozen conversation, no document was added to "conversations/{id}/messages" after the migration timestamp

  # Idempotency — re-running the migration on dev must produce zero changes.
  @blocker @regression osa17-migration-idempotent
  Scenario: Re-running the migration on the post-migration database produces zero changes
    When the migration script is executed with --dry-run against dev
    Then the script reports 0 followingIds entries to remove
    Then the script reports 0 followerIds entries to remove
    Then the script reports 0 rooms to close
    Then the script reports 0 conversations to freeze
    Then the script exit code is 0

  # Sanity — Officia (SHYTALK_OFFICIAL, isOfficial=true) is exempt from
  # migration follow-edge cleanup because she is exempt from cohort gating.
  @regression @cross-cohort osa17-migration-official-exempt
  Scenario: Officia's followingIds and followerIds are preserved across cohorts
    Given Officia [P-19] has uniqueId=1, isOfficial=true, isUnblockable=true
    When a query is run for the user doc "users/1"
    Then the doc has entries in "followerIds" with users from BOTH cohort="adult" AND cohort="minor"
    Then the doc has at most 0 entries in "auditLog" matching {action: "blocked", sourceId: 1}
