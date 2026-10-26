import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { createResidentRecord } from '@workspace/api-client-react';
import type { ResidentRecord } from '@workspace/api-client-react';
import { L, type Language } from '@/lib/resident/text';
import { LT } from '@/lib/resident/listingText';
import { Btn, ErrorBox, Field, Toggle } from './Ui';
import { useAction } from './useAction';
// Date entered as "YYYY-MM-DD HH:mm" in local time (no native date picker installed); sent as ISO.
export default function ViewingForm({ rec, l, after, onDone }: { rec: ResidentRecord; l: Language; after: () => void; onDone: () => void }) {
  const [at, setAt] = useState(''); const [yes, setYes] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const a = useAction(l, after);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(at.trim());
  const t = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  const valid = !!t && !isNaN(t.getTime()) && t.getTime() > Date.now();
  const send = () => {
    setErr(''); if (!valid || !t) return setErr(L(l, LT.badNum));
    Alert.alert(L(l, LT.confirmSend), t.toLocaleString(l), [{ text: L(l, ['Ոչ', 'Нет', 'No']), style: 'cancel' }, { text: L(l, LT.reqView), onPress: () => void a.run(async () => { await createResidentRecord('conversations', { title: rec.title, body: '', parentId: rec.id, viewingAt: t.toISOString(), viewingConsent: true } as never); setOk(L(l, LT.sent)); setAt(''); setYes(false); }) }]);
  };
  return <View style={{ gap: 10 }}>
    <Field label={L(l, LT.when) + ' (YYYY-MM-DD HH:mm)'} value={at} onChange={setAt} />
    <Toggle label={L(l, LT.consent)} value={yes} onChange={setYes} />
    <Btn label={L(l, LT.reqView)} onPress={send} busy={a.busy} disabled={!valid || !yes} />
    <Btn kind="secondary" label={L(l, ['Փակել', 'Закрыть', 'Close'])} onPress={onDone} />
    {ok ? <Text accessibilityRole="alert">{ok}</Text> : null}
    {err ? <Text accessibilityRole="alert">{err}</Text> : null}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
