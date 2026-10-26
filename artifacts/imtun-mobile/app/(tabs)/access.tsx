import React from 'react';
import { Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppPalette } from '@/hooks/useAppTheme';
import { useLang } from '@/lib/resident/hooks';
import { tr } from '@/lib/resident/shell';
import Access from '@/components/resident/Access';

export default function AccessTab() {
  const palette = useAppPalette();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 67 : insets.top + 8;
  return <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={[styles.content, { paddingTop: top }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{tr(lang, ['Մուտք', 'Доступ', 'Access'])}</Text>
    <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>{tr(lang, ['Մուտքի սարքերը ձեր տանը', 'Устройства доступа в вашем доме', 'Access devices in your home'])}</Text>
    <Access l={lang} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 116, gap: 12 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 2 },
});
