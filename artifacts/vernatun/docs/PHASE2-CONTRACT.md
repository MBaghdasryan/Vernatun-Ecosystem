# Phase 2 — existing workflow extensions

All URLs are relative to the existing `/api` client prefix. Use existing `request`/`uploadPhoto` and product shell; do not redesign/duplicate Workflow. All mutations retain fresh server authorization, context, subscription/module policy and version/idempotency validation.

## Configuration / phone form

- GET `/operations/categories` → category rows `{id,key,name,active,version}`.
- POST `/operations/categories` → `{key,name}` creates; PATCH `/operations/categories/:id` `{version,name,active}`.
- GET `/operations/sla-policies` → rows `{id,category_id,priority,response_minutes,assignment_minutes,arrival_minutes,resolution_minutes,pause_resolution,version}`.
- POST `/operations/sla-policies` → `{categoryId:null|UUID,priority,responseMinutes,assignmentMinutes,arrivalMinutes,resolutionMinutes,pauseResolution}` upsert with `version` required when existing.
- GET `/operations/setup?buildingId=&unitId=` → `{buildings,units,residents,technicians}`; selected unit mandatory before residents/technicians. Dispatcher/manager requests.assign only. Each name/id scoped to context.
- Existing POST `/requests` accepts legacy `{unitId,subject,description}`. Enhanced fields `{key:UUID,categoryId,priority:low|normal|high|urgent|emergency,reportedForUserId?:UUID,contactMethod:app|phone|email|none,preferredVisitStart?:ISO,preferredVisitEnd?:ISO,technicianId?:UUID,assetId?:UUID}`. Phone source derived server-side, never user-supplied. Staff requires category/key; selected resident optional (unit-only fallback). Optional technician assigned atomically. Response request row, 201, replay same result.
- Existing GET `/requests` stays array for compatibility; enriched row includes source/category_id/priority/contact_method/reported_for_user_id/asset_id, accepted_at/paused_at/blocked_reason/due_at/overdue. Existing GET `/requests/:id` additionally includes `{sla:[kind,due_at,satisfied_at,overdue],visits:[],visitHistory:[],materials:[],category_name}` and photos include photo_type. Update queue sorting/filter controls to use five priorities and backend SLA, not UI-derived deadlines.

## Actions / scheduling / evidence

- Existing POST `/requests/:id/transition` adds `accept`, `cannot_perform`, `pause`, `resume` to existing actions, `{key,version,action,note,reason}`. Cannot-perform reason one of resident_unavailable/no_access/missing_material/requires_specialist/unsafe_condition/wrong_category/other; nonblank note for other/pause. Assigned enhanced request must be explicitly accepted before start. Paused/blocked work cannot report. Manager/dispatcher `assign` can reassign blocked work with technicianId; old flow preserved for legacy requests.
- POST `/requests/:id/visits` `{key,version,startsAt:ISO,endsAt:ISO}` proposes or reschedules; prior active visit superseded, confirmations reset, history retained. Staff requests.assign only.
- POST `/requests/:id/visits/:visitId` `{key,version,visitVersion,action:confirm|cancel,note?}`. Resident confirms own authorized request; assigned technician confirms own work. Confirmed only after both required parties; no resident account → server-derived resident_required false. Staff can cancel, resident can cancel own visit with reason. Reassignment resets technician confirmation.
- POST `/requests/:id/materials` `{key,version,kind:material|service,name,quantity:number,unit,unitCostMinor?:integer,comment?}`. Assigned executing technician only, no financial operation.
- Existing raw photo endpoint `/requests/:id/photos?photoType=before|during|after|evidence` adds typed metadata; same sanitization/private storage/auth. Existing no-type uploads/immutable offline receipts stay compatible. Preserve queued offline file types where provided; default legacy evidence, never auto-sync.
- GET `/assets/lookup?identifier=UUID-or-serial` → scoped `{asset,plans,works,units}`. No token is an authorization grant. Manual input fallback, no fake camera.
- Existing POST `/requests` with assetId and selected unit creates linked request; technician's own equipment work is assigned to self server-side. Staff uses optional technicianId. Existing work orders, not a second model.

## Incidents / freshness

- Existing GET/POST `/incidents` → scoped list/create. Create `{buildingId,description,severity?:low|normal|high|critical,key?:UUID}`; defaults preserve existing clients.
- GET `/incidents/:id` → row plus `{history,attachments}`.
- POST `/incidents/:id/transition` `{key,version,status:open|investigating|resolved|closed,severity?,note}`. Explicit legal progression/reopen, reason required; historical values append-only.
- POST `/incidents/:id/attachments` raw image → private sanitized attachment; GET `/incident-attachments/:id` revalidates incident scope.
- Choose visibility-aware polling, not SSE: refetch on mount/focus/visibility/resume and every30s only when visible, clean up on context/logout; refresh list after writes without overwriting unsaved detail form. Existing Email polling not touched.

All dates ISO UTC in transport / Asia/Yerevan display. Existing HY/RU/EN UI dictionaries, original HAYAT/ImTun logos, no emojis. Categories/SLA configuration visible only requests.configure. Operational actions online-only; preserve offline draft and token/session safeguards.
