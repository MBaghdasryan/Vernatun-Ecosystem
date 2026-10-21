import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateOperationalRequest, useGetMobileAuthSession, useGetOperationalRequests } from '@workspace/api-client-react';
import { palette } from '@/constants/colors';
import { csrfSessionRef } from '../_layout';
import { useColors } from '@/hooks/useColors';
import { formatArmenianDate, friendlyError, isCompletedRequestStatus, localizeRequestStatus } from '@/constants/armenian';

type RequestCard = { id: string; subject: string; description: string; status: string; statusCode: string; date: string };
function normalizeRequests(rows: unknown): RequestCard[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const raw = row as Record<string, unknown>;
    const safeText = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
    const id = safeText(raw.id, `request-${index}`);
    const created = raw.created_at ?? raw.createdAt;
    const date = formatArmenianDate(created, true);
    const statusCode = safeText(raw.status, '');
    return [{ id, subject: safeText(raw.subject, 'Հայտ՝ առանց վերնագրի'), description: safeText(raw.description, ''), status: localizeRequestStatus(statusCode), statusCode, date }];
  });
}

export default function RequestsScreen() {
  const colors = useColors();
  const client = useQueryClient();
  const session = useGetMobileAuthSession();
  const requests = useGetOperationalRequests();
  const createRequest = useCreateOperationalRequest();
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  csrfSessionRef.current = session.data?.csrf ?? csrfSessionRef.current;
  const records = useMemo(() => normalizeRequests(requests.data), [requests.data]);
  const active = session.data?.contexts.find((context) => context.id === session.data?.contextId);
  const unitId = active?.unit_id;

  const submit = () => {
    const cleanSubject = subject.trim();
    if (!unitId) { setFormError('Ընտրված միջավայրի համար բնակարան նշված չէ։ Անձնական էջում ընտրեք հասանելի բնակարանը։'); return; }
    if (cleanSubject.length < 3) { setFormError('Նշեք հայտի թեման՝ առնվազն 3 նիշ։'); return; }
    if (cleanSubject.length > 160 || description.trim().length > 4000) { setFormError('Թեման կարող է ունենալ մինչև 160, իսկ նկարագրությունը՝ մինչև 4000 նիշ։'); return; }
    setFormError('');
    createRequest.mutate({ data: { unitId, subject: cleanSubject, description: description.trim() } }, {
      onSuccess: () => {
        client.invalidateQueries({ queryKey: requests.queryKey });
        setComposerOpen(false); setSubject(''); setDescription('');
      },
      onError: (error) => setFormError(friendlyError(error, 'Չհաջողվեց ուղարկել հայտը։ Կրկին փորձեք։')),
    });
  };

  return (
    <View style={styles.root}>
      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={() => requests.refetch()} tintColor={colors.primary} />}
        ListHeaderComponent={<View>
          <Text style={styles.kicker}>IMTUN · ՏԱՆ ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐ</Text><Text style={styles.title}>Հայտեր</Text><Text style={styles.subtitle}>Կառավարման ընկերությանն ուղարկված դիմումները։</Text>
          <View style={styles.summary}><View style={styles.summaryMark}><Feather name="clipboard" size={20} color={palette.primary} /></View><View style={{ flex: 1 }}><Text style={styles.summaryTitle}>Ձեր դիմումները</Text><Text style={styles.summarySub}>{requests.isLoading ? 'Բեռնում ենք տվյալները…' : `${records.length} դիմում ցանկում`}</Text></View><Feather name="arrow-down-right" size={18} color={palette.heroMuted} /></View>
          <View style={styles.listHeading}><Text style={styles.sectionTitle}>Պատմություն</Text><Text style={styles.countLabel}>{records.length ? `ԸՆԴԱՄԵՆԸ՝ ${records.length}` : 'ԸՆԹԱՑԻԿ ՑԱՆԿԸ'}</Text></View>
        </View>}
        ListEmptyComponent={requests.isLoading ? <View style={styles.loadingCard}><View style={styles.shimmer} /><View style={[styles.shimmer, { width: '65%' }]} /><View style={[styles.shimmer, { height: 70 }]} /></View> : requests.isError ? <View style={styles.empty}><View style={styles.emptyIcon}><Feather name="wifi-off" size={21} color={palette.accentForeground} /></View><Text style={styles.emptyTitle}>Չհաջողվեց բեռնել ցանկը</Text><Text style={styles.emptyBody}>Կրկին փորձեք։ Ճշտված տվյալների աղբյուրը սերվերն է։</Text><Pressable accessibilityRole="button" testID="requests-retry" onPress={() => requests.refetch()} style={styles.retry}><Text style={styles.retryText}>Կրկին բեռնել</Text></Pressable></View> : <View style={styles.empty}><View style={styles.emptyIcon}><Feather name="inbox" size={21} color={palette.accentForeground} /></View><Text style={styles.emptyTitle}>Դեռ հայտեր չկան</Text><Text style={styles.emptyBody}>Ստեղծեք հայտ, եթե տան որևէ հարց ուշադրության կարիք ունի։</Text></View>}
        renderItem={({ item }) => <RequestRow item={item} />}
        ListFooterComponent={<View style={{ height: 100 }} />}
      />
      <Pressable accessibilityRole="button" testID="create-request-open" disabled={!unitId} onPress={() => { setFormError(''); setComposerOpen(true); }} style={[styles.fab, !unitId && styles.fabDisabled]}><Feather name="plus" size={20} color={palette.foreground} /><Text style={styles.fabText}>Նոր հայտ</Text></Pressable>
      <Modal visible={isComposerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setComposerOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHead}><View><Text style={styles.kicker}>ՀԱՅՏ ՁԵՐ ՏԱՆ ՀԱՄԱՐ</Text><Text style={styles.modalTitle}>Նոր հայտ</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Փակել" testID="create-request-close" onPress={() => setComposerOpen(false)} style={styles.close}><Feather name="x" size={20} color={palette.foreground} /></Pressable></View>
            <View style={styles.unitNotice}><Feather name="home" size={17} color={palette.accentForeground} /><Text style={styles.unitNoticeText}>{active?.building_name || active?.organization_name || 'Ձեր տունը'}{active?.unit_number ? ` · բն. ${active.unit_number}` : ''}</Text></View>
            <Text style={styles.fieldLabel}>Հայտի թեման</Text><TextInput testID="request-subject" accessibilityLabel="Հայտի թեման" value={subject} onChangeText={setSubject} placeholder="Օրինակ՝ մուտքի լույսը չի աշխատում" placeholderTextColor={palette.placeholder} maxLength={160} style={styles.input} />
            <Text style={styles.fieldLabel}>Մանրամասներ</Text><TextInput testID="request-description" accessibilityLabel="Հայտի մանրամասներ" value={description} onChangeText={setDescription} placeholder="Նկարագրեք՝ ինչ է տեղի ունեցել և որտեղ" placeholderTextColor={palette.placeholder} multiline textAlignVertical="top" maxLength={4000} style={[styles.input, styles.textarea]} />
            <Text style={styles.counter}>{subject.length}/160 · {description.length}/4000</Text>
            {formError ? <View style={styles.formError}><Feather name="alert-circle" size={16} color={palette.destructive} /><Text style={styles.formErrorText}>{formError}</Text></View> : null}
            <View style={styles.privacy}><Feather name="shield" size={15} color={palette.mutedForeground} /><Text style={styles.privacyText}>Հայտը կուղարկվի ընտրված բնակչի անունից։</Text></View>
            <Pressable accessibilityRole="button" testID="request-submit" disabled={createRequest.isPending || !subject.trim()} onPress={submit} style={[styles.submit, (createRequest.isPending || !subject.trim()) && styles.fabDisabled]}>{createRequest.isPending ? <ActivityIndicator color={palette.foreground} /> : <><Text style={styles.submitText}>Ուղարկել հայտը</Text><Feather name="arrow-right" size={18} color={palette.foreground} /></>}</Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function RequestRow({ item }: { item: RequestCard }) {
  const isDone = isCompletedRequestStatus(item.statusCode);
  return <View style={styles.rowCard}>
    <View style={styles.rowTop}><View style={[styles.statusDot, isDone && { backgroundColor: palette.success }]} /><Text style={[styles.status, isDone && { color: palette.successStrong }]} numberOfLines={1}>{item.status}</Text><Text style={styles.date}>{item.date}</Text></View>
    <Text style={styles.rowTitle}>{item.subject}</Text>{item.description ? <Text style={styles.rowDescription} numberOfLines={3}>{item.description}</Text> : null}
    <View style={styles.rowBottom}><Text style={styles.recordRef}>IMTUN · ՀԱՅՏ</Text><Feather name="arrow-up-right" size={15} color={palette.accentForeground} /></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background }, content: { paddingTop: 25, paddingHorizontal: 20 },
  kicker: { fontSize: 9, letterSpacing: 1.45, color: palette.subdued, fontWeight: '800', marginBottom: 7 }, title: { fontSize: 29, lineHeight: 35, letterSpacing: -0.8, color: palette.foreground, fontWeight: '800' },
  subtitle: { color: palette.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 300 },
  summary: { marginTop: 22, backgroundColor: palette.foreground, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 77 },
  summaryMark: { width: 39, height: 39, borderRadius: 12, backgroundColor: palette.heroOverlay, alignItems: 'center', justifyContent: 'center' }, summaryTitle: { color: palette.surface, fontWeight: '800', fontSize: 14 }, summarySub: { color: palette.heroMuted, fontSize: 11, marginTop: 4 },
  listHeading: { marginTop: 27, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: palette.foreground, fontWeight: '800', fontSize: 17 }, countLabel: { color: palette.subdued, fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  rowCard: { backgroundColor: palette.surface, borderRadius: 14, borderColor: palette.border, borderWidth: 1, padding: 15, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 7 }, statusDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: palette.warning }, status: { color: palette.warningText, fontSize: 10, fontWeight: '800', flex: 1 }, date: { color: palette.subdued, fontSize: 10 },
  rowTitle: { color: palette.foreground, fontSize: 15, fontWeight: '800', lineHeight: 20, marginTop: 12 }, rowDescription: { fontSize: 12, color: palette.mutedForeground, lineHeight: 18, marginTop: 5 },
  rowBottom: { borderTopWidth: 1, borderColor: palette.divider, marginTop: 14, paddingTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, recordRef: { color: palette.placeholder, fontWeight: '700', fontSize: 9, letterSpacing: 1 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, borderRadius: 15, borderColor: palette.border, borderWidth: 1, backgroundColor: palette.surface }, emptyIcon: { height: 43, width: 43, borderRadius: 14, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: palette.foreground, fontSize: 15, fontWeight: '800', marginBottom: 5 }, emptyBody: { color: palette.mutedForeground, fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 260 },
  retry: { marginTop: 13, paddingVertical: 10, paddingHorizontal: 15, backgroundColor: palette.accent, borderRadius: 9 }, retryText: { color: palette.accentForeground, fontSize: 12, fontWeight: '800' },
  loadingCard: { backgroundColor: palette.surface, borderRadius: 15, padding: 15, gap: 12 }, shimmer: { height: 13, width: '86%', backgroundColor: palette.skeleton, borderRadius: 6 },
  fab: { position: 'absolute', bottom: 18, left: 20, right: 20, backgroundColor: palette.primary, minHeight: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, elevation: 5, shadowColor: palette.shadow, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  fabText: { color: palette.foreground, fontSize: 14, fontWeight: '800' }, fabDisabled: { opacity: 0.5 },
  modalRoot: { flex: 1, backgroundColor: palette.background }, modalContent: { padding: 22, paddingTop: 25, paddingBottom: 38, maxWidth: 560, width: '100%', alignSelf: 'center' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 19 }, modalTitle: { fontSize: 25, color: palette.foreground, fontWeight: '800', letterSpacing: -0.6 }, close: { width: 42, height: 42, borderRadius: 14, borderColor: palette.border, borderWidth: 1, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  unitNotice: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, backgroundColor: palette.accent, borderRadius: 11, marginBottom: 22 }, unitNoticeText: { color: palette.foreground, fontSize: 12, fontWeight: '700' },
  fieldLabel: { color: palette.foreground, fontSize: 12, fontWeight: '800', marginBottom: 8 }, input: { minHeight: 48, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 13, color: palette.foreground, marginBottom: 17 },
  textarea: { height: 132, paddingTop: 12, lineHeight: 19 }, counter: { color: palette.placeholder, fontSize: 10, textAlign: 'right', marginTop: -11, marginBottom: 14 },
  formError: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 11, backgroundColor: palette.destructiveSurface, borderRadius: 10, marginBottom: 14 }, formErrorText: { color: palette.destructiveForeground, flex: 1, fontSize: 12, lineHeight: 17 },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 10 }, privacyText: { color: palette.mutedForeground, fontSize: 11, flex: 1 },
  submit: { backgroundColor: palette.primary, minHeight: 51, borderRadius: 12, marginTop: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, submitText: { color: palette.foreground, fontWeight: '800', fontSize: 14 },
});
