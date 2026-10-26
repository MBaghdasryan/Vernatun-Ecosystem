import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { L, superViews, superTitle } from '@/lib/resident/text';
import { useLang } from '@/lib/resident/hooks';
import { domainTitle, domainViews } from '@/lib/resident/domain';
const icons: Record<string, keyof typeof Feather.glyphMap> = { finance: 'credit-card', meetings: 'users', notifications: 'bell', family: 'user-plus', meters: 'activity', announcements: 'volume-2', documents: 'file-text', passes: 'key', building: 'home', vehicles: 'truck', devices: 'smartphone', agreements: 'check-square', contacts: 'phone', directory: 'book', services: 'grid', community: 'message-circle', marketplace: 'shopping-bag', help: 'life-buoy', feedback: 'message-square', preferences: 'sliders', security: 'lock' };
export default function MoreScreen() { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const l = useLang(); const router = useRouter();
  return <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={st.content}>
    <Text style={st.h}>{L(l, ['Ծառայություններ', 'Сервисы', 'Services'])}</Text>
    <View style={st.grid}>{domainViews.map(v => <Pressable key={v} accessibilityRole="button" testID={'more-' + v} onPress={() => router.push({ pathname: '/resident/[section]', params: { section: v } })} style={st.tile}><Feather name={icons[v]} size={26} color={palette.primary} /><Text style={st.t}>{L(l, domainTitle[v])}</Text></Pressable>)}{superViews.map(v => <Pressable key={v} accessibilityRole="button" testID={'more-' + v} onPress={() => router.push({ pathname: '/resident/[section]', params: { section: v } })} style={st.tile}><Feather name={icons[v]} size={26} color={palette.primary} /><Text style={st.t}>{L(l, superTitle[v])}</Text></Pressable>)}<Pressable accessibilityRole="button" testID="more-security" onPress={() => router.push({ pathname: '/resident/[section]', params: { section: 'security' } })} style={st.tile}><Feather name="lock" size={26} color={palette.primary} /><Text style={st.t}>{L(l, ['Անվտանգություն', 'Безопасность', 'Security'])}</Text></Pressable></View>
  </ScrollView>;
}
const make_st = (palette: Palette) => StyleSheet.create({ content: { padding: 20, paddingTop: 64, paddingBottom: 120, gap: 18 }, h: { fontSize: 28, fontWeight: '800', color: palette.foreground }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, tile: { width: '48%', minHeight: 100, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: 14, justifyContent: 'space-between' }, t: { fontWeight: '700', fontSize: 13, color: palette.foreground } });
