//
//  MsafiriLiveActivity.swift
//  MsafiriWidget
//
//  Dynamic Island compact / expanded views + Lock Screen widget for
//  real-time navigation state. Requires iOS 16.2+ / ActivityKit.
//

import SwiftUI
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit

// MARK: - Shared attribute types (must match LiveActivityModule.swift)

struct MsafiriActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var speedKmh: Double
    var speedLimitKmh: Double?
    var nextInstruction: String?
    var distToNextM: Double?
    var destinationName: String?
    var isSharingTrip: Bool
  }
}

// MARK: - Formatting helpers

private func fmtDist(_ m: Double?) -> String {
  guard let m else { return "" }
  if m < 1000 { return "\(Int(m.rounded())) m" }
  return String(format: "%.1f km", m / 1000)
}

private func maneuverIcon(for instruction: String?) -> String {
  guard let instruction = instruction?.lowercased() else { return "arrow.up" }
  if instruction.contains("left")      { return "arrow.turn.up.left" }
  if instruction.contains("right")     { return "arrow.turn.up.right" }
  if instruction.contains("u-turn") || instruction.contains("uturn") { return "arrow.uturn.left" }
  if instruction.contains("roundabout") || instruction.contains("circle") { return "arrow.triangle.turn.up.right.circle" }
  if instruction.contains("exit")      { return "arrow.up.right" }
  if instruction.contains("merge")     { return "arrow.merge" }
  if instruction.contains("arrive") || instruction.contains("destination") { return "mappin.circle.fill" }
  return "arrow.up"
}

// MARK: - Compact Leading (Dynamic Island left side)

struct CompactLeadingView: View {
  let state: MsafiriActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 2) {
      Text("\(Int(state.speedKmh.rounded()))")
        .font(.system(size: 17, weight: .bold, design: .rounded))
        .foregroundStyle(.white)
      Text("km/h")
        .font(.system(size: 8, weight: .medium))
        .foregroundStyle(.white.opacity(0.7))
    }
    .padding(.leading, 4)
  }
}

// MARK: - Compact Trailing (Dynamic Island right side)

struct CompactTrailingView: View {
  let state: MsafiriActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: maneuverIcon(for: state.nextInstruction))
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.white)
      if let dist = state.distToNextM {
        Text(fmtDist(dist))
          .font(.system(size: 11, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.85))
          .lineLimit(1)
      }
    }
    .padding(.trailing, 4)
  }
}

// MARK: - Minimal (Dynamic Island pill when two activities compete)

struct MinimalView: View {
  let state: MsafiriActivityAttributes.ContentState

  var body: some View {
    Text("\(Int(state.speedKmh.rounded()))")
      .font(.system(size: 14, weight: .bold, design: .rounded))
      .foregroundStyle(.white)
  }
}

// MARK: - Expanded (Dynamic Island expanded press) + Lock Screen

struct ExpandedView: View {
  let state: MsafiriActivityAttributes.ContentState
  @Environment(\.colorScheme) var colorScheme

  private var accentColor: Color { Color(red: 0, green: 0.784, blue: 0.322) } // #00C853

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {

      // ── Destination row ───────────────────────────────────────
      if let dest = state.destinationName {
        HStack(spacing: 6) {
          Image(systemName: "mappin.circle.fill")
            .font(.system(size: 13))
            .foregroundStyle(accentColor)
          Text(dest)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.primary)
            .lineLimit(1)
          Spacer()
          if state.isSharingTrip {
            HStack(spacing: 3) {
              Circle()
                .fill(accentColor)
                .frame(width: 7, height: 7)
              Text("Sharing")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(accentColor)
            }
          }
        }
      }

      // ── Next manoeuvre ────────────────────────────────────────
      HStack(alignment: .center, spacing: 10) {
        ZStack {
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(accentColor.opacity(0.15))
            .frame(width: 44, height: 44)
          Image(systemName: maneuverIcon(for: state.nextInstruction))
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(accentColor)
        }

        VStack(alignment: .leading, spacing: 2) {
          if let dist = state.distToNextM {
            Text(fmtDist(dist))
              .font(.system(size: 14, weight: .bold, design: .rounded))
              .foregroundStyle(.primary)
          }
          if let instruction = state.nextInstruction {
            Text(instruction)
              .font(.system(size: 12, weight: .regular))
              .foregroundStyle(.secondary)
              .lineLimit(2)
          }
        }
        Spacer()
      }

      // ── Speed vs limit bar ────────────────────────────────────
      if let limit = state.speedLimitKmh, limit > 0 {
        let speed = state.speedKmh
        let ratio = min(speed / limit, 1.5)
        let overLimit = speed > limit + 5
        let barColor: Color = overLimit ? .red : accentColor

        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text("\(Int(speed.rounded())) km/h")
              .font(.system(size: 12, weight: .semibold, design: .rounded))
              .foregroundStyle(overLimit ? .red : .primary)
            Spacer()
            Text("Limit \(Int(limit)) km/h")
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
          }

          GeometryReader { geo in
            ZStack(alignment: .leading) {
              RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(Color.secondary.opacity(0.2))
                .frame(height: 5)
              RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(barColor)
                .frame(width: geo.size.width * min(ratio, 1.0), height: 5)
            }
          }
          .frame(height: 5)
        }
      } else {
        // No limit — just show speed
        Text("\(Int(state.speedKmh.rounded())) km/h")
          .font(.system(size: 13, weight: .semibold, design: .rounded))
          .foregroundStyle(.primary)
      }
    }
    .padding(14)
  }
}

// MARK: - Lock Screen (banner below the Dynamic Island on non-DI phones)

struct LockScreenView: View {
  let context: ActivityViewContext<MsafiriActivityAttributes>

  var body: some View {
    ExpandedView(state: context.state)
      .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
      .activitySystemActionForegroundColor(.primary)
  }
}

// MARK: - Widget Configuration

@available(iOS 16.2, *)
struct MsafiriLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MsafiriActivityAttributes.self) { context in
      // Lock Screen / StandBy view
      LockScreenView(context: context)

    } dynamicIsland: { context in
      DynamicIsland {
        // Expanded views (user long-presses the island)
        DynamicIslandExpandedRegion(.leading) {
          CompactLeadingView(state: context.state)
        }
        DynamicIslandExpandedRegion(.trailing) {
          CompactTrailingView(state: context.state)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ExpandedView(state: context.state)
        }
      } compactLeading: {
        CompactLeadingView(state: context.state)
      } compactTrailing: {
        CompactTrailingView(state: context.state)
      } minimal: {
        MinimalView(state: context.state)
      }
      .keylineTint(Color(red: 0, green: 0.784, blue: 0.322))
    }
  }
}

// MARK: - Entry point

@main
struct MsafiriWidgetBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      MsafiriLiveActivity()
    }
  }
}

#endif // canImport(ActivityKit)
