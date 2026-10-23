# Seven-chain isolated regression report

- Run: 2026-10-23T21:17:36.691Z
- Result: FAIL
- Target: isolated database `vernatun_test`, random schema `qa_f8be5c39fa2e49f3a433`; production database was not used.
- External services: no live mail, payment, or banking calls; provider integrations use existing isolated test modes.
- Tests: 56 passed; 21 failed.
- QA cleanup: PASS — runner-owned schema removed and absence verified

| # | User journey | Result | Passed | Failed |
|---|---|---:|---:|---:|
| 1 | Приглашение пользователя | PASS | 12 | 0 |
| 2 | IAM и границы полномочий | PASS | 7 | 0 |
| 3 | Заявка жителя и выполнение работы | FAIL | 0 | 18 |
| 4 | Начисление, публикация и банковская сверка | PASS | 13 | 0 |
| 5 | Дефект и работа подрядчика | FAIL | 10 | 3 |
| 6 | Пропуск и охрана | PASS | 6 | 0 |
| 7 | Собрание, голосование и протокол | PASS | 8 | 0 |

This is a single ordered API/database regression run. It is not a new live external-service test or production acceptance.
