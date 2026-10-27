import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDiscussionLineage } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useContextId } from '@/lib/resident/hooks';
import { L, statusLabel, type Language } from '@/lib/resident/text';
import { ErrorBox, Skeleton } from './Ui';
import { StyleSheet, Text, View } from 'react-native';

type LocalText = [string, string, string];
const T: Record<string, LocalText> = {
  loading: ['Բեռնվում է…', 'Загрузка…', 'Loading…'],
  empty: ['Կապված գրառումներ դեռ չկան։', 'Связанных записей пока нет.', 'No linked records yet.'],
  request: ['Քննարկում → հայտ', 'Обсуждение → заявка', 'Discussion → request'],
  proposal: ['Քննարկում → օրակարգի առաջարկ', 'Обсуждение → предложение в повестку', 'Discussion → agenda proposal'],
  meeting: ['Ժողով', 'Собрание', 'Meeting'],
  votes: ['Գրանցված քվեներ', 'Записанные голоса', 'Recorded votes'],
  work: ['Աշխատանք', 'Работы', 'Work order'],
  decision: ['Որոշում', 'Решение', 'Decision'],
  source: ['Մեջբերում քննարկումից', 'Фрагмент обсуждения', 'Excerpt from discussion'],
  passed: ['Ընդունվել է', 'Принято', 'Passed'],
  failed: ['Չի ընդունվել', 'Не принято', 'Not passed'],
};

export default function DiscussionLineagePanel({ discussionId, l }: { discussionId: string; l: Language }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]);
  const contextId = useContextId();
  const query = useQuery({
    queryKey: ['discussion-lineage', contextId, discussionId],
    enabled: !!contextId,
    queryFn: () => getDiscussionLineage(discussionId),
  });
  if (query.isPending) return <View style={s.box}><Text style={s.heading}>{L(l, T.loading)}</Text><Skeleton /></View>;
  if (query.isError) return <ErrorBox message={L(l, ['Չհաջողվեց բեռնել կապակցված գրառումները։','Не удалось загрузить связанные записи.','Could not load linked records.'])} retryLabel={L(l, ['Կրկնել', 'Повторить', 'Retry'])} onRetry={() => void query.refetch()} />;
  if (!query.data?.length) return <View style={s.box}><Text style={s.heading}>{L(l, T.empty)}</Text></View>;
  return <View style={s.box}>
    <Text style={s.heading}>{L(l, ['Քննարկման ընթացքը', 'Цепочка обсуждения', 'Discussion trail'])}</Text>
    {query.data.map((item) => {
      const decision = item.decision as { passed?: boolean } | null;
      return <View key={item.id} style={s.item}>
        <Text style={s.heading}>{item.linkType === 'request' ? L(l, T.request) : L(l, T.proposal)}</Text>
        <Text style={s.text}>{item.requestSubject ?? item.proposalTitle ?? '—'}</Text>
         {item.requestStatus ? <Text style={s.meta}>{statusLabel[item.requestStatus] ? L(l, statusLabel[item.requestStatus]) : item.requestStatus}</Text> : null}
         {item.proposalStatus ? <Text style={s.meta}>{statusLabel[item.proposalStatus] ? L(l, statusLabel[item.proposalStatus]) : item.proposalStatus}</Text> : null}
        {item.meetingId ? <Text style={s.meta}>{L(l, T.meeting)}: {item.meetingTitle ?? item.meetingId.slice(0, 8)} · {item.meetingStatus}</Text> : null}
        {item.voteIds.length ? <Text style={s.meta}>{L(l, T.votes)}: {item.voteIds.length}</Text> : null}
        {decision && typeof decision.passed === 'boolean' ? <Text style={s.meta}>{L(l, T.decision)}: {L(l, decision.passed ? T.passed : T.failed)}</Text> : null}
        {item.workOrderId ? <Text style={s.meta}>{L(l, T.work)}: {item.workOrderStatus ?? item.workOrderId.slice(0, 8)}</Text> : null}
         <View style={s.source}>
           <Text style={s.sourceLabel}>{L(l, T.source)}</Text>
           <Text style={s.text}>{item.sourceExcerpt}</Text>
         </View>
        {item.sourceMessageId ? <Text style={s.meta}>source {item.sourceMessageId.slice(0, 8)}</Text> : null}
      </View>;
    })}
  </View>;
}

const make_s = (palette: Palette) => StyleSheet.create({
  box: { borderTopWidth: 1, borderTopColor: palette.divider, paddingTop: 12, gap: 10 },
  item: { backgroundColor: palette.muted, borderRadius: 10, padding: 10, gap: 4 },
  heading: { fontWeight: '800', color: palette.foreground, fontSize: 13 },
  text: { color: palette.foreground, fontSize: 13 },
  meta: { color: palette.mutedForeground, fontSize: 11 },
  source: { marginTop: 6, borderTopWidth: 1, borderTopColor: palette.divider, paddingTop: 7, gap: 3 },
  sourceLabel: { color: palette.mutedForeground, fontSize: 11, fontWeight: '700' },
});
