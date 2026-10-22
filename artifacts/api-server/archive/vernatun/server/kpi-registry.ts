import {invoiceAmounts} from './operations.js';
import {moduleForPermission} from './roles.js';

export type KpiKey=
 | 'organizations'|'buildings'|'activeSubscriptions'|'openSupport'|'team'|'units'
 | 'activeGrants'|'onboardingRemaining'|'pendingInvites'|'openRequests'|'assignedWork'
 | 'openDefects'|'reviewDefects'|'handoverReady'|'validPasses'|'charged'|'paid'|'balance';
export type KpiQuery=
 | 'platform.organizations'|'platform.buildings'|'platform.active_subscriptions'
 | 'platform.open_support'|'support.assigned_open'|'organization.active_people'
 | 'organization.units'|'support.active_grants'|'platform.onboarding_remaining'
 | 'organization.pending_invitations'|'operations.open_requests'|'operations.assigned_work'
 | 'operations.open_defects'|'operations.review_defects'|'operations.ready_handovers'
 | 'operations.active_passes'|'finance.published_invoice_totals';

export const KPI_QUERIES:Record<KpiQuery,string>={
 'platform.organizations':'SELECT count(*)::text AS value FROM organizations',
 'platform.buildings':'SELECT count(*)::text AS value FROM buildings',
 'platform.active_subscriptions':"SELECT count(*)::text AS value FROM subscriptions WHERE status='active' AND starts_on<=current_date AND ends_on>=current_date",
 'platform.open_support':"SELECT count(*)::text AS value FROM support_cases WHERE status<>'resolved'",
 'support.assigned_open':"SELECT count(*)::text AS value FROM support_cases WHERE assigned_to=$1 AND status<>'resolved'",
 'organization.active_people':`SELECT count(DISTINCT a.user_id)::text AS value FROM role_assignments a
  JOIN users person ON person.id=a.user_id JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
  WHERE a.organization_id=$1 AND a.active AND m.active AND NOT person.blocked AND a.starts_at<=now()
  AND (a.expires_at IS NULL OR a.expires_at>now()) AND ($2::uuid IS NULL OR a.building_id=$2) AND ($3::uuid IS NULL OR a.unit_id=$3)`,
 'organization.units':'SELECT count(*)::text AS value FROM units WHERE organization_id=$1 AND ($2::uuid IS NULL OR building_id=$2) AND ($3::uuid IS NULL OR id=$3)',
 'support.active_grants':'SELECT count(*)::text AS value FROM support_access_grants WHERE support_user_id=$1 AND approved_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now()',
 'platform.onboarding_remaining':"SELECT count(*)::text AS value FROM onboarding_steps WHERE ($1::boolean OR assigned_to=$2) AND completed_at IS NULL",
 'organization.pending_invitations':'SELECT count(*)::text AS value FROM invitations WHERE organization_id=$1 AND ($2::uuid IS NULL OR building_id=$2) AND ($3::uuid IS NULL OR unit_id=$3) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()',
 'operations.open_requests':"SELECT count(*)::text AS value FROM resident_requests r JOIN units u ON u.id=r.unit_id WHERE r.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3) AND r.status<>'closed' AND ($4::boolean OR r.author_user_id=$5)",
 'operations.assigned_work':"SELECT count(*)::text AS value FROM work_orders w JOIN resident_requests r ON r.id=w.request_id JOIN units u ON u.id=r.unit_id WHERE r.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3) AND w.technician_id=$4 AND w.status IN ('assigned','in_progress')",
 'operations.open_defects':"SELECT count(*)::text AS value FROM defects d JOIN units u ON u.id=d.unit_id WHERE d.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3) AND ($4::boolean OR d.contractor_id=$5) AND d.status<>'accepted'",
 'operations.review_defects':"SELECT count(*)::text AS value FROM defects d JOIN units u ON u.id=d.unit_id WHERE d.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3) AND ($4::boolean OR d.contractor_id=$5) AND d.status='review'",
 'operations.ready_handovers':"SELECT count(*)::text AS value FROM handover_cases h JOIN units u ON u.id=h.unit_id WHERE h.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3) AND h.status='ready'",
 'operations.active_passes':"SELECT count(*)::text AS value FROM visitor_passes p JOIN units u ON u.id=p.unit_id WHERE p.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3) AND ($4::boolean OR p.created_by=$5) AND p.revoked_at IS NULL AND p.valid_until>now() AND p.state<>'exited'",
 'finance.published_invoice_totals':`SELECT count(*)::text AS invoice_count,
  COALESCE(sum(amount_minor::bigint),0)::text AS charged,
  COALESCE(sum(paid_minor::bigint),0)::text AS paid,
  COALESCE(sum(balance_minor::bigint),0)::text AS balance
  FROM (SELECT ${invoiceAmounts} FROM invoices i JOIN units u ON u.id=i.unit_id
   WHERE i.organization_id=$1 AND ($2::uuid IS NULL OR u.building_id=$2) AND ($3::uuid IS NULL OR u.id=$3)
   AND ($4::boolean OR i.payer_user_id=$5) AND i.currency=$6 AND i.status='published'
   AND ($7::date IS NULL OR (i.period >= $7::date AND i.period < $7::date + interval '1 month'))) x`
};

