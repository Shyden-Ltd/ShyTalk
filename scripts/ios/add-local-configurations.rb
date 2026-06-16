#!/usr/bin/env ruby
# frozen_string_literal: true

# scripts/ios/add-local-configurations.rb
#
# Phase 3.2 of the iOS-local build-out: adds Debug-Local and
# Release-Local XCBuildConfigurations to iosApp.xcodeproj.
#
# Scope:
#   - PROJECT-level configuration list — both configs added, both
#     reference iosApp/Configurations/Local.xcconfig as their
#     baseConfigurationReference (the file added by PR #714).
#   - iosApp TARGET-level configuration list — both configs added,
#     no base reference (CocoaPods integration is Phase 3.4).
#   - The Local.xcconfig file itself is added as a PBXFileReference
#     under iosApp/Configurations/ if not already present.
#
# Out of scope (deferred to later sub-PRs):
#   - 3.3 — iosAppTests + iosAppUITests target configurations
#   - 3.4 — Pods-iosApp.{debug,release}-local.xcconfig generation
#   - 3.5 — Local scheme + LiveKitBridge.isAllowedURL extension
#
# THE SCRIPT IS IDEMPOTENT. Re-running on a project that already
# has the Local configurations is a no-op — each step checks for
# existing entries by name before adding. The xcodeproj gem
# guarantees deterministic UUID generation for the configurations
# (same name → same UUID across runs) so the resulting pbxproj
# diff is stable.
#
# Usage:
#   ruby scripts/ios/add-local-configurations.rb
#
# Verified by: express-api/tests/scripts/ios-local-configurations.test.js

require 'xcodeproj'

REPO_ROOT = File.expand_path('../..', __dir__)
PROJECT_PATH = File.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj')
XCCONFIG_PATH_ABS = File.join(REPO_ROOT, 'iosApp/Configurations/Local.xcconfig')
XCCONFIG_REL_TO_IOSAPP = 'Configurations/Local.xcconfig'
TARGET_NAME = 'iosApp'
NEW_CONFIG_NAMES = %w[Debug-Local Release-Local].freeze

unless File.exist?(XCCONFIG_PATH_ABS)
  abort "FATAL: Local.xcconfig not found at #{XCCONFIG_PATH_ABS}. " \
        'Phase 3.1 (PR #714) must be merged before Phase 3.2 can run.'
end

project = Xcodeproj::Project.open(PROJECT_PATH)

# ── 1. Ensure Local.xcconfig is a project file reference ──────────
# Looking for a child of the iosApp group named "Configurations"
# that contains "Local.xcconfig". If absent, create the group and
# add the file reference. Idempotent — both lookups skip on hit.
iosapp_group = project.main_group['iosApp'] ||
               raise("Could not find iosApp PBXGroup in project main_group.")

configs_group = iosapp_group.groups.find { |g| g.display_name == 'Configurations' }
if configs_group.nil?
  configs_group = iosapp_group.new_group('Configurations', 'Configurations')
  puts "Created PBXGroup: iosApp/Configurations"
end

# The Configurations directory lives at SOURCE_ROOT/Configurations (next to the
# .xcodeproj), NOT under the iosApp source subdir. With the default `<group>`
# relativity the path doubles to iosApp/iosApp/Configurations and xcodebuild
# can't open the xcconfig once a Configurations-based config is built. Pin
# SOURCE_ROOT. (Latent here because CI never builds Debug-Local; surfaced + fixed
# under SHY-0104 when Debug-Dev became the first built Configurations config.)
if configs_group.source_tree != 'SOURCE_ROOT'
  configs_group.source_tree = 'SOURCE_ROOT'
  puts 'Fixed Configurations PBXGroup sourceTree → SOURCE_ROOT'
end

xcconfig_ref = configs_group.files.find { |f| f.display_name == 'Local.xcconfig' }
if xcconfig_ref.nil?
  xcconfig_ref = configs_group.new_file('Local.xcconfig')
  xcconfig_ref.last_known_file_type = 'text.xcconfig'
  puts "Added PBXFileReference: Local.xcconfig"
else
  puts "PBXFileReference already present: Local.xcconfig (no-op)"
end

