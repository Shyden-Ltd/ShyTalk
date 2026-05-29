# j12 — Greta's admin daily routine — reports, age-verification, economy, audit, device bans.
#
# Personas: P-12 Greta (Web Admin — sole driver)
# Platforms: Web Admin (Chromium primary)
#
# This journey walks an admin through their daily moderation routine. Each step verifies
# the admin panel UI loads, the action results in the expected Firestore + audit changes,
# and stale UI is refreshed (real-time admin queues are a common gap).

Feature: j12 — Greta's admin daily routine
  As an admin doing a normal moderation day
  I want to clear the reports queue, action age verifications, adjust an economy edge case, audit a device ban, all from one panel
  So that the admin surface scales for daily operational use

  Background:
    Given the local stack is healthy
    Given Greta [P-12] is signed in on Web Admin Chromium with custom claim isAdmin=true
    Given the reports queue has 3 pending reports
    Given the age-verification queue has 5 pending submissions
    Given the suspension-appeals queue has 2 pending appeals
    Given the audit log has at least 50 recent entries

  # The original "Greta processes the full daily queue" scenario was 51 steps
  # threading 9 sub-phases of the admin daily routine. Split into 9 phase-focused
  # scenarios (≤12 steps each) sharing the Background queue setup. Each phase
  # runs in isolation against the seeded queues — no inter-scenario state hand-off
  # required because each phase opens its own admin tab fresh.
  @blocker @browser-chromium
  Scenario: Greta opens the admin panel — dashboard shows the queue counters with no console errors
    When Greta on Web Admin navigates to "/admin.html"
    Then within 3000ms Greta's Web Admin UI shows the dashboard with counters: 3 reports, 5 verifications, 2 appeals
    Then no JavaScript console errors are present

  @blocker @browser-chromium
  Scenario: Greta processes the reports queue — warn, dismiss, suspend 7 days
    Given Greta is on the admin dashboard with 3 pending reports
    When Greta on Web Admin opens the "reports" tab
    Then within 3000ms Greta's Web Admin UI shows 3 rows in the reports table
    When Greta on Web Admin opens the first report and taps "Issue warning"
    Then within 3000ms the database has 1 entries in "auditLog" matching {action: "warn"}
    Then within 3000ms the reports counter on the dashboard updates to 2
    When Greta on Web Admin opens the second report and taps "Dismiss" with reason "No violation observed"
    Then within 3000ms the database has document "reports/{reportId}" with field "status" equal to "DISMISSED"
    When Greta on Web Admin opens the third report and taps "Suspend for 7 days"
    Then within 3000ms the database has 1 entries in "auditLog" matching {action: "suspend", durationDays: 7}

  @blocker @browser-chromium
  Scenario: Greta processes the age-verification queue — 3 approvals + 1 reject + 1 reject-and-DOB-downgrade
    Given Greta is on the admin dashboard with 5 pending age-verification submissions
    When Greta on Web Admin opens the "age-verification" tab
    Then within 3000ms Greta's Web Admin UI shows 5 rows
    When Greta on Web Admin approves submissions 1-3
    Then within 5000ms 3 audit entries with action "age_verification.approve" exist
    Then within 5000ms the 3 corresponding users have isAgeVerified=true
    When Greta on Web Admin rejects submission 4 with reason "Image too blurry to read"
    Then within 3000ms the database has document "ageVerificationSubmissions/{sub4Id}" with field "status" equal to "REJECTED"
    Then within 3000ms the user receives a system PM from Officia with the reject reason
    When Greta on Web Admin rejects submission 5 with reason "DOB on ID shows minor" and dobOverride="2011-01-01"
    Then within 5000ms the database has 1 entries in "auditLog" matching {action: "age_verification.reject_and_dob_down"}
    Then within 5000ms the target user is downgraded to cohort=minor

  @blocker @browser-chromium
  Scenario: Greta processes the suspension appeals — lift the first, deny the second with reason
    Given Greta is on the admin dashboard with 2 pending suspension appeals
    When Greta on Web Admin opens the "appeals" tab
    Then Greta's Web Admin UI shows 2 rows
    When Greta on Web Admin lifts the first appeal
    Then within 3000ms that user has suspendedUntil=null
    When Greta on Web Admin denies the second appeal with reason "Persistent pattern of harassment"
    Then within 3000ms the database has document "suspensionAppeals/{appealId}" with field "status" equal to "DENIED"

  @blocker @browser-chromium
  Scenario: Greta adjusts a user's economy balance with a refund — audit + transaction entries both written
    Given Greta is on the admin dashboard
    When Greta on Web Admin opens the "economy" tab
    When Greta on Web Admin searches for user "50000020"
    When Greta on Web Admin adjusts shyCoins by +500 with reason "Customer support refund"
    Then within 3000ms the database has document "users/50000020" with field "shyCoins" increased by 500
    Then the database has 1 entries in "auditLog" matching {action: "economy.adjust", amount: 500, targetId: 50000020}
    Then the database has 1 entries in "users/50000020/transactions" matching {type: "ADMIN_ADJUST", amount: 500}

  @blocker @browser-chromium
  Scenario: Greta bans a device by ID — adminDeviceBans + audit entries are written
    Given Greta is on the admin dashboard
    When Greta on Web Admin opens the "security" subtab
    When Greta on Web Admin taps "Ban device" and types deviceId="device-xyz" + reason "Repeated abuse"
    Then within 3000ms the database has 1 entries in "adminDeviceBans" matching {deviceId: "device-xyz"}
    Then the database has 1 entries in "auditLog" matching {action: "device.ban", targetDevice: "device-xyz"}

  @blocker @browser-chromium
  Scenario: Greta reviews the age-segregation 24h dashboard
    Given Greta is on the admin dashboard
    When Greta on Web Admin opens the "age-segregation" tab
    Then within 3000ms Greta's Web Admin UI shows the "Blocked cross-cohort attempts (24h)" stat
    Then Greta's Web Admin UI shows a table of recent blocked attempts

  @blocker @browser-chromium
  Scenario: Greta reviews the audit log — recent 20 entries with filter
    Given Greta is on the admin dashboard with at least 50 audit-log entries
    When Greta on Web Admin opens the "audit-log" tab
    Then within 3000ms Greta's Web Admin UI shows the most recent 20 entries
    Then each entry shows action + targetId + adminId + timestamp + reason
    When Greta on Web Admin filters by action="suspend"
    Then within 3000ms Greta's Web Admin UI shows only suspend entries

  @blocker @browser-chromium
  Scenario: Audit log is immutable — PATCH + DELETE both rejected from admin endpoints
    Given Greta is on the admin dashboard with at least 50 audit-log entries
    When Greta on Web Admin attempts to PATCH /api/admin/audit/{anyEntry}
    Then the response status is 405 or 403
    When Greta on Web Admin attempts to DELETE /api/admin/audit/{anyEntry}
    Then the response status is 405 or 403

  @browser-chromium
  Scenario: Non-admin user is bounced from the admin panel
    Given Adam [P-01] is signed in as a non-admin user
    When Adam on Web Chromium navigates to "/admin.html"
    Then within 3000ms Adam's Web UI shows "You are not authorized to view this page"
    When Adam on Web POSTs /api/admin/users/suspend with targetUniqueId=50000050
    Then the response status is 403

  @blocker @regression j12-bug-admin-claim-name
  # bug: provision-test-personas.js wrote `customClaims.isAdmin=true`, but
  # the admin middleware (auth.js requireAdmin) checks `req.auth.token.admin`.
  # Greta's admin endpoints returned 403 despite being marked admin in
  # the registry. Regression guard — if the claim key drifts again, this
  # scenario fails before any human notices.
  Scenario: Greta's admin claim uses the correct key `admin` (not `isAdmin`)
    Given Greta [P-12] is signed in
    Then Greta's Firebase Auth custom claims include "admin" equal to true
    Then Greta's Firebase Auth custom claims do not include "isAdmin"
    When Greta on Web Admin sends GET /api/user/50000010 with her ID token
    Then the response status is 200
    Then the response body has user data for uniqueId 50000010

  @blocker @regression j12-bug-admin-claim-name
  Scenario: Non-admin Alice cannot reach the admin endpoint
    Given Alice [P-02] is signed in (no admin claim)
    When Alice on Web sends GET /api/user/50000010 with her ID token
    Then the response status is 403
    Then the response body contains "Admin access required"

  @browser-chromium @perf-budget:3000
  Scenario: Admin panel initial load completes within 3s with a populated audit log
    Given the audit log has 10000 entries
    When Greta on Web Admin navigates to "/admin.html"
    Then within 3000ms the dashboard renders fully

  @browser-chromium @locale-rtl
  Scenario: Admin panel stays LTR even with browser locale=ar (admin is English-only by policy)
    Given Greta's browser locale is "ar"
    When Greta on Web Admin navigates to "/admin.html"
    Then Greta's Web Admin UI document direction is "ltr"
    Then Greta's Web Admin UI labels are in English
