import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { actOnResidentRecord, removeResidentRecord } from '@workspace/api-client-react';
import type { ResidentRecord, ResidentRecordKind } from '@workspace/api-client-react';
import { palette } from '@/constants/colors';
import { L, S, A2, reasonNeeded, actLabel, statusLabel, inquire, type Language } from '@/lib/resident/text';
import { Btn, Card, Chip, ErrorBox, Field } from './Ui';
import { useAction } from './useAction';
import RecordForm from './RecordForm';
import Thread from './Thread';
import ListingForm from './ListingForm';
import ListingPhotos from './ListingPhotos';
import ViewingForm from './ViewingForm';
import { LT, fmtView, listingSummary } from '@/lib/resident/listingText';
const metaKeys = ['plate', 'make', 'model', 'color', 'platform', 'appVersion', 'phone', 'email', 'hours', 'category', 'saleType', 'priceMinor', 'currency', 'area', 'rooms', 'floor', 'quantity'];
export default function RecordCard({ kind, rec, l, after }: { kind: ResidentRecordKind; rec: ResidentRecord; l: Language; after: () => void }) {
  const a = useAction(l, after);
  const [mode, setMode] = useState<'none' | 'edit' | 'thread' | 'inquire' | 'reason' | 'viewing'>('none');
  const [note, setNote] = useState(''); const [reason, setReason] = useState(''); const [pending, setPending] = useState('');
  const d = rec.data as Record<string, unknown>;
  const meta = kind === 'listings' ? listingSummary(d,l) : metaKeys.filter(k => d[k] != null && d[k] !== '').map(k => String(d[k])).join(' · ');
  const hasMsg = rec.actions.includes('message') && kind !== 'listings';
  const acts = rec.actions.filter(x => x !== 'message' && x !== 'inquire');
  const doAct = (x: string) => {
    if (LT.act[x]) return Alert.alert(L(l, LT.act[x]), undefined, [{ text: L(l, ['Ոչ', 'Нет', 'No']), style: 'cancel' }, { text: L(l, LT.act[x]), onPress: () => { setNote(''); void a.run(async () => { await actOnResidentRecord(kind, rec.id, { action: x as never, version: rec.version }); setNote(L(l, LT.done[x])); }); } }]);
    if (x === 'edit') return setMode('edit');
    if (reasonNeeded.includes(x)) { setPending(x); return setMode('reason'); }
    if (x === 'delete' || x === 'revoke') return Alert.alert(L(l, S.confirm), undefined, [{ text: L(l, ['Ոչ', 'Нет', 'No']), style: 'cancel' }, { text: L(l, actLabel[x]), style: 'destructive', onPress: () => void a.run(() => removeResidentRecord(kind, rec.id, { version: rec.version })) }]);
    void a.run(() => actOnResidentRecord(kind, rec.id, { action: x as 'accept', version: rec.version }));
  };
  if (mode === 'edit' && kind === 'listings') return <Card><ListingForm l={l} rec={rec} after={after} onDone={() => setMode('none')} /></Card>;
  const vw = kind === 'conversations' ? fmtView(d, l) : '';
  if (mode === 'edit') return <Card><RecordForm kind={kind} l={l} rec={rec} after={after} onDone={() => setMode('none')} /></Card>;
  return <Card>
    <View style={st.top}><Chip label={statusLabel[rec.status] ? L(l, statusLabel[rec.status]) : '·'} />{(rec.supportCount ?? 0) > 0 && <Text style={st.meta}>+{rec.supportCount}</Text>}</View>
    <Text style={st.title}>{rec.title}</Text>
    {rec.body ? <Text style={st.body}>{rec.body}</Text> : null}
    {meta ? <Text style={st.meta}>{meta}</Text> : null}
    {vw ? <Text style={st.meta} accessibilityRole="alert">{vw}</Text> : null}
    {kind === 'listings' ? <ListingPhotos rec={rec} l={l} after={after} /> : null}
    <View style={st.row}>
      {acts.map(x => <View key={x} style={{ flexGrow: 1 }}><Btn kind={x === 'delete' || x === 'revoke' ? 'danger' : 'secondary'} label={actLabel[x] ? L(l, actLabel[x]) : LT.act[x] ? L(l, LT.act[x]) : L(l, S.open2)} onPress={() => doAct(x)} busy={a.busy} /></View>)}
      {hasMsg && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, S.msgs)} onPress={() => setMode(mode === 'thread' ? 'none' : 'thread')} /></View>}
      {kind === 'listings' && rec.actions.includes('inquire') && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, LT.reqView)} onPress={() => setMode('viewing')} /></View>}
      {kind === 'listings' && rec.actions.includes('inquire') && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, inquire)} onPress={() => setMode('inquire')} /></View>}
    </View>
    {note ? <Text style={st.meta} accessibilityRole="alert">{note}</Text> : null}
    {a.err ? <ErrorBox message={a.err} /> : null}
    {mode === 'reason' && <View style={{ gap: 10 }}><Field label={L(l, A2.reason)} value={reason} onChange={setReason} multiline maxLength={2000} /><Btn label={L(l, actLabel[pending])} disabled={!reason.trim()} busy={a.busy} onPress={() => void a.run(async () => { await actOnResidentRecord(kind, rec.id, { action: pending as 'report', version: rec.version, reason: reason.trim() }); setMode('none'); setReason(''); })} /></View>}
    {mode === 'thread' && hasMsg && <Thread kind={kind} rec={rec} l={l} />}
    {mode === 'viewing' && <ViewingForm rec={rec} l={l} after={after} onDone={() => setMode('none')} />}
    {mode === 'inquire' && <RecordForm kind="conversations" l={l} parent={rec} after={after} onDone={() => setMode('none')} submitLabel={inquire} />}
  </Card>;
}
const st = StyleSheet.create({ top: { flexDirection: 'row', justifyContent: 'space-between' }, title: { fontSize: 17, fontWeight: '800', color: palette.foreground }, body: { color: palette.mutedForeground, fontSize: 14 }, meta: { color: palette.subdued, fontSize: 11 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
