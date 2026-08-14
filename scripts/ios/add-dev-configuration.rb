#!/usr/bin/env ruby
# frozen_string_literal: true

# scripts/ios/add-dev-configuration.rb
#
# SHY-0104 — adds a `Debug-Dev` XCBuildConfiguration to iosApp.xcodeproj so a
# real iPhone can run the PUBLIC dev backend (shytalk-dev + dev-api) WITH the
# test-persona picker — the iOS sibling of the Android `dev` product flavor.
#
# Scope (mirrors scripts/ios/add-local-configurations.rb):
#   - PROJECT-level configuration list — Debug-Dev added, base-references
#     iosApp/Configurations/Dev.xcconfig (declares DEV_QA_PERSONAS_PASSWORD).
#   - EVERY target's configuration list (iosApp + iosAppTests + iosAppUITests)
#     — Debug-Dev added (no base ref; CocoaPods sets Pods-<target>.debug-dev
#     .xcconfig as the base on the next `pod install` for the integrated
#     targets, gated by the Podfile `'Debug-Dev' => :debug` mapping). All
#     targets carry it so CocoaPods' "1 unique SWIFT_VERSION per target" check
#     passes (a managed target lacking the config makes CocoaPods synthesise an
#     empty one → conflict) and the scheme builds cleanly under Debug-Dev.
#   - The Dev.xcconfig file is added as a PBXFileReference under the
#     iosApp/Configurations PBXGroup if not already present.
#   - The app-target Debug-Dev gets `DEV_BACKEND` appended to
#     SWIFT_ACTIVE_COMPILATION_CONDITIONS so iOSApp.swift's `#if DEV_BACKEND`
#     branch compiles. (The flag lives in the pbxproj, not the xcconfig: a
#     config cloned from Debug carries its own SWIFT_ACTIVE_COMPILATION_CONDITIONS
#     which would override an xcconfig value lacking `$(inherited)`.)
#   - The two SHY-0104 Swift sources (AppEnvironment.swift in iosApp,
#     AppEnvironmentTests.swift in iosAppTests) are added to their target
#     Sources build phases — a file on disk isn't compiled without it.
#
# Only Debug-Dev is added — NOT a Release-Dev: the distributable Release config
# already targets dev (sans picker), and a Release-flavoured dev build would be
# an archive footgun (it must never ship the picker password).
#
# THE SCRIPT IS IDEMPOTENT. Re-running on a project that already has the
# Debug-Dev configuration is a no-op — each step checks for an existing entry
# by name first. The xcodeproj gem generates deterministic UUIDs (same name →
# same UUID) so the pbxproj diff is stable across runs.
#
# Usage:
#   ruby scripts/ios/add-dev-configuration.rb
#
# Then `pod install` (the Podfile maps 'Debug-Dev' => :debug) to generate
# Pods-iosApp.debug-dev.xcconfig + wire the target-level base reference.
#
# Verified by: express-api/tests/scripts/ios-dev-configuration.test.js

require 'xcodeproj'

REPO_ROOT = File.expand_path('../..', __dir__)
PROJECT_PATH = File.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj')
XCCONFIG_PATH_ABS = File.join(REPO_ROOT, 'iosApp/Configurations/Dev.xcconfig')
TARGET_NAME = 'iosApp'
NEW_CONFIG_NAME = 'Debug-Dev'

unless File.exist?(XCCONFIG_PATH_ABS)
  abort "FATAL: Dev.xcconfig not found at #{XCCONFIG_PATH_ABS}. " \
        'Create iosApp/Configurations/Dev.xcconfig before running this script.'
end

project = Xcodeproj::Project.open(PROJECT_PATH)

# ── 1. Ensure Dev.xcconfig is a project file reference ────────────
# Reuse the existing iosApp/Configurations PBXGroup (created by the Local
# build-out); create it only if somehow absent. Idempotent — both lookups
# skip on hit.
iosapp_group = project.main_group['iosApp'] ||
               raise('Could not find iosApp PBXGroup in project main_group.')

