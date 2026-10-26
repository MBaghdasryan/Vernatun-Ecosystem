import React from 'react';
import { Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetOperationalRequestsQueryKey, useGetMobileAuthSession, useGetOperationalRequests } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useLang, useWorkspace } from '@/lib/resident/hooks';
import { money, roleLabel, tr } from '@/lib/resident/shell';
import { useDomainAccess } from '@/components/resident/domain/useDomain';
import { EmptyState, ErrorBox, Row, SectionHead, Skeleton, Tile } from '@/components/resident/Ui';
import { formatArmenianDate, localizeRequestStatus } from '@/constants/armenian';
import { residentRole, residentSectionAllowed } from '@/lib/resident/navigation';

export default function HomeScreen() {
  const palette = useAppPalette();
  const st = React.useMemo(() => make_st(palette), [palette]);
  const router = useRouter();
  const l = useLang();
  const insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 67 : insets.top + 8;
  const session = useGetMobileAuthSession();
  const ws = useWorkspace();
  const active = session.data?.contexts.find((context) => context.id === session.data?.contextId);
  const role = residentRole(active);
  const canReadRequests = !!active?.permissions.includes('requests.own');
  const canCreateRequests = !!active?.permissions.includes('requests.create');
  const canOpenAccess = !!active?.permissions.includes('device.read.own')
    && ws.data?.integrations.some((integration) => integration.key === 'barrier' && integration.status === 'ACTIVE') === true;
  const requests = useGetOperationalRequests({ query: {
    enabled: canReadRequests,
    queryKey: [...getGetOperationalRequestsQueryKey(), active?.id ?? 'none'],
  } });
  const finance = useDomainAccess('finance');
  const family = useDomainAccess('family');
  const passes = useDomainAccess('passes');
  const announcements = useDomainAccess('announcements');
  const meetings = useDomainAccess('meetings');
  const go = (section: string) => router.push({ pathname: '/resident/[section]', params: { section } });
  const home = ws.data?.home;
  const availableHomes = session.data?.contexts.length ?? 0;
  const summary = home?.summary;
  const payable = money(home?.payableMinor, home?.currency);
  const overdue = money(home?.overdueMinor, home?.currency);
  const financeAvailable = finance.allowed && (payable !== null || overdue !== null);
  const paymentsActive = ws.data?.integrations.some((integration) => integration.key === 'payments' && integration.status === 'ACTIVE') === true;
  const firstName = session.data?.user?.name?.split(' ')[0];
  const requestRows = (requests.data ?? []).slice(0, 2) as unknown as Record<string, unknown>[];
  const chatAvailable = active?.modules?.includes('community') === true
    && ws.data?.capabilities?.conversations === true;
  const roleGreeting = role === 'owner'
    ? tr(l, ['Ձեր տունը', 'Ваш дом', 'Your home'])
    : role === 'renter' ? tr(l, ['Ձեր վարձակալությունը', 'Ваша аренда', 'Your rental'])
      : role === 'family' ? tr(l, ['Ձեր տան համայնքը', 'Жизнь вашего дома', 'Your home community'])
        : tr(l, ['Ձեր տունը՝ մեկ վայրում', 'Всё о вашем доме в одном месте', 'Everything about your home in one place']);

  if (session.isPending) return <View style={[st.root, { paddingTop: top, padding: 20, gap: 12 }]}><Skeleton /><Skeleton /><Skeleton /></View>;
  if (session.isError) return <View style={[st.root, st.center]}><ErrorBox message={tr(l, ['Չհաջողվեց բեռնել տան տվյալները', 'Не удалось загрузить данные дома', 'Could not load your home'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => session.refetch()} /></View>;

  const financeCard = financeAvailable ? <View style={st.fin}>
    <Text style={st.finK}>{tr(l, ['ՎՃԱՐՄԱՆ ԵՆԹԱԿԱ', 'К ОПЛАТЕ', 'PAYABLE NOW'])}</Text>
    <Text style={st.finA} accessibilityLabel={payable ?? ''}>{payable ?? '—'}</Text>
    {overdue && home?.overdueMinor !== '0' ? <Text style={st.finO}>{tr(l, ['Ժամկետանց՝ ', 'Просрочено: ', 'Overdue: '])}{overdue}</Text> : null}
    <View style={st.finRow}>
      {paymentsActive ? <Pressable accessibilityRole="button" testID="home-pay" onPress={() => router.push('/(tabs)/bills')} style={st.pay}><Text style={st.payT}>{tr(l, ['Վճարել', 'Оплатить', 'Pay'])}</Text></Pressable> : <Text style={st.finNote}>{tr(l, ['Առցանց վճարումը դեռ միացված չէ', 'Онлайн-оплата пока не подключена', 'Online payment is not enabled yet'])}</Text>}
      <Pressable accessibilityRole="button" testID="home-bills" onPress={() => router.push('/(tabs)/bills')} style={st.det}><Text style={st.detT}>{tr(l, ['Մանրամասն', 'Подробнее', 'Details'])}</Text><Feather name="arrow-right" size={15} color={palette.surface} /></Pressable>
    </View>
  </View> : null;
  const requestBlock = canReadRequests ? <>
    <SectionHead title={tr(l, ['Ընթացիկ հայտեր', 'Текущие заявки', 'Current requests'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/requests')} testID="home-all-requests" />
    {requests.isPending ? <Skeleton /> : requests.isError
      ? <ErrorBox message={tr(l, ['Ցանկը անհասանելի է', 'Список недоступен', 'List unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => requests.refetch()} />
      : requestRows.length
        ? requestRows.map((row, index) => <Row key={String(row.id ?? index)} icon="clipboard" title={typeof row.subject === 'string' && row.subject ? row.subject : '—'} subtitle={`${localizeRequestStatus(String(row.status ?? ''))} · ${formatArmenianDate(row.created_at ?? row.createdAt)}`} onPress={() => router.push('/(tabs)/requests')} />)
        : <EmptyState icon="clipboard" title={tr(l, ['Ակտիվ հայտեր չկան', 'Активных заявок нет', 'No active requests'])} />}
  </> : null;
  const notices = announcements.allowed ? <>
    <SectionHead title={tr(l, ['Հայտարարություններ', 'Объявления', 'Notices'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/community')} />
    {summary?.announcements?.length
      ? summary.announcements.slice(0, 2).map((item) => <Row key={item.id} icon="volume-2" title={item.title} subtitle={formatArmenianDate(item.createdAt)} onPress={() => go('announcements')} />)
      : <EmptyState icon="volume-x" title={tr(l, ['Նոր հայտարարություններ չկան', 'Новых объявлений нет', 'No new announcements'])} />}
  </> : null;
  const events = meetings.allowed && summary?.activeVoting?.length ? <>
    <SectionHead title={tr(l, ['Ժողովներ և միջոցառումներ', 'События дома', 'Meetings & events'])} />
    {summary.activeVoting.slice(0, 2).map((item) => <Row key={item.id} icon="calendar" tone="ok" title={item.title} subtitle={tr(l, ['Ակտիվ քվեարկություն', 'Активное голосование', 'Active vote'])} onPress={() => go('meetings')} />)}
  </> : null;
  const chat = chatAvailable ? <Row icon="message-circle" title={tr(l, role === 'renter' ? ['Կապ կառավարչի հետ', 'Чат с управляющей компанией', 'Management chat'] : ['Զրույցներ', 'Чаты', 'Community chat'])} subtitle={summary?.unreadMessages ? tr(l, ['Չկարդացված՝ ', 'Непрочитанных: ', 'Unread: ']) + summary.unreadMessages : undefined} onPress={() => router.push({ pathname: '/(tabs)/community', params: { tab: 'chats' } })} testID="home-chat" /> : null;
  const emergency = summary?.emergencyContacts?.length ? <View style={st.emerg}>
    <Text style={st.emergT}>{tr(l, ['Արտակարգ կապ', 'Экстренная связь', 'Emergency'])}</Text>
    {summary.emergencyContacts.slice(0, 3).map((contact) => <Pressable key={contact.id} accessibilityRole="button" accessibilityLabel={`${contact.title} ${contact.phone}`} onPress={() => Linking.openURL(`tel:${contact.phone.replace(/[^\d+]/g, '')}`)} style={st.emergRow}><Feather name="phone-call" size={16} color={palette.destructive} /><Text style={st.emergName} numberOfLines={1}>{contact.title}</Text><Text style={st.emergPh}>{contact.phone}</Text></Pressable>)}
  </View> : null;
  const actions = <View style={st.tiles}>
    {canCreateRequests ? <Tile icon="tool" label={tr(l, ['Նոր հայտ', 'Новая заявка', 'New request'])} onPress={() => router.push('/(tabs)/requests')} testID="quick-request" /> : null}
    {passes.allowed ? <Tile icon="key" label={tr(l, ['Հյուրի անցաթուղթ', 'Гостевой пропуск', 'Guest pass'])} onPress={() => go('passes')} testID="quick-pass" /> : null}
    {canOpenAccess ? <Tile icon="unlock" label={tr(l, ['Մուտք', 'Доступ', 'Access'])} onPress={() => go('access')} testID="quick-access" /> : null}
    <Tile icon="grid" label={tr(l, ['Ծառայություններ', 'Сервисы', 'Services'])} onPress={() => router.push('/(tabs)/more')} testID="quick-services" />
  </View>;
  const pendingAgreements = residentSectionAllowed(active, ws.data, 'agreements') && summary?.pendingAgreements
    ? <Row icon="check-square" title={tr(l, ['Համաձայնություններ՝ հաստատման', 'Соглашения на подтверждение', 'Agreements to review'])} subtitle={String(summary.pendingAgreements)} onPress={() => go('agreements')} />
    : null;
  const household = family.allowed && summary?.pendingHouseholdInvitations
    ? <Row icon="user-plus" title={tr(l, ['Սպասվող հրավերներ', 'Ожидающие приглашения', 'Pending invitations'])} subtitle={String(summary.pendingHouseholdInvitations)} onPress={() => go('family')} />
    : null;

  return <ScrollView style={st.root} contentContainerStyle={[st.content, { paddingTop: top }]} refreshControl={<RefreshControl refreshing={ws.isRefetching || (canReadRequests && requests.isRefetching)} onRefresh={() => { void ws.refetch(); if (canReadRequests) void requests.refetch(); void session.refetch(); }} tintColor={palette.primary} />}>
    <View style={st.top}>
      <Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={st.logo} accessibilityLabel="ImTun" />
      <Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Փոխել գույքը', 'Сменить объект', 'Switch property'])} testID="home-context-button" onPress={() => router.push('/(tabs)/profile')} style={st.ctx}>
        <Text style={st.ctxRole} numberOfLines={1}>{roleLabel(l, active?.role_key)}</Text><Feather name="chevron-down" size={14} color={palette.mutedForeground} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Ծանուցումներ', 'Уведомления', 'Notifications'])} testID="home-bell" onPress={() => go('notifications')} style={st.bell}>
        <Feather name="bell" size={20} color={palette.foreground} />{home?.unreadNotifications ? <View style={st.dot}><Text style={st.dotT}>{home.unreadNotifications > 9 ? '9+' : home.unreadNotifications}</Text></View> : null}
      </Pressable>
    </View>
    <Text style={st.hello}>{tr(l, ['Բարի օր', 'Добрый день', 'Good day'])}{firstName ? `, ${firstName}` : ''}</Text>
    <Text style={st.sub}>{roleGreeting}</Text>
    {active ? <View style={st.prop}>
      <View style={st.propIcon}><Feather name="home" size={22} color={palette.primary} /></View>
      <View style={{ flex: 1 }}><Text style={st.propT} numberOfLines={1}>{ws.data?.building.name || active.building_name || active.organization_name || '—'}</Text><Text style={st.propS} numberOfLines={2}>{[ws.data?.building.unit || active.unit_number ? `${tr(l, ['Բն.', 'Кв.', 'Apt'])} ${ws.data?.building.unit || active.unit_number}` : null, ws.data?.building.address].filter(Boolean).join(' · ')}</Text></View>
      <Feather name="chevron-right" size={18} color={palette.mutedForeground} />
    </View> : <Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Ընտրել տունը', 'Выбрать дом', 'Choose a home'])} testID="home-select-context" onPress={() => router.push('/(tabs)/profile')} style={st.prop}>
      <View style={st.propIcon}><Feather name="home" size={22} color={palette.primary} /></View>
      <View style={{ flex: 1 }}><Text style={st.propT}>{tr(l, ['Ընտրեք ձեր տունը', 'Выберите свой дом', 'Choose your home'])}</Text><Text style={st.propS}>{availableHomes ? tr(l, [`Հասանելի է ${availableHomes} տուն`, `Доступно домов: ${availableHomes}`, `${availableHomes} home${availableHomes === 1 ? '' : 's'} available`]) : tr(l, ['Տան հասանելիություն դեռ նշանակված չէ', 'Доступ к дому пока не назначен', 'No home access is assigned yet'])}</Text></View>
      <Feather name="chevron-right" size={18} color={palette.mutedForeground} />
    </Pressable>}
    {active && ws.isPending ? <Skeleton /> : null}
    {active && ws.isError ? <ErrorBox message={tr(l, ['Տվյալները ժամանակավորապես անհասանելի են', 'Данные временно недоступны', 'Data temporarily unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => ws.refetch()} /> : null}
    {!active ? <View style={st.noHome}>
      <EmptyState icon="home" title={tr(l, ['Ձեր տան տվյալները դեռ ընտրված չեն', 'Дом ещё не выбран', 'No home selected yet'])} text={availableHomes ? tr(l, ['Ընտրեք հասանելի տունը՝ վճարումները, մուտքը և հայտերը տեսնելու համար։', 'Выберите доступный дом, чтобы увидеть платежи, доступ, объявления и заявки.', 'Select an available home to see payments, access, notices, and requests.']) : tr(l, ['Եթե տունը պետք է լինի հասանելի, դիմեք ձեր управляющей компании։', 'Если доступ к дому должен быть, обратитесь в управляющую компанию.', 'If you should have home access, contact your management company.'])} />
      {availableHomes ? <Pressable accessibilityRole="button" testID="home-select-context-cta" onPress={() => router.push('/(tabs)/profile')} style={st.selectHomeButton}><Text style={st.selectHomeText}>{tr(l, ['Ընտրել տունը', 'Выбрать дом', 'Choose a home'])}</Text><Feather name="arrow-right" size={16} color={palette.surface} /></Pressable> : null}
    </View> : role === 'owner' ? <>
      {finance.allowed ? financeCard ?? (!ws.isPending && !ws.isError ? <EmptyState icon="credit-card" title={tr(l, ['Վճարման տվյալներ դեռ չկան', 'Данные о платежах пока недоступны', 'No payment details available yet'])} /> : null) : null}
      {actions}
      {family.allowed ? <Row icon="users" title={tr(l, ['Իմ ընտանիքը', 'Моя семья', 'My household'])} subtitle={tr(l, ['Անդամներ և հրավերներ', 'Участники и приглашения', 'Members and invitations'])} onPress={() => go('family')} testID="home-household" /> : null}
      {requestBlock}{household}{pendingAgreements}{notices}{events}{emergency}
    </> : role === 'renter' ? <>
      {finance.allowed ? financeCard ?? (!ws.isPending && !ws.isError ? <EmptyState icon="file-text" title={tr(l, ['Վճարման տվյալները հասանելի չեն', 'Данные о платежах недоступны', 'Payment details unavailable'])} text={tr(l, ['Այս տան համար վճարման տվյալներ չեն տրամադրվել։', 'Для этого дома не предоставлены платёжные данные.', 'No payment details were provided for this home.'])} /> : null) : <EmptyState icon="file-text" title={tr(l, ['Վարձի տվյալները հասանելի չեն', 'Данные об аренде недоступны', 'Rental details unavailable'])} text={tr(l, ['Ընտրված միջավայրում վարձի կամ պարտավորությունների տվյալներ չեն տրամադրվել։', 'В выбранном контексте не предоставлены данные об аренде или обязательствах.', 'No rent or obligation details were provided for this context.'])} />}
      {requestBlock}
      {canCreateRequests && !canReadRequests ? <Row icon="tool" title={tr(l, ['Նոր հայտ', 'Новая заявка', 'New request'])} onPress={() => router.push('/(tabs)/requests')} /> : null}
      {canOpenAccess ? <Row icon="unlock" title={tr(l, ['Թույլատրված մուտք', 'Доступные входы', 'Permitted access'])} onPress={() => go('access')} /> : null}
      {chat}{notices}{events}{pendingAgreements}{emergency}
      {passes.allowed ? <Row icon="key" title={tr(l, ['Հյուրի անցաթուղթ', 'Гостевой пропуск', 'Guest pass'])} onPress={() => go('passes')} /> : null}
    </> : role === 'family' ? <>
      {canOpenAccess ? <Row icon="unlock" title={tr(l, ['Մուտք', 'Доступ', 'Access'])} subtitle={tr(l, ['Միայն ձեզ թույլատրված մուտքեր', 'Только доступные вам входы', 'Only access permitted to you'])} onPress={() => go('access')} testID="home-access" /> : null}
      {notices}{chat}{events}
      {canCreateRequests && !canReadRequests ? <Row icon="tool" title={tr(l, ['Ստեղծել հայտ', 'Создать заявку', 'Create a request'])} onPress={() => router.push('/(tabs)/requests')} /> : null}
      {requestBlock}
      {passes.allowed ? <Row icon="key" title={tr(l, ['Հյուրի անցաթուղթ', 'Гостевой пропуск', 'Guest pass'])} onPress={() => go('passes')} /> : null}
      {household}{emergency}
    </> : <>{actions}{financeCard}{requestBlock}{notices}{chat}{events}{emergency}</>}
    </ScrollView>;
}

const make_st = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background }, center: { justifyContent: 'center', padding: 20 }, content: { paddingHorizontal: 18, paddingBottom: 120, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 }, logo: { width: 100, height: 40, marginLeft: -4 },
  ctx: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minHeight: 44 }, ctxRole: { fontSize: 13, fontWeight: '700', color: palette.foreground, flexShrink: 1 },
  bell: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  dot: { position: 'absolute', top: 4, right: 4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }, dotT: { fontSize: 9, fontWeight: '800', color: palette.surface },
  hello: { fontSize: 25, fontWeight: '800', color: palette.foreground, letterSpacing: -0.6, marginTop: 6 }, sub: { fontSize: 13, color: palette.mutedForeground, marginTop: -6 },
  prop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  propIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' }, propT: { fontSize: 15, fontWeight: '800', color: palette.foreground }, propS: { fontSize: 12, color: palette.mutedForeground, marginTop: 3 },
  noHome: { gap: 12 }, selectHomeButton: { minHeight: 48, borderRadius: 12, backgroundColor: palette.primary, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, selectHomeText: { color: palette.surface, fontWeight: '800', fontSize: 14 },
  fin: { backgroundColor: palette.foreground, borderRadius: 18, padding: 18, gap: 4 }, finK: { color: palette.heroMuted, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' }, finA: { color: palette.surface, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 }, finO: { color: palette.selectedBorder, fontSize: 12, fontWeight: '700' },
  finRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }, finNote: { color: palette.heroMuted, fontSize: 12, flex: 1 },
  pay: { backgroundColor: palette.primary, minHeight: 44, borderRadius: 12, paddingHorizontal: 22, justifyContent: 'center' }, payT: { color: palette.surface, fontWeight: '800', fontSize: 14 },
  det: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: palette.heroOverlay }, detT: { color: palette.surface, fontWeight: '700', fontSize: 13 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emerg: { backgroundColor: palette.destructiveSurface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: palette.dangerBorder }, emergT: { fontSize: 12, fontWeight: '800', color: palette.dangerText, marginBottom: 2 },
  emergRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, emergName: { flex: 1, fontSize: 13, fontWeight: '700', color: palette.foreground }, emergPh: { fontSize: 13, fontWeight: '700', color: palette.destructive },
});
