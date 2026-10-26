import React, { useRef, useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { reauthenticateResident, transitionResidentLease } from '@workspace/api-client-react';
import type { ResidentHousehold, ResidentHouseholdLeasesItem } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { Btn, Card, ErrorBox, Field } from '../Ui';
import { useAction } from '../useAction';
import { needsReauth, tt } from './core';
function LeaseCard({ x, l, ctxId }: { x: ResidentHouseholdLeasesItem; l: Language; ctxId: string | null }) { const palette = useAppPalette();
  const qc = useQueryClient(); const [ends, setEnds] = useState(''); const [reason, setReason] = useState(''); const [need, setNeed] = useState(false); const [pw, setPw] = useState(''); const [code, setCode] = useState('');
  const pending = useRef<(() => Promise<unknown>) | null>(null);
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-household', ctxId] }); });
  const attempt = (fn: () => Promise<unknown>) => { pending.current = fn; void a.run(async () => { try { await fn(); pending.current = null; setNeed(false); } catch (e) { if (needsReauth(e)) { setNeed(true); return; } throw e; } }); };
  const okEnd = /^\d{4}-\d{2}-\d{2}$/.test(ends) && !isNaN(Date.parse(ends)) && ends > x.endsOn.slice(0, 10);
  return <Card>
    <Text style={{ color: palette.foreground, fontWeight: '800' }}>{x.name}</Text><Text style={{ color: palette.foreground }}>{x.startsOn.slice(0, 10)} → {x.endsOn.slice(0, 10)} · {x.cancelled ? tt(l, 'Չեղարկված', 'Расторгнут', 'Cancelled') : tt(l, 'Գործող', 'Действует', 'Active')}</Text>
    {!x.cancelled && <View style={{ gap: 8 }}>
      <Field label={tt(l, 'Նոր ավարտ (ՏՏՏՏ-ԱԱ-ՕՕ)', 'Новая дата окончания (ГГГГ-ММ-ДД)', 'New end date (YYYY-MM-DD)')} value={ends} onChange={setEnds} maxLength={10} />
      <Btn kind="secondary" label={tt(l, 'Երկարացնել', 'Продлить', 'Extend')} busy={a.busy} disabled={!okEnd} onPress={() => attempt(() => transitionResidentLease(x.id, 'extend', { version: x.version, endsOn: ends }))} />
      <Field label={tt(l, 'Պատճառ (առնվազն 3 նիշ)', 'Причина (минимум 3 символа)', 'Reason (min 3 characters)')} value={reason} onChange={setReason} maxLength={1000} />
      <Btn kind="danger" label={tt(l, 'Չեղարկել պայմանագիրը', 'Расторгнуть договор', 'Cancel lease')} busy={a.busy} disabled={reason.trim().length < 3} onPress={() => attempt(() => transitionResidentLease(x.id, 'cancel', { version: x.version, reason: reason.trim() }))} />
    </View>}
    {need && <View style={{ gap: 8 }}><Text accessibilityRole="alert">{tt(l, 'Պահանջվում է գաղտնաբառի կրկնակի հաստատում։', 'Нужно подтвердить пароль.', 'Password confirmation is required.')}</Text>
      <Field label={tt(l, 'Գաղտնաբառ', 'Пароль', 'Password')} value={pw} onChange={setPw} maxLength={72} />
      <Field label={tt(l, 'MFA կոդ (եթե կա)', 'Код MFA (если есть)', 'MFA code (if enabled)')} value={code} onChange={setCode} keyboard="number-pad" maxLength={30} />
      <Btn label={tt(l, 'Հաստատել և շարունակել', 'Подтвердить и продолжить', 'Confirm and continue')} busy={a.busy} disabled={!pw} onPress={() => void a.run(async () => { await reauthenticateResident({ password: pw, ...(code.length >= 6 ? { code } : {}) }); setPw(''); setCode(''); const fn = pending.current; if (fn) { await fn(); pending.current = null; } setNeed(false); })} /></View>}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </Card>;
}
export default function HouseholdLeases({ hh, l, ctxId }: { hh: ResidentHousehold; l: Language; ctxId: string | null }) { const palette = useAppPalette();
  if (!hh.canManageLeases) return null;
  return <View style={{ gap: 8 }}><Text style={{ color: palette.foreground, fontWeight: '800' }}>{tt(l, 'Վարձակալության պայմանագրեր', 'Договоры аренды', 'Leases')}</Text>
    {!hh.leases.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Պայմանագրեր չկան', 'Договоров нет', 'No leases')}</Text>}
    {hh.leases.map(x => <LeaseCard key={x.id + x.version} x={x} l={l} ctxId={ctxId} />)}
    <Text style={{ color: palette.foreground, fontSize: 11 }}>{tt(l, 'Նոր վարձակալի ավելացումը այս API-ով հասանելի չէ։', 'Добавление нового арендатора через этот API недоступно.', 'Adding a new renter is not available through this API.')}</Text></View>;
}