configs_group = iosapp_group.groups.find { |g| g.display_name == 'Configurations' }
if configs_group.nil?
  configs_group = iosapp_group.new_group('Configurations', 'Configurations')
  puts 'Created PBXGroup: Configurations'
end

# The Configurations directory lives at SOURCE_ROOT/Configurations (next to the
# .xcodeproj), NOT under the iosApp source subdir. The group is parented under
# the iosApp source group, so with the default `<group>` relativity its path
# doubles to iosApp/iosApp/Configurations and xcodebuild fails to open the
# xcconfig ("Unable to open base configuration reference file") the first time a
# Configurations-based config (Debug-Dev) is actually built. Pin SOURCE_ROOT so
# Dev.xcconfig — AND the pre-existing Local.xcconfig in the same group, which
# carried the same latent bug (never surfaced because CI never builds
# Debug-Local) — both resolve to iosApp/Configurations. Idempotent.
if configs_group.source_tree != 'SOURCE_ROOT'
  configs_group.source_tree = 'SOURCE_ROOT'
  puts 'Fixed Configurations PBXGroup sourceTree → SOURCE_ROOT (corrects xcconfig path resolution)'
end

xcconfig_ref = configs_group.files.find { |f| f.display_name == 'Dev.xcconfig' }
if xcconfig_ref.nil?
  xcconfig_ref = configs_group.new_file('Dev.xcconfig')
  xcconfig_ref.last_known_file_type = 'text.xcconfig'
  puts 'Added PBXFileReference: Dev.xcconfig'
else
  puts 'PBXFileReference already present: Dev.xcconfig (no-op)'
end

# ── Helper: clone build_settings from the Debug sibling ───────────
# CocoaPods enforces "1 unique SWIFT_VERSION per target across all configs".
# Cloning Debug carries the right baseline (SWIFT_VERSION, deployment target,
# codesign settings) into Debug-Dev. Dev.xcconfig layers on top via the
# project-level baseConfigurationReference; only DEV_QA_PERSONAS_PASSWORD
# needs to live in the xcconfig.
def clone_debug_settings(list)
  source = list.build_configurations.find { |c| c.name == 'Debug' } ||
           raise('Cannot find Debug config to clone for Debug-Dev')
  Marshal.load(Marshal.dump(source.build_settings))
end

# ── Helper: ensure DEV_BACKEND is in the Swift compile conditions ──
# Selects iOSApp.swift's `#if DEV_BACKEND` branch. Kept alongside DEBUG (a
# Debug-derived config) and `$(inherited)`. Order-insensitive + idempotent:
# tokenise, add the missing ones, rejoin.
def ensure_dev_backend!(settings)
  key = 'SWIFT_ACTIVE_COMPILATION_CONDITIONS'
  current = settings[key]
  tokens =
    case current
    when Array then current.dup
    when String then current.split(/\s+/)
    when nil then []
    else current.to_s.split(/\s+/)
    end
  tokens << 'DEBUG' unless tokens.include?('DEBUG')
  tokens << 'DEV_BACKEND' unless tokens.include?('DEV_BACKEND')
  tokens << '$(inherited)' unless tokens.include?('$(inherited)')
  settings[key] = tokens.join(' ')
end

# ── 2. Add Debug-Dev to the PROJECT-level configuration list ──────
existing = project.build_configuration_list.build_configurations.find { |c| c.name == NEW_CONFIG_NAME }
if existing
  if existing.build_settings.empty?
    existing.build_settings = clone_debug_settings(project.build_configuration_list)
  end
  existing.base_configuration_reference = xcconfig_ref if existing.base_configuration_reference.nil?
  ensure_dev_backend!(existing.build_settings)
  puts "Project-level XCBuildConfiguration already present: #{NEW_CONFIG_NAME} (refreshed)"
