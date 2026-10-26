import type { MobileAuthContext } from '@workspace/api-client-react';
import type { T } from './text';
// Existing resident domains. Availability mirrors the web config.ts feature gates (permission + organization module).
export const domainViews = ['finance', 'meetings', 'notifications', 'family', 'meters', 'announcements', 'documents', 'passes'] as const;
export type DomainView = typeof domainViews[number];
export const domainTitle: Record<DomainView, T> = {
  finance: ['Վճարումներ և կոմունալ', 'Платежи и коммунальные', 'Payments and utilities'], meetings: ['Ժողովներ և քվեարկություն', 'Собрания и голосования', 'Meetings and voting'],
  notifications: ['Ծանուցումներ', 'Уведомления', 'Notifications'], family: ['Ընտանիք', 'Семья', 'Family'], meters: ['Ցուցմունքներ', 'Показания счётчиков', 'Meter readings'],
  announcements: ['Հայտարարություններ', 'Объявления', 'Announcements'], documents: ['Փաստաթղթեր', 'Документы', 'Documents'], passes: ['Հյուրերի անցագրեր', 'Гостевые пропуска', 'Guest passes'],
};
const gate: Record<DomainView, { permission?: string; module?: string }> = {
  finance: { permission: 'billing.own', module: 'finance' }, meetings: { permission: 'meetings.read', module: 'community' }, notifications: {}, family: { permission: 'residents.delegate' },
  meters: { permission: 'meters.own', module: 'meters' }, announcements: { permission: 'announcements.read', module: 'community' }, documents: { permission: 'documents.read', module: 'documents' }, passes: { permission: 'access.create', module: 'access' },
};
export function domainAvailable(c: MobileAuthContext | undefined, v: DomainView): boolean {
  if (!c) return false; const g = gate[v];
  return (!g.permission || c.permissions.includes(g.permission)) && (!g.module || !!c.modules?.includes(g.module));
}
