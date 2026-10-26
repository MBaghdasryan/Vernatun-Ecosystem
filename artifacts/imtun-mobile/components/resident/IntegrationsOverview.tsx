import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useWorkspace } from '@/lib/resident/hooks';
import { L, integName, integStatus, integrationsTitle, type Language, type T } from '@/lib/resident/text';
import { useGetMobileAuthSession } from '@workspace/api-client-react';
import { residentSectionAllowed } from '@/lib/resident/navigation';
import { ErrorBox, Skeleton } from './Ui';

const items: { key: string; icon: keyof typeof Feather.glyphMap; preview?: 'camera' | 'intercom' }[] = [
  { key: 'payments', icon: 'credit-card' },
  { key: 'utilities', icon: 'activity' },
  { key: 'barrier', icon: 'unlock' },
  { key: 'ble', icon: 'key' },
  { key: 'intercom', icon: 'phone', preview: 'intercom' },
  { key: 'camera', icon: 'video', preview: 'camera' },
  { key: 'ai', icon: 'message-circle' },
  { key: 'push', icon: 'bell' },
];
const unavailable: T = [
  'Այս էկրանը միացված չէ ինտեգրացիային կամ ադապտերին․ այս հնարավորությունը դեռ օգտագործել հնարավոր չէ։',
  'Этот экран не подключён к интеграции или адаптеру, поэтому воспользоваться функцией пока нельзя.',
  'This screen is not connected to the integration or adapter, so this feature cannot be used here yet.',
];
const activeUnavailable: T = [
  'Միացումը կա, բայց ImTun-ում այս գործառույթի էկրանը դեռ հասանելի չէ։',
  'Подключение отмечено сервером, но экран этой функции в ImTun пока недоступен.',
  'The server reports a connection, but this feature is not available in ImTun yet.',
];
const selectHome: T = ['Ընտրեք տունը՝ կարգավիճակները տեսնելու համար։', 'Выберите дом, чтобы увидеть статусы.', 'Select a home to see integration statuses.'];
const cameraPreview: T = ['Նախադիտումը հասանելի չէ', 'Предпросмотр недоступен', 'Preview unavailable'];
const callArea: T = ['Տեսազանգը հասանելի չէ', 'Видеовызов недоступен', 'Video call unavailable'];
const accessLabel: T = ['Բացել մուտքի բաժինը', 'Перейти к доступу', 'Open Access'];

