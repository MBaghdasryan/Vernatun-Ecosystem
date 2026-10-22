# Vernatun — продолжение Phase 8

Дата проверки: **22 октября 2026 года**.

**Статус: PARTIAL. Phase 8 и весь мастер-промпт не объявлены завершёнными.**
Этот документ обновляет сведения из отчётов от 7 октября. Platform Operations
Center и отдельный Payments & Utility Billing в этом продолжении не расширялись.

## Что исправлено

### Календарные даты

- Обслуживание: вычисление сегодняшнего дня и отметки просроченности больше не
  переключается по UTC вместо календаря, показываемого пользователю.
- Собственность: начальная дата периода и сравнение действующих периодов используют
  тот же календарь.
- Email Console: начальный диапазон фильтра дат совпадает с календарём отображения.
- Календарь визитов использует общую функцию вместо отдельного ручного смещения.
- Общая функция принимает явный IANA timezone, по умолчанию `Asia/Yerevan`.
  Неверная дата/зона вызывает ошибку, а не молчаливое переключение.

**Граница:** это исправление конкретных UTC-defaults. Выбор timezone из профиля
пользователя/организации во всех интерфейсах ещё не реализован этим изменением.
MFA activation, явно обозначенная как UTC, не менялась.

### Точность OpenAPI inventory

Прежняя регулярная строковая проверка могла учитывать выражение
`router.get('/' + resource, ...)` как ложную операцию `GET /`.

Новый анализ использует TypeScript AST:

- связывает импортированный router с конкретным исходным модулем и mount prefix;
- поддерживает aliases, строковые литералы, шаблоны и циклы по литеральным спискам;
- не принимает комментарии/содержимое строк за регистрацию маршрута;
- сохраняет несколько исходников для дублирующих регистраций;
- показывает неразрешённые выражения отдельно вместо придумывания endpoint.

Текущий результат: **246 уникальных статически найденных операций,
134 сопоставлены с canonical OpenAPI, 112 отсутствуют; неразрешённых выражений
в поддерживаемых регистрациях — 0**.

Это уточнение инструмента подсчёта, не увеличение числа ошибок приложения.
Сопоставление method/path **не доказывает** правильность request/response schemas,
авторизации, middleware и динамически подключаемых внешних маршрутов.
111 контрактов не были заменены заглушками и остаются незавершённой работой.

#### Первый закрытый OpenAPI пробел: health check

- Добавлен canonical `GET /health` (`getApiHealth`) с точной успешной формой:
  `status: "ok"` и положительный `stage`; `503` описан для ошибки проверки БД.
- Сгенерированы client/Zod контракты штатным Orval codegen.
- Проверено непосредственно на работающем API: `GET /api/health` отвечает
  HTTP 200 и `{"status":"ok","stage":1}`.
- Инвентаризация после изменения: **246 найденных, 135 документированных,
  111 ещё без контракта; 0 неразрешённых**. Это один реальный закрытый пробел,
  не завершение OpenAPI части.

### Восстановление рабочей среды

- Post-merge script использует Corepack для запуска закреплённой версии pnpm.
- Устранено исчерпание потоков среды из-за повторных процессов переключения
  глобального pnpm; ошибки запуска Node/esbuild не выдаются за TypeScript-ошибки.
- Повторный post-merge setup завершился успешно: frozen install, development
  migrations и проверка private-file migration. Источники файлов не удалялись.
- Основной Web и API запущены; публичная главная страница и мобильная форма входа
  визуально проверены после восстановления.
- После последующих слияний устранён повторный источник исчерпания ресурсов:
  команды validation workflows, Canvas и slides теперь тоже используют Corepack.
  Финальный post-merge setup с reconciliation прошёл за 5,3 секунды при прежнем
  лимите 180 секунд; версия pnpm и правила зависимостей не менялись.

## Подтверждённые проверки

| Проверка | Результат |
|---|---|
| API-codegen и TypeScript generated libs | PASS |
| API server, ImTun mobile, slides и scripts typecheck | PASS |
| Full workspace typecheck | **BLOCKED**: Vernatun и HAYAT имеют `TS2322`; независимые от этой правки ошибки refs/submit handlers в Vernatun/Canvas и nullable `MobileAuthSession.user` в HAYAT |
| Frozen workspace install по существующему lockfile | PASS; версии/lockfile не менялись |
| OpenAPI inventory и runtime `GET /api/health` | **135/246 documented**, 111 gaps; HTTP 200 с ожидаемым телом |
| Phase 8 API: leads, paging/scope, 14 dashboards, MFA rollout/recovery | **6/6 PASS**, отдельная тестовая схема |
| Delivery/invitations после объединения исправления audit-immutability | **36/36 PASS**: 8 adapters + 16 webhook/evidence + 12 access/invitation/audit |
| Новые тесты календарной даты + существующие тесты календаря визитов | **5/5 PASS** |
| Новые тесты AST inventory | **3/3 PASS** |
| API production bundle | PASS |
| Vernatun Web production bundle с `PORT=5000 BASE_PATH=/` | PASS; Portal chunk >500 kB |
| Mockup и slides production bundles с теми же build-параметрами | PASS; slides chunk >500 kB |
| Post-merge setup + reconciliation | PASS |
| Public landing 1440 px / login 390 px | Видимые экраны загружаются |
| Browser: login → settings → TOTP setup → enable → refresh MFA status | PASS на отдельной тестовой схеме |
| Browser: MFA policy save/enforcement, record tables | **Не завершено** |
| Полная authenticated matrix 14 ролей и A–H | **Не завершено** |

### Ограничения общего build

