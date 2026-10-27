import { useQuery } from '@tanstack/react-query';
import { getResidentContinuity, useGetMobileAuthSession } from '@workspace/api-client-react';
import { L, type Language } from '@/lib/resident/text';
import { useContextId } from '@/lib/resident/hooks';
export const tt = (l: Language, hy: string, ru: string, en: string) => L(l, [hy, ru, en]);
export const contKey = (ctx: string | null) => ['resident-continuity', ctx] as const;
export function useContinuity() {
  const ctx = useContextId();
  const session = useGetMobileAuthSession();
  const userId = session.data?.user?.id ?? null;
  return useQuery({ queryKey: [...contKey(ctx), userId], enabled: !!ctx && !!userId, queryFn: () => getResidentContinuity() });
}
export const httpStatus = (e: unknown): number => { const s = typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : NaN; return s; };
export const fmt = (l: Language, v: string) => new Date(v).toLocaleString(l === 'hy' ? 'hy-AM' : l === 'ru' ? 'ru-RU' : 'en-GB');
export const parseLocal = (v: string): Date | null => { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v.trim()); if (!m) return null; const [y, mo, da, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]]; const d = new Date(y, mo - 1, da, h, mi); if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da || d.getHours() !== h || d.getMinutes() !== mi) return null; return d; };
export const coordsFromText = (la: string, lo: string): { latitude: number; longitude: number } | null | 'invalid' => { const a = la.trim(); const b = lo.trim(); if (!a && !b) return null; if (!a || !b) return 'invalid'; const x = Number(a); const y = Number(b); return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 90 && Math.abs(y) <= 180 ? { latitude: x, longitude: y } : 'invalid'; };
export const needsReauth = (e: unknown): boolean => { const s = httpStatus(e); if (s !== 401 && s !== 403) return false; try { return JSON.stringify((e as { data?: unknown }).data ?? '').includes('recent_auth'); } catch { return false; } };
