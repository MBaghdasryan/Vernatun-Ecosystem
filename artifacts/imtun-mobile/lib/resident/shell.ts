import { useRouter } from 'expo-router';
import type { Language } from './text';
export type T3 = [string, string, string];
export const tr = (l: Language, t: T3) => t[l === 'ru' ? 1 : l === 'en' ? 2 : 0];
export const tabLabels: Record<'home' | 'bills' | 'requests' | 'community' | 'profile', T3> = {
  home: ['Գլխավոր', 'Главная', 'Home'], bills: ['Վճարներ', 'Платежи', 'Bills'], requests: ['Հայտեր', 'Заявки', 'Requests'], community: ['Համայնք', 'Сообщество', 'Community'], profile: ['Պրոֆիլ', 'Профиль', 'Profile'],
};
export const roleLabel = (l: Language, role?: string | null): string => {
  const r = (role ?? '').toLowerCase();
  if (r.includes('owner')) return tr(l, ['Սեփականատեր', 'Собственник', 'Owner']);
  if (r.includes('tenant') || r.includes('renter') || r.includes('lease')) return tr(l, ['Վարձակալ', 'Арендатор', 'Renter']);
  if (r.includes('family') || r.includes('member') || r.includes('household')) return tr(l, ['Ընտանիքի անդամ', 'Член семьи', 'Family member']);
  return tr(l, ['Բնակիչ', 'Житель', 'Resident']);
};
export const money = (minor: string | null | undefined, currency?: string) => {
  if (minor == null || !/^-?\d+$/.test(minor)) return null;
  const neg = minor.startsWith('-'); const n = BigInt(neg ? minor.slice(1) : minor);
  const whole = (n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); const f = n % 100n;
  return `${neg ? '-' : ''}${whole}${f ? '.' + f.toString().padStart(2, '0') : ''} ${currency === 'AMD' || !currency ? '֏' : currency}`;
};
export function useSection() {
  const router = useRouter();
  return (section: string) => router.push({ pathname: '/resident/[section]', params: { section } });
}
