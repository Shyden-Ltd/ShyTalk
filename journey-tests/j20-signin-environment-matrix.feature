# j20 — Sign-in screen environment matrix.
#
# Personas: P-01 Adam (default sign-in actor), P-02 Alice (paired sign-in actor)
# Platforms: Android physical (per [feedback-android-real-device-preferred]),
#            iPhone physical via xcrun devicectl, Web Chromium via Playwright MCP
#
# Operator directive 2026-05-29 (updated 2026-06-01) — sign-in screen buttons:
#   - Apple + Google buttons MUST be visible on every flavor (local, dev, prod)
#   - On local: tapping either surfaces "Sign-in not available on local
#     environment" snackbar (firebase emulator can't redeem real OAuth)
#   - On dev + prod: tapping either kicks off the real OAuth flow
#   - Persona picker button MUST appear on local + dev, NEVER on prod
#     regardless of any credential misconfiguration
#   - (The single-account "Dev sign-in" shortcut was removed 2026-06-01 —
#     it never worked end-to-end. Negative prod assertions for the
#     `dev_sign_in` testTag are retained below as drift catches in case
#     a future PR accidentally re-introduces it.)
#
# Tested across the three flavors via per-scenario Background that installs the
# right flavor APK. The runner has flavor-specific install helpers
# (assembleLocalDebug / assembleDevDebug / assembleRelease) so each scenario
# runs against the flavor it asserts.

