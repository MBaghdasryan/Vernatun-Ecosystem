---
name: Platform completion scope
description: Active completion requirements and how role-specific reference screenshots should be interpreted.
---

Пользователь активировал новую спецификацию доработки всей платформы: выполнять AUDIT → PRESERVE → FIX → COMPLETE → INTEGRATE → TEST → REPORT, а не только восстановление архивов и не новый prototype.

**Why:** Пользователь прямо попросил задействовать новый промпт и реализовать функции приложенных интерфейсов согласно ему.

**How to apply:** Сверяться с сохранённой активной спецификацией в документации проекта. Сохранять стек, общий backend/auth/Workflow и landing. Native/Expo, физический door controller, banking gateway, SMS/push и юридическая подпись исключены из этого этапа; внешние сервисы не симулировать.

Логотипы брать по продукту и типу пользователя согласно спецификации, даже если на приложенном role-specific референсе показан общий Vernatun.

**Why:** Пользователь отдельно уточнил, что логотипы должны соответствовать промпту и user type; изображения интерфейсов не отменяют разделение Vernatun Console/OS, HAYAT и ImTun.

**How to apply:** Не заменять оригинальные HAYAT/ImTun логотипы общим Vernatun из референсов. Использовать реальные scoped данные вместо примерных цифр/дат/графиков и статусов интеграций на изображениях.

Для выполнения активного промпта пользователь разрешил новые добавочные миграции в базе проекта: «Да, после изолированной проверки». Существующие данные и private bytes сохранять; это не разрешение на удаление, destructive restore или публикацию.

**Why:** Пользователь явно выбрал согласованное расширение схемы после изолированной проверки.

**How to apply:** В рамках этой спецификации сначала проверять новые миграции в изоляции и сохранность исходных данных, затем применять добавочные изменения. Не запрашивать повторно то же согласование для каждого поля.

После исходных Phase 0–8 пользователь активировал Product & Interface Completion: сначала аудит REFERENCE UI → FUNCTION → ROUTE → API → PERMISSION → DATA → TEST, затем интерфейсное завершение всех 14 ролей и полноценный IAM. Референсы — функциональные требования, не только визуальные примеры. Реальные email не тестировать до готовности домена.

**Why:** Новый пользовательский continuation prompt явно приоритизирует скрытые за API функции, управление пользователями, custom roles и effective access перед следующими интеграционными этапами.

**How to apply:** Сохранить 14 неизменяемых системных шаблонов; custom profiles и overrides не обходят tenant/module/subscription/ownership. До приёмки этого этапа не начинать Payments, Utility Billing, Boon, новую Platform Operations или native apps. Разделять source evidence, API tests и browser acceptance; промежуточный аудит не является DONE. Актуальные матрицы и проект IAM — ROLE-UI-PARITY.md, REFERENCE-SCREEN-GAP-REPORT.md, IAM-ARCHITECTURE.md в документации Vernatun.

Исходный аудит принят пользователем. Не повторять его без нового конфликта и не заменять реализацию очередной документацией. Следующий обязательный milestone — IAM вместе с платформенным управлением пользователями и организационным управлением сотрудниками/ролями; остальные dashboard продолжать только после него.

**Why:** Пользователь повторно уточнил «Do not postpone IAM again» и потребовал реальные изменения кода в каждой итерации.

**How to apply:** Сначала IAM foundation → Platform Admin UI → Organization Admin UI. Затем shared shell и ролевые панели в заданном промптом порядке. Для прогресса использовать COMPLETE / PARTIAL / EXTERNAL BLOCKER / INTENTIONALLY NOT ALLOWED с отдельными API, browser и negative-permission доказательствами.
