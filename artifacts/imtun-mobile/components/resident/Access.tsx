import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMobileAuthSession, useListMyBuildingDevices, useGetMyEdgeCommand, useRequestMyBuildingDeviceCommand, getGetMyEdgeCommandQueryKey, getListMyBuildingDevicesQueryKey, type EdgeResidentDevice, type AvailableDeviceAction, type EdgeResidentCommand } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { newUuid } from '@/lib/resident/hooks';
import { tr } from '@/lib/resident/shell';
import type { Language } from '@/lib/resident/text';
import { EmptyState, ErrorBox, SectionHead, Skeleton } from './Ui';

type Outcome = { kind: 'pending' | 'sent' | 'ok' | 'denied' | 'offline' | 'expired' | 'error'; at: number };
const OPEN = 'BARRIER.OPEN' as const;

/** The server scopes /me/buildings/:id/devices to the active assignment only.
 * For another building the user must first switch to its authenticated context. */
export default function Access({ l }: { l: Language }) {
  const session = useGetMobileAuthSession();
  const active = session.data?.contexts.find(c => c.id === session.data?.contextId);
  const palette = useAppPalette();
  if (session.isPending) return <Skeleton />;
  if (!active?.building_id || !active.permissions.includes('device.read.own')) return <EmptyState icon="lock" title={tr(l, ['Մուտքի սարքեր չկան', 'Нет устройств доступа', 'No access devices'])} text={tr(l, ['Այս տան համար հասանելիություն չկա։', 'Для этого дома доступ не предоставлен.', 'Access is not available for this home.'])} />;
  return <View style={{ gap: 18 }}>
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}><Feather name="shield" size={15} color={palette.successStrong} /><Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: palette.mutedForeground }}>{tr(l, ['Կոճակը հայտնվում է միայն այն ժամանակ, երբ սերվերը թույլատրում է։ «Բացված է» կցուցադրվի միայն սարքի հաստատումից հետո։', 'Кнопка появляется только если сервер разрешает действие. «Открыто» показывается только после подтверждения устройства.', 'Buttons appear only when the server allows the action. "Opened" is shown only after the device confirms.'])}</Text></View>
    <BuildingDevices key={active.id} buildingId={active.building_id} name={active.building_name || active.organization_name || '—'} l={l} />
    {(session.data?.contexts ?? []).some(c => c.id !== active.id && c.building_id) && <Text style={{ color: palette.mutedForeground, fontSize: 12 }}>{tr(l, ['Այլ շենքի սարքերը տեսնելու համար փոխեք տունը անձնական էջում։', 'Чтобы увидеть устройства другого здания, переключите дом в профиле.', 'Switch homes in Profile to see another building’s devices.'])}</Text>}
  </View>;
}

