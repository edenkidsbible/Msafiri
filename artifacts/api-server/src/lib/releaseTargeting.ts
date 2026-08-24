export type ReleasePlatform = "all" | "ios" | "android";
export type DevicePlatform = "ios" | "android" | "unknown" | null | undefined;

export function isDeviceReleasePlatform(platform: string): platform is "ios" | "android" {
  return platform === "ios" || platform === "android";
}

/**
 * A release only targets the matching native operating system. Unknown legacy
 * tokens are deliberately excluded until their app refreshes registration.
 */
export function releaseTargetsDevice(
  releasePlatform: ReleasePlatform,
  devicePlatform: DevicePlatform,
): boolean {
  return releasePlatform === "all" || devicePlatform === releasePlatform;
}