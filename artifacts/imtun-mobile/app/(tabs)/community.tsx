import React, { useState } from 'react';
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
import { L, S } from '@/lib/resident/text';
import { useLocalSearchParams } from 'expo-router';

type Tab = 'news' | 'chats' | 'discussions' | 'voting';
export default function CommunityScreen() { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const l = useLang(); const ctx = useContextId(); const ws = useWorkspace(); const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>(); const [tab, setTab] = useState<Tab>(initialTab === 'chats' || initialTab === 'discussions' || initialTab === 'voting' ? initialTab : 'news');
  const ann = useDomainAccess('announcements'); const meet = useDomainAccess('meetings');
  const insets = useSafeAreaInsets(); const top = Platform.OS === 'web' ? 67 : insets.top + 8;
  const unread = ws.data?.home.summary.unreadMessages ?? undefined;
  const off = <Card><Text style={{ color: palette.mutedForeground }}>{L(l, S.off)}</Text></Card>;
  return <ScrollView style={st.root} contentContainerStyle={[st.c, { paddingTop: top }]} keyboardShouldPersistTaps="handled">
    <Text style={st.h} accessibilityRole="header">{tr(l, ['Համայնք', 'Жизнь дома', 'Community'])}</Text>
    <Tabs value={tab} onChange={setTab} options={[['news', tr(l, ['Լուրեր', 'Объявления', 'News'])], ['chats', tr(l, ['Զրույցներ', 'Чаты', 'Chats']), unread || undefined], ['discussions', tr(l, ['Քննարկումներ', 'Обсуждения', 'Discussions'])], ['voting', tr(l, ['Քվեարկություն', 'Голосования', 'Voting'])]]} />
    <View key={(ctx ?? 'none') + tab} style={{ gap: 12 }}>
      {tab === 'news' && (ann.loading ? null : ann.allowed ? <Announcements l={l} /> : off)}
      {tab === 'chats' && <RecordsList kind="conversations" l={l} />}
      {tab === 'discussions' && <RecordsList kind="discussions" l={l} />}
      {tab === 'voting' && (meet.loading ? null : meet.allowed ? <Meetings l={l} /> : off)}
    </View>
  </ScrollView>;
}
const make_st = (palette: Palette) => StyleSheet.create({ root: { flex: 1, backgroundColor: palette.background }, c: { paddingHorizontal: 18, paddingBottom: 120, gap: 14 }, h: { fontSize: 26, fontWeight: '800', color: palette.foreground, letterSpacing: -0.6 } });
