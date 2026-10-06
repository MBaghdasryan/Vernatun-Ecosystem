# Vernatun

Property-management platform restored from the supplied source archive, with
Console, OS, HAYAT and ImTun portals over one permission-scoped API.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/api-server run db:migrate` — restored SQL migrations (development only)
- `pnpm --filter @workspace/api-server run test:api` — original integration tests in an isolated test database
- Required env: `DATABASE_URL`, `SESSION_SECRET`; production also requires HTTPS `APP_ORIGIN`.

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

Do not push the template's empty Drizzle schema to the restored SQL database.
Do not seed users on startup or merge. Local demo credentials are gitignored at
`artifacts/api-server/.local/demo-accounts.md`; do not expose or log them.
See `artifacts/api-server/RESTORATION.md` for operation and production boundaries.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
