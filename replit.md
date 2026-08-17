# Msafiri Kenya

A road-safety companion app for Kenyan drivers — real-time speed cameras, police checkpoints, speed zones, community hazard reports, and turn-by-turn navigation with voice guidance.

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

## Database Backup & Restore

### Nightly backup
A scheduled job runs every night at **23:00 EAT (20:00 UTC)** and:
1. Calls `pg_dump --format=custom` against `DATABASE_URL`
2. Uploads the dump to Cloudflare R2 under `db-backups/YYYY-MM-DD_HH-mm-ss.dump`
3. Sends a JSON + CSV email snapshot to `BACKUP_EMAIL_ADDRESS` (if set)
4. Prunes R2 dumps older than **30 days** automatically

Backups can also be triggered on demand from the Admin panel → Backup tab.

### Restore from a pg_dump file

1. Download the dump file from R2 (`db-backups/` prefix in the `R2_BUCKET_NAME` bucket).
2. Set your target `DATABASE_URL` in your shell environment.
3. Run:
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists \
     -d "$DATABASE_URL" path/to/backup.dump
   ```
   - `--clean` drops existing objects before recreating them (use with caution in production).
   - `--no-owner` / `--no-privileges` — skips role assignments (managed DB handles permissions).
4. Verify the restore:
   ```bash
   psql "$DATABASE_URL" -c "SELECT count(*) FROM community_reports;"
   ```

### Required environment variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (set automatically by Replit) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | R2 bucket name |
| `BACKUP_EMAIL_ADDRESS` | (optional) Email address to receive nightly backup emails |

---

## Gotchas

- **Mobile Expo packages — always use `expo install`, never `pnpm add`.**
  Running `pnpm add expo-task-manager` (or any `expo-*` / `react-native-*` package) installs the latest npm version, which is almost always wrong for the pinned SDK. `npx expo install <pkg>` consults the SDK's known-good version registry and pins the correct one. Wrong versions cause a native SIGABRT crash on launch in TestFlight builds (while still passing Expo Go). After adding any new Expo package, run `pnpm --filter @workspace/mobile run check-expo-versions` to confirm everything is compatible. This check also runs automatically as `prebuildCommand` on every EAS build profile and will abort the build if any package is on the wrong version.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
