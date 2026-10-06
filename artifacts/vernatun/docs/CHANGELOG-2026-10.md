# Vernatun — октябрь 2026

## 6 октября — старт выполнения новой платформенной спецификации

### Changed
- Активная спецификация сохранена отдельно от исторических восстановительных документов.
- Scoped support start route учитывает реальные permissions/modules.
- Invitation list/revoke использует платформенную и организационную policy без выдачи лишних прав.

### Added
- Structured audit details в существующем Console UI.
- Разрешение импорта в существующей форме временного доступа поддержки.
- Изолированные Phase 1 regression tests и отдельные core/phase1 test modes.
- `VERNATUN-AUDIT.md`: карта всех блоков и честный статус неполных функций.

### Fixed
- Платформенный список приглашений ранее ошибочно требовал `people.invite`.
- Audit Console ранее исключал tenant-associated administrative events.
- Временный support context стартовал по названию роли, а не доступным действиям.

### Security
- Tenant isolation и expiry/revocation остаются server-enforced.
- Отзыв приглашения и audit event выполняются атомарно.
- Новые глобальные permissions не выдавались; audit JSON отображается как текст, не HTML.

### Migration
- Новых миграций основной базы и основного seed в этом блоке нет.
- Изолированные tests используют текущие migrations и случайную test schema.

### Tests
- После изменений: core API 44/44, frontend/backend TypeScript, Vite build — passed.
- Начальный full run остановлен по внешнему лимиту времени на storage suite; не считается полностью passing.
- Browser QA Console invitations/audit на desktop1440/mobile390 прошёл; scope и ограничения подробно отмечены в `VERNATUN-AUDIT.md`.

Остальные фазы спецификации пока не выполнены.
