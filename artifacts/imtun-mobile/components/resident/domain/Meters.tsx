import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listResidentMeters, submitResidentMeterReading } from '@workspace/api-client-react';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, Empty, ErrorBox, Field, Skeleton } from '../Ui';
import { useAction } from '../useAction';
import { useDomainAccess } from './useDomain';
const kindLabel: Record<string, T> = { electricity: ['Էլեկտրաէներգիա', 'Электричество', 'Electricity'], gas: ['Գազ', 'Газ', 'Gas'], cold_water: ['Սառը ջուր', 'Холодная вода', 'Cold water'], hot_water: ['Տաք ջուր', 'Горячая вода', 'Hot water'], heating: ['Ջեռուցում', 'Отопление', 'Heating'], water: ['Ջուր', 'Вода', 'Water'] };
const D = { value: ['Ցուցմունք', 'Показание', 'Reading'] as T, submit: ['Ներկայացնել', 'Передать', 'Submit reading'] as T, hist: ['Պատմություն', 'История', 'History'] as T, bad: ['Մուտքագրեք թիվ (մինչև 3 տասնորդական)։', 'Введите число (до 3 знаков после запятой).', 'Enter a number (up to 3 decimals).'] as T, serial: ['Սերիա', 'Серийный №', 'Serial'] as T };
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const fmt = (v: string | number) => (Number(v) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
function Meter({ m, l, after }: { m: { id: string; serial_number: string; kind: string; number: string; readings: { id: string; period: string; value_thousandths: string | number }[] }; l: Language; after: () => void }) {
  const [v, setV] = useState(''); const a = useAction(l, after); const valid = /^\d{1,10}(\.\d{1,3})?$/.test(v.trim());
  return <Card><Text style={{ fontWeight: '800', fontSize: 16 }}>{kindLabel[m.kind] ? L(l, kindLabel[m.kind]) : L(l, ['Հաշվիչ', 'Счётчик', 'Meter'])} · {m.number}</Text><Text style={{ fontSize: 11, color: '#728087' }}>{L(l, D.serial)}: {m.serial_number}</Text>
    <Field label={L(l, D.value)} value={v} onChange={setV} keyboard="decimal-pad" maxLength={14} />{v && !valid ? <Text style={{ color: '#a43d32', fontSize: 12 }}>{L(l, D.bad)}</Text> : null}
    <Btn label={L(l, D.submit)} disabled={!valid} busy={a.busy} onPress={() => void a.run(async () => { await submitResidentMeterReading(m.id, { period: firstOfMonth(), value: v.trim() }); setV(''); })} />{a.err ? <ErrorBox message={a.err} /> : null}
    <Text style={{ fontWeight: '700' }}>{L(l, D.hist)}</Text>{!m.readings.length && <Text>{L(l, S.empty)}</Text>}{m.readings.map(r => <Text key={r.id}>{r.period.slice(0, 7)} · {fmt(r.value_thousandths)}</Text>)}</Card>;
}
export default function Meters({ l }: { l: Language }) {
  const { ctxId } = useDomainAccess('meters'); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resident-meters', ctxId], enabled: !!ctxId, queryFn: () => listResidentMeters() });
  return <View style={{ gap: 12 }}>{q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}{q.data && !q.data.length && <Empty text={L(l, S.empty)} />}
    {q.data?.map(m => <Meter key={m.id} m={m} l={l} after={() => { void qc.invalidateQueries({ queryKey: ['resident-meters', ctxId] }); }} />)}</View>;
}