export interface KpiDefinition{
 queryId:KpiQuery;permission:string;module:string|null;scope:string;definition:string;
 noDataBehavior:'zero_is_a_measured_count'|'no_matching_published_invoices';
}
const def=(queryId:KpiQuery,permission:string,module:string|null,scope:string,definition:string,noDataBehavior:KpiDefinition['noDataBehavior']='zero_is_a_measured_count'):KpiDefinition=>
 ({queryId,permission,module:moduleForPermission(permission.split(' OR ')[0])??null,scope,definition,noDataBehavior});
export const KPI_REGISTRY:Record<KpiKey,KpiDefinition>={
 organizations:def('platform.organizations','organizations.read',null,'platform','Count of organizations in the platform database.'),
 buildings:def('platform.buildings','organizations.read',null,'platform','Count of buildings in the platform database.'),
 activeSubscriptions:def('platform.active_subscriptions','organizations.read',null,'platform','Subscriptions with active status whose start and end dates include today.'),
 openSupport:def('platform.open_support','organizations.read',null,'platform_or_assigned_operator','Unresolved support cases: all cases for organizations.read; otherwise cases assigned to the authenticated support operator.'),
 team:def('organization.active_people','people.read','organization','organization_building_unit','Distinct unblocked users with an active membership and an active, currently effective role assignment in the selected organization/building/unit.'),
 units:def('organization.units','properties.read OR properties.own','properties','organization_building_unit','Units in the selected organization, restricted to the selected building or unit when present.'),
 activeGrants:def('support.active_grants','support.access.request',null,'authenticated_operator','Approved, unrevoked support grants that have not expired.'),
 onboardingRemaining:def('platform.onboarding_remaining','onboarding.manage',null,'platform_or_assigned_operator','Onboarding steps without completed_at: all platform steps for an authorized platform-wide reader, otherwise steps assigned to the authenticated operator.'),
 pendingInvites:def('organization.pending_invitations','people.invite','organization','organization_building_unit','Invitations not accepted or revoked that are still within their expiry time.'),
 openRequests:def('operations.open_requests','requests.read OR requests.own','requests','organization_building_unit_or_author','Non-closed resident requests in the selected organization/building/unit; requests.own restricts results to the authenticated author.'),
 assignedWork:def('operations.assigned_work','workorders.assigned','requests','organization_building_unit_and_assigned_technician','Assigned or in-progress work orders assigned to the authenticated technician.'),
 openDefects:def('operations.open_defects','defects.read OR defects.assigned','defects','organization_building_unit_or_assigned_contractor','Defects except accepted defects, scoped to the selected location; defects.assigned restricts to the authenticated contractor.'),
 reviewDefects:def('operations.review_defects','defects.read OR defects.assigned','defects','organization_building_unit_or_assigned_contractor','Defects with review status, scoped to the selected location; defects.assigned restricts to the authenticated contractor.'),
 handoverReady:def('operations.ready_handovers','handover.read','handover','organization_building_unit','Handover cases whose current status is ready in the selected organization/building/unit.'),
 validPasses:def('operations.active_passes','access.validate OR access.create','access','organization_building_unit_or_creator','Not-revoked visitor passes that are unexpired and not exited; access.create-only readers see passes they created.'),
 charged:def('finance.published_invoice_totals','billing.read OR billing.own','finance','organization_building_unit_or_authenticated_payer','Sum of published invoice charges for the selected currency and optional invoice period.','no_matching_published_invoices'),
 paid:def('finance.published_invoice_totals','billing.read OR billing.own','finance','organization_building_unit_or_authenticated_payer','Sum of payment allocations applied to the selected published invoices.','no_matching_published_invoices'),
 balance:def('finance.published_invoice_totals','billing.read OR billing.own','finance','organization_building_unit_or_authenticated_payer','Sum of published invoice charges plus adjustments minus payment allocations.','no_matching_published_invoices'),
};
