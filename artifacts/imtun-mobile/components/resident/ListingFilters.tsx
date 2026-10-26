import React from 'react';
import { View } from 'react-native';
import { L, type Language } from '@/lib/resident/text';
import { LT, majorToMinor, CURRENCIES } from '@/lib/resident/listingText';
import { Btn, Field, Segment } from './Ui';
export type LF = { saleType: string; currency: string; min: string; max: string; rooms: string };
export const emptyLF: LF = { saleType: '', currency: '', min: '', max: '', rooms: '' };
export function lfParams(f: LF) {
  const p: Record<string, unknown> = {};
  if (f.saleType) p.saleType = f.saleType; if (f.currency) p.currency = f.currency;
  if (f.min) p.minPrice = majorToMinor(f.min) ?? f.min; if (f.max) p.maxPrice = majorToMinor(f.max) ?? f.max;
  if (f.rooms !== '') p.rooms = f.rooms;
  return p;
}
export default function ListingFilters({ f, set, l }: { f: LF; set: (f: LF) => void; l: Language }) {
  return <View style={{ gap: 8 }}>
    <Segment label={L(l, LT.type)} value={f.saleType} options={[['', L(l, LT.any)], ['sale', L(l, LT.sale)], ['rent', L(l, LT.rent)]]} onChange={x => set({ ...f, saleType: x })} />
    <Segment label={L(l, LT.currency)} value={f.currency} options={[['', L(l, LT.any)], ...CURRENCIES.map(c => [c, c] as [string, string])]} onChange={x => set({ ...f, currency: x })} />
    {!!f.currency && <><Field label={L(l, LT.min)} value={f.min} onChange={x => set({ ...f, min: x })} keyboard="decimal-pad" />
    <Field label={L(l, LT.max)} value={f.max} onChange={x => set({ ...f, max: x })} keyboard="decimal-pad" /></>}
    <Field label={L(l, LT.rooms)} value={f.rooms} onChange={x => set({ ...f, rooms: x })} keyboard="number-pad" />
    <Btn kind="secondary" label={L(l, LT.reset)} onPress={() => set(emptyLF)} />
  </View>;
}
