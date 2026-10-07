# Vernatun — ход реализации IAM

Дата: 2026-10-07. Реализация IAM завершена в описанных ниже границах.
Общий статус IAM milestone: **COMPLETE** в описанных границах. Целевая браузерная приёмка пройдена на изолированных данных.
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

COMPLETE в After означает выполненную реализацию функции. Browser отражает целевой
прогон ниже, а не перебор всех сочетаний разрешений и всех бизнес-процессов платформы.

| Reference function | Before | After | API | Browser | Negative permission |
|---|---|---|---|---|---|
| Platform user directory / user card | PARTIAL | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| Account lock/reactivate | PARTIAL | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| MFA state / sessions / force logout | PARTIAL | COMPLETE | COMPLETE | COMPLETE — card + force logout | COMPLETE |
| Organization employee card | PARTIAL | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| Role / building / unit / dates editor | PARTIAL | COMPLETE | COMPLETE | COMPLETE — scope save/reload | COMPLETE |
| Custom role profiles | PARTIAL | COMPLETE | COMPLETE | COMPLETE — create/edit/reopen | COMPLETE |
| Immutable system roles / permission matrix | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| Assignment deny / audited exceptional grants | PARTIAL | COMPLETE | COMPLETE | COMPLETE — deny save/reopen; grants API-tested | COMPLETE |
| Suspend / resume / revoke staff assignment | PARTIAL | COMPLETE | COMPLETE | COMPLETE — suspend/resume; revoke API-tested | COMPLETE |
| Assignment history | PARTIAL | COMPLETE | COMPLETE | Сохранение событий подтверждено API после UI-действий | Серверные scope guards; не отдельный browser case |
| Shared permission / module / subscription explanation | PARTIAL | COMPLETE | COMPLETE | COMPLETE — displayed permission rows | COMPLETE |
| Object-aware effective access debugger — чтение помещения | PARTIAL | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| Platform staff assignment scope editor | PARTIAL | COMPLETE | COMPLETE | COMPLETE — scope retained after reload | COMPLETE |
| Platform IAM → tenant business data | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | Проверено API, не отдельным browser case | COMPLETE |
| Editing system role definitions | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | COMPLETE — readonly matrix | COMPLETE |
| Generic modification of own / protected lifecycle assignments | INTENTIONALLY NOT ALLOWED | INTENTIONALLY NOT ALLOWED | COMPLETE | COMPLETE — own dangerous actions hidden | COMPLETE |

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

Первый браузерный прогон подтвердил вход и загрузку обзора, затем выявил неверную маршрутизацию
из меню на /console/users (старый Records запрашивал /api/users). Исправлено: внешний
dispatcher подписан на pushState/replaceState/popstate. Сборка и TypeScript после исправления прошли.
Исправленный переход, новые IAM формы и указанные ширины затем проверены финальным
браузерным прогоном ниже. Снимок страницы входа и API tests не использовались вместо него.

## Финальная браузерная приёмка — COMPLETE

Предыдущие блокировки выше — история проверки, не текущий статус. Финальный прогон
прошёл через локальный потоковый proxy к изолированной API-схеме, без перехвата
запросов браузерным драйвером. Прямой API-вход работал; прежний перехват давал HTTP 400.
Изменять рабочую авторизацию для обхода этой тестовой ошибки не потребовалось.

- Переход из платформенного меню в /console/users, поиск и карточка сотрудника работают.
- Scope помещения сохранён, повторное открытие и полная перезагрузка сохранили выбор.
- Org admin изменил scope здания; создал и отредактировал профиль Manager, изменения сохранились.
- Персональный deny requests.read сохранился после повторного открытия.
- Отдельный API-read после browser run подтвердил сохранение причины deny. Пустое поле
  причины в форме относится к НОВОМУ изменению; прежняя причина не потеряна.
- Приостановка и возобновление назначения прошли. Конечное состояние — active.
- Отзыв всех сессий показал пустой список на карточке; отдельный браузер сотрудника
  после reload показал вход вместо рабочего экрана.
- Lock/reactivate через UI прошли; итоговый статус тестового аккаунта — active.
- Собственные опасные действия платформенного администратора скрыты.
- Чужой пользователь не находится в каталоге org admin.
- Системная матрица разрешений read-only.
- Debugger отобразил отказ GET /units/:id для technician и разрешённые рабочие права.
  Это ожидаемо: у technician нет properties.read/properties.own; scope сам по себе
  не выдаёт эти разрешения. Положительный manager-case проверен API-тестами.
- На 360/390/768/1024/1440 px нет горизонтального переполнения документа, модальное
  окно помещается в экран. На узких экранах таблица прокручивается внутри своего контейнера.
- Кнопка закрытия модального окна доступна с клавиатуры и имеет доступное имя.
- Неблокирующее предупреждение React о ключах элементов исправлено; TypeScript прошёл.

При отзыве сессии исходный защищённый URL может оставаться в адресной строке, но вместо
данных отображается форма входа — это не сохранение доступа.

## Что не заявляется этим закрытием

- Новая реальная отправка приглашений не проверялась и не запускалась. В тесте список
  приглашений был пуст: существующие ссылки нельзя было проверить; отправка при пустой форме disabled.
- Отдельные browser cases для выдачи временного grant, terminal revoke и назначения
  готового профиля не выполнялись; соответствующие серверные операции проверены API.
- Это целевая IAM-приёмка, не полный аудит WCAG и не общеплатформенная регрессия
  семи бизнес-сценариев и всех 14 ролей. Эти работы остаются отдельным этапом.

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
