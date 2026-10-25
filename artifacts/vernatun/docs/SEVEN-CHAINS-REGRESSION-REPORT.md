# Seven-chain isolated regression report

- Run: 2026-10-25T08:01:21.886Z
- Result: PASS
- Target: isolated database `vernatun_test`; each journey receives its own random schema. CI supplies disposable PostgreSQL and configures no production credentials.
- External services: `NODE_ENV=test` selects the development outbox; this CI job does not provide mail, payment, banking, or production secrets.
- Tests: 43 passed; 0 failed; 0 chains not run.
- QA cleanup: PASS — database schemas 7/7 removed and absence verified; private files cleaned.
- Repeat from workspace root: `corepack pnpm --filter @workspace/api-server run test:seven-chains`.

| # | User journey | Result | Passed | Failed |
|---|---|---:|---:|---:|
| 1 | Приглашение пользователя | PASS | 5 | 0 |
| 2 | IAM и границы полномочий | PASS | 7 | 0 |
| 3 | Заявка жителя и выполнение работы | PASS | 8 | 0 |
| 4 | Начисление, публикация и банковская сверка | PASS | 8 | 0 |
| 5 | Дефект и работа подрядчика | PASS | 6 | 0 |
| 6 | Пропуск и охрана | PASS | 1 | 0 |
| 7 | Собрание, голосование и протокол | PASS | 8 | 0 |

## Executed coverage

- Приглашение пользователя: `server/tests/security.test.ts` (name filter: Organization onboarding links|Revoked invitation|Expired invitation); `server/tests/phase1.test.ts` (name filter: invitation).
- IAM и границы полномочий: `server/tests/assignment-management.test.ts`.
- Заявка жителя и выполнение работы: `server/tests/workflow.test.ts`; `server/tests/phase2.test.ts`.
- Начисление, публикация и банковская сверка: `server/tests/business.test.ts` (name filter: Calculation); `server/tests/phase4.test.ts`.
- Дефект и работа подрядчика: `server/tests/business.test.ts` (name filter: Defect assigned contractor); `server/tests/defect-collaboration.test.ts`.
- Пропуск и охрана: `server/tests/business.test.ts` (name filter: Pass verification).
- Собрание, голосование и протокол: `server/tests/phase6.test.ts`.

This is one ordered API/database regression run. Each journey receives fresh fixtures in its own schema, avoiding cross-test role/data contamination. It is not new browser or production acceptance.
