#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Vernatun uses the restored SQL schema, not the template's empty Drizzle schema.
# Development schema only; no seed or account creation on merges/startup.
NODE_ENV=development pnpm --filter @workspace/api-server run db:migrate
