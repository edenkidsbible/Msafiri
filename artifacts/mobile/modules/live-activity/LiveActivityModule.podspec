require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiveActivityModule'
  s.version        = package['version']
  s.summary        = 'iOS Dynamic Island / Lock Screen Live Activity for Msafiri'
  s.description    = 'Expo native module that wraps ActivityKit to display real-time navigation state in the Dynamic Island and on the Lock Screen.'
  s.homepage       = 'https://github.com/msafirikenya/app'
  s.license        = package['license']
  s.authors        = package['author']
  s.platform       = :ios, '16.0'
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.{h,m,mm,swift}'

  # ActivityKit is part of the iOS SDK — no extra framework linkage needed.
  # The canImport(ActivityKit) guard in Swift handles SDK version gating.
end
