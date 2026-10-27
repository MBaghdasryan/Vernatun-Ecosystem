import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, Text, View } from 'react-native';
import { createResidentRecord, getResidentRecord } from '@workspace/api-client-react';
import type { ResidentRecord } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { L, type Language } from '@/lib/resident/text';
import { LT, parseViewingLocal } from '@/lib/resident/listingText';
import { Btn, ErrorBox, Field, Toggle } from './Ui';
import { useAction } from './useAction';
// Date entered as "YYYY-MM-DD HH:mm" in local time (no native date picker installed); sent as ISO.
export default function ViewingForm({ rec, l, after, onDone, onUnavailable }: { rec: ResidentRecord; l: Language; after: () => void; onDone: () => void; onUnavailable: () => void }) {
  const [at, setAt] = useState(''); const [yes, setYes] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [sentAt, setSentAt] = useState<string | null>(null); const [unavailable, setUnavailable] = useState(false);
  const a = useAction(l, after);
  const availability = useQuery({
    queryKey: ['resident-listing-availability', rec.id],
    queryFn: () => getResidentRecord('listings', rec.id),
    retry: false,
    refetchInterval: 5000,
  });
  const t = parseViewingLocal(at);
  const valid = !!t && !isNaN(t.getTime()) && t.getTime() > Date.now();
  const status = Number((availability.error as { status?: number } | null)?.status);
  const listingUnavailable = unavailable || availability.data?.status !== 'active' && !!availability.data || availability.isError && status === 404;
  useEffect(() => {
    if (listingUnavailable) AccessibilityInfo.announceForAccessibility(L(l, LT.changed));
  }, [listingUnavailable, l]);
  const checkListing = async () => {
    try {
      const current = await getResidentRecord('listings', rec.id);
      if (current.status === 'active') return true;
    } catch (error) {
      const code = Number((error as { status?: number })?.status);
      if (code !== 404 && code !== 409) throw error;
    }
    setUnavailable(true);
    return false;
  };
  const submit = () => void a.run(async () => {
    if (!(await checkListing())) return;
    try {
      await createResidentRecord('conversations', { title: rec.title, body: '', parentId: rec.id, viewingAt: t!.toISOString(), viewingConsent: true } as never);
      setSentAt(t!.toISOString()); setOk(L(l, LT.sent)); setAt(''); setYes(false);
    } catch (error) {
      const code = Number((error as { status?: number })?.status);
      if (code === 404 || code === 409) { setUnavailable(true); return; }
      throw error;
    }
  });
  const send = () => {
    setErr(''); if (!valid || !t) return setErr(L(l, LT.badNum));
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${L(l, LT.confirmSend)}\n${t.toLocaleString(l)}`)) submit();
      return;
    }
    Alert.alert(L(l, LT.confirmSend), t.toLocaleString(l), [{ text: L(l, ['Ոչ', 'Нет', 'No']), style: 'cancel' }, { text: L(l, LT.reqView), onPress: submit }]);
  };
  if (listingUnavailable) return <View style={{ gap: 10 }}>
    <Text testID="viewing-listing-unavailable" accessibilityLabel={L(l, LT.changed)}>{L(l, LT.changed)}</Text>
    <Btn testID="viewing-back-to-results" kind="secondary" label={L(l, LT.currentResults)} onPress={onUnavailable} />
  </View>;
  if (availability.isPending) return <View style={{ gap: 10 }}><Text>{L(l, ['Ստուգվում է հայտարարությունը…', 'Проверяем объявление…', 'Checking listing…'])}</Text></View>;
  if (availability.isError) return <View style={{ gap: 10 }}>
    <ErrorBox message={L(l, ['Չհաջողվեց ստուգել հայտարարությունը։ Կրկնեք։', 'Не удалось проверить объявление. Повторите.', 'Could not check the listing. Please retry.'])} />
    <Btn kind="secondary" label={L(l, LT.retry)} busy={availability.isFetching} onPress={() => void availability.refetch()} />
  </View>;
  return <View style={{ gap: 10 }}>
    <Field testID="viewing-date-time" label={L(l, LT.when) + ' (YYYY-MM-DD HH:mm)'} value={at} onChange={setAt} maxLength={16} />
    <Toggle testID="viewing-owner-consent" label={L(l, LT.consent)} value={yes} onChange={setYes} />
    <Btn testID="submit-viewing-request" label={L(l, LT.reqView)} onPress={send} busy={a.busy || availability.isFetching} disabled={!valid || !yes || a.busy || availability.isFetching} />
    <Btn kind="secondary" label={L(l, ['Փակել', 'Закрыть', 'Close'])} onPress={onDone} />
    {ok ? <Text accessibilityRole="alert">{ok}{sentAt ? ` · ${new Date(sentAt).toLocaleString(l)} · ${L(l, LT.vs.requested)}` : ''}</Text> : null}
    {err ? <Text accessibilityRole="alert">{err}</Text> : null}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
