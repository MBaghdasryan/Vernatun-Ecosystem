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

Этот пересмотр обновляет технические проверки. Он не заменяет полную
роль-устройство и production-приёмку.

| Пункт | Текущий результат |
|---|---|
| Phase 8 API suite | **PASS: 6/6**, запущена 22 октября в изолированном тестовом окружении |
| Полный workspace typecheck | **PASS**: HAYAT, ImTun, Vernatun, Mockup, API, slides и scripts |
| Полный workspace build | **PASS** с `PORT=5000 BASE_PATH=/`; API, Vernatun, Mockup, slides и ImTun production static bundles собраны |
| Production API health | **PASS: HTTP 200**, `GET https://api.vernatun.io/api/health`, `{"status":"ok","stage":1}`; это только health smoke, не авторизационная приёмка |
| ImTun static server | **PASS**: landing, Android manifest и bundle — HTTP 200; encoded traversal не открыл файл (HTTP 404) |
| OpenAPI static inventory | **PARTIAL: 246 операций, 135 documented, 111 gaps, 0 unresolved** |
| Dependency / SAST / HoundDog | **PARTIAL**: 2 high + 1 moderate dependency findings; SAST 0; HoundDog 0 |
| Browser MFA / полная 14-role matrix / A–H | **НЕ ЗАВЕРШЕНО**: backend Phase 8 tests прошли, но это не подтверждает браузерную и сквозную приёмку |
| Production acceptance | **НЕ ЗАВЕРШЕНА**: production health проверен; вход, сессии, полный workflow, private storage, backup/restore и scheduler не принимались |

Исправления для общего typecheck/build:

- HAYAT теперь передаёт экрану очереди только сессию с подтверждённым
  `user`, сохраняя прежнее поведение авторизации.
- Vernatun `ButtonGroupText` разделяет нативные `div` props и Radix `Slot`
  props вместо несовместимого объединения типов.
- React type packages выровнены на совместимую версию; календарь и spinner
  больше не конфликтуют из-за разных React ref types.
- Vite-плагины Mockup используют один совместимый peer context; общий typecheck
  и build проходят.
- Сборщик ImTun использует отдельный configurable Metro-порт (`8082` по
  умолчанию), чтобы не перехватывать занятый порт предпросмотра `8081`.
- ImTun static server создаёт allowlist файлов при старте, отдаёт только
  проиндексированные статические bytes и не строит путь чтения файла из URL.

Свежий audit после обновлений: **2 high / 1 moderate / 0 low / 0 critical**.
`uuid@7.0.3` заменён на `11.1.1` для Expo `xcode`; проверены CommonJS `v4()`
и рабочая замена. Остались `braces@3.0.3` и `node-forge@1.4.0` (реестр
пока не предлагает исправленные версии), а также `decode-uri-component@0.2.2`.
Для последнего исправление `0.5.0` есть, но это ESM-only пакет, тогда как
текущий `query-string@7` загружает его через CommonJS `require`; форсированное
переопределение нарушило бы Expo tooling. Эти findings нельзя объявить
устранёнными без совместимого обновления родителей.

Общий build успешен; остались предупреждения о JS chunks свыше 500 kB в
Vernatun и коммерческой презентации. В сборке Expo также был диагностический
лог об отсутствующей системной библиотеке для React Native DevTools, но
production bundles обеих платформ ImTun собраны.

## Что остаётся для закрытия Phase 8

1. Описать и проверить **111 OpenAPI gaps** реальными schemas, permissions и
   legacy response shapes, затем выполнить codegen и проверить клиентов.
2. Закрыть server paging/search/sort для оставшихся operational, financial,
   document lists и больших справочников.
3. Завершить hy/ru/en и locale/timezone audit для organization/user business
   dates, а также проверить поведение при переходе летнего времени.
4. Принять MFA policy save/enforcement в полном разрешённом контексте и
   browser-acceptance для MFA, поиска/сортировки/пагинации, клавиатуры,
   диалогов/focus/contrast и responsive matrix.
5. Завершить browser acceptance 14 ролей по релевантным маршрутам и viewport;
   автоматические role-card tests не заменяют проверку UI и запретных действий.
6. Пройти сквозные journeys A–H: resident request→closure; phone intake/SLA;
   maintenance→history; billing→bank→resident; onboarding/invite; support expiry;
   delegation revoke; voting→protocol.
7. Закрыть оставшиеся dependency findings после выхода совместимых upstream
   исправлений либо безопасного обновления Expo/Metro родителей.
8. Пройти полный production checklist: auth/session/CORS, схемы и matched
   backups, private bytes/storage, scheduler, monitoring, error recovery и
   ролевые smoke tests. Health endpoint сам по себе не является приёмкой.
9. Live email/invite/reset — только после готовности домена и отдельного
   разрешения пользователя. Тестовые письма в этой проверке не отправлялись.

**Итог:** конкретные typecheck/build и ImTun path-handling блокеры закрыты,
одна dependency уязвимость устранена; Phase 8 остаётся **PARTIAL**, а не DONE.
