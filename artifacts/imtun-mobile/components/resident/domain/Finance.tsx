import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { createOnlinePaymentIntent, listResidentInvoices, getPaymentsWorkspace, getUtilityBillingWorkspace } from '@workspace/api-client-react';
import { L, S, safeError, type Language, type T } from '@/lib/resident/text';
import { newUuid } from '@/lib/resident/hooks';
import { Btn, Card, Chip, Empty, ErrorBox, Skeleton , Row } from '../Ui';
import { useDomainAccess } from './useDomain';
const D = { inv: ['Հաշիվների պատմություն', 'История счетов', 'Invoice history'] as T, paid: ['Վճարված', 'Оплачено', 'Paid'] as T, bal: ['Մնացորդ', 'Остаток', 'Balance'] as T, ready: ['Առցանց վճարման պատրաստվածություն', 'Готовность онлайн-оплаты', 'Online payment readiness'] as T, off: ['Առցանց վճարումը դեռ հասանելի չէ․ մատակարարի պայմանագիրը կամ հավատարմագրերը չեն միացված։', 'Онлайн-оплата пока недоступна: договор с провайдером или ключи не подключены.', 'Online payment is not available yet: the provider contract or credentials are not connected.'] as T, on: ['Հասանելի է', 'Доступна', 'Available'] as T, payable: ['Վճարման ենթակա հաշիվներ', 'Счета к оплате', 'Invoices to pay'] as T, pay: ['Վճարել', 'Оплатить', 'Pay'] as T, hist: ['Վճարումների պատմություն', 'История платежей', 'Payment history'] as T, util: ['Կոմունալ ծառայություններ', 'Коммунальные услуги', 'Utilities'] as T, nobal: ['Մնացորդը չի ստացվել՝ նույնը չէ, ինչ 0։', 'Баланс не получен — это не ноль.', 'Balance not retrieved — this is not zero.'] as T, none: ['Վճարման ենթակա հաշիվներ չկան', 'Нет счетов к оплате', 'No invoices to pay'] as T, redirect: ['Վճարումը չի սկսվել․ ստուգեք մատակարարին։', 'Платёж не начат: провайдер не вернул ссылку.', 'Payment was not started: the provider returned no link.'] as T };
const ist: Record<string, T> = { paid: ['Վճարված', 'Оплачен', 'Paid'], open: ['Բաց', 'Открыт', 'Open'], partial: ['Մասնակի', 'Частично', 'Partially paid'], overdue: ['Ժամկետանց', 'Просрочен', 'Overdue'], issued: ['Թողարկված', 'Выставлен', 'Issued'], void: ['Չեղյալ', 'Аннулирован', 'Void'] };
const ps: Record<string, T> = { succeeded: ['Հաջողված', 'Успешно', 'Succeeded'], processing: ['Մշակվում է', 'В обработке', 'Processing'], pending: ['Սպասում է', 'Ожидает', 'Pending'], pending_verification: ['Սպասում է ստուգման', 'Ожидает проверки', 'Pending verification'], failed: ['Ձախողված', 'Неуспешно', 'Failed'], cancelled: ['Չեղարկված', 'Отменён', 'Cancelled'], refunded: ['Վերադարձված', 'Возврат', 'Refunded'], created: ['Ստեղծված', 'Создан', 'Created'] };
export default function Finance({ l }: { l: Language }) { const palette = useAppPalette();
  const { ctxId } = useDomainAccess('finance'); const qc = useQueryClient();
  const w = useQuery({ queryKey: ['resident-pay', ctxId], enabled: !!ctxId, queryFn: () => getPaymentsWorkspace() });
  const u = useQuery({ queryKey: ['resident-util', ctxId], enabled: !!ctxId, queryFn: () => getUtilityBillingWorkspace() });
  const inv = useQuery({ queryKey: ['resident-invoices', ctxId], enabled: !!ctxId, queryFn: () => listResidentInvoices() });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const money = (m: string, c: string) => `${(Number(m) / 100).toLocaleString(l)} ${c}`;
  const pay = async (ids: string[]) => { setBusy(true); setErr(''); try { const i = await createOnlinePaymentIntent({ domain: 'property', key: newUuid(), invoiceIds: ids, allocationStrategy: 'selected_invoices' }); if (i.redirect_url) await WebBrowser.openBrowserAsync(i.redirect_url); else setErr(L(l, D.redirect)); } catch (e) { setErr(safeError(l, e)); } finally { setBusy(false); void qc.invalidateQueries({ queryKey: ['resident-pay', ctxId] }); } };
  return <View style={{ gap: 12 }}>
    {w.isPending && <Skeleton />}{w.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => w.refetch()} />}
    {w.data && <>
      <Card><Text style={{ color: palette.foreground, fontWeight: '800' }}>{L(l, D.ready)}</Text><Chip tone={w.data.readiness.onlineAvailable ? 'ok' : 'warn'} label={L(l, w.data.readiness.onlineAvailable ? D.on : D.off)} /></Card>
      <Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{L(l, D.payable)}</Text>
      {!w.data.payableInvoices.length && <Empty text={L(l, D.none)} />}
      {w.data.payableInvoices.map(i => <Card key={i.id}><Text style={{ color: palette.foreground, fontWeight: '800' }}>{i.period} · {money(i.balance_minor, i.currency)}</Text><Btn label={L(l, D.pay)} disabled={!w.data.readiness.onlineAvailable} busy={busy} onPress={() => void pay([i.id])} /></Card>)}
      {err ? <ErrorBox message={err} /> : null}
      <Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{L(l, D.hist)}</Text>
      {!w.data.intents.length && <Empty text={L(l, S.empty)} />}
      {w.data.intents.map(i => <Row key={i.id} icon="credit-card" tone="plain" title={money(i.amount_minor, i.currency)} subtitle={i.public_reference} right={<Chip tone={i.status === 'succeeded' ? 'ok' : 'warn'} label={ps[i.status] ? L(l, ps[i.status]) : '·'} />} />)}
    </>}
    <Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{L(l, D.inv)}</Text>
    {inv.isPending && <Skeleton />}{inv.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => inv.refetch()} />}{inv.data && !inv.data.length && <Empty text={L(l, S.empty)} />}
    {inv.data?.map(i => <Row key={i.id} icon={i.status === 'paid' ? 'check-circle' : 'file-text'} tone={i.status === 'paid' ? 'ok' : 'accent'} title={`${i.period} · ${money(i.amount_minor, i.currency)}`} subtitle={`${L(l, D.paid)}: ${money(i.paid_minor, i.currency)} · ${L(l, D.bal)}: ${money(i.balance_minor, i.currency)}`} right={<Chip tone={i.status === 'paid' ? 'ok' : 'warn'} label={ist[i.status] ? L(l, ist[i.status]) : '·'} />} />)}
    <Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{L(l, D.util)}</Text>
    {u.isPending && <Skeleton />}{u.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => u.refetch()} />}
    {u.data && <Card>{!u.data.accounts.length && <Text style={{ color: palette.foreground }}>{L(l, S.empty)}</Text>}{u.data.accounts.map(a => <Text key={a.id}>{a.display_name} · {a.subscriber_number_masked}</Text>)}<Text style={{ color: palette.mutedForeground, fontSize: 12 }}>{L(l, D.nobal)}</Text></Card>}
  </View>;
}
