import React, { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLogoutMobileAuth, useGetMobileAuthSession, useSwitchMobileAuthContext, type MobileAuthContext } from '@workspace/api-client-react';
import { useRouter } from 'expo-router';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { csrfSessionRef } from '../_layout';
import { armenianCurrency, friendlyError } from '@/constants/armenian';
import { useLang, useWorkspace } from '@/lib/resident/hooks';
import { roleLabel, tr, useSection } from '@/lib/resident/shell';
import { Row } from '@/components/resident/Ui';
import { isImTunResidentContext, residentSectionAllowed } from '@/lib/resident/navigation';

export default function ProfileScreen() { const palette = useAppPalette(); const styles = React.useMemo(() => make_styles(palette), [palette]);
  const router = useRouter();
  const client = useQueryClient();
  const session = useGetMobileAuthSession();
  const logout = useLogoutMobileAuth();
  const switchContext = useSwitchMobileAuthContext();
  const [contextSheet, setContextSheet] = useState(false);
  const [error, setError] = useState('');
  csrfSessionRef.current = session.data?.csrf ?? csrfSessionRef.current;
  const contexts = useMemo(() => (session.data?.contexts ?? []).filter(isImTunResidentContext), [session.data?.contexts]);
  const active = contexts.find((context) => context.id === session.data?.contextId);
  const user = session.data?.user;
  const l = useLang(); const ws = useWorkspace(); const go = useSection();
  const b = ws.data?.building; const sum = ws.data?.home.summary;
  const can = (section: string) => residentSectionAllowed(active, ws.data, section);
  const canReadRequests = !!active?.permissions.includes('requests.own');

  const changeContext = (context: MobileAuthContext) => {
    setError('');
    switchContext.mutate({ data: { id: context.id } }, {
      onSuccess: () => {
        setContextSheet(false);
        // Generated finance, device and request hooks have context-agnostic
        // query keys. Never show cached data from the previous assignment.
        client.clear();
        void session.refetch();
      },
      onError: (cause) => setError(friendlyError(cause, tr(l, ['Չհաջողվեց փոխել տունը։ Կրկին փորձեք։', 'Не удалось сменить дом. Повторите попытку.', 'Could not switch home. Please try again.']))),
    });
  };

  const signOut = () => {
    setError('');
    logout.mutate(undefined, {
      onSuccess: () => {
        csrfSessionRef.current = null;
        client.clear();
        router.replace('/');
      },
      onError: (cause) => setError(friendlyError(cause, tr(l, ['Չհաջողվեց ավարտել սեսիան։ Կրկին փորձեք։', 'Не удалось завершить сеанс. Повторите попытку.', 'Could not end the session. Please try again.']))),
    });
  };

  if (session.isLoading) return <View style={styles.center}><View style={styles.skeleton} /><View style={[styles.skeleton, { width: '65%' }]} /><View style={[styles.skeleton, { height: 170 }]} /></View>;
  if (session.isError && !session.data) return <View style={styles.center}><Feather name="wifi-off" size={27} color={palette.mutedForeground} /><Text style={styles.title}>{tr(l, ['Անձնական էջն անհասանելի է', 'Профиль недоступен', 'Profile unavailable'])}</Text><Text style={styles.muted}>{tr(l, ['Չհաջողվեց ստանալ հաշվի տվյալները։', 'Не удалось загрузить данные аккаунта.', 'Could not load account information.'])}</Text><Pressable accessibilityRole="button" testID="profile-retry" onPress={() => session.refetch()} style={styles.retry}><Text style={styles.retryText}>{tr(l, ['Կրկին փորձել', 'Повторить', 'Retry'])}</Text></Pressable></View>;

  const initials = (user?.name || ' ').trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || '•';
  return <>
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.top}><Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} /><Text style={styles.kicker}>{tr(l, ['ՁԵՐ ՀԱՇԻՎԸ', 'ВАШ АККАУНТ', 'YOUR ACCOUNT'])}</Text></View>
      <Text style={styles.title}>{tr(l, ['Անձնական էջ', 'Профиль', 'Profile'])}</Text><Text style={styles.subtitle}>{tr(l, ['Ձեր տվյալներն ու ընտրված տունը։', 'Ваши данные и выбранный дом.', 'Your details and selected home.'])}</Text>
      <View style={styles.identityCard}><View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View><View style={{ flex: 1 }}><Text style={styles.name}>{user?.name || tr(l, ['ImTun-ի օգտատեր', 'Пользователь ImTun', 'ImTun resident'])}</Text><Text style={styles.email}>{user?.email || tr(l, ['Էլեկտրոնային փոստը նշված չէ', 'Электронная почта не указана', 'Email not provided'])}</Text></View><Feather name="check-circle" size={19} color={palette.success} /></View>
      <Text style={styles.section}>{tr(l, ['ՏՈՒՆ ԵՎ ԲՆԱԿԱՐԱՆ', 'ДОМ И КВАРТИРА', 'HOME & APARTMENT'])}</Text>
      <Pressable accessibilityRole="button" testID="profile-change-context" disabled={!contexts.length || (contexts.length === 1 && !!active)} onPress={() => setContextSheet(true)} style={[styles.listCard, !contexts.length && styles.notInteractive]}>
        <View style={styles.listIcon}><Feather name="home" size={19} color={palette.accentForeground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>{active?.building_name || active?.organization_name || tr(l, ['Ընտրել տունը', 'Выбрать дом', 'Choose a home'])}</Text><Text style={styles.itemDescription}>{active?.unit_number ? `${tr(l, ['Բնակարան', 'Квартира', 'Apartment'])} ${active.unit_number}` : contexts.length ? tr(l, ['Փոխել ակտիվ տունը', 'Выбрать доступный дом', 'Choose an available home']) : tr(l, ['Տան հասանելիություն դեռ նշանակված չէ', 'Доступ к дому пока не назначен', 'No home access is assigned yet'])}{active?.organization_name && active.building_name ? ` · ${active.organization_name}` : ''}</Text></View>{contexts.length > 1 || !active ? <Feather name="chevron-right" size={19} color={palette.mutedForeground} /> : <Feather name="check" size={18} color={palette.success} />}
      </Pressable>
      <View style={styles.listCard}><View style={styles.listIcon}><Feather name="award" size={18} color={palette.accentForeground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>{roleLabel(l, b?.role ?? active?.role_key)}</Text><Text style={styles.itemDescription}>{[b?.unit ? `${tr(l, ['Բն.', 'Кв.', 'Apt'])} ${b.unit}` : null, b?.area ? `${b.area} m²` : null, b?.address].filter(Boolean).join(' · ') || '—'}</Text></View></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[
        ...(canReadRequests ? [[tr(l, ['Բաց հայտեր', 'Заявки', 'Requests']), ws.data?.home.openRequests] as const] : []),
        ...(can('passes') ? [[tr(l, ['Անցաթղթեր', 'Пропуска', 'Passes']), sum?.activeGuestPasses] as const] : []),
        ...(can('meetings') ? [[tr(l, ['Քվեարկություն', 'Голосования', 'Votes']), sum?.activeVoting?.length] as const] : []),
      ].map(([k, v]) => <View key={String(k)} style={[styles.listCard, { flexGrow: 1, flexBasis: '28%', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }]}><Text style={styles.name}>{v == null ? '—' : String(v)}</Text><Text style={styles.itemDescription}>{k}</Text></View>)}</View>
      <Text style={styles.section}>{tr(l, ['ԻՄ ՏՈՒՆԸ', 'МОЙ ДОМ', 'MY HOME'])}</Text>
      <View style={{ gap: 8 }}>
        {can('family') ? <Row icon="users" title={tr(l, ['Ընտանիք և հասանելիություն', 'Семья и права доступа', 'Household and access'])} onPress={() => go('family')} /> : null}
        {can('passes') ? <Row icon="key" title={tr(l, ['Հյուրի անցաթղթեր', 'Гостевые пропуска', 'Guest passes'])} onPress={() => go('passes')} /> : null}
        {can('vehicles') ? <Row icon="truck" tone="plain" title={tr(l, ['Մեքենաներ', 'Автомобили', 'Vehicles'])} onPress={() => go('vehicles')} /> : null}
        {can('documents') ? <Row icon="file-text" tone="plain" title={tr(l, ['Փաստաթղթեր', 'Документы', 'Documents'])} onPress={() => go('documents')} /> : null}
        {can('agreements') ? <Row icon="check-square" tone="plain" title={tr(l, ['Համաձայնություններ', 'Соглашения', 'Agreements'])} onPress={() => go('agreements')} /> : null}
        {can('building') ? <Row icon="phone" tone="plain" title={tr(l, ['Շենքի կոնտակտներ', 'Контакты дома', 'Building contacts'])} onPress={() => go('building')} /> : null}
        {can('access') ? <Row icon="unlock" tone="plain" title={tr(l, ['Մուտք', 'Доступ', 'Access'])} onPress={() => go('access')} /> : null}
        <Row icon="grid" tone="plain" title={tr(l, ['Բոլոր ծառայությունները', 'Все сервисы', 'All services'])} onPress={() => router.push('/(tabs)/more')} testID="profile-more" />
      </View>
      <Text style={styles.section}>{tr(l, ['ԿԱՐԳԱՎՈՐՈՒՄՆԵՐ', 'НАСТРОЙКИ', 'SETTINGS'])}</Text>
      <View style={{ gap: 8 }}>
        {can('preferences') ? <Row icon="sliders" tone="plain" title={tr(l, ['Լեզու, թեմա, ծանուցումներ', 'Язык, тема, уведомления', 'Language, theme, notifications'])} onPress={() => go('preferences')} /> : null}
        {can('security') ? <Row icon="lock" tone="plain" title={tr(l, ['Անվտանգություն և սարքեր', 'Безопасность и устройства', 'Security and devices'])} onPress={() => go('security')} testID="profile-security" /> : null}
        {can('help') ? <Row icon="life-buoy" tone="plain" title={tr(l, ['Օգնություն', 'Помощь', 'Help'])} onPress={() => go('help')} /> : null}
      </View>
      <Text style={styles.section}>{tr(l, ['ՀԱՇԻՎ', 'АККАУНТ', 'ACCOUNT'])}</Text>
      <View style={styles.listCard}>
        <View style={[styles.listIcon, { backgroundColor: palette.alternateSurface }]}><Feather name="mail" size={18} color={palette.foreground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>{tr(l, ['Էլեկտրոնային փոստ', 'Электронная почта', 'Email'])}</Text><Text style={styles.itemDescription}>{user?.email || tr(l, ['Նշված չէ', 'Не указана', 'Not provided'])}</Text></View>
      </View>
      <View style={styles.listCard}>
        <View style={[styles.listIcon, { backgroundColor: palette.alternateSurface }]}><Feather name="globe" size={18} color={palette.foreground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>{tr(l, ['Լեզու և արժույթ', 'Язык и валюта', 'Language & currency'])}</Text><Text style={styles.itemDescription}>{tr(l, ['Հայերեն', 'Русский', 'English'])} · {armenianCurrency(user?.currency)}</Text></View>
      </View>
      {error ? <View style={styles.errorBox}><Feather name="alert-circle" size={16} color={palette.destructive} /><Text style={styles.errorText}>{error}</Text></View> : null}
      <View style={styles.security}><View style={styles.securityIcon}><Feather name="shield" size={17} color={palette.success} /></View><View style={{ flex: 1 }}><Text style={styles.securityTitle}>{tr(l, ['Պաշտպանված սեսիա', 'Защищённый сеанс', 'Protected session'])}</Text><Text style={styles.securityText}>{tr(l, ['Տան հասանելիությունը որոշվում է սերվերի և ընտրված միջավայրի կողմից։', 'Доступ к дому определяется сервером и выбранным контекстом.', 'Home access is determined by the server and selected context.'])}</Text></View></View>
      <Pressable accessibilityRole="button" testID="profile-logout" disabled={logout.isPending} onPress={signOut} style={styles.logout}><Feather name="log-out" size={17} color={palette.dangerText} /><Text style={styles.logoutText}>{logout.isPending ? tr(l, ['Ավարտում ենք սեսիան…', 'Завершаем сеанс…', 'Ending session…']) : tr(l, ['Դուրս գալ հաշվից', 'Выйти из аккаунта', 'Sign out'])}</Text></Pressable>
      <Text style={styles.version}>{tr(l, ['IMTUN · VERNATUN-Ի ԿՈՂՄԻՑ', 'IMTUN · ОТ VERNATUN', 'IMTUN · BY VERNATUN'])}</Text>
    </ScrollView>
    <Modal visible={contextSheet} transparent animationType="slide" onRequestClose={() => setContextSheet(false)}>
      <View style={styles.sheetBackdrop}><Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Փակել տների ընտրությունը', 'Закрыть выбор дома', 'Close home selection'])} testID="context-sheet-backdrop" onPress={() => setContextSheet(false)} style={StyleSheet.absoluteFill} /><View style={styles.sheet}>
        <View style={styles.sheetHandle} /><View style={styles.sheetTitleRow}><View><Text style={styles.kicker}>{tr(l, ['ՁԵՐ ՄՈՒՏՔԸ', 'ВАШ ДОСТУП', 'YOUR ACCESS'])}</Text><Text style={styles.sheetTitle}>{tr(l, ['Ընտրեք տունը', 'Выберите дом', 'Choose a home'])}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Փակել', 'Закрыть', 'Close'])} testID="context-sheet-close" onPress={() => setContextSheet(false)} style={styles.close}><Feather name="x" size={20} color={palette.foreground} /></Pressable></View>
        <Text style={styles.sheetDescription}>{tr(l, ['Փոխվում է միայն ակտիվ միջավայրը։ Մուտքի իրավունքը ստուգում է սերվերը։', 'Меняется только активный контекст. Права доступа проверяет сервер.', 'Only the active context changes. Access rights are checked by the server.'])}</Text>
        {contexts.map((context) => {
          const selected = context.id === session.data?.contextId;
          return <Pressable accessibilityRole="button" accessibilityLabel={`${context.building_name || context.organization_name || tr(l, ['Բնակելի շենք', 'Жилой дом', 'Residential building'])}, ${context.unit_number ? `${tr(l, ['Բնակարան', 'Квартира', 'Apartment'])} ${context.unit_number}` : tr(l, ['Բնակչի մուտք', 'Доступ жителя', 'Resident access'])}`} testID={`profile-context-${context.id}`} key={context.id} disabled={selected || switchContext.isPending} onPress={() => changeContext(context)} style={[styles.contextOption, selected && styles.contextSelected]}>
            <View style={[styles.listIcon, selected && { backgroundColor: palette.accent }]}><Feather name="home" size={18} color={selected ? palette.accentForeground : palette.mutedForeground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>{context.building_name || context.organization_name || tr(l, ['Բնակելի շենք', 'Жилой дом', 'Residential building'])}</Text><Text style={styles.itemDescription}>{context.unit_number ? `${tr(l, ['Բնակարան', 'Квартира', 'Apartment'])} ${context.unit_number}` : tr(l, ['Բնակչի մուտք', 'Доступ жителя', 'Resident access'])}</Text></View>{selected ? <Feather name="check-circle" size={19} color={palette.success} /> : <Feather name="arrow-right" size={17} color={palette.subdued} />}
          </Pressable>;
        })}
        {switchContext.isPending ? <Text style={styles.muted}>{tr(l, ['Փոխում ենք տունը…', 'Меняем дом…', 'Switching home…'])}</Text> : null}
      </View></View>
    </Modal>
  </>;
}

const make_styles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background }, content: { paddingHorizontal: 21, paddingTop: 20, paddingBottom: 40 },
  top: { marginBottom: 17 }, logo: { width: 115, height: 49, marginLeft: -5 }, kicker: { color: palette.subdued, fontSize: 9, letterSpacing: 1.4, fontWeight: '800', marginTop: 8 },
  title: { color: palette.foreground, fontSize: 29, lineHeight: 35, letterSpacing: -0.7, fontWeight: '800' }, subtitle: { color: palette.mutedForeground, fontSize: 13, marginTop: 5, marginBottom: 21 },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 84, padding: 14, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.foreground, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: palette.surface, fontSize: 16, fontWeight: '800' },
  name: { color: palette.foreground, fontSize: 15, fontWeight: '800' }, email: { color: palette.mutedForeground, fontSize: 11, marginTop: 4 },
  section: { color: palette.subdued, fontSize: 9, fontWeight: '800', letterSpacing: 1.3, marginTop: 24, marginBottom: 9 },
  listCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, minHeight: 68, borderRadius: 13, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginBottom: 8 },
  listIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' }, itemLabel: { color: palette.foreground, fontSize: 13, fontWeight: '800' }, itemDescription: { color: palette.mutedForeground, fontSize: 11, marginTop: 4, lineHeight: 16 }, notInteractive: { opacity: 1 },
  security: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, marginTop: 16, borderRadius: 13, backgroundColor: palette.successSurface }, securityIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: palette.successSoft, alignItems: 'center', justifyContent: 'center' }, securityTitle: { color: palette.successDeep, fontSize: 12, fontWeight: '800' }, securityText: { color: palette.mutedForeground, fontSize: 10, lineHeight: 15, marginTop: 3 },
  logout: { marginTop: 20, minHeight: 49, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 12, borderWidth: 1, borderColor: palette.dangerBorder, backgroundColor: palette.dangerSurface }, logoutText: { color: palette.dangerText, fontSize: 13, fontWeight: '800' },
  version: { textAlign: 'center', color: palette.version, fontSize: 9, letterSpacing: 1.3, fontWeight: '700', marginTop: 23 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 11, backgroundColor: palette.destructiveSurface, borderRadius: 10, marginTop: 13 }, errorText: { color: palette.destructiveForeground, flex: 1, fontSize: 12, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 25, gap: 11, backgroundColor: palette.background }, muted: { color: palette.mutedForeground, textAlign: 'center', padding: 10, fontSize: 12 },
  retry: { backgroundColor: palette.primary, paddingHorizontal: 21, paddingVertical: 11, borderRadius: 10, marginTop: 5 }, retryText: { color: palette.foreground, fontWeight: '800' }, skeleton: { height: 18, width: '100%', borderRadius: 8, backgroundColor: palette.skeleton, marginBottom: 13 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: palette.overlay }, sheet: { backgroundColor: palette.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 11, paddingHorizontal: 20, paddingBottom: 30, maxHeight: '82%' },
  sheetHandle: { width: 38, height: 4, borderRadius: 3, backgroundColor: palette.handle, alignSelf: 'center', marginBottom: 17 }, sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: palette.foreground, fontSize: 23, letterSpacing: -0.5, fontWeight: '800', marginTop: 4 }, sheetDescription: { fontSize: 12, color: palette.mutedForeground, lineHeight: 18, marginTop: 9, marginBottom: 14 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  contextOption: { minHeight: 69, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 13, padding: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, contextSelected: { borderColor: palette.selectedBorder, backgroundColor: palette.selectedSurface },
});
