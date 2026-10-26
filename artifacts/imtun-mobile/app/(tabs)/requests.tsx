import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { uploadOperationalPhoto, useCreateOperationalRequest, useGetMobileAuthSession, useGetOperationalRequests } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useLocalSearchParams } from 'expo-router';
import RequestDetail from '@/components/resident/RequestDetail';
import { csrfSessionRef } from '../_layout';
import { formatArmenianDate, friendlyError, isCompletedRequestStatus, localizeRequestStatus } from '@/constants/armenian';
import { newUuid, useLang } from '@/lib/resident/hooks';
import { pickImage } from '@/components/resident/continuity/media';
import { tt } from '@/components/resident/continuity/core';
import { Tabs } from '@/components/resident/Ui';

type RequestCard = { id: string; subject: string; description: string; status: string; statusCode: string; date: string };
type RequestPhotoDraft = { blob: Blob; uri: string; operationKey: string };
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

export default function RequestsScreen() { const palette = useAppPalette(); const styles = React.useMemo(() => make_styles(palette), [palette]);
  const colors = palette;
  const lang = useLang();
  const client = useQueryClient();
  const session = useGetMobileAuthSession();
  const requests = useGetOperationalRequests();
  const createRequest = useCreateOperationalRequest();
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [photo, setPhoto] = useState<RequestPhotoDraft | null>(null);
  const [pendingPhotoRequestId, setPendingPhotoRequestId] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const pendingPhotoRequestIdRef = React.useRef<string | null>(null);
  const submitInFlight = React.useRef(false);
  csrfSessionRef.current = session.data?.csrf ?? csrfSessionRef.current;
  const { requestId: selectedId } = useLocalSearchParams<{ requestId?: string }>();
  const records = useMemo(() => { const all = normalizeRequests(requests.data); return selectedId ? [...all.filter(r => r.id === selectedId), ...all.filter(r => r.id !== selectedId)] : all; }, [requests.data, selectedId]);
  const doneCount = records.filter(r => isCompletedRequestStatus(r.statusCode)).length;
  const shown = filter === 'all' ? records : records.filter(r => isCompletedRequestStatus(r.statusCode) === (filter === 'done'));
  const active = session.data?.contexts.find((context) => context.id === session.data?.contextId);
  const unitId = active?.unit_id;

  const resetComposer = () => {
    setComposerOpen(false);
    setSubject('');
    setDescription('');
    setFormError('');
    setPhoto(null);
    pendingPhotoRequestIdRef.current = null;
    setPendingPhotoRequestId(null);
  };

  const closeComposer = () => {
    if (pendingPhotoRequestIdRef.current && photo) {
      setFormError(tt(lang, 'Լուսանկարը դեռ չի վերբեռնվել։ Կրկնեք վերբեռնումը կամ ավարտեք հայտը առանց լուսանկարի։', 'Фото ещё не загружено. Повторите загрузку или завершите заявку без фото.', 'The photo is still pending. Retry the upload or finish the request without it.'));
      return;
    }
    setComposerOpen(false);
  };

  const choosePhoto = async (source: 'library' | 'camera' = 'library') => {
    setFormError('');
    try {
      const picked = await pickImage(lang, 6 * 1024 * 1024, false, source);
      if (!picked) return;
      if ('error' in picked) { setFormError(picked.error); return; }
      setPhoto({ ...picked, operationKey: newUuid() });
    } catch (error) {
      setFormError(friendlyError(error, tt(lang, 'Չհաջողվեց ընտրել լուսանկարը։', 'Не удалось выбрать фото.', 'Could not select the photo.')));
    }
  };

  const submit = async () => {
    if (submitInFlight.current) return;
    const cleanSubject = subject.trim();
    if (!pendingPhotoRequestIdRef.current) {
      if (!unitId) { setFormError(tt(lang, 'Ընտրված միջավայրի համար բնակարան նշված չէ։', 'Для выбранного контекста не указана квартира.', 'No apartment is set for the selected context.')); return; }
      if (cleanSubject.length < 3) { setFormError(tt(lang, 'Նշեք հայտի թեման՝ առնվազն 3 նիշ։', 'Укажите тему — не менее 3 символов.', 'Enter a subject of at least 3 characters.')); return; }
      if (cleanSubject.length > 160 || description.trim().length > 4000) { setFormError(tt(lang, 'Թեման՝ մինչև 160, նկարագրությունը՝ մինչև 4000 նիշ։', 'Тема — до 160, описание — до 4000 символов.', 'Subject up to 160, details up to 4000 characters.')); return; }
    }

    submitInFlight.current = true;
    setSubmitting(true);
    setFormError('');
    try {
      let requestId: string;
      const existingRequestId = pendingPhotoRequestIdRef.current;
      if (existingRequestId) {
        requestId = existingRequestId;
      } else {
        const created = await createRequest.mutateAsync({
          data: { unitId: unitId!, subject: cleanSubject, description: description.trim() },
        });
        if (typeof created.id !== 'string' || !created.id) throw new Error('Request creation returned no request ID.');
        requestId = created.id;
        pendingPhotoRequestIdRef.current = requestId;
        setPendingPhotoRequestId(requestId);
        await client.invalidateQueries({ queryKey: requests.queryKey });
      }

      if (photo) {
        await uploadOperationalPhoto(
          requestId,
          photo.blob,
          { photoType: 'evidence' },
          { headers: { 'X-Operation-Key': photo.operationKey } },
        );
        await client.invalidateQueries({ queryKey: requests.queryKey });
      }
      resetComposer();
    } catch (error) {
      const fallback = pendingPhotoRequestIdRef.current && photo
        ? tt(lang, 'Հայտը ստեղծվել է, բայց լուսանկարը չի վերբեռնվել։ Կրկնեք՝ առանց երկրորդ հայտ ստեղծելու։', 'Заявка создана, но фото не загружено. Повторите загрузку — вторая заявка не создастся.', 'The request was created, but the photo did not upload. Retry; this will not create a duplicate request.')
        : tt(lang, 'Չհաջողվեց ուղարկել հայտը։ Կրկին փորձեք։', 'Не удалось отправить заявку. Повторите.', 'Could not send the request. Try again.');
      setFormError(friendlyError(error, fallback));
      if (pendingPhotoRequestIdRef.current) {
        await client.invalidateQueries({ queryKey: requests.queryKey });
      }
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={() => requests.refetch()} tintColor={colors.primary} />}
        ListHeaderComponent={<View>
          <Text style={styles.kicker}>{tt(lang, 'IMTUN · ՏԱՆ ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐ', 'IMTUN · СЕРВИС ДОМА', 'IMTUN · HOME SERVICE')}</Text><Text style={styles.title} accessibilityRole="header">{tt(lang, 'Հայտեր', 'Заявки', 'Requests')}</Text><Text style={styles.subtitle}>{tt(lang, 'Կառավարման ընկերությանն ուղարկված դիմումները։', 'Обращения в управляющую компанию.', 'Requests sent to your management company.')}</Text>
          <View style={styles.summary}><View style={styles.summaryMark}><Feather name="clipboard" size={20} color={palette.primary} /></View><View style={{ flex: 1 }}><Text style={styles.summaryTitle}>{tt(lang, 'Ձեր դիմումները', 'Ваши обращения', 'Your requests')}</Text><Text style={styles.summarySub}>{requests.isLoading ? tt(lang, 'Բեռնում ենք…', 'Загрузка…', 'Loading…') : `${tt(lang, 'Ակտիվ', 'Активные', 'Active')}: ${records.length - doneCount} · ${tt(lang, 'Ավարտված', 'Завершённые', 'Completed')}: ${doneCount}`}</Text></View><Feather name="arrow-down-right" size={18} color={palette.heroMuted} /></View>
          {!unitId ? <View testID="request-unit-unavailable" style={styles.unitUnavailable}><Feather name="info" size={17} color={palette.accentForeground} /><Text style={styles.unitUnavailableText}>{tt(lang, 'Այս հաշվի համար բնակարան նշված չէ։ Նոր հայտի համար դիմեք կառավարման ընկերությանը։', 'Для этого аккаунта не указана квартира. Чтобы создать заявку, обратитесь в управляющую компанию.', 'No apartment is linked to this account. Contact management to create requests.')}</Text></View> : null}
          <View style={styles.listHeading}><Text style={styles.sectionTitle} accessibilityRole="header">{tt(lang, 'Պատմություն', 'История', 'History')}</Text><Text style={styles.countLabel}>{shown.length}/{records.length}</Text></View>
          <View style={{ marginBottom: 12 }}><Tabs value={filter} onChange={setFilter} options={[['all', tt(lang, 'Բոլորը', 'Все', 'All'), records.length], ['active', tt(lang, 'Ակտիվ', 'Активные', 'Active'), records.length - doneCount], ['done', tt(lang, 'Ավարտված', 'Завершённые', 'Completed'), doneCount]]} /></View>
        </View>}
        ListEmptyComponent={requests.isLoading ? <View style={styles.loadingCard}><View style={styles.shimmer} /><View style={[styles.shimmer, { width: '65%' }]} /><View style={[styles.shimmer, { height: 70 }]} /></View> : requests.isError ? <View style={styles.empty}><View style={styles.emptyIcon}><Feather name="wifi-off" size={21} color={palette.accentForeground} /></View><Text style={styles.emptyTitle}>{tt(lang, 'Չհաջողվեց բեռնել ցանկը', 'Не удалось загрузить список', 'Could not load the list')}</Text><Text style={styles.emptyBody}>{tt(lang, 'Կրկին փորձեք։', 'Попробуйте ещё раз.', 'Please try again.')}</Text><Pressable accessibilityRole="button" testID="requests-retry" onPress={() => requests.refetch()} style={styles.retry}><Text style={styles.retryText}>{tt(lang, 'Կրկին բեռնել', 'Повторить', 'Retry')}</Text></Pressable></View> : <View style={styles.empty}><View style={styles.emptyIcon}><Feather name="inbox" size={21} color={palette.accentForeground} /></View><Text style={styles.emptyTitle}>{records.length ? tt(lang, 'Այս ֆիլտրով հայտեր չկան', 'Нет заявок с этим фильтром', 'No requests in this filter') : tt(lang, 'Դեռ հայտեր չկան', 'Заявок пока нет', 'No requests yet')}</Text><Text style={styles.emptyBody}>{tt(lang, 'Ստեղծեք հայտ, եթե տան որևէ հարց ուշադրության կարիք ունի։', 'Создайте заявку, если дому нужно внимание.', 'Create a request when something at home needs attention.')}</Text></View>}
        renderItem={({ item }) => <RequestRow item={item} selected={item.id === selectedId} onOpen={item.id.startsWith('request-') ? undefined : () => setOpenId(item.id)} />}
        ListFooterComponent={<View style={{ height: 100 }} />}
      />
      <Pressable accessibilityRole="button" testID="create-request-open" disabled={!unitId} onPress={() => { setFormError(''); setComposerOpen(true); }} style={[styles.fab, !unitId && styles.fabDisabled]}><Feather name="plus" size={20} color={palette.foreground} /><Text style={styles.fabText}>{tt(lang, 'Նոր հայտ', 'Новая заявка', 'New request')}</Text></Pressable>
      <RequestDetail id={openId} l={lang} onClose={() => setOpenId(null)} />
      <Modal visible={isComposerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeComposer}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHead}><View><Text style={styles.kicker}>{tt(lang, 'ՀԱՅՏ ՁԵՐ ՏԱՆ ՀԱՄԱՐ', 'ЗАЯВКА ПО ДОМУ', 'HOME REQUEST')}</Text><Text style={styles.modalTitle}>{tt(lang, 'Նոր հայտ', 'Новая заявка', 'New request')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={tt(lang, 'Փակել', 'Закрыть', 'Close')} testID="create-request-close" onPress={closeComposer} style={styles.close}><Feather name="x" size={20} color={palette.foreground} /></Pressable></View>
            <View style={styles.unitNotice}><Feather name="home" size={17} color={palette.accentForeground} /><Text style={styles.unitNoticeText}>{active?.building_name || active?.organization_name || 'Ձեր տունը'}{active?.unit_number ? ` · բն. ${active.unit_number}` : ''}</Text></View>
            <Text style={styles.fieldLabel}>{tt(lang, 'Հայտի թեման', 'Тема заявки', 'Subject')}</Text><TextInput testID="request-subject" accessibilityLabel={tt(lang, 'Հայտի թեման', 'Тема заявки', 'Subject')} editable={!isSubmitting && !pendingPhotoRequestId} value={subject} onChangeText={setSubject} placeholder={tt(lang, 'Օրինակ՝ մուտքի լույսը չի աշխատում', 'Например: не горит свет в подъезде', 'E.g. the entrance light is out')} placeholderTextColor={palette.placeholder} maxLength={160} style={styles.input} />
            <Text style={styles.fieldLabel}>{tt(lang, 'Մանրամասներ', 'Подробности', 'Details')}</Text><TextInput testID="request-description" accessibilityLabel={tt(lang, 'Հայտի մանրամասներ', 'Подробности заявки', 'Request details')} editable={!isSubmitting && !pendingPhotoRequestId} value={description} onChangeText={setDescription} placeholder={tt(lang, 'Նկարագրեք՝ ինչ է տեղի ունեցել և որտեղ', 'Опишите, что и где произошло', 'Describe what happened and where')} placeholderTextColor={palette.placeholder} multiline textAlignVertical="top" maxLength={4000} style={[styles.input, styles.textarea]} />
            <Text style={styles.counter}>{subject.length}/160 · {description.length}/4000</Text>
            <Text style={styles.fieldLabel}>{tt(lang, 'Լուսանկար (ըստ ցանկության)', 'Фото (необязательно)', 'Photo (optional)')}</Text>
            {photo ? <View style={styles.photoCard}>
              <Image testID="request-photo-preview" accessibilityLabel={tt(lang, 'Ընտրված լուսանկարը', 'Выбранное фото', 'Selected photo')} source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="cover" />
              {!pendingPhotoRequestId ? <Pressable accessibilityRole="button" testID="request-photo-remove" disabled={isSubmitting} onPress={() => setPhoto(null)} style={styles.photoRemove}><Feather name="x" size={15} color={palette.foreground} /><Text style={styles.photoRemoveText}>{tt(lang, 'Հեռացնել լուսանկարը', 'Убрать фото', 'Remove photo')}</Text></Pressable> : null}
            </View> : <View style={{ flexDirection: 'row', gap: 10 }}>{Platform.OS !== 'web' ? <Pressable accessibilityRole="button" accessibilityLabel={tt(lang, 'Լուսանկարել', 'Сделать фото', 'Take photo')} testID="request-photo-camera" disabled={isSubmitting || !!pendingPhotoRequestId} onPress={() => { void choosePhoto('camera'); }} style={[styles.photoPicker, { flex: 1 }]}><Feather name="camera" size={18} color={palette.accentForeground} /><Text style={styles.photoPickerText}>{tt(lang, 'Լուսանկարել', 'Сделать фото', 'Take photo')}</Text></Pressable> : null}<Pressable accessibilityRole="button" testID="request-photo-choose" disabled={isSubmitting || !!pendingPhotoRequestId} onPress={() => { void choosePhoto('library'); }} style={[styles.photoPicker, { flex: 1 }]}><Feather name="image" size={18} color={palette.accentForeground} /><Text style={styles.photoPickerText}>{tt(lang, 'Ընտրել լուսանկար', 'Выбрать фото', 'Choose a photo')}</Text><Text style={styles.photoPickerHint}>JPG, PNG, WebP · ≤ 6 MB</Text></Pressable></View>}
            {pendingPhotoRequestId ? <View accessibilityRole="alert" style={styles.photoStatus}><Feather name="info" size={16} color={palette.accentForeground} /><Text style={styles.photoStatusText}>{tt(lang, 'Հայտն արդեն ստեղծվել է։ Կրկնում ենք միայն լուսանկարի վերբեռնումը։', 'Заявка уже создана. Повторяется только загрузка фото.', 'The request is already created. Retrying will upload only the photo.')}</Text></View> : null}
            {formError ? <View style={styles.formError}><Feather name="alert-circle" size={16} color={palette.destructive} /><Text style={styles.formErrorText}>{formError}</Text></View> : null}
            <View style={styles.privacy}><Feather name="shield" size={15} color={palette.mutedForeground} /><Text style={styles.privacyText}>{tt(lang, 'Հայտը կուղարկվի ընտրված բնակչի անունից։', 'Заявка будет отправлена от имени выбранного жителя.', 'The request is sent on behalf of the selected resident.')}</Text></View>
            <Pressable accessibilityRole="button" testID="request-submit" disabled={isSubmitting || (!pendingPhotoRequestId && !subject.trim())} onPress={() => { void submit(); }} style={[styles.submit, (isSubmitting || (!pendingPhotoRequestId && !subject.trim())) && styles.fabDisabled]}>{isSubmitting ? <ActivityIndicator color={palette.foreground} /> : <><Text style={styles.submitText}>{pendingPhotoRequestId && photo ? tt(lang, 'Կրկնել լուսանկարի վերբեռնումը', 'Повторить загрузку фото', 'Retry photo upload') : tt(lang, 'Ուղարկել հայտը', 'Отправить заявку', 'Send request')}</Text><Feather name={pendingPhotoRequestId && photo ? 'refresh-cw' : 'arrow-right'} size={18} color={palette.foreground} /></>}</Pressable>
            {pendingPhotoRequestId && photo ? <Pressable accessibilityRole="button" testID="request-finish-without-photo" disabled={isSubmitting} onPress={resetComposer} style={styles.finishWithoutPhoto}><Text style={styles.finishWithoutPhotoText}>{tt(lang, 'Ավարտել առանց լուսանկարի', 'Завершить без фото', 'Finish without photo')}</Text></Pressable> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function RequestRow({ item, selected, onOpen }: { item: RequestCard; selected: boolean; onOpen?: () => void }) { const palette = useAppPalette(); const styles = React.useMemo(() => make_styles(palette), [palette]);
  const isDone = isCompletedRequestStatus(item.statusCode);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.subject}, ${item.status}`} disabled={!onOpen} onPress={onOpen} testID={'request-row-' + item.id} style={({ pressed }) => [styles.rowCard, selected && { borderColor: palette.primary, borderWidth: 2 }, pressed && { opacity: 0.8 }]}>
    <View style={styles.rowTop}><View style={[styles.statusDot, isDone && { backgroundColor: palette.success }]} /><Text style={[styles.status, isDone && { color: palette.successStrong }]} numberOfLines={1}>{item.status}</Text><Text style={styles.date}>{item.date}</Text></View>
    <Text style={styles.rowTitle}>{item.subject}</Text>{item.description ? <Text style={styles.rowDescription} numberOfLines={3}>{item.description}</Text> : null}
    <View style={styles.rowBottom}><Text style={styles.recordRef}>IMTUN</Text><Feather name="arrow-up-right" size={15} color={palette.accentForeground} /></View>
  </Pressable>;
}

const make_styles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background }, content: { paddingTop: 25, paddingHorizontal: 16 },
  kicker: { fontSize: 9, letterSpacing: 1.45, color: palette.subdued, fontWeight: '800', marginBottom: 7 }, title: { fontSize: 29, lineHeight: 35, letterSpacing: -0.8, color: palette.foreground, fontWeight: '800' },
  subtitle: { color: palette.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 6 },
  summary: { marginTop: 22, backgroundColor: palette.foreground, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 77 },
  summaryMark: { width: 39, height: 39, borderRadius: 12, backgroundColor: palette.heroOverlay, alignItems: 'center', justifyContent: 'center' }, summaryTitle: { color: palette.surface, fontWeight: '800', fontSize: 14 }, summarySub: { color: palette.heroMuted, fontSize: 11, marginTop: 4 },
  unitUnavailable: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: palette.accent, borderWidth: 1, borderColor: palette.border },
  unitUnavailableText: { flex: 1, color: palette.accentForeground, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  listHeading: { marginTop: 27, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: palette.foreground, fontWeight: '800', fontSize: 17 }, countLabel: { color: palette.subdued, fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  rowCard: { backgroundColor: palette.surface, borderRadius: 14, borderColor: palette.border, borderWidth: 1, padding: 15, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 7 }, statusDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: palette.warning }, status: { color: palette.warningText, fontSize: 10, fontWeight: '800', flex: 1 }, date: { color: palette.subdued, fontSize: 11, flexShrink: 0 },
  rowTitle: { color: palette.foreground, fontSize: 15, fontWeight: '800', lineHeight: 20, marginTop: 12 }, rowDescription: { fontSize: 12, color: palette.mutedForeground, lineHeight: 18, marginTop: 5 },
  rowBottom: { borderTopWidth: 1, borderColor: palette.divider, marginTop: 14, paddingTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, recordRef: { color: palette.placeholder, fontWeight: '700', fontSize: 9, letterSpacing: 1 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, borderRadius: 15, borderColor: palette.border, borderWidth: 1, backgroundColor: palette.surface }, emptyIcon: { height: 43, width: 43, borderRadius: 14, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: palette.foreground, fontSize: 15, fontWeight: '800', marginBottom: 5 }, emptyBody: { color: palette.mutedForeground, fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 260 },
  retry: { marginTop: 13, paddingVertical: 10, paddingHorizontal: 15, backgroundColor: palette.accent, borderRadius: 9 }, retryText: { color: palette.accentForeground, fontSize: 12, fontWeight: '800' },
  loadingCard: { backgroundColor: palette.surface, borderRadius: 15, padding: 15, gap: 12 }, shimmer: { height: 13, width: '86%', backgroundColor: palette.skeleton, borderRadius: 6 },
  fab: { position: 'absolute', bottom: 18, left: 20, right: 20, backgroundColor: palette.primary, minHeight: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, elevation: 5, shadowColor: palette.shadow, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  fabText: { color: palette.foreground, fontSize: 14, fontWeight: '800' }, fabDisabled: { opacity: 0.5 },
  modalRoot: { flex: 1, backgroundColor: palette.background }, modalContent: { padding: 22, paddingTop: 25, paddingBottom: 38, maxWidth: 560, width: '100%', alignSelf: 'center' },
  photoPicker: { minHeight: 96, marginBottom: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', gap: 5, padding: 12 },
  photoPickerText: { color: palette.accentForeground, fontSize: 12, fontWeight: '800' }, photoPickerHint: { color: palette.subdued, fontSize: 10 },
  photoCard: { marginBottom: 16, borderWidth: 1, borderColor: palette.border, borderRadius: 12, overflow: 'hidden', backgroundColor: palette.surface },
  photoPreview: { width: '100%', height: 180, backgroundColor: palette.skeleton }, photoRemove: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, photoRemoveText: { color: palette.foreground, fontSize: 11, fontWeight: '700' },
  photoStatus: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, marginBottom: 13, borderRadius: 10, backgroundColor: palette.accent }, photoStatusText: { flex: 1, color: palette.accentForeground, fontSize: 11, lineHeight: 16 },
  finishWithoutPhoto: { marginTop: 9, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, finishWithoutPhotoText: { color: palette.mutedForeground, fontSize: 11, fontWeight: '700' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 19 }, modalTitle: { fontSize: 25, color: palette.foreground, fontWeight: '800', letterSpacing: -0.6 }, close: { width: 44, height: 44, borderRadius: 14, borderColor: palette.border, borderWidth: 1, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  unitNotice: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, backgroundColor: palette.accent, borderRadius: 11, marginBottom: 22 }, unitNoticeText: { color: palette.foreground, fontSize: 12, fontWeight: '700' },
  fieldLabel: { color: palette.foreground, fontSize: 12, fontWeight: '800', marginBottom: 8 }, input: { minHeight: 48, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 13, color: palette.foreground, marginBottom: 17 },
  textarea: { height: 132, paddingTop: 12, lineHeight: 19 }, counter: { color: palette.placeholder, fontSize: 10, textAlign: 'right', marginTop: -11, marginBottom: 14 },
  formError: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 11, backgroundColor: palette.destructiveSurface, borderRadius: 10, marginBottom: 14 }, formErrorText: { color: palette.destructiveForeground, flex: 1, fontSize: 12, lineHeight: 17 },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 10 }, privacyText: { color: palette.mutedForeground, fontSize: 11, flex: 1 },
  submit: { backgroundColor: palette.primary, minHeight: 51, borderRadius: 12, marginTop: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, submitText: { color: palette.foreground, fontWeight: '800', fontSize: 14 },
});
