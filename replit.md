# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Mobile Expo packages — always use `expo install`, never `pnpm add`.**
  Running `pnpm add expo-task-manager` (or any `expo-*` / `react-native-*` package) installs the latest npm version, which is almost always wrong for the pinned SDK. `npx expo install <pkg>` consults the SDK's known-good version registry and pins the correct one. Wrong versions cause a native SIGABRT crash on launch in TestFlight builds (while still passing Expo Go). After adding any new Expo package, run `pnpm --filter @workspace/mobile run check-expo-versions` to confirm everything is compatible. This check also runs automatically as `prebuildCommand` on every EAS build profile and will abort the build if any package is on the wrong version.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
