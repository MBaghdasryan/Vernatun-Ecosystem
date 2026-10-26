import React from 'react';
import { Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetOperationalRequestsQueryKey, useGetMobileAuthSession, useGetOperationalRequests } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useLang, useWorkspace } from '@/lib/resident/hooks';
import { money, roleLabel, tr, useSection } from '@/lib/resident/shell';
import { useDomainAccess } from '@/components/resident/domain/useDomain';
import { EmptyState, ErrorBox, Row, SectionHead, Skeleton, Tile } from '@/components/resident/Ui';
import { formatArmenianDate, localizeRequestStatus } from '@/constants/armenian';

export default function HomeScreen() { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const router = useRouter(); const go = useSection(); const l = useLang();
  const insets = useSafeAreaInsets(); const top = Platform.OS === 'web' ? 67 : insets.top + 8;
  const session = useGetMobileAuthSession(); const ws = useWorkspace();
  const active = session.data?.contexts.find((c) => c.id === session.data?.contextId);
  const requests = useGetOperationalRequests({ query: {
    enabled: !!active?.permissions.includes('requests.own'),
    queryKey: [...getGetOperationalRequestsQueryKey(), active?.id ?? 'none'],
  } });
  const b = ws.data?.building; const home = ws.data?.home; const sum = home?.summary;
  const integ = (k: string) => ws.data?.integrations.find((i) => i.key === k)?.status === 'ACTIVE';
  const payable = money(home?.payableMinor, home?.currency); const overdue = money(home?.overdueMinor, home?.currency);
  const financeVisible = payable !== null || overdue !== null; // null = not authorised by server (e.g. family without delegation)
  const first = session.data?.user?.name?.split(' ')[0];
  // Server role only ARRANGES sections; each block below is still gated by server data/grants.
  const roleKey = (b?.role ?? active?.role_key ?? '').toLowerCase();
  const kind: 'owner' | 'renter' | 'family' | 'resident' = roleKey.includes('owner') ? 'owner' : /tenant|renter|lease/.test(roleKey) ? 'renter' : /family|member|household/.test(roleKey) ? 'family' : 'resident';
  const passes = useDomainAccess('passes'); const family = useDomainAccess('family');

  if (session.isLoading) return <View style={[st.root, { paddingTop: top, padding: 20, gap: 12 }]}><Skeleton /><Skeleton /><Skeleton /></View>;
  if (session.isError) return <View style={[st.root, st.center]}><ErrorBox message={tr(l, ['Չհաջողվեց բեռնել տան տվյալները', 'Не удалось загрузить данные дома', 'Could not load your home'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => session.refetch()} /></View>;

  const reqRows = (requests.data ?? []).slice(0, 2) as unknown as Record<string, unknown>[];
  return (
    <ScrollView style={st.root} contentContainerStyle={[st.content, { paddingTop: top }]} refreshControl={<RefreshControl refreshing={ws.isRefetching || requests.isRefetching} onRefresh={() => { ws.refetch(); requests.refetch(); session.refetch(); }} tintColor={palette.primary} />}>
      <View style={st.top}>
        <Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={st.logo} accessibilityLabel="ImTun" />
        <Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Փոխել գույքը', 'Сменить объект', 'Switch property'])} testID="home-context-button" onPress={() => router.push('/(tabs)/profile')} style={st.ctx}>
          <Text style={st.ctxRole} numberOfLines={1}>{roleLabel(l, b?.role ?? active?.role_key)}</Text><Feather name="chevron-down" size={14} color={palette.mutedForeground} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={tr(l, ['Ծանուցումներ', 'Уведомления', 'Notifications'])} testID="home-bell" onPress={() => go('notifications')} style={st.bell}>
          <Feather name="bell" size={20} color={palette.foreground} />{home?.unreadNotifications ? <View style={st.dot}><Text style={st.dotT}>{home.unreadNotifications > 9 ? '9+' : home.unreadNotifications}</Text></View> : null}
        </Pressable>
      </View>
      <Text style={st.hello}>{tr(l, ['Բարի օր', 'Добрый день', 'Good day'])}{first ? `, ${first}` : ''}</Text>
      <Text style={st.sub}>{tr(l, ['Ձեր տունը՝ մեկ վայրում', 'Всё о вашем доме в одном месте', 'Everything about your home in one place'])}</Text>

      <View style={st.prop}>
        <View style={st.propIcon}><Feather name="home" size={22} color={palette.primary} /></View>
        <View style={{ flex: 1 }}><Text style={st.propT} numberOfLines={1}>{b?.name || active?.building_name || active?.organization_name || '—'}</Text><Text style={st.propS} numberOfLines={1}>{[b?.unit || active?.unit_number ? `${tr(l, ['Բն.', 'Кв.', 'Apt'])} ${b?.unit || active?.unit_number}` : null, b?.address].filter(Boolean).join(' · ')}</Text></View>
      </View>

      {kind === 'owner' ? <>
      {ws.isPending ? <Skeleton /> : ws.isError ? <ErrorBox message={tr(l, ['Տվյալները ժամանակավորապես անհասանելի են', 'Данные временно недоступны', 'Data temporarily unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => ws.refetch()} /> : financeVisible ? (
        <View style={st.fin}>
          <Text style={st.finK}>{tr(l, ['ՎՃԱՐՄԱՆ ԵՆԹԱԿԱ', 'К ОПЛАТЕ', 'PAYABLE NOW'])}</Text>
          <Text style={st.finA} accessibilityLabel={payable ?? ''}>{payable ?? '—'}</Text>
          {overdue && home?.overdueMinor !== '0' ? <Text style={st.finO}>{tr(l, ['Ժամկետանց՝ ', 'Просрочено: ', 'Overdue: '])}{overdue}</Text> : null}
          <View style={st.finRow}>
            {integ('payments') ? <Pressable accessibilityRole="button" testID="home-pay" onPress={() => router.push('/(tabs)/bills')} style={st.pay}><Text style={st.payT}>{tr(l, ['Վճարել', 'Оплатить', 'Pay'])}</Text></Pressable> : <Text style={st.finNote}>{tr(l, ['Առցանց վճարումը դեռ միացված չէ', 'Онлайн-оплата пока не подключена', 'Online payment is not enabled yet'])}</Text>}
            <Pressable accessibilityRole="button" testID="home-bills" onPress={() => router.push('/(tabs)/bills')} style={st.det}><Text style={st.detT}>{tr(l, ['Մանրամասն', 'Подробнее', 'Details'])}</Text><Feather name="arrow-right" size={15} color={palette.surface} /></Pressable>
          </View>
        </View>) : null}

      <View style={st.tiles}>
        <Tile icon="tool" label={tr(l, ['Նոր հայտ', 'Новая заявка', 'New request'])} onPress={() => router.push('/(tabs)/requests')} testID="quick-request" />
        {passes.allowed ? <Tile icon="key" label={tr(l, ['Հյուրի անցաթուղթ', 'Гостевой пропуск', 'Guest pass'])} onPress={() => go('passes')} testID="quick-pass" /> : null}
        {integ('barrier') ? <Tile icon="unlock" label={tr(l, ['Մուտք', 'Доступ', 'Access'])} onPress={() => go('access')} testID="quick-access" /> : null}
        <Tile icon="grid" label={tr(l, ['Ծառայություններ', 'Сервисы', 'Services'])} onPress={() => router.push('/(tabs)/more')} testID="quick-services" />
      </View>

      {kind === 'owner' && family.allowed ? <Row icon="users" title={tr(l, ['Իմ ընտանիքը', 'Моя семья', 'My household'])} subtitle={tr(l, ['Անդամներ և հրավերներ', 'Участники и приглашения', 'Members and invitations'])} onPress={() => go('family')} testID="home-household" /> : null}
      <SectionHead title={tr(l, ['Ընթացիկ հայտեր', 'Текущие заявки', 'Current requests'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/requests')} testID="home-all-requests" />
      {requests.isLoading ? <Skeleton /> : requests.isError ? <ErrorBox message={tr(l, ['Ցանկը անհասանելի է', 'Список недоступен', 'List unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => requests.refetch()} /> : reqRows.length ? reqRows.map((r, i) => <Row key={String(r.id ?? i)} icon="clipboard" title={typeof r.subject === 'string' && r.subject ? r.subject : '—'} subtitle={`${localizeRequestStatus(String(r.status ?? ''))} · ${formatArmenianDate(r.created_at ?? r.createdAt)}`} onPress={() => router.push('/(tabs)/requests')} />) : <EmptyState title={tr(l, ['Ակտիվ հայտեր չկան', 'Активных заявок нет', 'No active requests'])} />}
      {(sum?.pendingHouseholdInvitations || sum?.pendingAgreements) ? <View style={{ gap: 8 }}>
        {sum?.pendingHouseholdInvitations ? <Row icon="user-plus" title={tr(l, ['Սպասվող հրավերներ', 'Ожидающие приглашения', 'Pending invitations'])} subtitle={String(sum.pendingHouseholdInvitations)} onPress={() => go('family')} /> : null}
        {sum?.pendingAgreements ? <Row icon="check-square" title={tr(l, ['Համաձայնություններ՝ հաստատման', 'Соглашения на подтверждение', 'Agreements to review'])} subtitle={String(sum.pendingAgreements)} onPress={() => go('agreements')} /> : null}
      </View> : null}

      <SectionHead title={tr(l, ['Կարևոր թարմացումներ', 'Важные обновления', 'Important updates'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/community')} />
      {sum?.announcements?.length ? sum.announcements.slice(0, 2).map((a) => <Row key={a.id} icon="volume-2" title={a.title} subtitle={formatArmenianDate(a.createdAt)} onPress={() => go('announcements')} />) : <EmptyState icon="volume-x" title={tr(l, ['Նոր հայտարարություններ չկան', 'Новых объявлений нет', 'No new announcements'])} />}
      {sum?.activeVoting?.length ? sum.activeVoting.slice(0, 1).map((v) => <Row key={v.id} icon="check-circle" tone="ok" title={v.title} subtitle={tr(l, ['Ակտիվ քվեարկություն', 'Активное голосование', 'Active vote'])} onPress={() => go('meetings')} />) : null}

      {sum?.emergencyContacts?.length ? <View style={st.emerg}>
        <Text style={st.emergT}>{tr(l, ['Արտակարգ կապ', 'Экстренная связь', 'Emergency'])}</Text>
        {sum.emergencyContacts.slice(0, 3).map((c) => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.title} ${c.phone}`} onPress={() => Linking.openURL(`tel:${c.phone.replace(/[^\d+]/g, '')}`)} style={st.emergRow}><Feather name="phone-call" size={16} color={palette.destructive} /><Text style={st.emergName} numberOfLines={1}>{c.title}</Text><Text style={st.emergPh}>{c.phone}</Text></Pressable>)}
      </View> : null}

      </> : kind === 'renter' ? <>
      {kind === 'renter' && family.allowed ? <Row icon="file-text" title={tr(l, ['Իմ վարձակալությունը', 'Моя аренда', 'My rental'])} subtitle={tr(l, ['Պայմանագիր և պարտավորություններ', 'Договор и обязательства', 'Lease and obligations'])} onPress={() => go('family')} testID="home-rental" /> : null}
      {ws.isPending ? <Skeleton /> : ws.isError ? <ErrorBox message={tr(l, ['Տվյալները ժամանակավորապես անհասանելի են', 'Данные временно недоступны', 'Data temporarily unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => ws.refetch()} /> : financeVisible ? (
        <View style={st.fin}>
          <Text style={st.finK}>{tr(l, ['ՎՃԱՐՄԱՆ ԵՆԹԱԿԱ', 'К ОПЛАТЕ', 'PAYABLE NOW'])}</Text>
          <Text style={st.finA} accessibilityLabel={payable ?? ''}>{payable ?? '—'}</Text>
          {overdue && home?.overdueMinor !== '0' ? <Text style={st.finO}>{tr(l, ['Ժամկետանց՝ ', 'Просрочено: ', 'Overdue: '])}{overdue}</Text> : null}
          <View style={st.finRow}>
            {integ('payments') ? <Pressable accessibilityRole="button" testID="home-pay" onPress={() => router.push('/(tabs)/bills')} style={st.pay}><Text style={st.payT}>{tr(l, ['Վճարել', 'Оплатить', 'Pay'])}</Text></Pressable> : <Text style={st.finNote}>{tr(l, ['Առցանց վճարումը դեռ միացված չէ', 'Онлайн-оплата пока не подключена', 'Online payment is not enabled yet'])}</Text>}
            <Pressable accessibilityRole="button" testID="home-bills" onPress={() => router.push('/(tabs)/bills')} style={st.det}><Text style={st.detT}>{tr(l, ['Մանրամասն', 'Подробнее', 'Details'])}</Text><Feather name="arrow-right" size={15} color={palette.surface} /></Pressable>
          </View>
        </View>) : null}

      <View style={st.tiles}>
        <Tile icon="tool" label={tr(l, ['Նոր հայտ', 'Новая заявка', 'New request'])} onPress={() => router.push('/(tabs)/requests')} testID="quick-request" />
        {passes.allowed ? <Tile icon="key" label={tr(l, ['Հյուրի անցաթուղթ', 'Гостевой пропуск', 'Guest pass'])} onPress={() => go('passes')} testID="quick-pass" /> : null}
        {integ('barrier') ? <Tile icon="unlock" label={tr(l, ['Մուտք', 'Доступ', 'Access'])} onPress={() => go('access')} testID="quick-access" /> : null}
        <Tile icon="grid" label={tr(l, ['Ծառայություններ', 'Сервисы', 'Services'])} onPress={() => router.push('/(tabs)/more')} testID="quick-services" />
      </View>

      <SectionHead title={tr(l, ['Ընթացիկ հայտեր', 'Текущие заявки', 'Current requests'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/requests')} testID="home-all-requests" />
      {requests.isLoading ? <Skeleton /> : requests.isError ? <ErrorBox message={tr(l, ['Ցանկը անհասանելի է', 'Список недоступен', 'List unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => requests.refetch()} /> : reqRows.length ? reqRows.map((r, i) => <Row key={String(r.id ?? i)} icon="clipboard" title={typeof r.subject === 'string' && r.subject ? r.subject : '—'} subtitle={`${localizeRequestStatus(String(r.status ?? ''))} · ${formatArmenianDate(r.created_at ?? r.createdAt)}`} onPress={() => router.push('/(tabs)/requests')} />) : <EmptyState title={tr(l, ['Ակտիվ հայտեր չկան', 'Активных заявок нет', 'No active requests'])} />}
      {(kind as string) !== 'owner' ? <Row icon="message-circle" title={(kind as string) === 'renter' ? tr(l, ['Կապ կառավարչի հետ', 'Чат с управляющей компанией', 'Chat with management']) : tr(l, ['Զրույցներ', 'Чаты', 'Chats'])} subtitle={sum?.unreadMessages ? tr(l, ['Չկարդացված՝ ', 'Непрочитанных: ', 'Unread: ']) + sum.unreadMessages : undefined} onPress={() => router.push({ pathname: '/(tabs)/community', params: { tab: 'chats' } })} testID="home-chat" /> : null}
      {(sum?.pendingHouseholdInvitations || sum?.pendingAgreements) ? <View style={{ gap: 8 }}>
        {sum?.pendingHouseholdInvitations ? <Row icon="user-plus" title={tr(l, ['Սպասվող հրավերներ', 'Ожидающие приглашения', 'Pending invitations'])} subtitle={String(sum.pendingHouseholdInvitations)} onPress={() => go('family')} /> : null}
        {sum?.pendingAgreements ? <Row icon="check-square" title={tr(l, ['Համաձայնություններ՝ հաստատման', 'Соглашения на подтверждение', 'Agreements to review'])} subtitle={String(sum.pendingAgreements)} onPress={() => go('agreements')} /> : null}
      </View> : null}

      <SectionHead title={tr(l, ['Կարևոր թարմացումներ', 'Важные обновления', 'Important updates'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/community')} />
      {sum?.announcements?.length ? sum.announcements.slice(0, 2).map((a) => <Row key={a.id} icon="volume-2" title={a.title} subtitle={formatArmenianDate(a.createdAt)} onPress={() => go('announcements')} />) : <EmptyState icon="volume-x" title={tr(l, ['Նոր հայտարարություններ չկան', 'Новых объявлений нет', 'No new announcements'])} />}
      {sum?.activeVoting?.length ? sum.activeVoting.slice(0, 1).map((v) => <Row key={v.id} icon="check-circle" tone="ok" title={v.title} subtitle={tr(l, ['Ակտիվ քվեարկություն', 'Активное голосование', 'Active vote'])} onPress={() => go('meetings')} />) : null}

      {sum?.emergencyContacts?.length ? <View style={st.emerg}>
        <Text style={st.emergT}>{tr(l, ['Արտակարգ կապ', 'Экстренная связь', 'Emergency'])}</Text>
        {sum.emergencyContacts.slice(0, 3).map((c) => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.title} ${c.phone}`} onPress={() => Linking.openURL(`tel:${c.phone.replace(/[^\d+]/g, '')}`)} style={st.emergRow}><Feather name="phone-call" size={16} color={palette.destructive} /><Text style={st.emergName} numberOfLines={1}>{c.title}</Text><Text style={st.emergPh}>{c.phone}</Text></Pressable>)}
      </View> : null}

      </> : kind === 'family' ? <>
      <View style={st.tiles}>
        <Tile icon="tool" label={tr(l, ['Նոր հայտ', 'Новая заявка', 'New request'])} onPress={() => router.push('/(tabs)/requests')} testID="quick-request" />
        {passes.allowed ? <Tile icon="key" label={tr(l, ['Հյուրի անցաթուղթ', 'Гостевой пропуск', 'Guest pass'])} onPress={() => go('passes')} testID="quick-pass" /> : null}
        {integ('barrier') ? <Tile icon="unlock" label={tr(l, ['Մուտք', 'Доступ', 'Access'])} onPress={() => go('access')} testID="quick-access" /> : null}
        <Tile icon="grid" label={tr(l, ['Ծառայություններ', 'Сервисы', 'Services'])} onPress={() => router.push('/(tabs)/more')} testID="quick-services" />
      </View>

      <SectionHead title={tr(l, ['Կարևոր թարմացումներ', 'Важные обновления', 'Important updates'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/community')} />
      {sum?.announcements?.length ? sum.announcements.slice(0, 2).map((a) => <Row key={a.id} icon="volume-2" title={a.title} subtitle={formatArmenianDate(a.createdAt)} onPress={() => go('announcements')} />) : <EmptyState icon="volume-x" title={tr(l, ['Նոր հայտարարություններ չկան', 'Новых объявлений нет', 'No new announcements'])} />}
      {sum?.activeVoting?.length ? sum.activeVoting.slice(0, 1).map((v) => <Row key={v.id} icon="check-circle" tone="ok" title={v.title} subtitle={tr(l, ['Ակտիվ քվեարկություն', 'Активное голосование', 'Active vote'])} onPress={() => go('meetings')} />) : null}

      {(kind as string) !== 'owner' ? <Row icon="message-circle" title={(kind as string) === 'renter' ? tr(l, ['Կապ կառավարչի հետ', 'Чат с управляющей компанией', 'Chat with management']) : tr(l, ['Զրույցներ', 'Чаты', 'Chats'])} subtitle={sum?.unreadMessages ? tr(l, ['Չկարդացված՝ ', 'Непрочитанных: ', 'Unread: ']) + sum.unreadMessages : undefined} onPress={() => router.push({ pathname: '/(tabs)/community', params: { tab: 'chats' } })} testID="home-chat" /> : null}
      {(sum?.pendingHouseholdInvitations || sum?.pendingAgreements) ? <View style={{ gap: 8 }}>
        {sum?.pendingHouseholdInvitations ? <Row icon="user-plus" title={tr(l, ['Սպասվող հրավերներ', 'Ожидающие приглашения', 'Pending invitations'])} subtitle={String(sum.pendingHouseholdInvitations)} onPress={() => go('family')} /> : null}
        {sum?.pendingAgreements ? <Row icon="check-square" title={tr(l, ['Համաձայնություններ՝ հաստատման', 'Соглашения на подтверждение', 'Agreements to review'])} subtitle={String(sum.pendingAgreements)} onPress={() => go('agreements')} /> : null}
      </View> : null}

      <SectionHead title={tr(l, ['Ընթացիկ հայտեր', 'Текущие заявки', 'Current requests'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/requests')} testID="home-all-requests" />
      {requests.isLoading ? <Skeleton /> : requests.isError ? <ErrorBox message={tr(l, ['Ցանկը անհասանելի է', 'Список недоступен', 'List unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => requests.refetch()} /> : reqRows.length ? reqRows.map((r, i) => <Row key={String(r.id ?? i)} icon="clipboard" title={typeof r.subject === 'string' && r.subject ? r.subject : '—'} subtitle={`${localizeRequestStatus(String(r.status ?? ''))} · ${formatArmenianDate(r.created_at ?? r.createdAt)}`} onPress={() => router.push('/(tabs)/requests')} />) : <EmptyState title={tr(l, ['Ակտիվ հայտեր չկան', 'Активных заявок нет', 'No active requests'])} />}
      {sum?.emergencyContacts?.length ? <View style={st.emerg}>
        <Text style={st.emergT}>{tr(l, ['Արտակարգ կապ', 'Экстренная связь', 'Emergency'])}</Text>
        {sum.emergencyContacts.slice(0, 3).map((c) => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.title} ${c.phone}`} onPress={() => Linking.openURL(`tel:${c.phone.replace(/[^\d+]/g, '')}`)} style={st.emergRow}><Feather name="phone-call" size={16} color={palette.destructive} /><Text style={st.emergName} numberOfLines={1}>{c.title}</Text><Text style={st.emergPh}>{c.phone}</Text></Pressable>)}
      </View> : null}

      {ws.isPending ? <Skeleton /> : ws.isError ? <ErrorBox message={tr(l, ['Տվյալները ժամանակավորապես անհասանելի են', 'Данные временно недоступны', 'Data temporarily unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => ws.refetch()} /> : financeVisible ? (
        <View style={st.fin}>
          <Text style={st.finK}>{tr(l, ['ՎՃԱՐՄԱՆ ԵՆԹԱԿԱ', 'К ОПЛАТЕ', 'PAYABLE NOW'])}</Text>
          <Text style={st.finA} accessibilityLabel={payable ?? ''}>{payable ?? '—'}</Text>
          {overdue && home?.overdueMinor !== '0' ? <Text style={st.finO}>{tr(l, ['Ժամկետանց՝ ', 'Просрочено: ', 'Overdue: '])}{overdue}</Text> : null}
          <View style={st.finRow}>
            {integ('payments') ? <Pressable accessibilityRole="button" testID="home-pay" onPress={() => router.push('/(tabs)/bills')} style={st.pay}><Text style={st.payT}>{tr(l, ['Վճարել', 'Оплатить', 'Pay'])}</Text></Pressable> : <Text style={st.finNote}>{tr(l, ['Առցանց վճարումը դեռ միացված չէ', 'Онлайн-оплата пока не подключена', 'Online payment is not enabled yet'])}</Text>}
            <Pressable accessibilityRole="button" testID="home-bills" onPress={() => router.push('/(tabs)/bills')} style={st.det}><Text style={st.detT}>{tr(l, ['Մանրամասն', 'Подробнее', 'Details'])}</Text><Feather name="arrow-right" size={15} color={palette.surface} /></Pressable>
          </View>
        </View>) : null}

      </> : <>
      {ws.isPending ? <Skeleton /> : ws.isError ? <ErrorBox message={tr(l, ['Տվյալները ժամանակավորապես անհասանելի են', 'Данные временно недоступны', 'Data temporarily unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => ws.refetch()} /> : financeVisible ? (
        <View style={st.fin}>
          <Text style={st.finK}>{tr(l, ['ՎՃԱՐՄԱՆ ԵՆԹԱԿԱ', 'К ОПЛАТЕ', 'PAYABLE NOW'])}</Text>
          <Text style={st.finA} accessibilityLabel={payable ?? ''}>{payable ?? '—'}</Text>
          {overdue && home?.overdueMinor !== '0' ? <Text style={st.finO}>{tr(l, ['Ժամկետանց՝ ', 'Просрочено: ', 'Overdue: '])}{overdue}</Text> : null}
          <View style={st.finRow}>
            {integ('payments') ? <Pressable accessibilityRole="button" testID="home-pay" onPress={() => router.push('/(tabs)/bills')} style={st.pay}><Text style={st.payT}>{tr(l, ['Վճարել', 'Оплатить', 'Pay'])}</Text></Pressable> : <Text style={st.finNote}>{tr(l, ['Առցանց վճարումը դեռ միացված չէ', 'Онлайн-оплата пока не подключена', 'Online payment is not enabled yet'])}</Text>}
            <Pressable accessibilityRole="button" testID="home-bills" onPress={() => router.push('/(tabs)/bills')} style={st.det}><Text style={st.detT}>{tr(l, ['Մանրամասն', 'Подробнее', 'Details'])}</Text><Feather name="arrow-right" size={15} color={palette.surface} /></Pressable>
          </View>
        </View>) : null}

      <View style={st.tiles}>
        <Tile icon="tool" label={tr(l, ['Նոր հայտ', 'Новая заявка', 'New request'])} onPress={() => router.push('/(tabs)/requests')} testID="quick-request" />
        {passes.allowed ? <Tile icon="key" label={tr(l, ['Հյուրի անցաթուղթ', 'Гостевой пропуск', 'Guest pass'])} onPress={() => go('passes')} testID="quick-pass" /> : null}
        {integ('barrier') ? <Tile icon="unlock" label={tr(l, ['Մուտք', 'Доступ', 'Access'])} onPress={() => go('access')} testID="quick-access" /> : null}
        <Tile icon="grid" label={tr(l, ['Ծառայություններ', 'Сервисы', 'Services'])} onPress={() => router.push('/(tabs)/more')} testID="quick-services" />
      </View>

      {sum?.emergencyContacts?.length ? <View style={st.emerg}>
        <Text style={st.emergT}>{tr(l, ['Արտակարգ կապ', 'Экстренная связь', 'Emergency'])}</Text>
        {sum.emergencyContacts.slice(0, 3).map((c) => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.title} ${c.phone}`} onPress={() => Linking.openURL(`tel:${c.phone.replace(/[^\d+]/g, '')}`)} style={st.emergRow}><Feather name="phone-call" size={16} color={palette.destructive} /><Text style={st.emergName} numberOfLines={1}>{c.title}</Text><Text style={st.emergPh}>{c.phone}</Text></Pressable>)}
      </View> : null}

      {(sum?.pendingHouseholdInvitations || sum?.pendingAgreements) ? <View style={{ gap: 8 }}>
        {sum?.pendingHouseholdInvitations ? <Row icon="user-plus" title={tr(l, ['Սպասվող հրավերներ', 'Ожидающие приглашения', 'Pending invitations'])} subtitle={String(sum.pendingHouseholdInvitations)} onPress={() => go('family')} /> : null}
        {sum?.pendingAgreements ? <Row icon="check-square" title={tr(l, ['Համաձայնություններ՝ հաստատման', 'Соглашения на подтверждение', 'Agreements to review'])} subtitle={String(sum.pendingAgreements)} onPress={() => go('agreements')} /> : null}
      </View> : null}

      <SectionHead title={tr(l, ['Կարևոր թարմացումներ', 'Важные обновления', 'Important updates'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/community')} />
      {sum?.announcements?.length ? sum.announcements.slice(0, 2).map((a) => <Row key={a.id} icon="volume-2" title={a.title} subtitle={formatArmenianDate(a.createdAt)} onPress={() => go('announcements')} />) : <EmptyState icon="volume-x" title={tr(l, ['Նոր հայտարարություններ չկան', 'Новых объявлений нет', 'No new announcements'])} />}
      {sum?.activeVoting?.length ? sum.activeVoting.slice(0, 1).map((v) => <Row key={v.id} icon="check-circle" tone="ok" title={v.title} subtitle={tr(l, ['Ակտիվ քվեարկություն', 'Активное голосование', 'Active vote'])} onPress={() => go('meetings')} />) : null}

      <SectionHead title={tr(l, ['Ընթացիկ հայտեր', 'Текущие заявки', 'Current requests'])} action={tr(l, ['Բոլորը', 'Все', 'All'])} onAction={() => router.push('/(tabs)/requests')} testID="home-all-requests" />
      {requests.isLoading ? <Skeleton /> : requests.isError ? <ErrorBox message={tr(l, ['Ցանկը անհասանելի է', 'Список недоступен', 'List unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => requests.refetch()} /> : reqRows.length ? reqRows.map((r, i) => <Row key={String(r.id ?? i)} icon="clipboard" title={typeof r.subject === 'string' && r.subject ? r.subject : '—'} subtitle={`${localizeRequestStatus(String(r.status ?? ''))} · ${formatArmenianDate(r.created_at ?? r.createdAt)}`} onPress={() => router.push('/(tabs)/requests')} />) : <EmptyState title={tr(l, ['Ակտիվ հայտեր չկան', 'Активных заявок нет', 'No active requests'])} />}
      {(kind as string) !== 'owner' ? <Row icon="message-circle" title={(kind as string) === 'renter' ? tr(l, ['Կապ կառավարչի հետ', 'Чат с управляющей компанией', 'Chat with management']) : tr(l, ['Զրույցներ', 'Чаты', 'Chats'])} subtitle={sum?.unreadMessages ? tr(l, ['Չկարդացված՝ ', 'Непрочитанных: ', 'Unread: ']) + sum.unreadMessages : undefined} onPress={() => router.push({ pathname: '/(tabs)/community', params: { tab: 'chats' } })} testID="home-chat" /> : null}
      </>}
    </ScrollView>
  );
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
  fin: { backgroundColor: palette.foreground, borderRadius: 18, padding: 18, gap: 4 }, finK: { color: palette.heroMuted, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' }, finA: { color: palette.surface, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 }, finO: { color: palette.selectedBorder, fontSize: 12, fontWeight: '700' },
  finRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }, finNote: { color: palette.heroMuted, fontSize: 12, flex: 1 },
  pay: { backgroundColor: palette.primary, minHeight: 44, borderRadius: 12, paddingHorizontal: 22, justifyContent: 'center' }, payT: { color: palette.surface, fontWeight: '800', fontSize: 14 },
  det: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: palette.heroOverlay }, detT: { color: palette.surface, fontWeight: '700', fontSize: 13 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emerg: { backgroundColor: palette.destructiveSurface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: palette.dangerBorder }, emergT: { fontSize: 12, fontWeight: '800', color: palette.dangerText, marginBottom: 2 },
  emergRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, emergName: { flex: 1, fontSize: 13, fontWeight: '700', color: palette.foreground }, emergPh: { fontSize: 13, fontWeight: '700', color: palette.destructive },
});