`corepack pnpm run build` прошёл встроенный полный typecheck, но остановился:
Vite-конфигурация mockup требует `PORT`. Повторный запуск build-стадии с явными
`PORT=5000 BASE_PATH=/` собрал API/Web/mockup/slides, но общий результат остался
**FAIL**: ImTun Expo build запросил занятой Metro port 8081 и завершился по timeout.
Успех отдельных web-сборок не подменяет успешную общую сборку.

### Границы browser evidence

Использовались настоящий API и изолированная схема `vernatun_test`, с тестовым
перенаправлением транспорта; это не production smoke test. Первые попытки
транспортного harness были неуспешны и не считаются дефектом приложения.
После исправления harness enrollment MFA прошёл. В выбранном контексте
организационного администратора управление обязательной политикой было недоступно;
проверка сохранения политики и последующие таблицы не завершились.

Обязательная MFA основной базы не активировалась. Тестовый сервер остановлен,
его случайно созданная схема удалена runner-ом. Письма не отправлялись.

## Быстрый пересмотр Phase 8 — 22 октября 2026 года

Этот пересмотр проверяет статус предыдущего списка, но не заменяет полную
роль-устройство и production-приёмку.

| Пункт | Текущий результат |
|---|---|
| Phase 8 API suite | **PASS: 6/6**, запущена 22 октября в изолированном тестовом окружении |
| API server production bundle | **PASS** |
| Vernatun Web production bundle | **PASS** с `PORT=5000 BASE_PATH=/`; остаётся предупреждение о Portal chunk >500 kB |
| Local API health | **PASS: HTTP 200** на `GET /api/health`; production endpoint этим не проверялся |
| OpenAPI static inventory | **PARTIAL: 246 операций, 135 documented, 111 gaps, 0 unresolved** |
| Полный workspace typecheck | **FAIL**: `TS2322` в HAYAT mobile, Vernatun и Mockup; см. ниже |
| Security scan | **BLOCKED**: после совместимых обновлений остаются 3 high и 1 moderate dependency findings; SAST вернул 2 high alerts в ImTun static server; HoundDog — 0 findings |
| Сквозные A–H / 14 ролей × viewport / MFA browser policy | **НЕ ЗАВЕРШЕНО**: эти прогоны не были частью данного короткого пересмотра |
| Production acceptance | **НЕ ВЫПОЛНЕНА**; production-база, DNS и реальные письма не затрагивались |

Свежие TypeScript-ошибки:

- HAYAT mobile: nullable `MobileAuthSession.user` не сужен перед передачей в
  компонент.
- Vernatun: типы polymorphic button-group `onSubmit` и несовпадающие версии
  React ref types в календаре.
- Mockup sandbox: несовпадающие React ref types в календаре и spinner.
- Отдельные API server, ImTun mobile и Vernatun Web production builds прошли
  (для Vernatun Web — с указанными build-параметрами); общий `pnpm run build`
  не прошёл, поскольку он останавливается на workspace typecheck.

Первичный dependency audit дал 7 high / 4 moderate / 2 low. Исправлены
совместимые версии `markdown-it` → `14.3.3`, `prosemirror-view` → `1.42.3`,
совместимый `prosemirror-model` выровнен на `1.25.12`, Vite обновлён
`7.3.6` → `7.3.7`. После них повторный audit показывает **3 high /
1 moderate / 0 low**: `braces@3.0.3`, `node-forge@1.4.0`, `uuid@7.0.3`
и `decode-uri-component@0.2.2`. Для `braces` и `node-forge` сканер не
предложил исправленную версию; перевод `uuid` на указанную версию исправления
требует major-перехода. Это отчёт scanner по workspace-графу, а не
подтверждение достижимости каждой проблемы через production endpoint.

После обновлений прошли frozen install, typecheck и build коммерческой
презентации, production build Vernatun Web и API. Большой JS chunk презентации
и portal bundle остаются предупреждениями по размеру.

SAST alerts указывают на конструирование путей в ImTun static server. При
поверхностной проверке ветка manifest ограничивает платформы значениями
`ios`/`android`, а static path проходит нормализацию и containment check;
эксплуатация этих сигналов не доказана, поэтому они остаются на ручной проверке,
а не объявляются ни подтверждёнными уязвимостями, ни закрытыми false positive.

## Что остаётся для закрытия Phase 8

1. Описать и проверить **111 OpenAPI gaps**, точные schemas и served legacy contract,
   затем выполнить codegen и проверку совместимости клиентов.
2. Закрыть server paging/search остальных растущих operational, financial и
   document lists и больших справочников.
3. Завершить передачу timezone организации/пользователя и аудит hy/ru/en
   во всех business-date формах. Три исправленных default не закрывают весь аудит.
4. Принять MFA policy save/enforcement в полном разрешённом контексте,
   record-table search/sort/paging, keyboard/dialog/focus/contrast и responsive matrix.
5. Выполнить последовательные browser journeys A–H: заявка → закрытие;
   phone intake/SLA; maintenance → history; billing → bank → resident;
   onboarding/invite; support expiry; delegation revoke; voting → protocol.
6. Устранить конфликт Metro при общей mobile-сборке и подтвердить чистый общий build.
7. Актуализировать security/dependency/performance проверки. Исторические результаты
   scans от 7 октября не считаются новым сканированием.
8. Пройти production checklist: schema/backup + private bytes/storage,
   scheduler, credentials/CORS/session, мониторинг и production smoke acceptance.
   DNS и production-база этим продолжением не изменялись.
9. Live email/invite/reset — только после готовности домена и явного разрешения
    пользователя. Отправка тестового письма не выполнялась.

**Следующий незакрытый технический блок:** реальные OpenAPI-контракты и
масштабируемые списки. Этот отчёт не является основанием считать всю Phase 8 DONE.
