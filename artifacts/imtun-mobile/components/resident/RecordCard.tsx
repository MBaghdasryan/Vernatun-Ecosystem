import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { actOnResidentRecord, createAgendaProposalFromDiscussion, createRequestFromDiscussion, removeResidentRecord } from '@workspace/api-client-react';
import type { ResidentRecord, ResidentRecordKind } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { L, S, A2, reasonNeeded, actLabel, statusLabel, inquire, type Language } from '@/lib/resident/text';
import { Btn, Card, Chip, ErrorBox, Field } from './Ui';
import { useAction } from './useAction';
import RecordForm from './RecordForm';
import Thread from './Thread';
import DiscussionLineagePanel from './DiscussionLineagePanel';
import ListingForm from './ListingForm';
import ListingPhotos from './ListingPhotos';
import ViewingForm from './ViewingForm';
import { LT, fmtView, listingSummary } from '@/lib/resident/listingText';
import { newUuid } from '@/lib/resident/hooks';
import DiscussionLinks from './DiscussionLinks';
const metaKeys = ['plate', 'make', 'model', 'color', 'platform', 'appVersion', 'phone', 'email', 'hours', 'category', 'saleType', 'priceMinor', 'currency', 'area', 'rooms', 'floor', 'quantity'];
type Source = { id?: string; text: string };
type LocalText = [string, string, string];
const C: Record<string, LocalText> = {
  subject: ['Հայտի վերնագիր', 'Тема заявки', 'Request subject'],
  requestDetails: ['Մանրամասներ', 'Подробности', 'Details'],
  proposalTitle: ['Օրակարգի առաջարկի վերնագիր', 'Тема предложения в повестку', 'Agenda proposal title'],
  proposalDetails: ['Առաջարկի մանրամասներ', 'Описание предложения', 'Proposal details'],
  selectedSource: ['Քննարկման ընտրված աղբյուր', 'Выбранный фрагмент обсуждения', 'Selected discussion source'],
  submitRequest: ['Ստեղծել հայտ', 'Создать заявку', 'Create request'],
  submitProposal: ['Ուղարկել ստուգման', 'Отправить на рассмотрение', 'Submit for review'],
  proposalReviewNote: ['Առաջարկը կանցնի առանձին ստուգում և ինքնաբերաբար չի դառնա օրակարգի կետ։', 'Предложение пройдёт отдельную проверку и не станет пунктом повестки автоматически.', 'The proposal requires separate review and will not automatically become an agenda item.'],
  lineage: ['Կապված գրառումներ', 'Связанные записи', 'Linked records'],
  cancel: ['Չեղարկել', 'Отмена', 'Cancel'],
  sent: ['Ուղարկված է', 'Отправлено', 'Submitted'],
};
export default function RecordCard({ kind, rec, l, after }: { kind: ResidentRecordKind; rec: ResidentRecord; l: Language; after: () => void }) { const palette = useAppPalette(); const st = React.useMemo(() => make_st(palette), [palette]);
  const a = useAction(l, after);
  const [mode, setMode] = useState<'none' | 'edit' | 'thread' | 'inquire' | 'reason' | 'viewing' | 'request' | 'proposal' | 'lineage'>('none');
  const [note, setNote] = useState(''); const [reason, setReason] = useState(''); const [pending, setPending] = useState('');
  const [source, setSource] = useState<Source>({ text: rec.body });
  const [requestSubject, setRequestSubject] = useState(rec.title);
  const [requestDetails, setRequestDetails] = useState(rec.body);
  const [proposalTitle, setProposalTitle] = useState(rec.title);
  const [proposalDetails, setProposalDetails] = useState(rec.body);
  const d = rec.data as Record<string, unknown>;
  const meta = kind === 'listings' ? listingSummary(d,l) : metaKeys.filter(k => d[k] != null && d[k] !== '').map(k => String(d[k])).join(' · ');
  const hasMsg = rec.actions.includes('message') && kind !== 'listings';
  const acts = rec.actions.filter(x => !['message', 'inquire', 'request', 'proposal'].includes(x));
  const beginConversion = (next: 'request' | 'proposal', src: Source) => {
    setSource(src);
    setRequestSubject(rec.title);
    setRequestDetails(src.text);
    setProposalTitle(rec.title);
    setProposalDetails(src.text);
    setNote('');
    setMode(next);
  };
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
    <DiscussionLinks rec={rec} l={l}/>
    <View style={st.row}>
      {acts.map(x => <View key={x} style={{ flexGrow: 1 }}><Btn kind={x === 'delete' || x === 'revoke' ? 'danger' : 'secondary'} label={actLabel[x] ? L(l, actLabel[x]) : LT.act[x] ? L(l, LT.act[x]) : L(l, S.open2)} onPress={() => doAct(x)} busy={a.busy} /></View>)}
      {hasMsg && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, S.msgs)} onPress={() => setMode(mode === 'thread' ? 'none' : 'thread')} /></View>}
      {kind === 'discussions' && rec.actions.includes('request') && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, actLabel.request)} onPress={() => beginConversion('request', { text: rec.body })} /></View>}
      {kind === 'discussions' && rec.actions.includes('proposal') && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, actLabel.proposal)} onPress={() => beginConversion('proposal', { text: rec.body })} /></View>}
      {kind === 'discussions' && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, C.lineage)} onPress={() => setMode(mode === 'lineage' ? 'none' : 'lineage')} /></View>}
      {kind === 'listings' && rec.actions.includes('inquire') && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, LT.reqView)} onPress={() => setMode('viewing')} /></View>}
      {kind === 'listings' && rec.actions.includes('inquire') && <View style={{ flexGrow: 1 }}><Btn kind="secondary" label={L(l, inquire)} onPress={() => setMode('inquire')} /></View>}
    </View>
    {note ? <Text style={st.meta} accessibilityRole="alert">{note}</Text> : null}
    {a.err ? <ErrorBox message={a.err} /> : null}
    {mode === 'reason' && <View style={{ gap: 10 }}><Field label={L(l, A2.reason)} value={reason} onChange={setReason} multiline maxLength={2000} /><Btn label={L(l, actLabel[pending])} disabled={!reason.trim()} busy={a.busy} onPress={() => void a.run(async () => { await actOnResidentRecord(kind, rec.id, { action: pending as 'report', version: rec.version, reason: reason.trim() }); setMode('none'); setReason(''); })} /></View>}
    {mode === 'thread' && hasMsg && <Thread kind={kind} rec={rec} l={l} onConvertSource={kind === 'discussions' ? (action, id, text) => beginConversion(action, { id, text }) : undefined} />}
    {mode === 'lineage' && kind === 'discussions' && <DiscussionLineagePanel discussionId={rec.id} l={l} />}
    {mode === 'request' && <View style={{ gap: 9 }}>
      <Text style={st.meta}>{L(l, C.selectedSource)}{source.id ? ` · ${source.id.slice(0, 8)}` : ''}</Text>
      <Text numberOfLines={3} style={st.body}>{source.text}</Text>
      <Field label={L(l, C.subject)} value={requestSubject} onChange={setRequestSubject} maxLength={160} />
      <Field label={L(l, C.requestDetails)} value={requestDetails} onChange={setRequestDetails} multiline maxLength={4000} />
      <View style={st.row}>
        <Btn label={L(l, C.submitRequest)} busy={a.busy} disabled={requestSubject.trim().length < 3 || !source.text.trim()} onPress={() => void a.run(async () => {
          await createRequestFromDiscussion(rec.id, { key: newUuid(), subject: requestSubject.trim(), description: requestDetails.trim(), ...(source.id ? { sourceMessageId: source.id } : {}) });
          setNote(L(l, C.sent)); setMode('none');
        })} />
        <Btn kind="secondary" label={L(l, C.cancel)} onPress={() => setMode('none')} />
      </View>
    </View>}
    {mode === 'proposal' && <View style={{ gap: 9 }}>
      <Text style={st.meta}>{L(l, C.selectedSource)}{source.id ? ` · ${source.id.slice(0, 8)}` : ''}</Text>
      <Text numberOfLines={3} style={st.body}>{source.text}</Text>
      <Field label={L(l, C.proposalTitle)} value={proposalTitle} onChange={setProposalTitle} maxLength={200} />
      <Field label={L(l, C.proposalDetails)} value={proposalDetails} onChange={setProposalDetails} multiline maxLength={4000} />
      <Text style={st.meta}>{L(l, C.proposalReviewNote)}</Text>
      <View style={st.row}>
        <Btn label={L(l, C.submitProposal)} busy={a.busy} disabled={proposalTitle.trim().length < 3 || !source.text.trim()} onPress={() => void a.run(async () => {
          await createAgendaProposalFromDiscussion(rec.id, { key: newUuid(), title: proposalTitle.trim(), description: proposalDetails.trim(), ...(source.id ? { sourceMessageId: source.id } : {}) });
          setNote(L(l, C.sent)); setMode('none');
        })} />
        <Btn kind="secondary" label={L(l, C.cancel)} onPress={() => setMode('none')} />
      </View>
    </View>}
    {mode === 'viewing' && <ViewingForm rec={rec} l={l} after={after} onDone={() => setMode('none')} />}
    {mode === 'inquire' && <RecordForm kind="conversations" l={l} parent={rec} after={after} onDone={() => setMode('none')} submitLabel={inquire} />}
  </Card>;
}
const make_st = (palette: Palette) => StyleSheet.create({ top: { flexDirection: 'row', justifyContent: 'space-between' }, title: { fontSize: 17, fontWeight: '800', color: palette.foreground }, body: { color: palette.mutedForeground, fontSize: 14 }, meta: { color: palette.subdued, fontSize: 11 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
