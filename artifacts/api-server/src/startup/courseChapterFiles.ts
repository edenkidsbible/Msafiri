/**
 * courseChapterFiles.ts
 *
 * Statically imports all 24 chapter JSON files so esbuild inlines them into
 * dist/index.mjs at build time.  In production the monorepo source tree does
 * not exist alongside the bundle, so runtime fs.readFileSync would always
 * fail.  esbuild resolves cross-package relative paths just fine.
 *
 * ⚠️  Keep in sync with lib/db/src/data/course/ when chapters are added.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – cross-package JSON; esbuild bundles these; tsc sees them via resolveJsonModule
import c00 from "../../../../lib/db/src/data/course/00-foreword.json";
// @ts-ignore
import c01 from "../../../../lib/db/src/data/course/01-introduction-to-driving.json";
// @ts-ignore
import c02 from "../../../../lib/db/src/data/course/02-fundamental-driving-rules.json";
// @ts-ignore
import c03 from "../../../../lib/db/src/data/course/03-model-town.json";
// @ts-ignore
import c04 from "../../../../lib/db/src/data/course/04-human-factors-in-traffic.json";
// @ts-ignore
import c05 from "../../../../lib/db/src/data/course/05-vehicle-constructions-and-controls.json";
// @ts-ignore
import c06 from "../../../../lib/db/src/data/course/06-self-inspection-of-vehicle.json";
// @ts-ignore
import c07 from "../../../../lib/db/src/data/course/07-observation.json";
// @ts-ignore
import c08 from "../../../../lib/db/src/data/course/08-vehicle-control.json";
// @ts-ignore
import c09 from "../../../../lib/db/src/data/course/09-communication-on-the-road.json";
// @ts-ignore
import c10 from "../../../../lib/db/src/data/course/10-speed-management.json";
// @ts-ignore
import c11 from "../../../../lib/db/src/data/course/11-space-management.json";
// @ts-ignore
import c12 from "../../../../lib/db/src/data/course/12-emergency-manoeuvres.json";
// @ts-ignore
import c13 from "../../../../lib/db/src/data/course/13-skid-control-and-recovery.json";
// @ts-ignore
import c14 from "../../../../lib/db/src/data/course/14-adverse-driving-conditions.json";
// @ts-ignore
import c15 from "../../../../lib/db/src/data/course/15-preventive-maintenance.json";
// @ts-ignore
import c16 from "../../../../lib/db/src/data/course/16-conditions-of-carriage.json";
// @ts-ignore
import c17 from "../../../../lib/db/src/data/course/17-hazardous-materials.json";
// @ts-ignore
import c18 from "../../../../lib/db/src/data/course/18-emergency-procedures.json";
// @ts-ignore
import c19 from "../../../../lib/db/src/data/course/19-work-planning.json";
// @ts-ignore
import c20 from "../../../../lib/db/src/data/course/20-customer-care.json";
// @ts-ignore
import c21 from "../../../../lib/db/src/data/course/21-the-examination.json";
// @ts-ignore
import c22 from "../../../../lib/db/src/data/course/22-traffic-signs.json";
// @ts-ignore
import c23 from "../../../../lib/db/src/data/course/23-model-town-illustrations.json";

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

export interface ContentBlock {
  type: string;
  text?: string;
  items?: string[];
  path?: string;
  caption?: string;
  [key: string]: unknown;
}

export interface LessonData {
  id?: string;
  slug: string;
  chapterId?: string;
  title: string;
  order: number;
  estimatedMinutes?: number;
  content: ContentBlock[];
  keyPoints: string[];
  quiz: QuizQuestion[];
}

export interface ChapterData {
  id?: string;
  slug: string;
  title: string;
  unitNumber?: number;
  order: number;
  lessons: LessonData[];
}

export const allChapterFiles: ChapterData[] = [
  c00, c01, c02, c03, c04, c05, c06, c07, c08, c09, c10, c11, c12,
  c13, c14, c15, c16, c17, c18, c19, c20, c21, c22, c23,
] as unknown as ChapterData[];
