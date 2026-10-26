import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { createResidentRecord, updateResidentRecord } from '@workspace/api-client-react';
import type { ResidentRecord } from '@workspace/api-client-react';
import { L, S, keepFields, type Language } from '@/lib/resident/text';
import { LT, minorToMajor, majorToMinor, optInt, optNum, CURRENCIES } from '@/lib/resident/listingText';
import { Btn, ErrorBox, Field, Segment } from './Ui';
import { useAction } from './useAction';
import { coordsFromText } from './continuity/core';
const strip = (o: Record<string, unknown>) => { const { area: _a, rooms: _r, floor: _f, latitude: _la, longitude: _lo, ...rest } = o; return rest; };
export default function ListingForm({ l, after, rec, onDone }: { l: Language; after: () => void; rec?: ResidentRecord; onDone: () => void }) {
  const d = (rec?.data ?? {}) as Record<string, unknown>;
  const [lat, setLat] = useState(String(d.latitude ?? '')), [lon, setLon] = useState(String(d.longitude ?? ''));
  const [v, setV] = useState({ title: rec?.title ?? '', body: rec?.body ?? '', saleType: String(d.saleType ?? 'sale'), currency: String(d.currency ?? 'AMD'), price: minorToMajor(d.priceMinor), area: d.area != null ? String(d.area) : '', rooms: d.rooms != null ? String(d.rooms) : '', floor: d.floor != null ? String(d.floor) : '' });
  const [err, setErr] = useState('');
  const a = useAction(l, after);
  const set = (k: string) => (x: string) => setV({ ...v, [k]: x });
  const submit = () => {
    setErr('');
    const area = optNum(v.area, 1, 100000), rooms = optInt(v.rooms, 0, 100), floor = optInt(v.floor, -10, 300), pm = majorToMinor(v.price);
    if (!v.price.trim()) return setErr(L(l, LT.priceReq));
    if (area === null || rooms === null || floor === null || pm === null) return setErr(L(l, LT.badNum));
    const cc = coordsFromText(lat, lon);
    if (cc === 'invalid') return setErr(L(l, ['Լրացրեք երկու ճիշտ կոորդինատ կամ թողեք դատարկ։', 'Укажите обе корректные координаты или оставьте пустыми.', 'Enter both valid coordinates or leave them empty.']));
    const data: Record<string, unknown> = { title: v.title.trim(), body: v.body, saleType: v.saleType, currency: v.currency };
    if (cc) Object.assign(data, cc);
    data.priceMinor = pm; if (area !== undefined) data.area = area; if (rooms !== undefined) data.rooms = rooms; if (floor !== undefined) data.floor = floor;
    void a.run(async () => {
      if (rec) await updateResidentRecord('listings', rec.id, { ...strip(keepFields('listings', d)), ...data, version: rec.version } as never);
      else await createResidentRecord('listings', data as never);
      onDone();
    });
  };
  return <View style={{ gap: 12 }}>
    <Field label={L(l, S.title)} value={v.title} onChange={set('title')} maxLength={200} />
    <Field label={L(l, S.body)} value={v.body} onChange={set('body')} multiline maxLength={5000} />
    <Segment label={L(l, LT.type)} value={v.saleType} options={[['sale', L(l, LT.sale)], ['rent', L(l, LT.rent)]]} onChange={set('saleType')} />
    <Segment label={L(l, LT.currency)} value={v.currency} options={CURRENCIES.map(c => [c, c] as [string, string])} onChange={set('currency')} />
    <Field label={L(l, LT.price)} value={v.price} onChange={set('price')} keyboard="decimal-pad" />
    <Field label={L(l, LT.area)} value={v.area} onChange={set('area')} keyboard="decimal-pad" />
    <Field label={L(l, LT.rooms)} value={v.rooms} onChange={set('rooms')} keyboard="number-pad" />
    <Field label={L(l, LT.floor)} value={v.floor} onChange={set('floor')} keyboard="numbers-and-punctuation" />
    <Field label={L(l, ['Լայնություն (−90…90, կամընտիր)', 'Широта (−90…90, необязательно)', 'Latitude (−90…90, optional)'])} value={lat} onChange={setLat} keyboard="numbers-and-punctuation" />
    <Field label={L(l, ['Երկայնություն (−180…180, կամընտիր)', 'Долгота (−180…180, необязательно)', 'Longitude (−180…180, optional)'])} value={lon} onChange={setLon} keyboard="numbers-and-punctuation" />
    <Btn label={L(l, S.save)} onPress={submit} busy={a.busy} disabled={!v.title.trim() || !v.price.trim()} />
    <Btn label={L(l, ['Չեղարկել', 'Отмена', 'Cancel'])} kind="secondary" onPress={onDone} />
    {err ? <Text accessibilityRole="alert">{err}</Text> : null}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
