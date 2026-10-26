import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useContextId, useLang, useWorkspace } from '@/lib/resident/hooks';
import { money, tr, useSection } from '@/lib/resident/shell';
import { useDomainAccess } from '@/components/resident/domain/useDomain';
import Finance from '@/components/resident/domain/Finance';
import { EmptyState, ErrorBox, Row, SectionHead, Skeleton } from '@/components/resident/Ui';

export default function BillsScreen() { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const l = useLang(); const ws = useWorkspace(); const ctx = useContextId(); const go = useSection(); const acc = useDomainAccess('finance');
  const insets = useSafeAreaInsets(); const top = Platform.OS === 'web' ? 67 : insets.top + 8;
  const h = ws.data?.home; const payable = money(h?.payableMinor, h?.currency); const overdue = money(h?.overdueMinor, h?.currency); const paid = money(h?.annualPaidMinor, h?.currency);
  const role = ws.data?.building.role.toLowerCase() ?? '';
  const pageTitle = /tenant|renter|lease/.test(role)
    ? tr(l, ['Վարձ և վճարումներ', 'Аренда и платежи', 'Rent & payments'])
    : role.includes('owner')
      ? tr(l, ['Ֆինանսներ', 'Финансы', 'Property finances'])
      : tr(l, ['Վճարներ', 'Начисления и платежи', 'Bills']);
  return <ScrollView style={st.root} contentContainerStyle={[st.c, { paddingTop: top }]} keyboardShouldPersistTaps="handled">
    <Text style={st.h} accessibilityRole="header">{pageTitle}</Text>
    {ws.isPending || acc.loading ? <Skeleton /> : ws.isError ? <ErrorBox message={tr(l, ['Տվյալները անհասանելի են', 'Данные недоступны', 'Data unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => ws.refetch()} /> : !acc.allowed || (payable === null && overdue === null) ? (
      <EmptyState icon="lock" title={tr(l, ['Ֆինանսական տվյալները ձեզ հասանելի չեն', 'Финансы вам недоступны', 'Finance is not available to you'])} text={tr(l, ['Հասանելիությունը տրամադրում է սեփականատերը կամ կառավարիչը։', 'Доступ предоставляет собственник или управляющая компания.', 'Access is granted by the owner or management.'])} />
    ) : <View key={ctx ?? 'none'} style={{ gap: 12 }}>
      <View style={st.card}>
        <Text style={st.k}>{tr(l, ['ԸՆԴԱՄԵՆԸ ՎՃԱՐԵԼՈՒ', 'ИТОГО К ОПЛАТЕ', 'TOTAL DUE'])}</Text>
        <Text style={st.a}>{payable ?? '—'}</Text>
        <View style={st.stats}>
          <View style={st.stat}><Text style={st.sk}>{tr(l, ['Ժամկետանց', 'Просрочено', 'Overdue'])}</Text><Text style={st.sv}>{overdue ?? '—'}</Text></View>
          <View style={st.stat}><Text style={st.sk}>{tr(l, ['Վճարված այս տարի', 'Оплачено за год', 'Paid this year'])}</Text><Text style={st.sv}>{paid ?? '—'}</Text></View>
        </View>
      </View>
      <SectionHead title={tr(l, ['Բաժիններ', 'Разделы', 'Sections'])} />
      <Row icon="activity" title={tr(l, ['Հաշվիչներ', 'Счётчики', 'Meters'])} onPress={() => go('meters')} />
      <Row icon="bar-chart-2" tone="plain" title={tr(l, ['Շենքի ֆինանսներ', 'Финансы дома', 'Building finances'])} onPress={() => go('building')} />
      <SectionHead title={tr(l, ['Հաշիվներ և վճարումներ', 'Счета и платежи', 'Invoices and payments'])} />
      <Finance l={l} />
    </View>}
  </ScrollView>;
}
const make_st = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background }, c: { paddingHorizontal: 18, paddingBottom: 120, gap: 12 }, h: { fontSize: 26, fontWeight: '800', color: palette.foreground, letterSpacing: -0.6 },
  card: { backgroundColor: palette.foreground, borderRadius: 18, padding: 18, gap: 4 }, k: { color: palette.heroMuted, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' }, a: { color: palette.surface, fontSize: 30, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 10, marginTop: 10 }, stat: { flex: 1, backgroundColor: palette.heroOverlay, borderRadius: 12, padding: 10 }, sk: { color: palette.heroMuted, fontSize: 11 }, sv: { color: palette.surface, fontSize: 15, fontWeight: '800', marginTop: 3 },
});
