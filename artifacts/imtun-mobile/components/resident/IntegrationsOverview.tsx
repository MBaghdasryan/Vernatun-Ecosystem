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

const items: { key: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'payments', icon: 'credit-card' },
  { key: 'utilities', icon: 'activity' },
  { key: 'barrier', icon: 'unlock' },
  { key: 'ble', icon: 'key' },
  { key: 'intercom', icon: 'phone' },
  { key: 'camera', icon: 'video' },
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
const edgeManaged: T = ['Միացումը կարգավորվում է Vernatun Edge-ում', 'Подключение настраивается в Vernatun Edge', 'Connection is configured in Vernatun Edge'];
const adminSetup: T = ['Կարգավորումը կատարում է տան ադմինիստրատորը', 'Настройку выполняет администратор дома', 'Configured by the home administrator'];
const invoices: T = ['Հաշիվներ և վճարման ենթակա գումար', 'Счета и сумма к оплате', 'Invoices and amount due'];
const paymentMethod: T = ['Վճարման եղանակ ավելացնել', 'Добавить способ оплаты', 'Add payment method'];
const digitalKey: T = ['Թվային բանալի', 'Цифровой ключ', 'Digital key'];
const connectKey: T = ['Միացնել բանալին', 'Подключить ключ', 'Connect key'];
const openDoor: T = ['Բացել դուռը', 'Открыть дверь', 'Open door'];
const closeDoor: T = ['Փակել դուռը', 'Закрыть дверь', 'Close door'];
const call: T = ['Զանգահարել', 'Позвонить', 'Call'];
const connectCamera: T = ['Միացնել տեսախցիկը', 'Подключить камеру', 'Connect camera'];
const liveView: T = ['Տեսախցիկի ուղիղ հեռարձակում', 'Прямой эфир с камеры', 'Camera live view'];
const aiWelcome: T = ['Օգնականը կհայտնվի միացումից հետո', 'Помощник появится после подключения', 'Assistant will appear after setup'];
const photoRecognition: T = ['Հարցնել լուսանկարով', 'Спросить по фото', 'Ask with a photo'];
const send: T = ['Ուղարկել', 'Отправить', 'Send'];
const pushPreview: T = ['Հայտեր · Վճարումներ · Համայնք · Մուտք', 'Заявки · Платежи · Сообщество · Доступ', 'Requests · Payments · Community · Access'];
const enablePush: T = ['Միացնել push-ը', 'Включить push', 'Enable push'];
const unavailableControl: T = ['Կակտիվանա ադմինիստրատորի և Edge ադապտերի ստուգումից հետո', 'Станет доступно после настройки администратором и проверки Edge-адаптера', 'Available after administrator setup and Edge adapter verification'];

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
        <FeaturePreview feature={item.key} l={l} st={st} palette={palette} status={status} />
        {item.key === 'barrier' ? <View style={st.inactiveNote}>
          <Feather name="info" size={14} color={palette.subdued} />
          <Text style={st.noteText}>{L(l, ['Շլագբաումի իրական կառավարումը հասանելի է միայն «Մուտք» բաժնում, եթե Cloud-ը թույլատրում է, և Edge-ը առցանց է։', 'Реальное управление шлагбаумом доступно только в разделе «Доступ», если Cloud разрешает действие и Edge в сети.', 'Real barrier controls are available only in Access when Cloud allows the action and Edge is online.'])}</Text>
        </View> : null}
        {item.key !== 'barrier' ? <View style={st.inactiveNote}>
          <Feather name="minus-circle" size={14} color={palette.subdued} />
          <Text style={st.noteText}>{L(l, status === 'ACTIVE' ? activeUnavailable : unavailable)}</Text>
        </View> : null}
      </View>;
    })}
    <Text style={st.footer}>{L(l, ['Կարգավիճակները տրամադրում է տան սերվերը։ Այս էկրանի նոր գործառույթները կմիացվեն ադմինիստրատորի կարգավորումից և Edge ստուգումից հետո։', 'Статусы предоставляет сервер дома. Новые функции на этом экране включатся после настройки администратором и проверки Edge.', 'Statuses come from the home server. New features on this screen will activate after administrator setup and Edge verification.'])}</Text>
  </View>;
}