export default function IntegrationsOverview({ l }: { l: Language }) {
  const palette = useAppPalette();
  const st = React.useMemo(() => makeStyles(palette), [palette]);
  const ws = useWorkspace();
  const session = useGetMobileAuthSession();
  const router = useRouter();
  const context = session.data?.contexts.find((item) => item.id === session.data?.contextId);
  const canAccess = !!context?.permissions.includes('device.read.own') && residentSectionAllowed(context, ws.data, 'access');

  if (session.isPending || (!!session.data?.contextId && ws.isPending)) {
    return <View style={{ gap: 12 }}><Skeleton /><Skeleton /><Skeleton /></View>;
  }
  if (session.isError || (!!session.data?.contextId && ws.isError)) {
    return <ErrorBox message={L(l, ['Չհաջողվեց բեռնել ինտեգրացիաների կարգավիճակները։', 'Не удалось загрузить статусы интеграций.', 'Could not load integration statuses.'])} retryLabel={L(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => { void session.refetch(); void ws.refetch(); }} />;
  }

  const integrations = ws.data?.integrations ?? [];
  return <View style={st.wrap}>
    <View style={st.intro}>
      <View style={st.introIcon}><Feather name="home" size={20} color={palette.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={st.heading}>{L(l, integrationsTitle)}</Text>
        <Text style={st.introText}>{context?.building_name || context?.organization_name || L(l, selectHome)}</Text>
      </View>
    </View>
    {!context ? <View style={st.notice}><Feather name="info" size={17} color={palette.warning} /><Text style={st.noticeText}>{L(l, selectHome)}</Text></View> : null}
    {items.map((item) => {
      const record = integrations.find((integration) => integration.key === item.key);
      // Missing context or missing provider record is deliberately never treated as active.
      const status = context ? (record?.status ?? 'NOT_CONFIGURED') : 'NOT_CONFIGURED';
      const translatedStatus = integStatus[status] ?? integStatus.NOT_CONFIGURED;
      const tone = status === 'ACTIVE' ? 'active' : status === 'DEGRADED' ? 'degraded' : 'inactive';
      return <View key={item.key} testID={`integration-${item.key}`} accessibilityLabel={`${L(l, integName[item.key])}: ${L(l, translatedStatus)}`} style={st.card}>
        <View style={st.topRow}>
          <View style={st.iconBox}><Feather name={item.icon} size={18} color={palette.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{L(l, integName[item.key])}</Text>
            <View style={st.statusLine}>
              <View style={[st.dot, tone === 'active' ? st.activeDot : tone === 'degraded' ? st.warnDot : st.offDot]} />
              <Text style={[st.status, tone === 'active' ? st.activeText : tone === 'degraded' ? st.warnText : st.offText]}>{L(l, translatedStatus)}</Text>
            </View>
          </View>
          {item.key === 'barrier' && canAccess ? <Pressable accessibilityRole="button" accessibilityLabel={L(l, accessLabel)} testID="integration-barrier-access" onPress={() => router.push({ pathname: '/resident/[section]', params: { section: 'access' } })} style={st.accessButton}>
            <Text style={st.accessText}>{L(l, accessLabel)}</Text><Feather name="chevron-right" size={15} color={palette.accentForeground} />
          </Pressable> : null}
        </View>
        {item.preview === 'camera' ? <View accessibilityLabel={L(l, cameraPreview)} testID="integration-camera-preview" style={st.preview} /> : null}
        {item.preview === 'intercom' ? <View accessibilityLabel={L(l, callArea)} testID="integration-intercom-call-area" style={st.callArea}><Feather name="video" size={19} color={palette.subdued} /><Text style={st.previewText}>{L(l, callArea)}</Text></View> : null}
        <View style={st.inactiveNote}>
          <Feather name="minus-circle" size={14} color={palette.subdued} />
          <Text style={st.noteText}>{L(l, status === 'ACTIVE' ? activeUnavailable : unavailable)}</Text>
        </View>
      </View>;
    })}
    <Text style={st.footer}>{L(l, ['Կարգավիճակները տրամադրում է տան սերվերը։ Գործողություններն այստեղ հասանելի չեն։', 'Статусы предоставляет сервер дома. Действия здесь недоступны.', 'Statuses come from the home server. Actions are not available here.'])}</Text>
  </View>;
}

const makeStyles = (p: Palette) => StyleSheet.create({
  wrap: { gap: 12 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginBottom: 2 },
  introIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
  heading: { color: p.foreground, fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: -0.35 },
  introText: { color: p.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 2 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, padding: 12, backgroundColor: p.accent },
  noticeText: { flex: 1, color: p.foreground, fontSize: 12, lineHeight: 17 },
  card: { padding: 13, gap: 11, borderRadius: 15, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: p.alternateSurface },
  name: { color: p.foreground, fontWeight: '700', fontSize: 14 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  activeDot: { backgroundColor: p.successStrong }, warnDot: { backgroundColor: p.warning }, offDot: { backgroundColor: p.subdued },
  status: { fontSize: 11, fontWeight: '700' }, activeText: { color: p.successStrong }, warnText: { color: p.warningText }, offText: { color: p.mutedForeground },
  accessButton: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 40, paddingLeft: 6 },
  accessText: { fontSize: 11, color: p.accentForeground, fontWeight: '700', maxWidth: 88, textAlign: 'right' },
  inactiveNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  noteText: { flex: 1, color: p.mutedForeground, fontSize: 11, lineHeight: 16 },
  preview: { height: 94, borderWidth: 1, borderColor: p.border, borderRadius: 11, backgroundColor: p.alternateSurface },
  callArea: { minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: p.border, borderRadius: 11, backgroundColor: p.alternateSurface },
  previewText: { color: p.mutedForeground, fontSize: 11 },
  footer: { color: p.subdued, fontSize: 11, lineHeight: 16, paddingHorizontal: 3, paddingTop: 2 },
});
