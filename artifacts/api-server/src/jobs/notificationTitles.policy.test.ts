import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAX_TITLE_LENGTH = 20;

const serverTitleFiles = [
  "./pushNotifications.ts",
  "../routes/push.ts",
  "../routes/reports.ts",
  "../routes/vehicles.ts",
  "./creatorMonitoring.ts",
];

function staticTitles(relativePath: string): string[] {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return Array.from(
    source.matchAll(/(?:title|notificationTitle):\s*"([^"]*)"/g),
    (match) => match[1]!,
  );
}

describe("notification title length policy", () => {
  it("keeps static server notification titles compact", () => {
    const titles = serverTitleFiles.flatMap(staticTitles);
    const tooLong = titles.filter(
      (title) => Array.from(title).length > MAX_TITLE_LENGTH,
    );
    expect(tooLong).toEqual([]);
  });

  it("keeps native notification titles compact and clear", () => {
    const backgroundAlerts = readFileSync(
      new URL("../../../mobile/utils/backgroundDriveAlerts.ts", import.meta.url),
      "utf8",
    );
    const backgroundShare = readFileSync(
      new URL("../../../mobile/utils/backgroundShare.ts", import.meta.url),
      "utf8",
    );
    const appContext = readFileSync(
      new URL("../../../mobile/context/AppContext.tsx", import.meta.url),
      "utf8",
    );
    const dashcamContext = readFileSync(
      new URL("../../../mobile/context/DashcamContext.tsx", import.meta.url),
      "utf8",
    );

    expect(backgroundAlerts).toContain('notificationTitle:   "Drive mode"');
    expect(backgroundAlerts).toContain("title: `${label} ahead`");
    expect(backgroundShare).toContain('notificationTitle: "Trip sharing"');
    expect(appContext).toContain("title: `${typeLabel} ahead`");
    expect(dashcamContext).toContain('title: "Storage full"');
    expect(dashcamContext).toContain('title: "Review clips"');
  });
});