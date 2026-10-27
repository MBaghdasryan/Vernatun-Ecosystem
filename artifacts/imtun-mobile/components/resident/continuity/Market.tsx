import React, { useMemo, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Linking, Pressable, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createResidentSavedSearch, deleteResidentSavedSearch, getResidentPropertyComparison, getResidentRecords } from '@workspace/api-client-react';
import type { ResidentContinuity, ResidentSearchInput } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import type { Language } from '@/lib/resident/text';
import { useContextId } from '@/lib/resident/hooks';
import { Btn, Card, Empty, ErrorBox, Field, Segment, Skeleton } from '../Ui';
import { useAction } from '../useAction';
import RecordCard from '../RecordCard';
import { contKey, tt } from './core';
type Offer = ResidentSearchInput['offerType'];
export default function Market({ d, l }: { d: ResidentContinuity; l: Language }) { const palette = useAppPalette();
  const qc = useQueryClient(); const ctx = useContextId();
  const a = useAction(l, () => {
    void qc.invalidateQueries({ queryKey: contKey(ctx) });
    void qc.invalidateQueries({ queryKey: ['resident-cx-listings', ctx] });
  });
  const [query, setQuery] = useState(''); const [offer, setOffer] = useState<Offer>('all'); const [name, setName] = useState(''); const [sel, setSel] = useState<string[]>([]); const [go, setGo] = useState(false); const [detailId, setDetailId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['resident-cx-listings', ctx, query, offer], enabled: d.canMarketplace && !!ctx, queryFn: () => getResidentRecords('listings', { ...(query ? { search: query } : {}), offerType: offer }) });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const ids = sel.filter(i => items.some(r => r.id === i)); const idsKey = ids.join(',');
  const cmp = useQuery({ queryKey: ['resident-cx-compare', ctx, idsKey], enabled: go && ids.length >= 2, queryFn: () => getResidentPropertyComparison({ ids: idsKey }) });
  if (!d.canMarketplace) return <Empty text={tt(l, 'Հայտարարությունների տախտակը միացված չէ։', 'Доска объявлений не включена.', 'The marketplace is not enabled.')} />;
  const toggle = (id: string) => { setGo(false); setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 4 ? [...s, id] : s); };
  return <>
    <Card>
      <Field label={tt(l, 'Որոնում', 'Поиск', 'Search')} value={query} onChange={setQuery} maxLength={120} />
      <Segment<Offer> label={tt(l, 'Տեսակ', 'Тип предложения', 'Offer type')} value={offer} options={[['all', tt(l, 'Բոլորը', 'Все', 'All')], ['sale', tt(l, 'Վաճառք', 'Продажа', 'Sale')], ['rent', tt(l, 'Վարձ', 'Аренда', 'Rent')]]} onChange={setOffer} />
    </Card>
    <Card>
      <Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{tt(l, 'Քարտեզ', 'Карта объявлений', 'Listing map')}</Text>
      <View
        accessibilityLabel={tt(l, 'Ներկառուցված քարտեզը դեռ միացված չէ', 'Встроенная карта пока не подключена', 'Embedded map is not connected yet')}
        testID="marketplace-map-shell"
        style={{ minHeight: 176, marginTop: 10, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: 14, backgroundColor: palette.surface }}
      >
        <Feather name="map" size={25} color={palette.mutedForeground} />
        <Text style={{ color: palette.foreground, fontWeight: '700', textAlign: 'center' }}>{tt(l, 'Քարտեզը կհայտնվի այստեղ', 'Здесь появится карта объявлений', 'The listing map will appear here')}</Text>
        <Text style={{ color: palette.mutedForeground, textAlign: 'center', fontSize: 12 }}>{tt(l, 'Ընտրված է MapLibre և MapTiler, բայց քարտեզը դեռ միացված չէ։ Քարտեզում կհայտնվեն միայն ստուգված տեղադրությունները։ Մինչ այդ հայտարարության հասցեն կարող եք բացել արտաքին քարտեզում։', 'Выбраны MapLibre и MapTiler, но карта ещё не подключена. На карте будут показаны только проверенные местоположения. Пока адрес объявления можно открыть во внешнем приложении карт.', 'MapLibre and MapTiler are selected, but the map is not configured yet. Only verified locations will appear on the map. For now, you can open a listing address in an external maps app.')}</Text>
      </View>
    </Card>
    <Card><Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{tt(l, 'Պահված որոնումներ (անձնական)', 'Сохранённые поиски (личные)', 'Saved searches (private)')}</Text>
      <Field label={tt(l, 'Անվանում', 'Название', 'Name')} value={name} onChange={setName} maxLength={80} />
      <Btn label={tt(l, 'Պահել ընթացիկ որոնումը', 'Сохранить текущий поиск', 'Save current search')} busy={a.busy} disabled={!name.trim()} onPress={() => void a.run(async () => { await createResidentSavedSearch({ name: name.trim(), query, offerType: offer }); setName(''); })} />
       {d.savedSearches.map(s => <View key={s.id} style={{ gap: 6 }}><Text style={{ color: palette.foreground, fontWeight: '700' }}>{s.name} · {s.query || '—'} · {s.offerType}</Text>
         <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Btn kind="secondary" label={tt(l, 'Կիրառել', 'Применить', 'Apply')} testID={`marketplace-apply-search-${s.id}`} onPress={() => { setQuery(s.query); setOffer(s.offerType); setSel([]); setGo(false); setDetailId(null); }} /></View><View style={{ flex: 1 }}><Btn kind="danger" label={tt(l, 'Ջնջել', 'Удалить', 'Delete')} busy={a.busy} onPress={() => void a.run(() => deleteResidentSavedSearch(s.id))} /></View></View></View>)}
      {!d.savedSearches.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Պահված որոնումներ չկան', 'Сохранённых поисков нет', 'No saved searches')}</Text>}{a.err ? <ErrorBox message={a.err} /> : null}</Card>
    <Card><Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{tt(l, 'Համեմատել (մինչև 4)', 'Сравнить (до 4)', 'Compare (up to 4)')}</Text>
      {q.isPending && <Skeleton />}{q.isError && <ErrorBox message={tt(l, 'Չհաջողվեց բեռնել։', 'Не удалось загрузить.', 'Could not load.')} retryLabel={tt(l, 'Կրկնել', 'Повторить', 'Retry')} onRetry={() => q.refetch()} />}
      {q.data && !items.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Հայտարարություններ չկան', 'Объявлений нет', 'No listings')}</Text>}
       {items.map(r => { const on = ids.includes(r.id); const open = detailId === r.id; return <View key={r.id} style={{ gap: 8 }}>
         <View style={{ flexDirection: 'row', gap: 8 }}>
           <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !on && ids.length >= 4 }} disabled={!on && ids.length >= 4} onPress={() => toggle(r.id)} style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: on ? palette.primary : palette.border, backgroundColor: on ? palette.accent : palette.surface }}><Text style={{ fontWeight: '700', color: palette.foreground }}>{on ? '✓ ' : ''}{r.title}</Text></Pressable>
           <Btn kind="secondary" testID={`marketplace-details-${r.id}`} label={tt(l, open ? 'Թաքցնել' : 'Մանրամասներ', open ? 'Скрыть' : 'Подробности', open ? 'Hide details' : 'View details')} onPress={() => setDetailId(open ? null : r.id)} />
         </View>
         {open && <RecordCard kind="listings" rec={r} l={l} after={() => {
           void qc.invalidateQueries({ queryKey: ['resident-cx-listings', ctx] });
           void qc.invalidateQueries({ queryKey: contKey(ctx) });
         }} />}
       </View>; })}
      <Btn label={`${tt(l, 'Համեմատել', 'Сравнить', 'Compare')} (${ids.length}/4)`} disabled={ids.length < 2} onPress={() => setGo(true)} />
      {cmp.isFetching && <Skeleton />}{cmp.isError && <ErrorBox message={tt(l, 'Համեմատությունը հասանելի չէ։', 'Сравнение недоступно.', 'Comparison is unavailable.')} />}
      {go && cmp.data?.map(p => <View key={p.id} style={{ gap: 4, padding: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 12 }}><Text style={{ color: palette.foreground, fontWeight: '800' }}>{p.title}</Text>
        <Text style={{ color: palette.foreground }}>{p.priceMinor !== null && p.currency ? (Number(p.priceMinor) / 100).toLocaleString(l) + ' ' + p.currency : tt(l, 'Գինը նշված չէ', 'Цена не указана', 'Price not provided')}</Text><Text style={{ color: palette.foreground }}>{p.description}</Text><Text style={{ color: palette.foreground }}>{p.address || tt(l, 'Հասցե նշված չէ', 'Адрес не указан', 'No address')}</Text>
        {p.latitude != null && p.longitude != null ? <><Btn kind="secondary" label={tt(l, 'Բացել արտաքին քարտեզների հավելվածում', 'Открыть во внешнем приложении карт', 'Open in external maps app')} onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}`)} /><Text style={{ color: palette.foreground, fontSize: 11 }}>© OpenStreetMap contributors</Text></> : <Text style={{ color: palette.foreground, fontSize: 12 }}>{tt(l, 'Տեղադրությունը նշված չէ', 'Местоположение не задано', 'Location not set')}</Text>}
        {p.address ? <Btn kind="secondary" label={tt(l, 'Արտաքին հասցեի որոնում (OpenStreetMap)', 'Внешний поиск адреса (OpenStreetMap)', 'External address lookup (OpenStreetMap)')} onPress={() => void Linking.openURL('https://www.openstreetmap.org/search?query=' + encodeURIComponent(p.address))} /> : null}</View>)}</Card>
  </>;
}
