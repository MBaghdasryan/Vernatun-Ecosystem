import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useContextId, useLang, useWorkspace } from '@/lib/resident/hooks';
import { tr } from '@/lib/resident/shell';
import { Card, Tabs } from '@/components/resident/Ui';
import RecordsList from '@/components/resident/RecordsList';
import Meetings from '@/components/resident/domain/Meetings';
import Announcements from '@/components/resident/domain/Announcements';
import { useDomainAccess } from '@/components/resident/domain/useDomain';
import { L } from '@/lib/resident/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGetMobileAuthSession } from '@workspace/api-client-react';
import { residentRole } from '@/lib/resident/navigation';

type Tab = 'news' | 'chats' | 'discussions' | 'voting';
export default function CommunityScreen() { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const l = useLang(); const router = useRouter(); const ctx = useContextId(); const ws = useWorkspace(); const session = useGetMobileAuthSession(); const current = session.data?.contexts.find((item) => item.id === session.data?.contextId); const initialRole = residentRole(current);
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const preferredTab: Tab = initialRole === 'family' ? 'chats' : 'news';
  const [tab, setTab] = useState<Tab>(initialTab === 'chats' || initialTab === 'discussions' || initialTab === 'voting' ? initialTab : preferredTab);
  const ann = useDomainAccess('announcements'); const meet = useDomainAccess('meetings');
  const available: Tab[] = [
    ...(ann.allowed ? ['news' as const] : []),
    ...(ws.data?.capabilities.conversations === true ? ['chats' as const] : []),
    ...(ws.data?.capabilities.discussions === true ? ['discussions' as const] : []),
    ...(meet.allowed ? ['voting' as const] : []),
  ];
  useEffect(() => {
    const requested = initialTab === 'chats' || initialTab === 'discussions' || initialTab === 'voting' || initialTab === 'news'
      ? initialTab as Tab : preferredTab;
    setTab(available.includes(requested) ? requested : available[0] ?? 'news');
  }, [initialTab, preferredTab, available.join('|')]);
  const activeTab = available.includes(tab) ? tab : available[0] ?? 'news';
  const insets = useSafeAreaInsets(); const top = Platform.OS === 'web' ? 67 : insets.top + 8;
  const unread = ws.data?.home.summary.unreadMessages ?? undefined;
  const selectTab = (next: Tab) => { setTab(next); router.setParams({ tab: next }); };
  return <ScrollView style={st.root} contentContainerStyle={[st.c, { paddingTop: top }]} keyboardShouldPersistTaps="handled">
     <Text style={st.h} accessibilityRole="header">{tr(l, roleTitle(ws.data?.building.role))}</Text>
      {available.length ? <Tabs value={activeTab} options={[
       ...(ann.allowed ? [['news', tr(l, ['Լուրեր', 'Объявления', 'News'])] as [Tab, string]] : []),
       ...(ws.data?.capabilities.conversations === true ? [['chats', tr(l, ['Զրույցներ', 'Чаты', 'Chats']), unread || undefined] as [Tab, string, number?]] : []),
       ...(ws.data?.capabilities.discussions === true ? [['discussions', tr(l, ['Քննարկումներ', 'Обсуждения', 'Discussions'])] as [Tab, string]] : []),
       ...(meet.allowed ? [['voting', tr(l, ['Քվեարկություն', 'Голосования', 'Voting'])] as [Tab, string]] : []),
      ]} onChange={selectTab} /> : <Card><Text style={{ color: palette.mutedForeground }}>{L(l, ['Համայնքի բաժինները հասանելի չեն', 'Разделы сообщества недоступны', 'Community sections are unavailable'])}</Text></Card>}
     <View key={(ctx ?? 'none') + activeTab} style={{ gap: 12 }}>
       {activeTab === 'news' && ann.allowed && <Announcements l={l} />}
       {activeTab === 'chats' && <RecordsList kind="conversations" l={l} />}
       {activeTab === 'discussions' && <RecordsList kind="discussions" l={l} />}
       {activeTab === 'voting' && meet.allowed && <Meetings l={l} />}
    </View>
  </ScrollView>;
}
const make_st = (palette: Palette) => StyleSheet.create({ root: { flex: 1, backgroundColor: palette.background }, c: { paddingHorizontal: 18, paddingBottom: 120, gap: 14 }, h: { fontSize: 26, fontWeight: '800', color: palette.foreground, letterSpacing: -0.6 } });

function roleTitle(role?: string): [string, string, string] {
  const value = role?.toLowerCase() ?? '';
  if (/tenant|renter|lease/.test(value)) return ['Կապ կառավարչի հետ', 'Связь с управляющей компанией', 'Management & community'];
  if (/family|member|household/.test(value)) return ['Համայնք', 'Соседи', 'Neighbors'];
  if (value.includes('owner')) return ['Համայնք', 'Сообщество дома', 'Home community'];
  return ['Համայնք', 'Жизнь дома', 'Community'];
}
