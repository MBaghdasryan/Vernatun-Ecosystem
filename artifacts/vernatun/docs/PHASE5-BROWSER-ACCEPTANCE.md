# Phase 5 — браузерная приёмка

7 октября 2026, Asia/Yerevan.

## Результат

**COMPLETE — целевая приёмка основных изменённых циклов Phase 5.**
Существующие страницы и API Vernatun; production, отправка писем и private bytes
не затрагивались. Это не исчерпывающая матрица всех ролей/устройств Phase 8.

## Метод и безопасность

- Существующие аккаунты platform admin, support, org-admin и accountant успешно
  вошли в приложение. Пароли не выводились и не сбрасывались.
- До взаимодействий установлен mutation guard: серверу разрешены только
  необходимые auth login/context/logout запросы. Business writes обслуживались
  заполненными in-memory synthetic fixtures, без записи текущих данных.
- Отдельные серверные гарантии проверены ранее: 106 isolated core checks и
  2 pure routing regressions. Их не подменяют и не повторяют fixtures.
- Read-only audit query с начала этой приёмки не обнаружил non-auth business events.
  Предыдущие counts/digests 17 таблиц до/после миграции и первоначальной read-only QA
  совпали. Новый after-run digest comparison не заявляется: временный baseline
  в /tmp исчез при инфраструктурном сбое.

## Подтверждённые сценарии

### Организация и маршрутизация — предыдущая приёмка

Карточка после реального входа; synthetic 409 не удаляет черновик.
Изменение статуса требует причину и подтверждение. Onboarding click/reload/direct
navigation и возврат из Overview показывают workflow, не чужой dashboard.

### Поддержка

- Staff видит public/internal messages; legacy reply показывает неизвестного
  автора, незаписанную дату и Imported, без выдуманных исторических данных.
- Synthetic Resolve/Reopen обновляют состояние; назначенный support отправляет
  внутреннюю заметку.
- Обычный неназначенный support не может отправлять сообщения, менять обращение
  или скачивать вложение.
- Customer получает только public fixture history и не имеет staff-only controls.
- Выбор разрешённого документа требует отдельного sharing acknowledgment.
  Отправленный attachment link использует case-scoped endpoint, не общий storage URL.
  Ссылка не открывалась, реальные файлы не скачивались.
- При 390×844 conversation/composer/Internal/Send доступны вертикальным скроллом.
  Viewport 390px, document/body 375px: горизонтального переполнения нет.
  Synthetic public message появился, composer очистился, Send отключился.

Evidence: `h81myn`, `r1p3zh`, `rgfrks`.

### Typed imports

- Org-admin: units/owners/residents/meters доступны; opening_balances отсутствует.
- Resident preview сохраняет явные rentMinor=0, AMD и даты; нет скрытого scaling
  или подразумеваемого бесплатного проживания. Confirm требует acknowledgment.
- Реальная accountant session содержит imports.finance/billing.publish/
  payments.reconcile, без imports.manage. В интерфейсе только opening_balances,
  нет legacy units tab.
- Invalid amountMinor=0 показывает ошибку и запрещает confirm.
- Valid preview сохраняет 12345 и -5000 в source/mapped values.
- После acknowledgment первый synthetic confirm вернул 503. За пассивное
  ожидание 1,2 секунды осталась ровно одна попытка — autoretry не было.
- Явный Retry создал вторую попытку с теми же method, path, raw body bytes,
  key и version:1. Synthetic success показал Confirmed/version 2.

Evidence: `vamrn6`, `72qibm`, `k6el4z`, `zw1e36`.

### Внедрение

A10→B20→C30, два разных synthetic исполнителя. Незавершённый prerequisite
блокирует Start/Complete; завершение A10 разрешило старт B20 и progress 1/3.
Незавершённый B20 блокировал C30. Reopen A10 требует причину и отдельный
acknowledgment зависимого B20. Cascade вернул A10/B20 в Pending, оставил C30
Pending; progress 0/3, версии A10/B20 стали 3.
Сохранены create/complete/reopen и create/start/dependent_reopen events с причиной.
При 390px доступны предупреждение, acknowledgment, Reopen и история.

Evidence: `4vmxqf`, `p4rn8i`, `u5kfvz`.

## Найденное и исправленное

После успешного Retry старый service_unavailable оставался рядом с success.
Оба success callbacks typed preview/confirm теперь очищают action error и
сбрасывают acknowledgment. Request method/path/body/key/version и retry protocol
не изменены. Frontend TypeScript и production Vite build прошли после исправления.
Проверка этого небольшого fix — inspection/typecheck/build, не новый browser pass.

Первый cascade fixture ошибочно не сбрасывал родительский A10; исправлен только
тестовый handler. Один detail GET потребовал точного fixture matcher. Это ошибки
тестовых fixtures, не приложения и не повод менять сервер.

## Инфраструктурное прерывание и оставшиеся границы

Browser worker был потерян, Web/API оказались NOT_STARTED, preview вернул 502.
Managed services восстановлены; public login/assets/session дали 200 и fresh
anonymous screenshot показал форму входа. Старый context ещё показывал failed
resource; завершающий проход в одном clean context прошёл без 502.

Не проверялись реальные private-byte downloads, production persistence/email,
полная reassignment/14-role/a11y matrix. Mobile imports preview/mapping проверены,
но confirm→503→Retry отдельно на телефоне не проходился; этот цикл подтверждён
на desktop. Sharing consent подтверждён desktop; phone conversation/send и
onboarding reopen подтверждены отдельно.

Phase 6–8 этой приёмкой не реализовывались.
