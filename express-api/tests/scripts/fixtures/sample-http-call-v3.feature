# Fixture for v3 HTTP-call verbs (POSTs / GETs / opens / navigates).
# These are the j08 (cross-cohort wall) phrasings the v3 runner adds.
# Uses stable personas from the registry — Marcus (P-04 minor) is
# convenient as a sender since he's in the stable provisioning set.

Feature: Fixture HTTP-call v3 verbs

  Background:
    Given the local stack is healthy

  @blocker
  Scenario: persona POSTs with kv-pair body
    Given Vexa [P-07] is signed in on Web Chromium
    When Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010
    Then the response status is 404

  @blocker
  Scenario: alt word-order POST with kv-pair body
    Given Marcus [P-04] is signed in on Android
    When POST /api/users/follow with targetUniqueId=50000010 as Marcus
    Then the response status is 404

  @regression
  Scenario: any-payload submit
    Given Marcus [P-04] is signed in on Android
    When POST /api/age-verification/submit with any payload as Marcus
    Then the response status is 200

  @regression
  Scenario: attempts POST with explicit body
    Given Vexa [P-07] is signed in on Web Chromium
    When Vexa on Web attempts POST /api/conversations/c1/messages with body {"text": "hello"}
    Then the response status is 403

  @blocker
  Scenario: opens an /api path fires a GET
    Given Vexa [P-07] is signed in on Web Chromium
    When Vexa on Web opens "/api/users/search?q=Marcus"
    Then the response from /api/users/search?q=Marcus has 0 results

  @regression
  Scenario: opens a non-API path records a visit (no HTTP call)
    Given Vexa [P-07] is signed in on Web Chromium
    When Vexa on Web opens "/discovery"
    # Subsequent UI assertions would STEP_NOT_IMPLEMENTED but the visit was recorded.