else
  config = project.new(Xcodeproj::Project::Object::XCBuildConfiguration)
  config.name = NEW_CONFIG_NAME
  config.base_configuration_reference = xcconfig_ref
  config.build_settings = clone_debug_settings(project.build_configuration_list)
  ensure_dev_backend!(config.build_settings)
  project.build_configuration_list.build_configurations << config
  puts "Added project-level XCBuildConfiguration: #{NEW_CONFIG_NAME}"
end

# ── 3. Add Debug-Dev to EVERY target's configuration list ─────────
# No base reference here — for the CocoaPods-integrated targets (iosApp +
# iosAppTests) `pod install` injects Pods-<target>.debug-dev.xcconfig as the
# base. Until then the cloned Debug settings carry the baseline (SWIFT_VERSION
# etc.). All targets MUST carry Debug-Dev: CocoaPods rejects `pod install` with
# "up to 1 unique SWIFT_VERSION per target" if a managed target (iosAppTests)
# lacks the config and CocoaPods synthesises an empty one. The UI-test target
# gets it too so the scheme builds cleanly under Debug-Dev (no-gaps).
#
# Only the app target (and the project level) get the DEV_BACKEND compile
# condition — that is where iOSApp.swift's `#if DEV_BACKEND` is evaluated. Test
# targets clone their own Debug solely to carry SWIFT_VERSION; their own
# compile conditions don't affect the imported app module.
project.targets.each do |target|
  list = target.build_configuration_list
  next unless list.build_configurations.any? { |c| c.name == 'Debug' } # skip targets with no Debug sibling

  existing_target = list.build_configurations.find { |c| c.name == NEW_CONFIG_NAME }
  if existing_target
    existing_target.build_settings = clone_debug_settings(list) if existing_target.build_settings.empty?
    ensure_dev_backend!(existing_target.build_settings) if target.name == TARGET_NAME
    puts "#{target.name}-target XCBuildConfiguration already present: #{NEW_CONFIG_NAME} (refreshed)"
  else
    config = project.new(Xcodeproj::Project::Object::XCBuildConfiguration)
    config.name = NEW_CONFIG_NAME
    config.build_settings = clone_debug_settings(list)
    ensure_dev_backend!(config.build_settings) if target.name == TARGET_NAME
    list.build_configurations << config
    puts "Added #{target.name}-target XCBuildConfiguration: #{NEW_CONFIG_NAME}"
  end
end

# ── 4. Ensure SHY-0104's new Swift sources are compiled ────────────
# A file written to disk is NOT compiled until it is a member of the target's
# Sources build phase (normally added by the Xcode GUI). These two files were
# added by SHY-0104 and have no pbxproj membership otherwise — without this the
# build fails with "cannot find type 'AppBuildVariant' in scope". Adding them
# here keeps the script the complete, reproducible record of SHY-0104's pbxproj
# state. Each file lives in its sibling group (iosApp / iosAppTests), which maps
# correctly to the on-disk source dir. Idempotent — skips if already a member.
[
  %w[iosApp iosApp AppEnvironment.swift],
  %w[iosAppTests iosAppTests AppEnvironmentTests.swift],
].each do |group_name, target_name, filename|
  group = project.main_group[group_name] || raise("Could not find #{group_name} PBXGroup.")
  target = project.targets.find { |t| t.name == target_name } ||
           raise("Could not find #{target_name} target.")
  if target.source_build_phase.files_references.any? { |r| r.display_name == filename }
    puts "#{target_name} already compiles #{filename} (no-op)"
    next
  end
  ref = group.files.find { |f| f.display_name == filename } || group.new_file(filename)
  target.add_file_references([ref])
  puts "Added #{filename} to #{target_name} Sources"
end

project.save
puts "\nSaved iosApp.xcodeproj."
puts 'Next: run `pod install` (Podfile maps Debug-Dev => :debug), then'
puts '`xcodebuild -list -project iosApp/iosApp.xcodeproj` to verify.'
