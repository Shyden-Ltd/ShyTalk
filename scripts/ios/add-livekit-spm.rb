#!/usr/bin/env ruby
# frozen_string_literal: true

# scripts/ios/add-livekit-spm.rb
#
# Task #24b: migrates LiveKitClient from CocoaPods to Swift
# Package Manager. CocoaPods Trunk pinned LiveKitClient at 2.0.18
# (the last version LiveKit published to Trunk before switching
# exclusively to SPM distribution). 2.14.1 (current) is required
# to clear the 302 Swift 6 actor-isolated warnings observed in
# PR #835's Build iOS run.
#
# Scope:
#   - Adds XCRemoteSwiftPackageReference for
#     https://github.com/livekit/client-sdk-swift with a
#     `kind: upToNextMajorVersion, minimumVersion: 2.14.1`
#     requirement (within-major upgrades auto-pulled; major
#     bumps gated to a deliberate PR).
#   - Adds XCSwiftPackageProductDependency for the "LiveKitClient"
#     product on the iosApp app target.
#   - Wires the product dependency into iosApp target's
#     PBXFrameworksBuildPhase so the linker sees it.
#   - The iosAppTests target inherits the framework via
#     `inherit! :search_paths` in the Podfile (LiveKit is
#     available to @testable import iosApp without re-linking).
#
# THE SCRIPT IS IDEMPOTENT. Re-running on a project that already
# has the LiveKit SPM dependency is a no-op — each step checks
# by package URL / product name before adding.
#
# Usage:
#   ruby scripts/ios/add-livekit-spm.rb
#
# Verified by: express-api/tests/scripts/ios-livekit-spm-pin.test.js

require 'xcodeproj'

REPO_ROOT = File.expand_path('../..', __dir__)
PROJECT_PATH = File.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj')
TARGET_NAME = 'iosApp'
PACKAGE_URL = 'https://github.com/livekit/client-sdk-swift'
# The SPM product is named "LiveKit" (per client-sdk-swift's
# Package.swift), NOT "LiveKitClient" — that latter name is the
# CocoaPods spec name only. Mixing them gives a confusing
# `Missing package product 'LiveKitClient'` linker error.
# Source: https://github.com/livekit/client-sdk-swift/blob/main/Package.swift
PRODUCT_NAME = 'LiveKit'
MIN_VERSION = '2.14.1'

project = Xcodeproj::Project.open(PROJECT_PATH)

# ---- 1. Find or create XCRemoteSwiftPackageReference ----

# `package_references` returns nil (not []) on a project that has
# never had an SPM dep — calling `.find` on nil raises NoMethodError.
# This script is contracted to be re-runnable on any iosApp checkout
# (including a freshly-cloned repo with the pbxproj stripped back),
# so guard the accessor with `|| []`.
package_refs = project.root_object.package_references || []
existing_package = package_refs.find do |ref|
  ref.is_a?(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference) &&
    ref.repositoryURL == PACKAGE_URL
end

if existing_package
  puts "LiveKit XCRemoteSwiftPackageReference already exists — leaving as-is."
  package_ref = existing_package
else
  package_ref = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
  package_ref.repositoryURL = PACKAGE_URL
  package_ref.requirement = {
    'kind' => 'upToNextMajorVersion',
    'minimumVersion' => MIN_VERSION,
  }
  project.root_object.package_references << package_ref
  puts "Added XCRemoteSwiftPackageReference for #{PACKAGE_URL} (>= #{MIN_VERSION})."
end

# ---- 2. Find target ----

target = project.targets.find { |t| t.name == TARGET_NAME }
abort "FATAL: target '#{TARGET_NAME}' not found in #{PROJECT_PATH}" unless target

# ---- 3. Find or create XCSwiftPackageProductDependency ----

# Match BOTH product_name AND package — if a future PR adds a
# different SPM package that also exports a product called
# "LiveKitClient" (unlikely but legal), matching on name alone
# would silently bind to the wrong package. The package match
# ensures we only re-use a product dependency that points at the
# LiveKit Swift SDK we just added/found above.
existing_product = target.package_product_dependencies.find do |dep|
  dep.product_name == PRODUCT_NAME && dep.package == package_ref
end

if existing_product
  puts "LiveKit product dependency already wired on #{TARGET_NAME} target — leaving as-is."
  product_dep = existing_product
else
  product_dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  product_dep.product_name = PRODUCT_NAME
  product_dep.package = package_ref
  target.package_product_dependencies << product_dep
  puts "Added XCSwiftPackageProductDependency '#{PRODUCT_NAME}' to #{TARGET_NAME} target."
end

# ---- 4. Wire into PBXFrameworksBuildPhase so the linker sees it ----

frameworks_phase = target.frameworks_build_phase
existing_build_file = frameworks_phase.files.find do |f|
  f.product_ref == product_dep
end

if existing_build_file
  puts "LiveKit already in Frameworks build phase — leaving as-is."
else
  build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  build_file.product_ref = product_dep
  frameworks_phase.files << build_file
  puts "Wired LiveKit into Frameworks build phase for #{TARGET_NAME} target."
end

project.save

puts "\nSaved iosApp.xcodeproj."
puts "Next: `cd iosApp && pod install` (regenerates Pods workspace WITHOUT LiveKitClient pod)."
puts "Then: open iosApp/iosApp.xcworkspace in Xcode to let SPM resolve + build, OR run xcodebuild."
