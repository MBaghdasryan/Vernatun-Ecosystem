import React from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useGetMobileAuthSession, useGetOperationalRequests } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const session = useGetMobileAuthSession();
  const requests = useGetOperationalRequests();
  const active = session.data?.contexts.find((item) => item.id === session.data?.contextId);
  const unitLabel = active?.unit_number ? `Квартира ${active.unit_number}` : 'Дом';

  if (session.isLoading) return <View style={styles.center}><View style={styles.skeleton} /><View style={[styles.skeleton, { width: '72%' }]} /><View style={[styles.skeleton, { height: 130 }]} /></View>;
  if (session.isError) return <View style={styles.center}><Feather name="wifi-off" size={28} color={colors.mutedForeground} /><Text style={styles.errorTitle}>Не удалось загрузить дом</Text><Text style={styles.muted}>Проверьте соединение и попробуйте ещё раз.</Text><Pressable accessibilityRole="button" testID="home-retry" onPress={() => session.refetch()} style={styles.retry}><Text style={styles.retryText}>Повторить</Text></Pressable></View>;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={session.isRefetching || requests.isRefetching} onRefresh={() => { session.refetch(); requests.refetch(); }} tintColor={colors.primary} />}>
      <View style={styles.topline}>
        <Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} accessibilityLabel="ImTun" />
        <Pressable accessibilityRole="button" accessibilityLabel="Изменить дом и квартиру" testID="home-context-button" onPress={() => router.push('/(tabs)/profile')} style={styles.unit}>
          <Feather name="home" size={15} color={colors.primary} />
          <View><Text style={styles.unitName}>{active?.building_name || active?.organization_name || 'Мой дом'}</Text><Text style={styles.unitCaption}>{unitLabel}</Text></View>
          <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <View style={styles.greeting}>
        <Text style={styles.kicker}>IMTUN · ДОМ И СЕРВИС</Text>
        <Text style={styles.title}>Здравствуйте, {session.data?.user?.name?.split(' ')[0] || 'сосед'}.</Text>
        <Text style={styles.subtitle}>Ваш дом — в порядке вещей.</Text>
      </View>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Feather name="sun" size={18} color={colors.primary} /></View>
        <Text style={styles.heroEyebrow}>ВАШ ДОМ СЕГОДНЯ</Text>
        <Text style={styles.heroTitle}>{requests.data?.length ? `${requests.data.length} обращений` : 'Всё важное — рядом'}</Text>
        <Text style={styles.heroText}>Создавайте заявки и следите за тем, как решаются вопросы дома.</Text>
        <Pressable accessibilityRole="button" testID="home-create-request" onPress={() => router.push('/(tabs)/requests')} style={styles.heroAction}>
          <Text style={styles.heroActionText}>Создать заявку</Text><Feather name="arrow-up-right" size={18} color={colors.foreground} />
        </Pressable>
        <View pointerEvents="none" style={styles.heroMark}><Feather name="home" size={148} color={palette.heroDecoration} /></View>
      </View>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Что нужно сделать?</Text><Text style={styles.sectionHint}>БЫСТРЫЙ ДОСТУП</Text></View>
      <View style={styles.quickGrid}>
        <Pressable accessibilityRole="button" testID="quick-request" onPress={() => router.push('/(tabs)/requests')} style={styles.quickCard}>
          <View style={[styles.quickIcon, { backgroundColor: palette.accent }]}><Feather name="tool" size={20} color={colors.primary} /></View><Text style={styles.quickTitle}>Заявки</Text><Text style={styles.quickSub}>Обращения по дому</Text>
        </Pressable>
        <Pressable accessibilityRole="button" testID="quick-profile" onPress={() => router.push('/(tabs)/profile')} style={styles.quickCard}>
          <View style={[styles.quickIcon, { backgroundColor: palette.alternateSurface }]}><Feather name="user" size={20} color={colors.foreground} /></View><Text style={styles.quickTitle}>Профиль</Text><Text style={styles.quickSub}>Аккаунт и квартира</Text>
        </Pressable>
      </View>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Последние заявки</Text><Pressable accessibilityRole="button" testID="home-all-requests" onPress={() => router.push('/(tabs)/requests')}><Text style={styles.link}>Все <Feather name="arrow-right" size={13} color={colors.accentForeground} /></Text></Pressable></View>
      {requests.isLoading ? <View style={styles.loadingCard}><View style={styles.line} /><View style={[styles.line, { width: '62%' }]} /></View> : requests.isError ? <View style={styles.inlineError}><Text style={styles.muted}>Список временно недоступен.</Text><Pressable onPress={() => requests.refetch()} testID="home-requests-retry"><Text style={styles.link}>Повторить</Text></Pressable></View> : requests.data?.length ? requests.data.slice(0, 2).map((row, index) => {
        const record = normalizeRow(row, index);
        return <View key={record.key} style={styles.requestCard}><View style={styles.requestIcon}><Feather name="clipboard" size={18} color={colors.accentForeground} /></View><View style={{ flex: 1 }}><Text style={styles.requestTitle} numberOfLines={1}>{record.subject}</Text><Text style={styles.requestMeta}>{record.status} · {record.date}</Text></View><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></View>;
      }) : <View style={styles.empty}><Feather name="inbox" size={23} color={colors.mutedForeground} /><Text style={styles.emptyTitle}>Заявок пока нет</Text><Text style={styles.muted}>Если что-то понадобится — мы рядом.</Text></View>}
      <Text style={styles.footer}>ImTun <Text style={styles.footerNote}>· забота о вашем доме</Text></Text>
    </ScrollView>
  );
}

