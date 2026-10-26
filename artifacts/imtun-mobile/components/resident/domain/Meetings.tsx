import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { castWeightedVote, getGovernanceMeeting, listGovernanceMeetings } from '@workspace/api-client-react';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { newUuid } from '@/lib/resident/hooks';
import { Btn, Card, Chip, Empty, ErrorBox, Segment, Skeleton } from '../Ui';
import { useAction } from '../useAction';
import { useDomainAccess } from './useDomain';
type Row = Record<string, any>;
const D = { elig: ['Ձեր քվեները', 'Ваши голоса', 'Your ballots'] as T, vote: ['Քվեարկել', 'Проголосовать', 'Cast vote'] as T, voted: ['Քվեարկված է', 'Голос принят', 'Vote recorded'] as T, back: ['Վերադառնալ', 'Назад', 'Back'] as T, noelig: ['Դուք իրավունք չունեք քվեարկելու այս հարցում։', 'У вас нет права голоса по этому собранию.', 'You are not eligible to vote in this meeting.'] as T, esign: ['Սա որակյալ էլեկտրոնային ստորագրություն չէ։', 'Это не квалифицированная электронная подпись.', 'This is not a qualified electronic signature.'] as T };
const ms: Record<string, T> = { draft: ['Սևագիր', 'Черновик', 'Draft'], published: ['Բաց է', 'Открыто', 'Open'], cancelled: ['Չեղարկված', 'Отменено', 'Cancelled'], finalized: ['Ավարտված', 'Завершено', 'Finalized'] };
function Detail({ id, l, ctxId, back }: { id: string; l: Language; ctxId: string | null; back: () => void }) {
  const qc = useQueryClient(); const key = ['resident-meeting', ctxId, id];
  const q = useQuery({ queryKey: key, enabled: !!ctxId, queryFn: () => getGovernanceMeeting(id) as Promise<Row> });
  const [pick, setPick] = useState<Record<string, string>>({});
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: key }); });
  const d = q.data; const agenda: Row[] = d?.agenda ?? []; const elig: Row[] = d?.eligibility ?? [];
  return <View style={{ gap: 12 }}><Btn kind="secondary" label={L(l, D.back)} onPress={back} />
    {q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}
    {d && <><Text style={{ fontSize: 20, fontWeight: '800' }}>{d.title}</Text>{d.description ? <Text>{d.description}</Text> : null}<Text style={{ fontSize: 11, color: '#52616b' }}>{L(l, D.esign)}</Text>
      {!elig.length && <Text>{L(l, D.noelig)}</Text>}
      {agenda.map((ag, n) => <Card key={ag.id}><Text style={{ fontWeight: '800' }}>{n + 1}. {ag.title}</Text>
        {elig.map(e => { const k = ag.id + ':' + e.id; const done = ((ag.my_votes ?? []) as Row[]).some(v => v.eligibility_id === e.id);
          return <View key={e.id} style={{ gap: 8 }}><Text style={{ fontSize: 12 }}>{e.number ?? e.unit_number}</Text>
            {done ? <Chip label={L(l, D.voted)} /> : d.status === 'published' ? <><Segment label="" value={pick[k] ?? ''} options={((ag.options ?? []) as string[]).map(o => [o, o] as [string, string])} onChange={o => setPick({ ...pick, [k]: o })} /><Btn label={L(l, D.vote)} disabled={!pick[k]} busy={a.busy} onPress={() => void a.run(() => castWeightedVote(ag.id, { key: newUuid(), eligibilityId: e.id, selectedOption: pick[k] }))} /></> : null}</View>; })}
      </Card>)}{a.err ? <ErrorBox message={a.err} /> : null}</>}</View>;
}
export default function Meetings({ l }: { l: Language }) {
  const { ctxId } = useDomainAccess('meetings'); const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['resident-meetings', ctxId], enabled: !!ctxId, queryFn: () => listGovernanceMeetings() as Promise<Row[]> });
  if (open) return <Detail key={ctxId + open} id={open} l={l} ctxId={ctxId} back={() => setOpen(null)} />;
  return <View style={{ gap: 12 }}>{q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}
    {q.data && !q.data.length && <Empty text={L(l, S.empty)} />}
    {q.data?.map(m => <Card key={m.id}><Chip label={ms[m.status] ? L(l, ms[m.status]) : '·'} /><Text style={{ fontWeight: '800', fontSize: 17 }}>{m.title}</Text>{m.starts_at ? <Text>{new Date(m.starts_at).toLocaleString(l)}</Text> : null}<Btn kind="secondary" label={L(l, ['Բացել', 'Открыть', 'Open'])} onPress={() => setOpen(m.id)} /></Card>)}</View>;
}
