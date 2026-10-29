import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { createOnlinePaymentIntent, customFetch, listResidentInvoices, getPaymentsWorkspace, getUtilityBillingWorkspace } from '@workspace/api-client-react';
import { L, S, safeError, type Language, type T } from '@/lib/resident/text';
import { newUuid } from '@/lib/resident/hooks';
import { Btn, Card, Chip, Empty, ErrorBox, Skeleton , Row } from '../Ui';
import { useDomainAccess } from './useDomain';
const D = { inv: ['Հաշիվների պատմություն', 'История счетов', 'Invoice history'] as T, paid: ['Վճարված', 'Оплачено', 'Paid'] as T, bal: ['Մնացորդ', 'Остаток', 'Balance'] as T, ready: ['Առցանց վճարման պատրաստվածություն', 'Готовность онлайн-оплаты', 'Online payment readiness'] as T, off: ['Առցանց վճարումը դեռ հասանելի չէ․ մատակարարի պայմանագիրը կամ հավատարմագրերը չեն միացված։', 'Онлайн-оплата пока недоступна: договор с провайдером или ключи не подключены.', 'Online payment is not available yet: the provider contract or credentials are not connected.'] as T, on: ['Հասանելի է', 'Доступна', 'Available'] as T, payable: ['Վճարման ենթակա հաշիվներ', 'Счета к оплате', 'Invoices to pay'] as T, pay: ['Վճարել', 'Оплатить', 'Pay'] as T, hist: ['Վճարումների պատմություն', 'История платежей', 'Payment history'] as T, util: ['Կոմունալ ծառայություններ', 'Коммунальные услуги', 'Utilities'] as T, nobal: ['Մնացորդը չի ստացվել՝ նույնը չէ, ինչ 0։', 'Баланс не получен — это не ноль.', 'Balance not retrieved — this is not zero.'] as T, none: ['Վճարման ենթակա հաշիվներ չկան', 'Нет счетов к оплате', 'No invoices to pay'] as T, redirect: ['Վճարումը չի սկսվել․ ստուգեք մատակարարին։', 'Платёж не начат: провайдер не вернул ссылку.', 'Payment was not started: the provider returned no link.'] as T };
const EX = {
  explain: ['Ինչպե՞ս է հաշվարկվել', 'Как рассчитано', 'How it was calculated'] as T,
  method: ['Հաշվարկի եղանակ', 'Способ расчёта', 'Calculation method'] as T,
  base: ['Հիմք', 'База', 'Basis'] as T,
  rate: ['Սակագին', 'Тариф', 'Rate'] as T,
  raw: ['Մինչ կլորացումը', 'До округления', 'Before rounding'] as T,
  rounded: ['Հաշիվը', 'Итого по строке', 'Line total'] as T,
  legacy: ['Պահպանված հին սակագին', 'Ранее сохранённый тариф', 'Previously saved tariff'] as T,
  review: ['Հաղորդել սխալ տվյալների մասին', 'Сообщить о неверных данных', 'Report incorrect data'] as T,
  value: ['Ճիշտ արժեքը', 'Правильное значение', 'Correct value'] as T,
  reason: ['Մեկնաբանություն', 'Комментарий', 'Reason'] as T,
  send: ['Ուղարկել ստուգման', 'Отправить на проверку', 'Submit for review'] as T,
  pending: ['Ուղարկվել է ստուգման։ Հրապարակված հաշիվը չի փոխվում։', 'Отправлено на проверку. Опубликованный счёт не изменяется.', 'Sent for review. The published invoice is unchanged.'] as T,
  unchanged: ['Հաշիվը մնում է անփոփոխ․ ստուգման հարցումն ազդում է միայն ապագա հաշվարկների վրա։', 'Счёт не меняется: запрос касается только будущих расчётов.', 'The invoice remains unchanged; this review only concerns future calculations.'] as T,
  residentCount: ['Բնակիչների քանակ', 'Количество жильцов', 'Resident count'] as T,
  area: ['Հաշվարկային մակերես', 'Расчётная площадь', 'Billing area'] as T,
  failed: ['Չհաջողվեց ուղարկել։ Փորձեք կրկին։', 'Не удалось отправить. Попробуйте ещё раз.', 'Could not submit. Try again.'] as T,
};
type InvoiceLine = { id:string; description:string; quantity_hundredths:string; rate_minor:string; amount_minor:string; calculation_metadata?:{model?:string;method?:string;serviceId?:string;baseQuantity?:string;unproratedQuantity?:string;baseUnit?:string;rateMinor?:string;rateUnit?:string;rawAmountMinor?:string;roundedAmountMinor?:string;roundingMode?:string} };
type InvoiceDetail = { id:string; lines:InvoiceLine[] };
const METHOD:Record<string,T> = {
  FIXED_PER_UNIT:['Յուրաքանչյուր բնակարանի համար','Фиксированная сумма за квартиру','Fixed per unit'] as T,
  PER_SQUARE_METER:['Ըստ քառակուսի մետրի','За квадратный метр','Per square meter'] as T,
  PER_RESIDENT:['Ըստ բնակիչների քանակի','За количество жильцов','Per resident'] as T,
  PER_PARKING_SPACE:['Ըստ կայանատեղերի','За парковочные места','Per parking space'] as T,
  PER_METER_CONSUMPTION:['Ըստ հաշվիչի ցուցմունքի','По показаниям счётчика','Per meter consumption'] as T,
  PER_QUANTITY:['Ըստ քանակի','По количеству','Per quantity'] as T,
  PER_DAY:['Ըստ օրերի','За день','Per day'] as T,
  MANUAL:['Ձեռքով հաշվարկ','Ручной расчёт','Manual calculation'] as T,
};
const ist: Record<string, T> = { paid: ['Վճարված', 'Оплачен', 'Paid'], open: ['Բաց', 'Открыт', 'Open'], partial: ['Մասնակի', 'Частично', 'Partially paid'], overdue: ['Ժամկետանց', 'Просрочен', 'Overdue'], issued: ['Թողարկված', 'Выставлен', 'Issued'], void: ['Չեղյալ', 'Аннулирован', 'Void'] };
const ps: Record<string, T> = { succeeded: ['Հաջողված', 'Успешно', 'Succeeded'], processing: ['Մշակվում է', 'В обработке', 'Processing'], pending: ['Սպասում է', 'Ожидает', 'Pending'], pending_verification: ['Սպասում է ստուգման', 'Ожидает проверки', 'Pending verification'], failed: ['Ձախողված', 'Неуспешно', 'Failed'], cancelled: ['Չեղարկված', 'Отменён', 'Cancelled'], refunded: ['Վերադարձված', 'Возврат', 'Refunded'], created: ['Ստեղծված', 'Создан', 'Created'] };
export default function Finance({ l }: { l: Language }) { const palette = useAppPalette();
  const { ctxId } = useDomainAccess('finance'); const qc = useQueryClient();
  const w = useQuery({ queryKey: ['resident-pay', ctxId], enabled: !!ctxId, queryFn: () => getPaymentsWorkspace() });
  const u = useQuery({ queryKey: ['resident-util', ctxId], enabled: !!ctxId, queryFn: () => getUtilityBillingWorkspace() });
  const inv = useQuery({ queryKey: ['resident-invoices', ctxId], enabled: !!ctxId, queryFn: () => listResidentInvoices() });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [openedInvoiceId, setOpenedInvoiceId] = useState<string|null>(null);
  const [reviewLine, setReviewLine] = useState<InvoiceLine|null>(null);
  const [reviewValue, setReviewValue] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const [reviewSent, setReviewSent] = useState(false);
  const invoiceDetail = useQuery({
    queryKey: ['resident-invoice-explanation', ctxId, openedInvoiceId],
    enabled: !!ctxId && !!openedInvoiceId,
    queryFn: () => customFetch<InvoiceDetail>(`/finance/invoices/${encodeURIComponent(openedInvoiceId!)}/details`, { method: 'GET', responseType: 'json' }),
  });
  const money = (m: string, c: string) => `${(Number(m) / 100).toLocaleString(l)} ${c}`;
  const pay = async (ids: string[]) => { setBusy(true); setErr(''); try { const i = await createOnlinePaymentIntent({ domain: 'property', key: newUuid(), invoiceIds: ids, allocationStrategy: 'selected_invoices' }); if (i.redirect_url) await WebBrowser.openBrowserAsync(i.redirect_url); else setErr(L(l, D.redirect)); } catch (e) { setErr(safeError(l, e)); } finally { setBusy(false); void qc.invalidateQueries({ queryKey: ['resident-pay', ctxId] }); } };
  const submitParameterReview = async () => {
    if (!reviewLine || reviewBusy || reviewValue.trim() === '' || reviewReason.trim().length < 5) return;
    const method = reviewLine.calculation_metadata?.method;
    const parameterKey = method === 'PER_RESIDENT' ? 'resident_count' : method === 'PER_SQUARE_METER' ? 'billing_area' : null;
    const value = Number(reviewValue);
    if (!parameterKey || !Number.isFinite(value) || value < 0 || parameterKey === 'billing_area' && value <= 0 || parameterKey === 'resident_count' && !Number.isInteger(value)) {
      setReviewError(true);
      return;
    }
    setReviewBusy(true); setReviewError(false);
    try {
      await customFetch('/resident/finance/parameter-reviews', {
        method: 'POST',
        body: JSON.stringify({ parameterKey, serviceId: reviewLine.calculation_metadata?.serviceId, proposedValue: value, reason: reviewReason.trim(), clientId: newUuid() }),
        responseType: 'json',
      });
      setReviewSent(true); setReviewLine(null); setReviewReason(''); setReviewValue('');
    } catch {
      setReviewError(true);
    } finally {
      setReviewBusy(false);
    }
  };
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
    {inv.data?.map(i => <Card key={i.id}>
      <Pressable accessibilityRole="button" accessibilityLabel={L(l, EX.explain)} onPress={() => { setReviewLine(null); setOpenedInvoiceId(openedInvoiceId === i.id ? null : i.id); }}>
        <Row icon={i.status === 'paid' ? 'check-circle' : 'file-text'} tone={i.status === 'paid' ? 'ok' : 'accent'} title={`${i.period} · ${money(i.amount_minor, i.currency)}`} subtitle={`${L(l, D.paid)}: ${money(i.paid_minor, i.currency)} · ${L(l, D.bal)}: ${money(i.balance_minor, i.currency)}`} right={<Chip tone={i.status === 'paid' ? 'ok' : 'warn'} label={ist[i.status] ? L(l, ist[i.status]) : '·'} />} />
      </Pressable>
      {openedInvoiceId === i.id && <View style={{ gap: 10, paddingTop: 12 }}>
        <Text style={{ color: palette.foreground, fontWeight: '800' }}>{L(l, EX.explain)}</Text>
        {invoiceDetail.isPending && <Skeleton />}
        {invoiceDetail.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => invoiceDetail.refetch()} />}
        {invoiceDetail.data?.lines.map(line => {
          const meta = line.calculation_metadata;
          const method = meta?.method;
          const parameterKey = method === 'PER_RESIDENT' ? 'resident_count' : method === 'PER_SQUARE_METER' ? 'billing_area' : null;
          const base = meta?.unproratedQuantity ?? meta?.baseQuantity ?? (Number(line.quantity_hundredths) / 100).toFixed(2);
          return <View key={line.id} style={{ gap: 5, borderTopWidth: 1, borderColor: palette.border, paddingTop: 10 }}>
            <Text style={{ color: palette.foreground, fontWeight: '700' }}>{line.description}</Text>
            <Text style={{ color: palette.mutedForeground }}>{L(l, EX.method)}: {method && METHOD[method] ? L(l, METHOD[method]) : L(l, EX.legacy)}</Text>
            <Text style={{ color: palette.mutedForeground }}>{L(l, EX.base)}: {base}{meta?.baseUnit ? ` ${meta.baseUnit}` : ''}</Text>
            <Text style={{ color: palette.mutedForeground }}>{L(l, EX.rate)}: {money(meta?.rateMinor ?? line.rate_minor, i.currency)}</Text>
            <Text style={{ color: palette.mutedForeground }}>{L(l, EX.raw)}: {money(meta?.rawAmountMinor ?? line.amount_minor, i.currency)}</Text>
            <Text style={{ color: palette.foreground, fontWeight: '700' }}>{L(l, EX.rounded)}: {money(meta?.roundedAmountMinor ?? line.amount_minor, i.currency)}</Text>
            {parameterKey && <Btn label={L(l, EX.review)} onPress={() => { setReviewLine(line); setReviewValue(base); setReviewReason(''); setReviewError(false); setReviewSent(false); }} />}
            {reviewLine?.id === line.id && <View style={{ gap: 8 }}>
              <Text style={{ color: palette.mutedForeground }}>{L(l, parameterKey === 'resident_count' ? EX.residentCount : EX.area)} · {L(l, EX.unchanged)}</Text>
              <TextInput accessibilityLabel={L(l, EX.value)} value={reviewValue} onChangeText={setReviewValue} keyboardType="decimal-pad" style={{ color: palette.foreground, borderColor: palette.border, borderWidth: 1, borderRadius: 10, padding: 10 }} />
              <TextInput accessibilityLabel={L(l, EX.reason)} value={reviewReason} onChangeText={setReviewReason} multiline placeholder={L(l, EX.reason)} style={{ color: palette.foreground, borderColor: palette.border, borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 72, textAlignVertical: 'top' }} />
              <Btn label={L(l, EX.send)} busy={reviewBusy} disabled={reviewReason.trim().length < 5 || reviewValue.trim() === ''} onPress={() => void submitParameterReview()} />
              {reviewError && <ErrorBox message={L(l, EX.failed)} />}
            </View>}
            {reviewSent && <Text accessibilityRole="text" style={{ color: palette.mutedForeground }}>{L(l, EX.pending)}</Text>}
          </View>;
        })}
      </View>}
    </Card>)}
    <Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{L(l, D.util)}</Text>
    {u.isPending && <Skeleton />}{u.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => u.refetch()} />}
    {u.data && <Card>{!u.data.accounts.length && <Text style={{ color: palette.foreground }}>{L(l, S.empty)}</Text>}{u.data.accounts.map(a => <Text key={a.id}>{a.display_name} · {a.subscriber_number_masked}</Text>)}<Text style={{ color: palette.mutedForeground, fontSize: 12 }}>{L(l, D.nobal)}</Text></Card>}
  </View>;
}
