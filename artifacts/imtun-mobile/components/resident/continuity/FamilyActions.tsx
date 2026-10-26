import React, { useRef, useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { changeDelegationExpiration, revokeResidentDelegation, reauthenticateResident, resendResidentDelegation } from '@workspace/api-client-react';
import type { ListResidentDelegations200Item } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { Btn, ErrorBox, Field, Segment } from '../Ui';
import { useAction } from '../useAction';
import { needsReauth, tt } from './core';
export default function DelegationActions({ x, l, ctxId }: { x: ListResidentDelegations200Item; l: Language; ctxId: string | null }) {
  const qc = useQueryClient(); const [days, setDays] = useState('90'); const [need, setNeed] = useState(false); const [pw, setPw] = useState(''); const [code, setCode] = useState('');
  const pending = useRef<(() => Promise<unknown>) | null>(null);
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-delegations', ctxId] }); });
  const attempt = (fn: () => Promise<unknown>) => { pending.current = fn; void a.run(async () => { try { await fn(); pending.current = null; setNeed(false); } catch (e) { if (needsReauth(e)) { setNeed(true); return; } throw e; } }); };
  const [ask, setAsk] = useState(false);
  if (x.revoked_at) return null;
  const resend = () => attempt(() => resendResidentDelegation(x.id, { version: x.version }));
  const expire = () => attempt(() => changeDelegationExpiration(x.id, { version: x.version, expiresAt: new Date(Date.now() + Number(days) * 864e5).toISOString() }));
  return <View style={{ gap: 8 }}>
    <Segment label={tt(l, 'Նոր ժամկետ (օր)', 'Новый срок (дней)', 'New validity (days)')} value={days} options={[['30', '30'], ['90', '90'], ['180', '180'], ['365', '365']]} onChange={setDays} />
    <Btn kind="secondary" label={tt(l, 'Փոխել ժամկետը', 'Изменить срок', 'Change expiry')} busy={a.busy} onPress={expire} />
    {!x.accepted_at && <Btn kind="secondary" label={tt(l, 'Նորից ուղարկել հրավերը', 'Отправить приглашение снова', 'Resend invitation')} busy={a.busy} onPress={resend} />}
    {ask ? <View style={{ gap: 8 }}><Btn kind="danger" label={tt(l, 'Հաստատել հեռացումը', 'Подтвердить отзыв', 'Confirm revoke')} busy={a.busy} onPress={() => { setAsk(false); attempt(() => revokeResidentDelegation(x.id)); }} /><Btn kind="secondary" label={tt(l, 'Չեղարկել', 'Отмена', 'Cancel')} onPress={() => setAsk(false)} /></View> : <Btn kind="danger" label={tt(l, 'Չեղարկել հրավերը', 'Отозвать приглашение', 'Revoke invitation')} busy={a.busy} onPress={() => setAsk(true)} />}
    {need && <View style={{ gap: 8 }}><Text accessibilityRole="alert">{tt(l, 'Այս գործողությունը պահանջում է գաղտնաբառի կրկնակի հաստատում։', 'Для этого действия нужно подтвердить пароль.', 'This action needs password confirmation.')}</Text>
      <Field label={tt(l, 'Գաղտնաբառ', 'Пароль', 'Password')} value={pw} onChange={setPw} maxLength={72} />
      <Field label={tt(l, 'MFA կոդ (եթե կա)', 'Код MFA (если есть)', 'MFA code (if enabled)')} value={code} onChange={setCode} keyboard="number-pad" maxLength={30} />
      <Btn label={tt(l, 'Հաստատել և շարունակել', 'Подтвердить и продолжить', 'Confirm and continue')} busy={a.busy} disabled={!pw} onPress={() => void a.run(async () => { await reauthenticateResident({ password: pw, ...(code.length >= 6 ? { code } : {}) }); setPw(''); setCode(''); const fn = pending.current; if (fn) { await fn(); pending.current = null; } setNeed(false); })} /></View>}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
