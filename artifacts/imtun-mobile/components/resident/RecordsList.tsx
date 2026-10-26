import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { ResidentRecordKind } from '@workspace/api-client-react';
import { palette } from '@/constants/colors';
import { L, S, always, creatable, kindName, type Language } from '@/lib/resident/text';
import { useRecords, useResidentRefresh, useWorkspace } from '@/lib/resident/hooks';
import { Btn, Card, Empty, ErrorBox, Field, Skeleton } from './Ui';
import RecordCard from './RecordCard';
import RecordForm from './RecordForm';
import DeviceRegister from './DeviceRegister';
import ServiceOrder from './ServiceOrder';
export default function RecordsList({ kind, l }: { kind: ResidentRecordKind; l: Language }) {
  const ws = useWorkspace(); const refresh = useResidentRefresh();
  const caps = ws.data?.capabilities;
  const enabled = always.includes(kind) || caps?.[kind] === true;
  const [search, setSearch] = useState(''); const [adding, setAdding] = useState(false);
  const q = useRecords(kind, enabled && !!ws.data, search);
  return <View style={{ gap: 12 }}>
    <Text style={st.h}>{L(l, kindName[kind])}</Text>
    {ws.isPending && <Skeleton />}
    {ws.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => ws.refetch()} />}
    {ws.data && !enabled && <Card><Text style={st.muted}>{L(l, S.off)}</Text></Card>}
    {ws.data && enabled && <>
      {!['contacts', 'help', 'agreements', 'mobile-devices'].includes(kind) && <Field label={L(l, S.search)} value={search} onChange={setSearch} />}
      {kind === 'mobile-devices' && <DeviceRegister l={l} after={refresh} />}
      {creatable.includes(kind) && kind !== 'subscriptions' && kind !== 'mobile-devices' && (adding ? <Card><RecordForm kind={kind} l={l} after={refresh} onDone={() => setAdding(false)} /></Card> : <Btn label={L(l, S.add)} onPress={() => setAdding(true)} />)}
      {q.isPending && <Skeleton />}
      {q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}
      {q.data && !q.data.items.length && <Empty text={L(l, S.empty)} />}
      {q.data?.items.map(r => <View key={r.id} style={{ gap: 8 }}><RecordCard kind={kind} rec={r} l={l} after={refresh} />{kind === 'services' && caps?.subscriptions === true && <ServiceOrder service={r} l={l} after={refresh} />}</View>)}
    </>}
  </View>;
}
const st = StyleSheet.create({ h: { fontSize: 22, fontWeight: '800', color: palette.foreground }, muted: { color: palette.mutedForeground } });