function normalizeRow(row: unknown, index: number) {
  const value = row && typeof row === 'object' ? row as Record<string, unknown> : {};
  const text = (input: unknown, fallback: string) => typeof input === 'string' && input.trim() ? input.trim() : fallback;
  const dateRaw = value.created_at ?? value.createdAt;
  const date = typeof dateRaw === 'string' && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'Дата не указана';
  return { key: text(value.id, `request-${index}`), subject: text(value.subject, 'Обращение без названия'), status: text(value.status, 'Статус уточняется'), date };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background }, content: { paddingHorizontal: 21, paddingTop: 18, paddingBottom: 34 },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 28 },
  logo: { width: 112, height: 47, marginLeft: -5 }, unit: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, maxWidth: '58%' },
  unitName: { fontSize: 12, color: palette.foreground, fontWeight: '700' }, unitCaption: { fontSize: 11, color: palette.mutedForeground, marginTop: 2 },
  greeting: { marginBottom: 22 }, kicker: { fontSize: 10, letterSpacing: 1.5, color: palette.mutedForeground, fontWeight: '700', marginBottom: 9 },
  title: { fontSize: 25, lineHeight: 31, color: palette.foreground, fontWeight: '800', letterSpacing: -0.7 }, subtitle: { fontSize: 14, color: palette.mutedForeground, marginTop: 5 },
  hero: { backgroundColor: palette.foreground, padding: 21, borderRadius: 19, minHeight: 216, overflow: 'hidden', marginBottom: 27 },
  heroIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: palette.heroOverlay, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroEyebrow: { color: palette.heroMuted, fontSize: 10, letterSpacing: 1.35, fontWeight: '700' }, heroTitle: { color: palette.surface, fontSize: 23, fontWeight: '800', marginTop: 7, letterSpacing: -0.5 },
  heroText: { color: palette.heroMuted, fontSize: 13, lineHeight: 19, maxWidth: 265, marginTop: 5 },
  heroAction: { marginTop: 17, backgroundColor: palette.primary, minHeight: 44, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, width: 190 },
  heroActionText: { color: palette.foreground, fontSize: 13, fontWeight: '800' }, heroMark: { position: 'absolute', right: -23, bottom: -39, transform: [{ rotate: '-12deg' }] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: palette.foreground, letterSpacing: -0.3 }, sectionHint: { fontSize: 9, color: palette.subdued, letterSpacing: 1, fontWeight: '700' },
  quickGrid: { flexDirection: 'row', gap: 11, marginBottom: 27 }, quickCard: { flex: 1, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, padding: 14, minHeight: 122 },
  quickIcon: { height: 37, width: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, quickTitle: { fontSize: 14, color: palette.foreground, fontWeight: '800' }, quickSub: { fontSize: 11, color: palette.mutedForeground, marginTop: 3 },
  link: { fontSize: 12, fontWeight: '700', color: palette.accentForeground }, requestCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 70, padding: 12, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginBottom: 9 },
  requestIcon: { height: 38, width: 38, backgroundColor: palette.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, requestTitle: { fontSize: 13, fontWeight: '700', color: palette.foreground }, requestMeta: { fontSize: 11, color: palette.mutedForeground, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 21, backgroundColor: palette.surface, borderRadius: 14, borderWidth: 1, borderColor: palette.border, gap: 6 }, emptyTitle: { fontSize: 14, fontWeight: '700', color: palette.foreground },
  muted: { color: palette.mutedForeground, fontSize: 12, textAlign: 'center' }, footer: { marginTop: 24, fontSize: 12, color: palette.foreground, fontWeight: '800' }, footerNote: { color: palette.subdued, fontWeight: '400' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10, backgroundColor: palette.background }, errorTitle: { fontSize: 18, fontWeight: '800', color: palette.foreground },
  retry: { backgroundColor: palette.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 11, marginTop: 8 }, retryText: { color: palette.foreground, fontWeight: '800' },
  skeleton: { width: '100%', height: 20, borderRadius: 8, backgroundColor: palette.skeleton, marginBottom: 13 }, loadingCard: { backgroundColor: palette.surface, padding: 16, borderRadius: 14, borderColor: palette.border, borderWidth: 1, gap: 11 },
  line: { width: '82%', height: 11, backgroundColor: palette.skeleton, borderRadius: 6 }, inlineError: { backgroundColor: palette.surface, padding: 16, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
