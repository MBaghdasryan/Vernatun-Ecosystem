# Vernatun — ход реализации IAM

Дата: 2026-10-07. Реализация IAM завершена в описанных ниже границах.
Общий статус приёмки milestone: **PARTIAL** — браузерная приёмка **EXTERNAL BLOCKER**.
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

COMPLETE в After означает выполненную реализацию функции, а не завершённую браузерную
приёмку. API/negative отражают серверные проверки; Browser остаётся EXTERNAL BLOCKER.

| Reference function | Before | After | API | Browser | Negative permission |
|---|---|---|---|---|---|
| Platform user directory / user card | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Account disable/reactivate | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| MFA state / sessions / force logout | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Organization employee card | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Role / building / unit / dates editor | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Custom role profiles | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Immutable system roles / permission matrix | COMPLETE | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Assignment deny / audited exceptional grants | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Suspend / resume / revoke staff assignment | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Assignment history | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | PARTIAL |
| Shared permission / module / subscription explanation | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Object-aware effective access debugger — чтение помещения | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Platform staff assignment scope editor | PARTIAL | COMPLETE | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Platform IAM → tenant business data | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Editing system role definitions | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | EXTERNAL BLOCKER | COMPLETE |
| Generic modification of own / protected lifecycle assignments | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | EXTERNAL BLOCKER | COMPLETE |

## Проверки

- Frontend TypeScript и backend TypeScript прошли.
- OpenAPI codegen и проверки общих библиотек прошли.
- Vite production build прошёл; остаётся предупреждение о размере Portal chunk.
- Изолированный переход схемы 023 → 024: старые поля и количество записей в 13 таблицах сохранены.
- Та же проверка выполнена при применении development migration; контрольные суммы совпали.
- Семь групп API integration tests прошли и проверяют:
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
  - платформенное редактирование staff role/building/unit/dates без tenant business access;
  - совпадение debugger и GET /units/:id для доступного и чужого помещения;
  - отказ при выключенном модуле, read-only подписке и обязательной MFA;
  - сохранение второго контекста при приостановке одного назначения;
  - отзыв конкретной сессии по необратимому административному идентификатору;
  - защиту последнего org admin при приостановке из платформенного интерфейса.

Браузерный прогон подтвердил вход и загрузку обзора, затем выявил неверную маршрутизацию
из меню на /console/users (старый Records запрашивал /api/users). Исправлено: внешний
dispatcher подписан на pushState/replaceState/popstate. Сборка и TypeScript после исправления прошли.
Продолжение этого же тестового прогона прервано авторизацией платформы из-за лимита кредитов.
Нет подтверждённой браузерной приёмки исправленного перехода, новых IAM форм или всех ширин.
Снимок страницы входа, сборка и API tests не подменяют эту проверку.

## Что ещё нужно для завершения milestone

1. Пройти targeted browser acceptance реестра, карточек, сохранения после reload,
   профилей, deny/grants, статусов и сессий; исправить обнаруженные UI проблемы.
2. Подтвердить accessibility и ширины 360/390/768/1024/1440 в браузере.
   У вложенных диалогов теперь уникальные aria-labelledby, собственные опасные действия скрыты.
3. Полная регрессионная приёмка семи бизнес-сценариев и всех 14 ролей остаётся отдельным
   общеплатформенным этапом, не выполненным этим целевым IAM-прогоном.

Функциональные доработки platform scope editor и object-aware debugger выполнены, не отложены.
Debugger показывает общий permission/module/subscription результат и точный IAM-результат
для GET /units/:id, включая lifecycle и MFA. Он намеренно не выполняет и не обещает симуляцию
переходов произвольных финансовых/ремонтных workflow. Platform/support/resident lifecycle
не редактируются обходным универсальным назначением. Org-admin status поддерживается
с защитой себя и последнего администратора; profile overrides для org_admin запрещены.

Новых миграций в этой итерации не добавлялось. Повторный тест перехода 023 → 024 на
изолированных данных подтвердил сохранение 13 проверяемых таблиц. QA sandbox корректно
остановлен, его схема удалена штатным runner.

Production не публиковался. Payments, banks, SMS, Boon, cameras, telephony, AI, native apps
не подключались. Изменения основной базы — только согласованное добавочное расширение;
business rows не удалялись и seed/reset на основной базе не выполнялся.
