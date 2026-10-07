# Vernatun — ход реализации IAM

Дата: 2026-10-07. Общий статус milestone: **PARTIAL**.
Исходный аудит принят и не повторялся. Остальные role dashboards не начинались.

## Изменения кода

- `/console/users`: реестр с поиском и страницами по 50 записей, карточка пользователя,
  аккаунт active/locked/disabled, MFA state, назначения, сессии, force logout, история.
- `/console/roles`, `/console/permissions`: неизменяемая матрица 14 системных ролей,
  каталог существующих разрешений, глобальные tenant-allowed профили.
- `/os/people`: сотрудники, карточка, role/scope/date editor, ограничения и объяснение доступа.
- `/os/roles`: создание/редактирование собственных профилей организации.
- Приглашения остаются в существующем `/os/invitations` / `/console/invitations`,
  ссылки доступны из IAM. Реальные письма не отправлялись.
- Профили ограничены разрешениями базовой роли. Новые permission keys не создавались.
- Исключительные grants выдаёт только platform admin: только разрешённые read-права
  базовой роли, с причиной и сроком. Они не обходят deny, tenant, модули или подписку.
- Account disable/lock и force logout удаляют соответствующие сессии.
- Assignment suspend не блокирует другие назначения пользователя; revoke терминален
  для нового status editor.
- При изменении базового типа назначения сначала требуется явно снять профиль/ограничения.
- Запреты имеют приоритет над временными исключениями; tenant admin может менять deny,
  не продлевая и не изменяя платформенный grant.

## Матрица прогресса

COMPLETE в API/negative-колонке означает пройденную проверку указанного поведения,
а не завершённую приёмку всей роли. Browser остаётся EXTERNAL BLOCKER.

| Reference function | Before | After | API | Browser | Negative permission |
|---|---|---|---|---|---|
| Platform user directory / user card | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Account disable/reactivate | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| MFA state / sessions / force logout | PARTIAL | PARTIAL | PARTIAL | EXTERNAL BLOCKER | COMPLETE |
| Organization employee card | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Role / building / unit / dates editor | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Custom role profiles | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Immutable system roles / permission matrix | COMPLETE | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Assignment deny / audited exceptional grants | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Suspend / resume / revoke staff assignment | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Assignment history | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | PARTIAL |
| Shared permission / module / subscription explanation | PARTIAL | PARTIAL | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Object-aware effective access debugger | PARTIAL | PARTIAL | PARTIAL | EXTERNAL BLOCKER | PARTIAL |
| Full platform assignment scope editor | PARTIAL | PARTIAL | PARTIAL | EXTERNAL BLOCKER | PARTIAL |
| Platform IAM → tenant business data | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Editing system role definitions | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Generic modification of own / protected lifecycle assignments | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | EXTERNAL BLOCKER | COMPLETE |

## Проверки

- Frontend TypeScript и backend TypeScript прошли.
- OpenAPI codegen и проверки общих библиотек прошли.
- Vite production build прошёл; остаётся предупреждение о размере Portal chunk.
- Изолированный переход схемы 023 → 024: старые поля и количество записей в 13 таблицах сохранены.
- Та же проверка выполнена при применении development migration; контрольные суммы совпали.
- Пять групп API integration tests проверяют:
  - чужую организацию, scope и редактирование самого себя;
  - несовместимые роли, чужие здания, неверные даты/scope;
  - конкурентные редакторы и аудит before/after;
  - последний действующий бессрочный organization admin;
  - немедленное изменение разрешений и отзыв контекста;
  - custom profile с недопустимым permission;
  - чужой profile, deny приоритетнее grant, сохранение платформенного grant при tenant deny;
  - приостановку/возобновление назначения;
  - disable/reactivate аккаунта и удаление его сессий;
  - запрет org admin на platform logout;
  - запрет platform IAM на invoices;
  - сохранение ровно 14 стандартных ролей.

Тестовый агент браузера не завершил работу: запуск был остановлен авторизацией платформы
из-за лимита кредитов. Нет подтверждённой браузерной приёмки новых IAM экранов или всех ширин.
Снимок страницы входа, сборка и API tests не подменяют эту проверку.

## Что ещё нужно для завершения milestone

1. Пройти targeted browser acceptance реестра, карточек, сохранения после reload,
   профилей, deny/grants, статусов и сессий; исправить обнаруженные UI проблемы.
2. Довести object-aware debugger: сейчас результат ограничен permission/module/subscription,
   а не моделирует все resource ownership/workflow/MFA условия произвольного endpoint.
3. Полностью согласовать платформенное редактирование назначений и специальные
   protected-role/lifecycle сценарии; не расширять generic editor обходом старых правил.
4. Проверить совместимость новых политик с семью сквозными сценариями, accessibility
   и ширинами 360/390/768/1024/1440. До этого IAM не объявлять COMPLETE.

Production не публиковался. Payments, banks, SMS, Boon, cameras, telephony, AI, native apps
не подключались. Изменения основной базы — только согласованное добавочное расширение;
business rows не удалялись и seed/reset на основной базе не выполнялся.