function FeaturePreview({ feature, l, st, palette, status }: {
  feature: string; l: Language; st: ReturnType<typeof makeStyles>; palette: Palette; status: string;
}) {
  const disabledAction = (key: string, icon: keyof typeof Feather.glyphMap, label: T) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ disabled: true }} disabled testID={`integration-action-${key}`} style={st.actionDisabled}>
      <Feather name={icon} size={15} color={palette.subdued} />
      <Text style={st.actionText}>{L(l, label)}</Text>
    </Pressable>
  );
  const stateText = status === 'ACTIVE' ? activeUnavailable : unavailable;
  if (feature === 'payments') return <View style={st.featurePanel} testID="integration-payment-shell">
    <View style={st.previewHeading}><Feather name="file-text" size={15} color={palette.primary} /><Text style={st.previewHeadingText}>{L(l, invoices)}</Text></View>
    <View style={st.amountPreview}><Text style={st.amountValue}>—</Text><Text style={st.noteText}>{L(l, stateText)}</Text></View>
    {disabledAction('add-payment-method', 'credit-card', paymentMethod)}
    <Text style={st.noteText}>{L(l, adminSetup)}</Text>
  </View>;
  if (feature === 'utilities') return <View style={st.featurePanel}>
    <View style={st.previewHeading}><Feather name="activity" size={15} color={palette.primary} /><Text style={st.previewHeadingText}>{L(l, ['Սպասարկման տվյալներ', 'Данные коммунальных услуг', 'Utility service data'])}</Text></View>
    <Text style={st.noteText}>{L(l, stateText)}</Text>
  </View>;
  if (feature === 'ble') return <View style={st.featurePanel} testID="integration-ble-shell">
    <View style={st.previewHeading}><Feather name="key" size={15} color={palette.primary} /><Text style={st.previewHeadingText}>{L(l, digitalKey)}</Text></View>
    <Text style={st.noteText}>{L(l, edgeManaged)}</Text>
    <View style={st.actionRow}>
      {disabledAction('connect-key', 'bluetooth', connectKey)}
      {disabledAction('ble-open', 'unlock', openDoor)}
      {disabledAction('ble-close', 'lock', closeDoor)}
    </View>
  </View>;
  if (feature === 'intercom') return <View style={st.featurePanel} testID="integration-intercom-shell">
    <View style={st.previewHeading}><Feather name="phone" size={15} color={palette.primary} /><Text style={st.previewHeadingText}>{L(l, ['Դոմոֆոն և մուտքի դուռ', 'Домофон и входная дверь', 'Intercom and entrance door'])}</Text></View>
    <View accessibilityLabel={L(l, callArea)} testID="integration-intercom-call-area" style={st.callArea}>
      <Feather name="video" size={22} color={palette.subdued} />
      <Text style={st.previewText}>{L(l, callArea)}</Text>
      <Text style={st.previewSubtext}>{L(l, edgeManaged)}</Text>
    </View>
    <View style={st.actionRow}>
      {disabledAction('intercom-call', 'phone-call', call)}
      {disabledAction('intercom-open', 'unlock', openDoor)}
      {disabledAction('intercom-close', 'lock', closeDoor)}
    </View>
  </View>;
  if (feature === 'camera') return <View style={st.featurePanel} testID="integration-camera-shell">
    <View style={st.previewHeading}><Feather name="video" size={15} color={palette.primary} /><Text style={st.previewHeadingText}>{L(l, liveView)}</Text></View>
    <View accessibilityLabel={L(l, cameraPreview)} testID="integration-camera-preview" style={st.cameraViewport}>
      <Feather name="video-off" size={25} color={palette.subdued} />
      <Text style={st.previewText}>{L(l, cameraPreview)}</Text>
      <Text style={st.previewSubtext}>{L(l, edgeManaged)}</Text>
    </View>
    {disabledAction('connect-camera', 'link-2', connectCamera)}
  </View>;
  if (feature === 'ai') return <View style={st.featurePanel} testID="integration-ai-shell">
    <View style={st.previewHeading}><Feather name="message-circle" size={15} color={palette.primary} /><Text style={st.previewHeadingText}>{L(l, ['Հարցրեք տան մասին', 'Задайте вопрос о доме', 'Ask about your home'])}</Text></View>
    <View style={st.aiEmpty}><Feather name="message-square" size={19} color={palette.subdued} /><Text style={st.previewText}>{L(l, aiWelcome)}</Text></View>
    <View style={st.actionRow}>
      {disabledAction('ai-photo', 'image', photoRecognition)}
      {disabledAction('ai-send', 'send', send)}
    </View>
    <Text style={st.noteText}>{L(l, adminSetup)}</Text>
  </View>;
  if (feature === 'push') return <View style={st.featurePanel} testID="integration-push-shell">
    <View style={st.previewHeading}><Feather name="bell" size={15} color={palette.primary} /><Text style={st.previewHeadingText}>{L(l, ['Կարևոր ծանուցումներ', 'Важные уведомления', 'Important notifications'])}</Text></View>
    <Text style={st.noteText}>{L(l, pushPreview)}</Text>
    {disabledAction('enable-push', 'bell', enablePush)}
    <Text style={st.noteText}>{L(l, adminSetup)}</Text>
  </View>;
  return null;
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
  featurePanel: { gap: 9, padding: 10, borderRadius: 12, backgroundColor: p.warmSurface, borderWidth: 1, borderColor: p.border },
  previewHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  previewHeadingText: { flex: 1, color: p.foreground, fontSize: 12, fontWeight: '700' },
  amountPreview: { minHeight: 49, justifyContent: 'center', gap: 2, paddingHorizontal: 11, borderRadius: 10, backgroundColor: p.alternateSurface },
  amountValue: { color: p.foreground, fontSize: 19, fontWeight: '800' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  actionDisabled: { flexGrow: 1, minWidth: '30%', minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, opacity: 0.58 },
  actionText: { color: p.mutedForeground, fontSize: 11, fontWeight: '700', flexShrink: 1 },
  cameraViewport: { minHeight: 136, alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: p.border, borderRadius: 11, backgroundColor: p.secondary, padding: 12 },
  callArea: { minHeight: 102, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: p.border, borderRadius: 11, backgroundColor: p.secondary, padding: 12 },
  aiEmpty: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: p.secondary },
  previewText: { color: p.mutedForeground, fontSize: 11, textAlign: 'center' },
  previewSubtext: { color: p.subdued, fontSize: 10, textAlign: 'center' },
  footer: { color: p.subdued, fontSize: 11, lineHeight: 16, paddingHorizontal: 3, paddingTop: 2 },
});
