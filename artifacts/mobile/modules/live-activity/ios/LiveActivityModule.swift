/**
 * LiveActivityModule.swift
 *
 * Expo native module that bridges ActivityKit to JavaScript.
 * Manages one Live Activity at a time (the current navigation/sharing
 * session).  The push token returned by startActivity lets the server
 * push ContentState updates directly via APNs even when the app is
 * fully suspended by iOS.
 *
 * Requires iOS 16.2+.  Guarded with #available checks so the file
 * compiles on earlier OS targets without crashing at runtime.
 */

import ExpoModulesCore

#if canImport(ActivityKit)
import ActivityKit

// MARK: - Shared attribute / content-state types
//
// These structs MUST be byte-for-byte identical to the ones declared in
// MsafiriLiveActivity.swift (the Widget Extension target).  ActivityKit
// matches activities between the app and the widget by their full Swift
// type name, which resolves consistently because this Pod is statically
// linked into the main app binary.

struct MsafiriActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var speedKmh:        Double
    var speedLimitKmh:   Double?
    var nextInstruction: String?
    var distToNextM:     Double?
    var destinationName: String?
    var isSharingTrip:   Bool
    /// Unix timestamp (seconds) of this update.  The widget shows a
    /// stale-data indicator when the value is >15 s old, which signals
    /// that iOS has suspended the app and the JS update loop has stopped.
    var lastUpdatedAt:   Double
  }
}

#endif // canImport(ActivityKit)

// MARK: - Expo Module definition

public class LiveActivityModule: Module {

  #if canImport(ActivityKit)
  /// The currently-running activity, if any.
  @available(iOS 16.2, *)
  private var currentActivity: Activity<MsafiriActivityAttributes>?

  /// Background task that forwards push-token rotations to JS via the
  /// onPushTokenUpdate event.
  private var tokenUpdateTask: Task<Void, Never>?
  #endif

  public func definition() -> ModuleDefinition {
    Name("LiveActivityModule")

    // ── Events ─────────────────────────────────────────────────────────
    // "onPushTokenUpdate" fires whenever ActivityKit rotates the push
    // token for the current activity.  Payload: { "token": "<hex>" }
    Events("onPushTokenUpdate")

    // ── startActivity ──────────────────────────────────────────────────
    // Requests a new Live Activity and waits up to two seconds for APNs
    // to issue the first push token.  Returns the hex-encoded push token,
    // or nil if APNs has not yet assigned one by the time we give up.
    // The JS caller should also listen for "onPushTokenUpdate" in case
    // the token arrives after startActivity resolves.
    AsyncFunction("startActivity") { [weak self] (state: [String: Any]) -> String? in
      guard let self = self else { return nil }

      #if canImport(ActivityKit)
      guard #available(iOS 16.2, *) else { return nil }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }

      let contentState = try self.buildContentState(from: state)
      let attributes  = MsafiriActivityAttributes()

      // End any stale activity before starting a new one.
      if let existing = self.currentActivity {
        self.tokenUpdateTask?.cancel()
        self.tokenUpdateTask = nil
        await existing.end(nil, dismissalPolicy: .immediate)
        self.currentActivity = nil
      }

      let activity = try Activity<MsafiriActivityAttributes>.request(
        attributes: attributes,
        content:    .init(state: contentState, staleDate: nil),
        pushType:   .token
      )
      self.currentActivity = activity

      // Observe push-token rotations for the lifetime of the activity
      // and forward them to the JS layer as events.
      self.tokenUpdateTask?.cancel()
      self.tokenUpdateTask = Task { [weak self] in
        guard let self = self else { return }
        if #available(iOS 16.2, *) {
          for await tokenData in activity.pushTokenUpdates {
            let hex = tokenData.map { String(format: "%02x", $0) }.joined()
            self.sendEvent("onPushTokenUpdate", ["token": hex])
          }
        }
      }

      // Wait up to 2 s for the initial push token.
      let deadline = Date().addingTimeInterval(2.0)
      while Date() < deadline {
        if let tokenData = activity.pushToken {
          return tokenData.map { String(format: "%02x", $0) }.joined()
        }
        try await Task.sleep(nanoseconds: 100_000_000) // 100 ms
      }

      return nil
      #else
      return nil
      #endif
    }

    // ── updateActivity ─────────────────────────────────────────────────
    // Pushes a new ContentState to the running activity (local update).
    // Only used while the app is in the foreground or background; when
    // the app is fully suspended the server drives updates via APNs.
    AsyncFunction("updateActivity") { [weak self] (state: [String: Any]) in
      guard let self = self else { return }
      #if canImport(ActivityKit)
      guard #available(iOS 16.2, *) else { return }
      guard let activity = self.currentActivity else { return }
      let contentState = try self.buildContentState(from: state)
      await activity.update(.init(state: contentState, staleDate: nil))
      #endif
    }

    // ── endActivity ────────────────────────────────────────────────────
    // Dismisses the Live Activity immediately.
    AsyncFunction("endActivity") { [weak self] in
      guard let self = self else { return }
      #if canImport(ActivityKit)
      guard #available(iOS 16.2, *) else { return }
      self.tokenUpdateTask?.cancel()
      self.tokenUpdateTask = nil
      if let activity = self.currentActivity {
        await activity.end(nil, dismissalPolicy: .immediate)
        self.currentActivity = nil
      }
      #endif
    }
  }

  // MARK: - Helpers

  #if canImport(ActivityKit)
  @available(iOS 16.2, *)
  private func buildContentState(
    from state: [String: Any]
  ) throws -> MsafiriActivityAttributes.ContentState {
    guard let speedKmh = state["speedKmh"] as? Double else {
      throw NSError(
        domain: "LiveActivityModule",
        code:   1,
        userInfo: [NSLocalizedDescriptionKey: "speedKmh is required in state"]
      )
    }
    return MsafiriActivityAttributes.ContentState(
      speedKmh:        speedKmh,
      speedLimitKmh:   state["speedLimitKmh"]   as? Double,
      nextInstruction: state["nextInstruction"]  as? String,
      distToNextM:     state["distToNextM"]      as? Double,
      destinationName: state["destinationName"]  as? String,
      isSharingTrip:   (state["isSharingTrip"]  as? Bool) ?? false,
      lastUpdatedAt:   (state["lastUpdatedAt"]   as? Double) ?? Date().timeIntervalSince1970
    )
  }
  #endif
}
