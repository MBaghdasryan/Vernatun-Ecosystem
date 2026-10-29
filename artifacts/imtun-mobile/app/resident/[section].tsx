import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { setCsrfTokenGetter, useGetMobileAuthSession } from '@workspace/api-client-react';
import { csrfSessionRef } from '../_layout';
import { L, S, kinds, superTitle, integrationsTitle } from '@/lib/resident/text';
import { useLang, useWorkspace } from '@/lib/resident/hooks';
import RecordsList from '@/components/resident/RecordsList';
import PrefsForm from '@/components/resident/PrefsForm';
import BuildingInfo from '@/components/resident/BuildingInfo';
import { Card, ErrorBox, Skeleton } from '@/components/resident/Ui';
import { domainTitle, domainViews, type DomainView } from '@/lib/resident/domain';
import { useDomainAccess } from '@/components/resident/domain/useDomain';
import Finance from '@/components/resident/domain/Finance';
import Meetings from '@/components/resident/domain/Meetings';
import Notifications from '@/components/resident/domain/Notifications';
import BroadcastInbox from '@/components/resident/domain/BroadcastInbox';
import Family from '@/components/resident/domain/Family';
import Meters from '@/components/resident/domain/Meters';
import Announcements from '@/components/resident/domain/Announcements';
import Documents from '@/components/resident/domain/Documents';
import Passes from '@/components/resident/domain/Passes';
import LocalSecurity from '@/components/security/LocalSecurity';
import Access from '@/components/resident/Access';
import Continuity, { continuitySections } from '@/components/resident/continuity/Gate';
import IntegrationsOverview from '@/components/resident/IntegrationsOverview';
function DomainSection({ view, l }: { view: DomainView; l: ReturnType<typeof useLang> }) {
  const acc = useDomainAccess(view);
  if (acc.loading) return <Skeleton />;
  if (!acc.allowed) return <Card><Text>{L(l, S.off)}</Text></Card>;
  return view === 'finance' ? <Finance l={l} /> : view === 'meetings' ? <Meetings l={l} /> : view === 'notifications' ? <Notifications l={l} /> : view === 'meters' ? <Meters l={l} /> : view === 'announcements' ? <Announcements l={l} /> : view === 'documents' ? <Documents l={l} /> : view === 'passes' ? <Passes l={l} /> : <Family l={l} />;
}
export default function ResidentSection() { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const { section } = useLocalSearchParams<{ section: string }>();
  const router = useRouter(); const l = useLang(); const session = useGetMobileAuthSession(); const ctx = session.data?.contextId ?? null; const ws = useWorkspace();
  useEffect(() => {
    if (session.data?.csrf) csrfSessionRef.current = session.data.csrf;
    setCsrfTokenGetter(() => csrfSessionRef.current);
  }, [session.data?.csrf]);
  const list = kinds[section ?? ''] ?? [];
  return <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityRole="button" accessibilityLabel={L(l, ['Հետ', 'Назад', 'Back'])} testID="resident-section-back" onPress={() => router.back()} style={st.back}><Feather name="chevron-left" size={22} color={palette.foreground} /><Text style={st.backT}>{section === 'integrations' ? L(l, integrationsTitle) : section === 'security' ? L(l, ['Անվտանգություն', 'Безопасность', 'Security']) : section === 'access' ? L(l, ['Մուտք', 'Доступ', 'Access']) : superTitle[section ?? ''] ? L(l, superTitle[section ?? '']) : (domainViews as readonly string[]).includes(section ?? '') ? L(l, domainTitle[section as DomainView]) : ''}</Text></Pressable>
    {/* key by context so forms and lists reset when the home changes */}
    <View key={(ctx ?? 'none') + section} style={{ gap: 16 }}>
      {continuitySections.includes(section ?? '') && <Continuity section={section ?? ''} l={l} />}
      {section === 'building' && <>{ws.isPending && <Skeleton />}{ws.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => ws.refetch()} />}{ws.data && <BuildingInfo ws={ws.data} l={l} />}<RecordsList kind="contacts" l={l} /></>}
      {section === 'security' && <LocalSecurity />}
      {section === 'access' && <Access l={l} />}
      {section === 'integrations' && <IntegrationsOverview l={l} />}
      {section === 'broadcasts' && <BroadcastInbox />}
      {section === 'preferences' && <>{ws.isPending && <Skeleton />}{ws.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => ws.refetch()} />}{ws.data && <PrefsForm key={JSON.stringify(ws.data.profile)} profile={ws.data.profile} l={l} />}</>}
      {(domainViews as readonly string[]).includes(section ?? '') && <DomainSection view={section as DomainView} l={l} />}
      {list.map(k => <RecordsList key={k} kind={k} l={l} />)}
    </View>
  </ScrollView>;
}
const make_st = (palette: Palette) => StyleSheet.create({ content: { padding: 20, paddingTop: 60, paddingBottom: 60, gap: 14 }, back: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }, backT: { fontWeight: '700', color: palette.foreground } });