Feature: j20 — Sign-in screen environment matrix
  As a ShyTalk user installing any flavor (local, dev, or prod)
  I want the correct sign-in affordances for that flavor
  So that the sign-in screen never confuses me with broken buttons OR exposes dev shortcuts on prod

  Background:
    Given the local stack is healthy

  # ── LOCAL FLAVOR — emulator, no real OAuth ──

  @blocker @android-physical @local-flavor
  Scenario: Local-flavor sign-in screen renders both OAuth buttons
    Given Adam [P-01] has the local-flavor APK installed on Android
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI shows the element with tag "google_sign_in_button"
    Then Adam's Android UI shows the element with tag "apple_sign_in_button"

  @blocker @android-physical @local-flavor
  Scenario: Local-flavor Google tap shows "not available on local environment"
    Given Adam [P-01] has the local-flavor APK installed on Android
    Given Adam is on the sign-in screen
    When Adam on Android taps "google_sign_in_button"
    Then within 3000ms Adam's Android UI shows the snackbar text from key "sign_in_not_available_on_local"
    Then Adam's Android UI is still on the sign-in screen
    Then no Firebase Auth session is created for Adam

  @blocker @android-physical @local-flavor
  Scenario: Local-flavor Apple tap shows "not available on local environment"
    Given Adam [P-01] has the local-flavor APK installed on Android
    Given Adam is on the sign-in screen
    When Adam on Android taps "apple_sign_in_button"
    Then within 3000ms Adam's Android UI shows the snackbar text from key "sign_in_not_available_on_local"
    Then Adam's Android UI is still on the sign-in screen
    Then no Firebase Auth session is created for Adam

  @blocker @android-physical @local-flavor
  Scenario: Local-flavor renders persona picker button
    Given Adam [P-01] has the local-flavor APK installed on Android
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI shows the element with tag "persona_picker_open"

  # ── DEV FLAVOR — real dev Firebase + real OAuth ──

  @blocker @android-physical @dev-flavor
  Scenario: Dev-flavor sign-in screen renders both OAuth buttons
    Given Adam [P-01] has the dev-flavor APK installed on Android
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI shows the element with tag "google_sign_in_button"
    Then Adam's Android UI shows the element with tag "apple_sign_in_button"

  @blocker @manual @android-physical @dev-flavor
  Scenario: Dev-flavor Google tap kicks off real OAuth flow
    Given Adam [P-01] has the dev-flavor APK installed on Android
    Given Adam is on the sign-in screen
    When Adam on Android taps "google_sign_in_button"
    Then within 5000ms Adam's Android UI shows the Google CredentialManager bottom-sheet
    # @manual continuation — the tester selects a real Google account; runner
    # cannot drive the system-level CredentialManager flow

  @blocker @manual @ios-physical @dev-flavor
  Scenario: Dev-flavor Apple tap kicks off real ASAuthorizationController flow
    Given Adam [P-01] has the dev-flavor IPA installed on iPhone
    Given Adam is on the sign-in screen
    When Adam on iPhone taps "apple_sign_in_button"
    Then within 5000ms Adam's iPhone UI shows the iOS Apple ID confirmation sheet
    # @manual continuation — tester confirms; runner cannot drive iOS system sheets

  @blocker @android-physical @dev-flavor
  Scenario: Dev-flavor renders persona picker button (operator opt-in via DEV_QA_PERSONAS_PASSWORD)
    Given Adam [P-01] has the dev-flavor APK installed on Android with DEV_QA_PERSONAS_PASSWORD env var baked in
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI shows the element with tag "persona_picker_open"

  # ── PROD FLAVOR — real prod Firebase + real OAuth, NO dev affordances ──

  @blocker @android-physical @prod-flavor
  Scenario: Prod-flavor sign-in screen renders both OAuth buttons
    Given Adam [P-01] has the prod-flavor APK installed on Android
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI shows the element with tag "google_sign_in_button"
    Then Adam's Android UI shows the element with tag "apple_sign_in_button"

  @blocker @manual @android-physical @prod-flavor
  Scenario: Prod-flavor Google tap kicks off real OAuth flow
    Given Adam [P-01] has the prod-flavor APK installed on Android
    Given Adam is on the sign-in screen
    When Adam on Android taps "google_sign_in_button"
    Then within 5000ms Adam's Android UI shows the Google CredentialManager bottom-sheet
    # @manual continuation — system sheet is operator-driven

  @blocker @manual @ios-physical @prod-flavor
  Scenario: Prod-flavor Apple tap kicks off real ASAuthorizationController flow
    Given Adam [P-01] has the prod-flavor IPA installed on iPhone
    Given Adam is on the sign-in screen
    When Adam on iPhone taps "apple_sign_in_button"
    Then within 5000ms Adam's iPhone UI shows the iOS Apple ID confirmation sheet
    # @manual continuation — operator confirms

  @blocker @android-physical @prod-flavor
  Scenario: Prod-flavor does NOT render dev sign-in shortcut (defence-in-depth)
    Given Adam [P-01] has the prod-flavor APK installed on Android
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI does not show the element with tag "dev_sign_in"

  @blocker @android-physical @prod-flavor
  Scenario: Prod-flavor does NOT render persona picker (defence-in-depth)
    Given Adam [P-01] has the prod-flavor APK installed on Android
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI does not show the element with tag "persona_picker_open"

  @blocker @android-physical @prod-flavor @regression
  Scenario: Prod-flavor with credential env vars accidentally baked in — dev affordances still hidden
    # Defence-in-depth pin: even if a misconfigured CI build of the prod
    # APK somehow has DEV_QA_PERSONAS_PASSWORD baked in, the environment-
    # based visibility gate must hide the picker. Tested by build-time
    # injecting the env var then asserting the picker is still absent.
    # (The dev_sign_in negative is also retained as a drift catch.)
    Given Adam [P-01] has the prod-flavor APK installed with DEV_QA_PERSONAS_PASSWORD accidentally set
    When Adam on Android opens the app for the first time
    Then within 5000ms Adam's Android UI does not show the element with tag "dev_sign_in"
    Then Adam's Android UI does not show the element with tag "persona_picker_open"

  # ── Cross-platform parity ──

  @blocker @ios-physical @local-flavor
  Scenario: Local-flavor iPhone parity — both OAuth buttons visible
    Given Adam [P-01] has the local-flavor IPA installed on iPhone
    When Adam on iPhone opens the app for the first time
    Then within 5000ms Adam's iPhone UI shows the element with tag "google_sign_in_button"
    Then Adam's iPhone UI shows the element with tag "apple_sign_in_button"

  @blocker @ios-physical @prod-flavor
  Scenario: Prod-flavor iPhone parity — both OAuth buttons visible + no dev affordances
    Given Adam [P-01] has the prod-flavor IPA installed on iPhone
    When Adam on iPhone opens the app for the first time
    Then within 5000ms Adam's iPhone UI shows the element with tag "google_sign_in_button"
    Then Adam's iPhone UI shows the element with tag "apple_sign_in_button"
    Then Adam's iPhone UI does not show the element with tag "dev_sign_in"
    Then Adam's iPhone UI does not show the element with tag "persona_picker_open"

  @blocker @browser-chromium @local-flavor
  Scenario: Local-flavor Web parity — both OAuth buttons visible
    Given Adam [P-01] visits the local-flavor web app in Chromium
    When Adam on Web opens "/login.html"
    Then within 5000ms Adam's Web UI shows the element with tag "google_sign_in_button"
    Then Adam's Web UI shows the element with tag "apple_sign_in_button"

  @blocker @browser-chromium @prod-flavor
  Scenario: Prod-flavor Web parity — both OAuth buttons visible + no dev affordances
    Given Adam [P-01] visits the prod-flavor web app in Chromium
    When Adam on Web opens "/login.html"
    Then within 5000ms Adam's Web UI shows the element with tag "google_sign_in_button"
    Then Adam's Web UI shows the element with tag "apple_sign_in_button"
    Then Adam's Web UI does not show the element with tag "dev_sign_in"
    Then Adam's Web UI does not show the element with tag "persona_picker_open"
