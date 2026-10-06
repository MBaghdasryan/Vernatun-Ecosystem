// Legacy renters without recorded leases keep their restored access. Once a
// lease is recorded, every protected context follows the live lease dates.
// History is preserved; expired/cancelled periods grant no protected actions.
export const activeLeasePredicate=(alias:string)=>`(${alias}.role_key<>'renter' OR NOT EXISTS(
 SELECT 1 FROM leases lp WHERE lp.organization_id=${alias}.organization_id AND lp.unit_id=${alias}.unit_id AND lp.renter_id=${alias}.user_id
) OR EXISTS(
 SELECT 1 FROM leases lp WHERE lp.organization_id=${alias}.organization_id AND lp.unit_id=${alias}.unit_id AND lp.renter_id=${alias}.user_id
 AND lp.cancelled_at IS NULL AND lp.starts_on<=(now() AT TIME ZONE 'Asia/Yerevan')::date AND lp.ends_on>=(now() AT TIME ZONE 'Asia/Yerevan')::date
))`;
