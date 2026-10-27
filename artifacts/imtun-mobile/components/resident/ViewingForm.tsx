import React, { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { createResidentRecord } from '@workspace/api-client-react';
import type { ResidentRecord } from '@workspace/api-client-react';
import { L, type Language } from '@/lib/resident/text';
import { LT, parseViewingLocal } from '@/lib/resident/listingText';
import { Btn, ErrorBox, Field, Toggle } from './Ui';
import { useAction } from './useAction';
// Date entered as "YYYY-MM-DD HH:mm" in local time (no native date picker installed); sent as ISO.
export default function ViewingForm({ rec, l, after, onDone }: { rec: ResidentRecord; l: Language; after: () => void; onDone: () => void }) {
  const [at, setAt] = useState(''); const [yes, setYes] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [sentAt, setSentAt] = useState<string | null>(null);
  const a = useAction(l, after);
  const t = parseViewingLocal(at);
  const valid = !!t && !isNaN(t.getTime()) && t.getTime() > Date.now();
  const submit = () => void a.run(async () => {
    await createResidentRecord('conversations', { title: rec.title, body: '', parentId: rec.id, viewingAt: t!.toISOString(), viewingConsent: true } as never);
    setSentAt(t!.toISOString()); setOk(L(l, LT.sent)); setAt(''); setYes(false);
  });
  const send = () => {
    setErr(''); if (!valid || !t) return setErr(L(l, LT.badNum));
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${L(l, LT.confirmSend)}\n${t.toLocaleString(l)}`)) submit();
      return;
    }
    Alert.alert(L(l, LT.confirmSend), t.toLocaleString(l), [{ text: L(l, ['Ոչ', 'Нет', 'No']), style: 'cancel' }, { text: L(l, LT.reqView), onPress: submit }]);
  };
  return <View style={{ gap: 10 }}>
    <Field testID="viewing-date-time" label={L(l, LT.when) + ' (YYYY-MM-DD HH:mm)'} value={at} onChange={setAt} maxLength={16} />
    <Toggle testID="viewing-owner-consent" label={L(l, LT.consent)} value={yes} onChange={setYes} />
    <Btn testID="submit-viewing-request" label={L(l, LT.reqView)} onPress={send} busy={a.busy} disabled={!valid || !yes} />
    <Btn kind="secondary" label={L(l, ['Փակել', 'Закрыть', 'Close'])} onPress={onDone} />
    {ok ? <Text accessibilityRole="alert">{ok}{sentAt ? ` · ${new Date(sentAt).toLocaleString(l)} · ${L(l, LT.vs.requested)}` : ''}</Text> : null}
    {err ? <Text accessibilityRole="alert">{err}</Text> : null}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
