import type { MobileAuthContext } from '@workspace/api-client-react';
import { domainAvailable, domainViews, type DomainView } from './domain';
import { kinds, superViews } from './text';

export type ResidentRole = 'owner' | 'renter' | 'family' | 'resident';

export function isImTunResidentContext(context: MobileAuthContext): boolean {
  const products = [context.product, ...(context.products ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return products.includes('imtun') || context.role_key.toLowerCase().includes('resident');
}

/** Role only changes presentation order and copy; it never grants a module. */
export function residentRole(context?: MobileAuthContext): ResidentRole {
  const role = (context?.role_key ?? '').toLowerCase();
  if (role.includes('owner')) return 'owner';
  if (/tenant|renter|lease/.test(role)) return 'renter';
  if (/family|member|household/.test(role)) return 'family';
  return 'resident';
}

export function residentSectionAllowed(context: MobileAuthContext | undefined, workspace: {
  capabilities?: Record<string, boolean>;
  integrations?: Array<{ key: string; status: string }>;
} | undefined, section: string): boolean {
  if (!context) return false;
  if (section === 'broadcasts') return true;
  if ((domainViews as readonly string[]).includes(section)) {
    return domainAvailable(context, section as DomainView);
  }
  if (section === 'preferences' || section === 'security') return true;
  if (section === 'building') return !!context.building_id;
  if (section === 'access') {
    return context.permissions.includes('device.read.own')
      && workspace?.integrations?.some((item) => item.key === 'barrier' && item.status === 'ACTIVE') === true;
  }
  if ((superViews as readonly string[]).includes(section)) {
    const sectionKinds = kinds[section] ?? [];
    return sectionKinds.some((kind) => workspace?.capabilities?.[kind] === true);
  }
  return false;
}

