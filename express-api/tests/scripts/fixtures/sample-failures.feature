# Fixture for runner negative-path tests: scenarios that SHOULD fail
# when the backend doesn't match the asserted contract. Used to verify
# the runner correctly classifies failures as findings.

Feature: Fixture failure modes

  Scenario: Unsupported verb produces STEP_NOT_IMPLEMENTED finding
    Given Alice [P-02] is signed in
    When Alice teleports to the moon
    Then the response status is 200

  Scenario: Wrong status assertion produces a finding
    Given Alice [P-02] is signed in
    When Alice sends GET /api/users/50000010 with her ID token
    Then the response status is 999

  Scenario: Missing body field assertion produces a finding
    Given Alice [P-02] is signed in
    When Alice sends GET /api/users/50000010 with her ID token
    Then the response status is 200
    Then the response body has field "totally_fake_field" of type "string"
