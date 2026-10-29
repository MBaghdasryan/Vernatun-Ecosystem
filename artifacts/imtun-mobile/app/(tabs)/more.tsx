import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { L, superViews, superTitle, integrationsTitle } from '@/lib/resident/text';
import { useLang, useWorkspace } from '@/lib/resident/hooks';
import { domainTitle, domainViews } from '@/lib/resident/domain';
import { useGetMobileAuthSession } from '@workspace/api-client-react';
import { residentRole, residentSectionAllowed, type ResidentRole } from '@/lib/resident/navigation';
import { EmptyState, ErrorBox, Skeleton } from '@/components/resident/Ui';
const icons: Record<string, keyof typeof Feather.glyphMap> = { finance: 'credit-card', meetings: 'users', notifications: 'bell', broadcasts: 'bell', family: 'user-plus', meters: 'activity', announcements: 'volume-2', documents: 'file-text', passes: 'key', building: 'home', vehicles: 'truck', devices: 'smartphone', integrations: 'cpu', agreements: 'check-square', contacts: 'phone', directory: 'book', services: 'grid', community: 'message-circle', marketplace: 'shopping-bag', help: 'life-buoy', feedback: 'message-square', preferences: 'sliders', security: 'lock' };
export default function MoreScreen() { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const l = useLang(); const router = useRouter(); const session = useGetMobileAuthSession(); const ws = useWorkspace();
  const context = session.data?.contexts.find((item) => item.id === session.data?.contextId);
  const role = residentRole(context);
  const domainOrder: Record<ResidentRole, readonly string[]> = {
    owner: ['finance', 'passes', 'family', 'meters', 'documents', 'meetings', 'announcements', 'notifications'],
    renter: ['finance', 'passes', 'documents', 'announcements', 'meetings', 'notifications', 'family', 'meters'],
    family: ['passes', 'announcements', 'meetings', 'notifications', 'documents', 'family', 'meters', 'finance'],
    resident: [...domainViews],
  };
  const superOrder: Record<ResidentRole, readonly string[]> = {
  owner: ['building', 'vehicles', 'agreements', 'contacts', 'directory', 'devices', 'services', 'community', 'marketplace', 'help', 'feedback', 'preferences', 'broadcasts'],
  renter: ['building', 'agreements', 'contacts', 'devices', 'services', 'community', 'help', 'feedback', 'preferences', 'vehicles', 'directory', 'marketplace', 'broadcasts'],
  family: ['building', 'contacts', 'devices', 'community', 'services', 'help', 'feedback', 'preferences', 'agreements', 'vehicles', 'directory', 'marketplace', 'broadcasts'],
  resident: [...superViews, 'broadcasts'],
  };
  const menuDomains = domainOrder[role].filter((key) => (domainViews as readonly string[]).includes(key) && residentSectionAllowed(context, ws.data, key));
  const menuSuper = superOrder[role].filter((key) => residentSectionAllowed(context, ws.data, key));
  const go = (section: string) => router.push({ pathname: '/resident/[section]', params: { section } });
  const openLegal = (document: 'privacy' | 'terms') => router.push({ pathname: '/legal/[document]', params: { document, lang: l } });
  const title = role === 'owner'
    ? L(l, ['Տան կառավարում', 'Управление домом', 'Property management'])
    : role === 'renter' ? L(l, ['Իմ վարձակալությունը', 'Моя аренда', 'My rental'])
      : role === 'family' ? L(l, ['Իմ հասանելիությունը', 'Мой доступ', 'My access'])
        : L(l, ['Ծառայություններ', 'Сервисы', 'Services']);
  return <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={st.content}>
    <Text style={st.h} accessibilityRole="header">{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={L(l, ['Անձնական էջ և կարգավորումներ', 'Профиль и настройки', 'Profile and settings'])} testID="more-profile" onPress={() => router.push('/(tabs)/profile')} style={st.profileCard}>
      <View style={st.profileIcon}><Feather name="user" size={20} color={palette.accentForeground} /></View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={st.profileName}>{session.data?.user?.name || L(l, ['Անձնական էջ', 'Профиль', 'Profile'])}</Text>
        <Text numberOfLines={1} style={st.profileDescription}>{context?.building_name || context?.organization_name || L(l, ['Հաշիվ և կարգավորումներ', 'Аккаунт и настройки', 'Account and settings'])}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={palette.mutedForeground} />
    </Pressable>
    {session.isPending || (!!context && ws.isPending) ? <><Skeleton /><Skeleton /></> : session.isError || (!!context && ws.isError) ? <ErrorBox message={L(l, ['Չհաջողվեց բեռնել հասանելի բաժինները։', 'Не удалось загрузить доступные разделы.', 'Could not load available sections.'])} retryLabel={L(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => { void session.refetch(); void ws.refetch(); }} /> : !context ? <>
      <EmptyState icon="home" title={L(l, ['Ընտրեք տունը՝ ծառայությունները տեսնելու համար', 'Выберите дом, чтобы увидеть сервисы', 'Select a home to see services'])} />
      <View style={st.grid}><Pressable accessibilityRole="button" accessibilityLabel={L(l, integrationsTitle)} testID="more-integrations" onPress={() => go('integrations')} style={st.tile}><Feather name={icons.integrations} size={24} color={palette.primary} /><Text style={st.t}>{L(l, integrationsTitle)}</Text></Pressable></View>
    </> : <>
      <Text style={st.kicker}>{L(l, ['ՁԵՐ ԲԱԺԻՆՆԵՐԸ', 'ВАШИ РАЗДЕЛЫ', 'YOUR SECTIONS'])}</Text>
      <View style={st.grid}>
        {menuDomains.map((v) => <Pressable key={v} accessibilityRole="button" accessibilityLabel={L(l, domainTitle[v as keyof typeof domainTitle])} testID={'more-' + v} onPress={() => go(v)} style={st.tile}><Feather name={icons[v]} size={24} color={palette.primary} /><Text style={st.t}>{L(l, domainTitle[v as keyof typeof domainTitle])}</Text></Pressable>)}
        {menuSuper.map((v) => <Pressable key={v} accessibilityRole="button" accessibilityLabel={L(l, superTitle[v])} testID={'more-' + v} onPress={() => go(v)} style={st.tile}><Feather name={icons[v]} size={24} color={palette.primary} /><Text style={st.t}>{L(l, superTitle[v])}</Text></Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel={L(l, integrationsTitle)} testID="more-integrations" onPress={() => go('integrations')} style={st.tile}><Feather name={icons.integrations} size={24} color={palette.primary} /><Text style={st.t}>{L(l, integrationsTitle)}</Text></Pressable>
        {residentSectionAllowed(context, ws.data, 'access') ? <Pressable accessibilityRole="button" accessibilityLabel={L(l, ['Մուտք', 'Доступ', 'Access'])} testID="more-access" onPress={() => go('access')} style={st.tile}><Feather name="unlock" size={24} color={palette.primary} /><Text style={st.t}>{L(l, ['Մուտք', 'Доступ', 'Access'])}</Text></Pressable> : null}
        {residentSectionAllowed(context, ws.data, 'security') ? <Pressable accessibilityRole="button" testID="more-security" onPress={() => go('security')} style={st.tile}><Feather name="lock" size={24} color={palette.primary} /><Text style={st.t}>{L(l, ['Անվտանգություն', 'Безопасность', 'Security'])}</Text></Pressable> : null}
      </View>
      {!menuDomains.length && !menuSuper.length ? <EmptyState icon="grid" title={L(l, ['Այս միջավայրի համար հասանելի ծառայություններ չկան', 'Для этого контекста нет доступных сервисов', 'No services are available for this context'])} /> : null}
    </>}
    <Text style={st.kicker}>{L(l, ['ԻՐԱՎԱԿԱՆ ՏԵՂԵԿՈՒԹՅՈՒՆ', 'ПРАВОВАЯ ИНФОРМАЦИЯ', 'LEGAL INFORMATION'])}</Text>
    <View style={st.grid}>
      <Pressable accessibilityRole="button" accessibilityLabel={L(l, ['Գաղտնիության քաղաքականություն', 'Политика конфиденциальности', 'Privacy policy'])} testID="more-privacy" onPress={() => openLegal('privacy')} style={st.tile}>
        <Feather name="shield" size={21} color={palette.primary} /><Text style={st.t}>{L(l, ['Գաղտնիություն', 'Конфиденциальность', 'Privacy'])}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={L(l, ['Օգտագործման պայմաններ', 'Условия использования', 'Terms of use'])} testID="more-terms" onPress={() => openLegal('terms')} style={st.tile}>
        <Feather name="file-text" size={21} color={palette.primary} /><Text style={st.t}>{L(l, ['Օգտագործման պայմաններ', 'Условия использования', 'Terms of use'])}</Text>
      </Pressable>
    </View>
  </ScrollView>;
}
const make_st = (palette: Palette) => StyleSheet.create({
  content: { padding: 18, paddingTop: 64, paddingBottom: 120, gap: 15 },
  h: { fontSize: 28, fontWeight: '800', color: palette.foreground },
  kicker: { color: palette.mutedForeground, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '46%', minWidth: 140, minHeight: 94, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: 13, justifyContent: 'space-between' },
  t: { fontWeight: '700', fontSize: 13, color: palette.foreground },
  profileCard: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  profileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  profileName: { fontSize: 14, fontWeight: '800', color: palette.foreground },
  profileDescription: { marginTop: 3, fontSize: 12, color: palette.mutedForeground },
});
