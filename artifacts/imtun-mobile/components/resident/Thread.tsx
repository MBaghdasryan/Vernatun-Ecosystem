import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { postResidentMessage } from '@workspace/api-client-react';
import type { ResidentRecord, ResidentRecordKind } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { L, S, type Language } from '@/lib/resident/text';
import { newUuid, useContextId, useMessages } from '@/lib/resident/hooks';
import { Btn, ErrorBox, Skeleton } from './Ui';
import { useAction } from './useAction';
export default function Thread({ kind, rec, l, onConvertSource }: { kind: ResidentRecordKind; rec: ResidentRecord; l: Language; onConvertSource?: (action: 'request' | 'proposal', id: string, text: string) => void }) { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const qc = useQueryClient(); const ctx = useContextId();
  const q = useMessages(kind, rec.id);
  const [text, setText] = useState(''); const [cid, setCid] = useState(newUuid);
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-msg', ctx, kind, rec.id] }); });
  const send = () => { const body = text.trim(); if (!body) return; void a.run(async () => { await postResidentMessage(kind, rec.id, { body, clientId: cid }); setText(''); setCid(newUuid()); }); };
  return <View style={st.box}>
    <Text style={st.h}>{L(l, S.msgs)}</Text>
    {q.isPending && <Skeleton />}
    {q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}
    {q.data?.map(m => <View key={m.id} style={[st.msg, m.own && st.own]}><Text style={st.meta}>{m.sender} · {new Date(m.createdAt).toLocaleString(l)}</Text><Text style={st.body}>{m.body}</Text>{kind === 'discussions' && onConvertSource ? <View style={st.actions}><Btn testID={`discussion-convert-request-${m.id}`} kind="secondary" label={L(l, ['Դարձնել հայտ','В заявку','Create request'])} onPress={() => onConvertSource('request', m.id, m.body)} /><Btn testID={`discussion-convert-proposal-${m.id}`} kind="secondary" label={L(l, ['Առաջարկել օրակարգ','Предложить в повестку','Suggest agenda'])} onPress={() => onConvertSource('proposal', m.id, m.body)} /></View> : null}</View>)}
    {q.data && !q.data.length && <Text style={st.meta}>{L(l, S.empty)}</Text>}
    <TextInput testID={kind === 'discussions' ? `discussion-message-${rec.id}` : undefined} accessibilityLabel={L(l, S.msg)} style={st.input} value={text} onChangeText={setText} placeholder={L(l, S.msg)} placeholderTextColor={palette.placeholder} maxLength={5000} multiline />
    <Btn testID={kind === 'discussions' ? `discussion-send-${rec.id}` : undefined} label={L(l, S.send)} onPress={send} busy={a.busy} disabled={!text.trim()} />
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
const make_st = (palette: Palette) => StyleSheet.create({
  box: { gap: 8, borderTopWidth: 1, borderTopColor: palette.divider, paddingTop: 12 }, h: { fontWeight: '800', color: palette.foreground },
  msg: { backgroundColor: palette.muted, borderRadius: 12, padding: 10, maxWidth: '88%' }, own: { alignSelf: 'flex-end', backgroundColor: palette.accent },
  meta: { fontSize: 11, color: palette.mutedForeground }, body: { color: palette.foreground, fontSize: 14 },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: palette.surface, color: palette.foreground },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