function BuildingDevices({ buildingId, name, l }: { buildingId: string; name: string; l: Language }) {
  const q = useListMyBuildingDevices(buildingId);
  return <View style={{ gap: 10 }}>
    <SectionHead title={name} />
    {q.isPending ? <Skeleton /> : q.isError ? <ErrorBox message={(q.error as { status?: number })?.status === 403 ? tr(l, ['Այս շենքում մուտքի իրավունք չունեք', 'Нет прав доступа в этом здании', 'You have no access rights in this building']) : tr(l, ['Սարքերի ցանկը անհասանելի է', 'Список устройств недоступен', 'Device list unavailable'])} retryLabel={tr(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => q.refetch()} />
      : !q.data?.length ? <EmptyState icon="lock" title={tr(l, ['Թույլատրված սարքեր չկան', 'Нет разрешённых устройств', 'No permitted devices'])} />
      : q.data.map((d) => <DeviceCard key={d.id} device={d} buildingId={buildingId} l={l} />)}
  </View>;
}

function DeviceCard({ device, buildingId, l }: { device: EdgeResidentDevice; buildingId: string; l: Language }) {
  const palette = useAppPalette(); const st = useMemo(() => make(palette), [palette]);
  const qc = useQueryClient(); const cmd = useRequestMyBuildingDeviceCommand();
  const [outcome, setOutcome] = useState<Outcome | null>(null); const inFlight = useRef(false);
  const [commandId, setCommandId] = useState<string | null>(null);
  const command = useGetMyEdgeCommand(commandId ?? '', { query: {
    queryKey: getGetMyEdgeCommandQueryKey(commandId ?? ''),
    enabled: !!commandId,
    refetchInterval: q => {
      const status = q.state.data?.status;
      return status && ['SUCCESS', 'DENIED', 'FAILED', 'TIMEOUT', 'CANCELLED'].includes(status) ? false : 2000;
    },
  } });
  const commandStatus = command.data?.status;
  const unresolved = !!commandId && !commandStatus || !!commandStatus && !['SUCCESS', 'DENIED', 'FAILED', 'TIMEOUT', 'CANCELLED'].includes(commandStatus);
  useEffect(() => {
    if (!commandStatus) return;
    if (commandStatus === 'SUCCESS' || commandStatus === 'DENIED' || commandStatus === 'FAILED' || commandStatus === 'TIMEOUT' || commandStatus === 'CANCELLED') {
      setOutcome({ kind: commandStatus === 'SUCCESS' ? 'ok' : commandStatus === 'DENIED' ? 'denied' : commandStatus === 'TIMEOUT' ? 'expired' : 'error', at: Date.now() });
      void qc.invalidateQueries({ queryKey: getListMyBuildingDevicesQueryKey(buildingId) });
    }
  }, [commandStatus, buildingId, qc]);
  const avail = device.availability; const online = avail ? avail.online : device.reported_online === true;
  const actions: AvailableDeviceAction[] = (avail?.actions ?? []).filter((a) => a.capability === OPEN && device.permittedCapabilities.includes(OPEN));
  const label = device.label || device.name;
  const type = (device.device_type || device.profile || '').toLowerCase();
  const icon: keyof typeof Feather.glyphMap = type.includes('gate') || type.includes('barrier') ? 'sliders' : type.includes('door') ? 'log-in' : 'lock';

  const send = () => {
    if (inFlight.current || unresolved) return; inFlight.current = true; setCommandId(null);
    setOutcome({ kind: 'pending', at: Date.now() });
    cmd.mutate({ buildingId, deviceId: device.id, data: { capability: OPEN, reason: 'Resident request from ImTun mobile', idempotencyKey: newUuid() } }, {
      onSuccess: (r: EdgeResidentCommand) => { setCommandId(r.commandId); setOutcome({ kind: r.status === 'SUCCESS' ? 'ok' : r.status === 'DENIED' ? 'denied' : r.status === 'TIMEOUT' ? 'expired' : r.status === 'FAILED' || r.status === 'CANCELLED' ? 'error' : 'sent', at: Date.now() }); },
      onError: (e) => { const s = Number((e as { status?: number })?.status); setOutcome({ kind: s === 403 ? 'denied' : s === 410 ? 'expired' : s === 409 || s === 503 || s === 504 ? 'offline' : 'error', at: Date.now() }); },
      onSettled: () => { inFlight.current = false; void qc.invalidateQueries({ queryKey: getListMyBuildingDevicesQueryKey(buildingId) }); },
    });
  };
  const confirmAndSend = (a: AvailableDeviceAction) => {
    if (!a.confirmation) return send();
    const title = tr(l, ['Բացե՞լ', 'Открыть?', 'Open?']); const msg = label;
    if (Platform.OS === 'web') { if (globalThis.confirm?.(`${title} ${msg}`)) send(); return; }
    Alert.alert(title, msg, [{ text: tr(l, ['Չեղարկել', 'Отмена', 'Cancel']), style: 'cancel' }, { text: tr(l, ['Բացել', 'Открыть', 'Open']), onPress: send }]);
  };
  const msg: Record<Outcome['kind'], [string, string, string]> = {
    pending: ['Բացում ենք…', 'Открываем…', 'Opening…'], sent: ['Հրամանն ընդունված է, սպասում ենք սարքի հաստատմանը', 'Команда принята, ждём подтверждения устройства', 'Command accepted, awaiting device confirmation'],
    ok: ['Բացված է', 'Открыто', 'Opened'], denied: ['Մուտքը մերժված է', 'Доступ запрещён', 'Access denied'], offline: ['Սարքը կապի մեջ չէ', 'Устройство не в сети', 'Device offline'],
    expired: ['Մուտքի իրավունքը ժամկետանց է', 'Срок доступа истёк', 'Access expired'], error: ['Ժամանակավոր սխալ։ Կրկնեք։', 'Временная ошибка. Повторите.', 'Temporary error. Try again.'],
  };
  const tone = outcome?.kind === 'ok' ? palette.successStrong : outcome?.kind === 'pending' || outcome?.kind === 'sent' ? palette.accentForeground : palette.destructive;
  return <View style={st.card}>
    <View style={st.row}>
      <View style={st.icon}><Feather name={icon} size={20} color={palette.primary} /></View>
      <View style={{ flex: 1 }}><Text style={st.t} numberOfLines={2}>{label}</Text>
        <View style={st.statusRow}><View style={[st.dot, { backgroundColor: online ? palette.success : palette.subdued }]} /><Text style={st.s}>{online ? tr(l, ['Կապի մեջ է', 'В сети', 'Online']) : tr(l, ['Կապ չկա', 'Не в сети', 'Offline'])}{avail?.state ? ` · ${avail.state}` : ''}</Text></View>
      </View>
      {actions.map((a) => <Pressable key={a.capability} accessibilityRole="button" accessibilityLabel={`${tr(l, ['Բացել', 'Открыть', 'Open'])} ${label}`} accessibilityState={{ disabled: !a.enabled || !a.adapterVerified || cmd.isPending || unresolved }} testID={'access-open-' + device.id} disabled={!a.enabled || !a.adapterVerified || cmd.isPending || unresolved} onPress={() => confirmAndSend(a)} style={[st.btn, (!a.enabled || !a.adapterVerified || unresolved) && st.btnOff]}>
        <Feather name="unlock" size={15} color={palette.surface} /><Text style={st.btnT}>{tr(l, ['Բացել', 'Открыть', 'Open'])}</Text></Pressable>)}
    </View>
    {actions.map((a) => !a.enabled && a.reason ? <Text key={'r' + a.capability} style={st.s}>{a.reason}</Text> : !a.adapterVerified ? <Text key={'v' + a.capability} style={st.s}>{tr(l, ['Սարքի ադապտերը դեռ հաստատված չէ', 'Адаптер устройства ещё не подтверждён', 'Device adapter not verified yet'])}</Text> : null)}
    {!actions.length ? <Text style={st.s}>{tr(l, ['Այս սարքի համար գործողություն հասանելի չէ', 'Для этого устройства действий нет', 'No action available for this device'])}</Text> : null}
    {avail?.safetyLocked?.length ? <Text style={st.s}>{tr(l, ['Անվտանգության արգելափակում', 'Блокировка безопасности', 'Safety lock'])}: {avail.safetyLocked.join(', ')}</Text> : null}
    {command.isError && unresolved && <Text accessibilityRole="alert" style={st.s}>{tr(l, ['Չի հաջողվել ստուգել արդյունքը։ Հրամանը նորից մի՛ ուղարկեք մինչև կարգավիճակի հաստատումը։', 'Не удалось проверить результат. Не отправляйте повторную команду до подтверждения статуса.', 'Could not check the result. Do not resend until status is confirmed.'])}</Text>}
    {outcome ? <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={st.out}><Feather name={outcome.kind === 'ok' ? 'check-circle' : outcome.kind === 'pending' || outcome.kind === 'sent' ? 'clock' : 'alert-circle'} size={15} color={tone} /><Text style={[st.outT, { color: tone }]}>{tr(l, msg[outcome.kind])}</Text></View> : null}
  </View>;
}
const make = (p: Palette) => StyleSheet.create({
  card: { backgroundColor: p.surface, borderRadius: 16, borderWidth: 1, borderColor: p.border, padding: 14, gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 13, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }, t: { fontSize: 15, fontWeight: '800', color: p.foreground },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }, dot: { width: 8, height: 8, borderRadius: 4 }, s: { fontSize: 12, color: p.mutedForeground, lineHeight: 16 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: p.primary }, btnOff: { opacity: 0.4 }, btnT: { color: p.surface, fontWeight: '800', fontSize: 13 },
  out: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 }, outT: { fontSize: 13, fontWeight: '700', flex: 1 },
});
