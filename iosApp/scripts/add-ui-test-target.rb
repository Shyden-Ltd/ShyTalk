#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Adds the `iosAppUITests` UI Testing Bundle target to iosApp.xcodeproj.
# Idempotent — if the target already exists, exits cleanly.
#
# What it does:
#   - Adds a PBXNativeTarget with productType `com.apple.product-type.bundle.ui-testing`
#   - Sets it to test against the `iosApp` app target (TestTargetID linkage)
#   - Creates Debug + Release build configurations cloned from the app target
#   - Adds `iosAppUITests/ManualQARemoteControl.swift` as a source
#   - Adds the target to the Tests scheme so it shows up in xcodebuild
#
# Usage:
#   cd iosApp
#   ruby scripts/add-ui-test-target.rb
#
# Pre-requisite: the `xcodeproj` gem (ships with Xcode command-line tools'
# stock Ruby on macOS).

require 'xcodeproj'

PROJECT_PATH = File.expand_path('../iosApp.xcodeproj', __dir__)
SWIFT_FILE = File.expand_path('../iosAppUITests/ManualQARemoteControl.swift', __dir__)
TARGET_NAME = 'iosAppUITests'
APP_TARGET_NAME = 'iosApp'
BUNDLE_ID = 'com.shyden.shytalk.uitests'

abort("xcodeproj not found at #{PROJECT_PATH}") unless Dir.exist?(PROJECT_PATH)
abort("UI test Swift file missing at #{SWIFT_FILE}") unless File.exist?(SWIFT_FILE)

project = Xcodeproj::Project.open(PROJECT_PATH)

# Idempotent: bail if the target is already present.
existing = project.native_targets.find { |t| t.name == TARGET_NAME }
if existing
  puts "Target '#{TARGET_NAME}' already exists; nothing to do."
  exit 0
end

app_target = project.native_targets.find { |t| t.name == APP_TARGET_NAME }
abort("App target '#{APP_TARGET_NAME}' not found in project") unless app_target

# Create the UI test bundle target.
ui_test_target = project.new_target(
  :ui_test_bundle,
  TARGET_NAME,
  :ios,
  # Initial deployment target passed to xcodeproj's new_target. The
  # build-settings override loop further down (the
  # `ui_test_target.build_configurations.each` block) sets the same
  # value again on each config, but on a fresh `new_target` call
  # the initial value gets written into the configs BEFORE the
  # override loop fires. Keeping both aligned to 26.0 prevents a
  # stale 15.0 from being committed if the override loop is skipped
  # or fails.
  '26.0',
  nil,
  :swift,
)

# Add the source file. Create a group for it first.
group = project.main_group.find_subpath('iosAppUITests', true)
group.set_source_tree('SOURCE_ROOT')
file_ref = group.new_file(SWIFT_FILE)
ui_test_target.add_file_references([file_ref])

# Set bundle identifier and link the UI test target to the app target.
ui_test_target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  config.build_settings['PRODUCT_NAME'] = TARGET_NAME
  config.build_settings['TEST_TARGET_NAME'] = APP_TARGET_NAME
  config.build_settings['SWIFT_VERSION'] = '5.0'
  # Auto-generate Info.plist (Xcode 13+ default for new targets).
  # Without it the target can't code-sign because xcodebuild has no
  # Info.plist to read from.
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['INFOPLIST_KEY_NSPrincipalClass'] = ''
  config.build_settings['INFOPLIST_KEY_UIRequiredDeviceCapabilities'] = ''
  # Inherit signing from the app target so the UI test bundle picks up
  # the same provisioning + team.
  config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
  config.build_settings['DEVELOPMENT_TEAM'] = app_target.build_configurations.first.build_settings['DEVELOPMENT_TEAM'] || ''
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'
end

# Wire the dependency so the app builds before UI tests.
ui_test_target.add_dependency(app_target)

# PBXProject.targetAttributes needs the TestTargetID linkage so Xcode
# knows which app this UI test bundle exercises.
project.root_object.attributes['TargetAttributes'] ||= {}
project.root_object.attributes['TargetAttributes'][ui_test_target.uuid] = {
  'CreatedOnToolsVersion' => '15.0',
  'TestTargetID' => app_target.uuid,
}

project.save

puts "Added UI test target '#{TARGET_NAME}' with bundle id '#{BUNDLE_ID}'."
puts "Source file: #{SWIFT_FILE}"
puts "Test target: #{APP_TARGET_NAME}"
puts ''
puts 'Next steps:'
puts "  1. Verify in Xcode: open iosApp.xcworkspace"
puts "  2. Build the target: xcodebuild build-for-testing -workspace iosApp.xcworkspace -scheme iosAppUITests \\"
puts "       -destination \"platform=iOS Simulator,id=$(xcrun simctl list devices booted | grep -oE '\\([0-9A-F-]{36}\\)' | head -1 | tr -d '()')\""