# ── Helper: clone build_settings from a Debug/Release sibling ─────
# CocoaPods enforces "1 unique SWIFT_VERSION per target across all
# configs" — if Debug-Local has empty buildSettings while Debug has
# SWIFT_VERSION = 5.0, `pod install` fails. Cloning the matching
# Debug or Release sibling carries the right baseline (SWIFT_VERSION,
# IPHONEOS_DEPLOYMENT_TARGET, codesign settings, etc.) into Local.
# Local.xcconfig is layered ON TOP via baseConfigurationReference
# at the project level — only differing values need to live in the
# xcconfig.
def clone_settings_from_sibling(list, new_name)
  source_name = new_name.start_with?('Debug') ? 'Debug' : 'Release'
  source = list.build_configurations.find { |c| c.name == source_name } ||
           raise("Cannot find #{source_name} config to clone for #{new_name}")
  # Deep-dup so future mutations to Local configs don't leak into
  # the source Debug/Release (xcodeproj's build_settings is a Hash).
  Marshal.load(Marshal.dump(source.build_settings))
end

# ── 2. Add Debug-Local + Release-Local to PROJECT-level list ──────
# Project-level configs base-reference Local.xcconfig so variables
# declared there (BUNDLE_ID_SUFFIX, LOCAL_HOST, etc.) propagate to
# every target unless overridden. Skip if a config of the same
# name already exists.
NEW_CONFIG_NAMES.each do |name|
  existing = project.build_configuration_list.build_configurations.find { |c| c.name == name }
  if existing
    # Self-heal migration: an earlier version of this script created
    # the Local configs with empty build_settings, which CocoaPods
    # rejects ("up to 1 unique SWIFT_VERSION per target"). Detect
    # the empty state and back-fill from the Debug/Release sibling.
    # On a healthy project the existing.build_settings is non-empty
    # and the no-op path runs.
    if existing.build_settings.empty?
      existing.build_settings = clone_settings_from_sibling(project.build_configuration_list, name)
      existing.base_configuration_reference = xcconfig_ref if existing.base_configuration_reference.nil?
      puts "Updated project-level XCBuildConfiguration: #{name} (back-filled empty build_settings)"
    else
      puts "Project-level XCBuildConfiguration already present: #{name} (no-op)"
    end
    next
  end

  config = project.new(Xcodeproj::Project::Object::XCBuildConfiguration)
  config.name = name
  config.base_configuration_reference = xcconfig_ref
  config.build_settings = clone_settings_from_sibling(project.build_configuration_list, name)
  project.build_configuration_list.build_configurations << config
  puts "Added project-level XCBuildConfiguration: #{name}"
end

# ── 3. Add Debug-Local + Release-Local to iosApp target list ──────
# Target-level configs have NO base reference at 3.2 — CocoaPods
# integration in Phase 3.4 will inject Pods-iosApp.debug-local
# .xcconfig as the base. Until then, target configs inherit
# baseline settings (SWIFT_VERSION, codesign, etc.) from their
# Debug/Release sibling via the cloned build_settings.
iosapp_target = project.targets.find { |t| t.name == TARGET_NAME } ||
                raise("Could not find iosApp target in project.")

NEW_CONFIG_NAMES.each do |name|
  existing = iosapp_target.build_configuration_list.build_configurations.find { |c| c.name == name }
  if existing
    # Same self-heal migration as the project-level loop above.
    if existing.build_settings.empty?
      existing.build_settings = clone_settings_from_sibling(iosapp_target.build_configuration_list, name)
      puts "Updated iosApp-target XCBuildConfiguration: #{name} (back-filled empty build_settings)"
    else
      puts "iosApp-target XCBuildConfiguration already present: #{name} (no-op)"
    end
    next
  end

  config = project.new(Xcodeproj::Project::Object::XCBuildConfiguration)
  config.name = name
  config.build_settings = clone_settings_from_sibling(iosapp_target.build_configuration_list, name)
  iosapp_target.build_configuration_list.build_configurations << config
  puts "Added iosApp-target XCBuildConfiguration: #{name}"
end

project.save
puts "\nSaved iosApp.xcodeproj."
puts 'Run `xcodebuild -list -project iosApp/iosApp.xcodeproj` to verify.'
