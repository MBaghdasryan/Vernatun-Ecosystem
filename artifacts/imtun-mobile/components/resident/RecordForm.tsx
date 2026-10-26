import React, { useState } from 'react';
import { View } from 'react-native';
import { createResidentRecord, updateResidentRecord } from '@workspace/api-client-react';
import type { ResidentRecord, ResidentRecordInput, ResidentRecordKind } from '@workspace/api-client-react';
import { L, S, feedbackCats, keepFields, type Language, type T } from '@/lib/resident/text';
import { Btn, ErrorBox, Field, Segment } from './Ui';
import { useAction } from './useAction';
const extra: Record<string, [string, T][]> = {
  vehicles: [['plate', ['Համարանիշ', 'Госномер', 'Plate']], ['make', ['Մակնիշ', 'Марка', 'Make']], ['model', ['Մոդել', 'Модель', 'Model']], ['color', ['Գույն', 'Цвет', 'Color']]],
  directory: [['category', ['Կատեգորիա', 'Категория', 'Category']]], discussions: [['category', ['Կատեգորիա', 'Категория', 'Category']]],
  listings: [['priceMinor', S.price]],
};
const vt: [string, T][] = [['car', ['Մեքենա', 'Автомобиль', 'Car']], ['motorcycle', ['Մոտոցիկլ', 'Мотоцикл', 'Motorcycle']], ['bicycle', ['Հեծանիվ', 'Велосипед', 'Bicycle']], ['other', ['Այլ', 'Другое', 'Other']]];
// Create/edit form built from per-kind field definitions; parent links a service order or a listing inquiry.
export default function RecordForm({ kind, l, after, rec, parent, onDone, submitLabel }: { kind: ResidentRecordKind; l: Language; after: () => void; rec?: ResidentRecord; parent?: ResidentRecord; onDone: () => void; submitLabel?: T }) {
  const d = (rec?.data ?? {}) as Record<string, unknown>;
  const init: Record<string, string> = { title: rec?.title ?? parent?.title ?? '', body: rec?.body ?? '', qty: '1', saleType: String(d.saleType ?? 'sale'), fbCat: String(d.category ?? 'idea'), vehicleType: String(d.vehicleType ?? 'car') };
  for (const [k] of extra[kind] ?? []) if (d[k] != null) init[k] = String(d[k]);
  const [v, setV] = useState(init);
  const a = useAction(l, after);
  const set = (k: string) => (x: string) => setV({ ...v, [k]: x });
  const submit = () => void a.run(async () => {
    const data: ResidentRecordInput = { title: v.title.trim(), body: v.body };
    for (const [k] of extra[kind] ?? []) if (v[k]) (data as unknown as Record<string, unknown>)[k] = v[k];
    if (kind === 'feedback') data.category = v.fbCat;
    if (kind === 'discussions') data.category = (v.category || 'general').trim() || 'general';
    if (kind === 'vehicles') { data.country = String(d.country ?? 'AM'); data.vehicleType = v.vehicleType as 'car'; }
    if (kind === 'listings') { data.saleType = v.saleType as 'sale'; data.currency = 'AMD'; }
    if (kind === 'subscriptions') data.quantity = Math.max(1, Number(v.qty) || 1);
    if (parent && (kind === 'subscriptions' || kind === 'conversations')) data.parentId = parent.id;
    if (rec) await updateResidentRecord(kind, rec.id, { ...keepFields(kind, d), ...data, version: rec.version }); else await createResidentRecord(kind, data);
    onDone();
  });
  return <View style={{ gap: 12 }}>
    <Field label={L(l, S.title)} value={v.title} onChange={set('title')} maxLength={200} />
    <Field label={L(l, S.body)} value={v.body} onChange={set('body')} multiline maxLength={5000} />
    {(extra[kind] ?? []).map(([k, lab]) => <Field key={k} label={L(l, lab)} value={v[k] ?? ''} onChange={set(k)} keyboard={k === 'priceMinor' ? 'number-pad' : undefined} />)}
    {kind === 'feedback' && <Segment label={L(l, ['Կատեգորիա', 'Категория', 'Category'])} value={v.fbCat} options={feedbackCats.map(([k, t]) => [k, L(l, t)] as [string, string])} onChange={set('fbCat')} />}
    {kind === 'vehicles' && <Segment label={L(l, ['Տեսակ', 'Тип', 'Type'])} value={v.vehicleType} options={vt.map(([k, t]) => [k, L(l, t)] as [string, string])} onChange={set('vehicleType')} />}
    {kind === 'listings' && <Segment label={L(l, ['Տեսակ', 'Тип', 'Type'])} value={v.saleType} options={[['sale', L(l, ['Վաճառք', 'Продажа', 'Sale'])], ['rent', L(l, ['Վարձակալություն', 'Аренда', 'Rent'])]]} onChange={set('saleType')} />}
    {kind === 'subscriptions' && <Field label={L(l, S.qty)} value={v.qty} onChange={set('qty')} keyboard="number-pad" />}
    <Btn label={L(l, submitLabel ?? S.save)} onPress={submit} busy={a.busy} disabled={!v.title.trim()} />
    <Btn label={L(l, ['Չեղարկել', 'Отмена', 'Cancel'])} kind="secondary" onPress={onDone} />
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
