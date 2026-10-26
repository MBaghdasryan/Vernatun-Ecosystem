import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetOperationalRequest, getGetOperationalRequestQueryKey } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { formatArmenianDate, isCompletedRequestStatus, localizeRequestStatus } from '@/constants/armenian';
import { tr } from '@/lib/resident/shell';
import type { Language } from '@/lib/resident/text';
import RequestPhoto from './continuity/RequestPhoto';
import { ErrorBox, Skeleton } from './Ui';

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x): x is Rec => !!x && typeof x === 'object') : []);

/** Read-only request detail. Renders only fields the server returned. */
export default function RequestDetail({ id, l, onClose }: { id: string | null; l: Language; onClose: () => void }) {
  const palette = useAppPalette(); const st = useMemo(() => make(palette), [palette]);
  const q = useGetOperationalRequest(id ?? '', { query: { enabled: !!id, queryKey: getGetOperationalRequestQueryKey(id ?? '') } });
  const r = (q.data ?? {}) as Rec;
  const status = str(r.status); const done = isCompletedRequestStatus(status);
  const history = arr(r.history ?? r.events ?? r.timeline);
  const photos = arr(r.photos ?? r.attachments);
  const team = str(r.assignee_name ?? r.assigned_to_name ?? r.team_name ?? r.assigned_team);
  const sla = str(r.due_at ?? r.sla_due_at ?? r.deadline);
  const resolution = str(r.resolution ?? r.resolution_note ?? r.result);
  const steps = history.length ? history.map((h) => ({ title: localizeRequestStatus(str(h.status ?? h.to_status ?? h.action)) || str(h.action), note: str(h.note ?? h.comment), at: h.created_at ?? h.createdAt }))
    : [{ title: tr(l, ['Հայտը ստեղծված է', 'Заявка создана', 'Request created']), note: '', at: r.created_at ?? r.createdAt }, ...(status ? [{ title: localizeRequestStatus(status), note: '', at: r.updated_at ?? r.updatedAt }] : [])];
  return <Modal visible={!!id} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <ScrollView style={st.root} contentContainerStyle={st.c}>
      <View style={st.head}><Text style={st.ref}>{str(r.number ?? r.reference) ? `#${str(r.number ?? r.reference)}` : tr(l, ['Հայտ', 'Заявка', 'Request'])}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Փակել', 'Закрыть', 'Close'])} testID="request-detail-close" onPress={onClose} style={st.close}><Feather name="x" size={20} color={palette.foreground} /></Pressable></View>
      {q.isPending ? <><Skeleton /><Skeleton /></> : q.isError ? <ErrorBox message={tr(l, ['Չհաջողվեց բեռնել հայտը', 'Не удалось загрузить заявку', 'Could not load request'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => q.refetch()} /> : <>
        <View style={[st.pill, done && { backgroundColor: palette.successSurface }]}><Feather name={done ? 'check-circle' : 'clock'} size={13} color={done ? palette.successStrong : palette.accentForeground} /><Text style={[st.pillT, done && { color: palette.successStrong }]}>{localizeRequestStatus(status)}</Text></View>
        <Text style={st.title}>{str(r.subject) || '—'}</Text>
        {str(r.description) ? <Text style={st.body}>{str(r.description)}</Text> : null}
        <View style={st.meta}>
          {team ? <Meta st={st} p={palette} icon="user" k={tr(l, ['Կատարող', 'Исполнитель', 'Assigned'])} v={team} /> : null}
          {sla ? <Meta st={st} p={palette} icon="calendar" k={tr(l, ['Ժամկետ', 'Срок', 'Due'])} v={formatArmenianDate(sla, true)} /> : null}
          {photos.length ? <Meta st={st} p={palette} icon="image" k={tr(l, ['Լուսանկարներ', 'Фото', 'Photos'])} v={String(photos.length)} /> : null}
        </View>
        <Text style={st.h}>{tr(l, ['Ընթացք', 'Ход выполнения', 'Progress'])}</Text>
        <View>{steps.map((s, i) => <View key={i} style={st.step}><View style={st.rail}><View style={[st.dot, i === steps.length - 1 && { backgroundColor: palette.primary }]} />{i < steps.length - 1 ? <View style={st.line} /> : null}</View><View style={{ flex: 1, paddingBottom: 14 }}><Text style={st.sT}>{s.title || '—'}</Text>{s.at ? <Text style={st.sM}>{formatArmenianDate(s.at, true)}</Text> : null}{s.note ? <Text style={st.sM}>{s.note}</Text> : null}</View></View>)}</View>
        {resolution ? <><Text style={st.h}>{tr(l, ['Արդյունք', 'Результат', 'Resolution'])}</Text><Text style={st.body}>{resolution}</Text></> : null}
        {id && !done ? <RequestPhoto requestId={id} /> : null}
      </>}
    </ScrollView>
  </Modal>;
}
function Meta({ st, p, icon, k, v }: { st: ReturnType<typeof make>; p: Palette; icon: keyof typeof Feather.glyphMap; k: string; v: string }) {
  return <View style={st.mRow}><Feather name={icon} size={15} color={p.mutedForeground} /><Text style={st.mK}>{k}</Text><Text style={st.mV} numberOfLines={2}>{v}</Text></View>;
}
const make = (p: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: p.background }, c: { padding: 20, paddingBottom: 48, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, ref: { fontSize: 13, fontWeight: '800', color: p.mutedForeground },
  close: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: p.accent }, pillT: { fontSize: 12, fontWeight: '800', color: p.accentForeground },
  title: { fontSize: 22, fontWeight: '800', color: p.foreground, letterSpacing: -0.4 }, body: { fontSize: 14, lineHeight: 20, color: p.mutedForeground },
  meta: { backgroundColor: p.surface, borderRadius: 14, borderWidth: 1, borderColor: p.border, paddingHorizontal: 12 }, mRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, mK: { fontSize: 12, color: p.mutedForeground, width: 100 }, mV: { flex: 1, fontSize: 13, fontWeight: '700', color: p.foreground },
  h: { fontSize: 16, fontWeight: '800', color: p.foreground, marginTop: 6 },
  step: { flexDirection: 'row', gap: 12 }, rail: { alignItems: 'center', width: 14 }, dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: p.success, marginTop: 3 }, line: { flex: 1, width: 2, backgroundColor: p.border, marginTop: 2 },
  sT: { fontSize: 14, fontWeight: '700', color: p.foreground }, sM: { fontSize: 12, color: p.mutedForeground, marginTop: 2 },
});
