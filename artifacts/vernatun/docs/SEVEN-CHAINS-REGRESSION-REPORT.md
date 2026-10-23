# Seven-chain isolated regression report

- Run: 2026-10-23T21:44:08.159Z
- Result: PASS
- Target: isolated database `vernatun_test`, seven random temporary schemas; production database was not used.
- External services: no live mail, payment, or banking calls; provider integrations use existing isolated test modes.
- Tests: 43 passed; 0 failed.
- QA cleanup: PASS — all seven runner-owned schemas removed and absence verified
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
