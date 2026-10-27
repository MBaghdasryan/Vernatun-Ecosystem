import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { ResidentRecordKind } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { L, S, always, creatable, kindName, type Language } from '@/lib/resident/text';
import { useRecords, useResidentRefresh, useWorkspace } from '@/lib/resident/hooks';
import { Btn, Card, Empty, ErrorBox, Field, Skeleton } from './Ui';
import RecordCard from './RecordCard';
import RecordForm from './RecordForm';
import ListingForm from './ListingForm';
import ListingFilters, { emptyLF, lfParams } from './ListingFilters';
import DeviceRegister from './DeviceRegister';
import ServiceOrder from './ServiceOrder';
export default function RecordsList({ kind, l }: { kind: ResidentRecordKind; l: Language }) { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const ws = useWorkspace(); const refresh = useResidentRefresh();
  const caps = ws.data?.capabilities;
  const enabled = always.includes(kind) || caps?.[kind] === true;
  const [search, setSearch] = useState(''); const [adding, setAdding] = useState(false);
  const [lf, setLf] = useState(emptyLF); const fp = kind === 'listings' ? lfParams(lf) : undefined;
  const q = useRecords(kind, enabled && !!ws.data, search, fp);
  return <View style={{ gap: 12 }}>
    <Text style={st.h}>{L(l, kindName[kind])}</Text>
    {ws.isPending && <Skeleton />}
    {ws.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => ws.refetch()} />}
    {ws.data && !enabled && <Card><Text style={st.muted}>{L(l, S.off)}</Text></Card>}
    {ws.data && enabled && <>
      {!['contacts', 'help', 'agreements', 'mobile-devices'].includes(kind) && <Field label={L(l, S.search)} value={search} onChange={setSearch} />}
      {kind === 'mobile-devices' && <DeviceRegister l={l} after={refresh} />}
      {kind === 'listings' && <ListingFilters f={lf} set={setLf} l={l} />}
      {creatable.includes(kind) && kind !== 'subscriptions' && kind !== 'mobile-devices' && (kind !== 'listings' || ws.data.building.role === 'unit_owner') && (adding ? <Card>{kind === 'listings' ? <ListingForm l={l} after={refresh} onDone={() => setAdding(false)} /> : <RecordForm kind={kind} l={l} after={refresh} onDone={() => setAdding(false)} />}</Card> : <Btn testID={`resident-add-${kind}`} label={L(l, S.add)} onPress={() => setAdding(true)} />)}
      {q.isPending && <Skeleton />}
      {q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}
      {q.data && !q.data.items.length && <Empty text={L(l, S.empty)} />}
      {q.data?.items.map(r => <View key={r.id} style={{ gap: 8 }}><RecordCard kind={kind} rec={r} l={l} after={refresh} />{kind === 'services' && caps?.subscriptions === true && <ServiceOrder service={r} l={l} after={refresh} />}</View>)}
    </>}
  </View>;
}
const make_st = (palette: Palette) => StyleSheet.create({ h: { fontSize: 22, fontWeight: '800', color: palette.foreground }, muted: { color: palette.mutedForeground } });
