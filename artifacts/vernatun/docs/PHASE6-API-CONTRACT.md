# Phase 6 implementation contract

Existing React portal request(), useFrozen()/Frozen/Fail/Dlg and RoleContext conventions.
All JSON writes carry UUID key; versioned changes send current version. Unknown/5xx
retain identical method/path/body/key for explicit retry, no automatic resubmission.
Backend current org/building/unit permissions authoritative. No mock business data.

- `/ownerships?unitId=` GET: rows id/unit_id/user_id/owner_name/number/building_name/
  starts_on/ends_on/share_basis_points/basis/basis_version_id/version/history.
  history has action/snapshot/reason/created_at (legacy date unknown).
  POST key,unitId,userId,startsOn,endsOn nullable,shareBasisPoints integer1..10000,
  basis required3+,basisDocumentId optional.
  `/ownerships/:id/end` POST key,version,endsOn,reason3+. Never delete.
  `/ownerships/candidates` GET active registered id/name.
  Read ownership.read, edit ownership.manage; unit owner sees only their records.
- `/governance/meetings` GET weighted meetings; legacy polls remain separately
  labelled legacy, not proper weighted meetings.
  POST key,buildingId,title,description,startsAt/endsAt ISO instants,
  quorumBasisPoints1..10000,documentIds optional,
  agenda array {title,votingType yes_no|single_choice,options2..10 unique strings,
  passOption included in options,passBasisPoints1..10000}.
  yes_no requires exactly yes,no,abstain; UI must offer custom option type too.
  `/governance/meetings/:id` GET meeting fields plus agenda, eligibility (own for
  unit_owner, all for manager), documents version IDs, result {totalEligibleShare,
  participationShare,quorum,agenda:[{id,title,participationShare,quorum,byOption,
  passed}]}; weights integer basis points across recorded eligible owners.
  `/governance/meetings/:id/actions` POST key,version,action publish|cancel|finalize,
  reason3+ for cancel. Finalize only after voting end, returns protocol_document_id.
  Publish freezes ownership at voting start, rejects no eligible shares.
  `/governance/agenda/:id/vote` POST key,eligibilityId,selectedOption. Owner only,
  time-window checked, one immutable ballot per ownership/agenda.
  Read meetings.read; manage meetings.manage; vote meetings.vote+unit_owner.
  No legal electronic-signature claims. Protocol download existing /documents/:id/download.
- Existing `/documents` upload/download preserved. List adds category,related_type,
  related_id,version,latest_version_id, without storage keys.
  `/documents/:id/versions` GET metadata id/version_number/previous_version_id/
  title/category/visibility/related_type/related_id/uploaded_by/uploaded_at.
  POST binary application/octet-stream, query key,version,title,category,visibility,
  relatedType optional building|unit|meeting and relatedId optional.
  Exactly same PDF/image sanitation/CSRF/6mb contract as existing uploader.
  `/documents/:id/versions/:versionId/download` private authorized URL.
  Existing case-sharing selector must send attachmentVersions:[{documentId,versionId}]
  matching selected latest_version_id alongside attachmentIds. If no attachments,
  omit or []; do not send storage keys or new public/upload endpoints.
- `/portfolio/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&currency=AMD&buildingId=&propertyId=`
  scoped building rows {id,name,unitCount,occupiedUnits,occupancyBasisPoints,billedMinor,
  collectedMinor,outstandingMinor,collectionRateBasisPoints,approvedExpensesMinor,
  budgetMinor nullable,budgetVarianceMinor nullable,netAllocatedCashflowMinor,
  expiringContracts,workOrders,slaViolations}; summary same monetary/count keys;
  series real months {period,billedMinor,collectedMinor,approvedExpensesMinor}.
  All monetary values exact minor-unit strings, no FX mixing/no fake history.
  Approved expenses are not proven bank-paid cash; label net as analytical estimate.
  Budget null means not recorded, never zero. Empty series has true empty state.
  Read reports.read OR expenses.read, never unit scopes.
- `/contractors/scorecard?from=&to=&buildingId=&propertyId=` GET actual contractor
  rows id/name/jobsAssigned/completed/accepted/returned/avgCompletionHours nullable/
  slaViolations/defectsReopened. Read workorders.accept OR reports.read OR expenses.read.
  Only actually assigned contractor work/defect histories, no fake star ratings.
- `/portfolio/budgets` GET rows id/building_id/period/currency/amount_minor/version.
  POST key,buildingId,period first of month,currency,amountMinor exact0..14digits,
  version when changing existing. Read expenses.read; manage expenses.manage.
  Planning values do not post ledger/expense/payment.

UI belongs to existing ownership, meetings, documents, portfolio/reports and
contractor-scorecard views. Preserve user/product-specific logos and assets,
hy/ru/en, safe date-time inputs, scope permissions and 390px behavior.
Community building choices /community/buildings; existing /units with unit ids,
registered people/candidates; entity selectors never arbitrary cross-org objects.
