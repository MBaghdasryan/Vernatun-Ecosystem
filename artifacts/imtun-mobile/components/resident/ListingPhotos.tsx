import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { getResidentListingPhoto, deleteResidentListingPhoto, uploadResidentListingPhoto } from '@workspace/api-client-react';
import type { ResidentRecord } from '@workspace/api-client-react';
import { palette } from '@/constants/colors';
import { L, S, type Language } from '@/lib/resident/text';
import { LT } from '@/lib/resident/listingText';
import { useContextId } from '@/lib/resident/hooks';
import { Btn, ErrorBox } from './Ui';
import { useAction } from './useAction';
// Authenticated download through the shared client; blob is converted to a data URI (no raw image URL, no token in URL).
function toDataUri(b: Blob): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }
function Photo({ rec, id, onDelete, busy, label }: { rec: ResidentRecord; id: string; onDelete?: () => void; busy: boolean; label: string }) {
  const ctx = useContextId();
  const [large, setLarge] = useState(false);
  const q = useQuery({ queryKey: ['resident-photo', ctx, rec.id, id], enabled: !!ctx, staleTime: 300000, queryFn: async () => toDataUri(await getResidentListingPhoto(rec.id, id)) });
  return <View style={{ gap: 4, width: large ? '100%' : 120 }}>
    {q.data ? <Pressable accessibilityRole="button" accessibilityLabel={rec.title} onPress={() => setLarge(!large)}><Image source={{ uri: q.data }} style={large ? { width: '100%', height: 260 } : st.img} resizeMode="contain" accessibilityLabel={rec.title} /></Pressable> : q.isError ? <Btn label="↻" onPress={() => void q.refetch()} /> : <View style={[st.img, { backgroundColor: palette.muted }]} />}
    {onDelete ? <Btn kind="danger" label={label} onPress={onDelete} busy={busy} /> : null}
  </View>;
}
export default function ListingPhotos({ rec, l, after }: { rec: ResidentRecord; l: Language; after: () => void }) {
  const a = useAction(l, after); const [ok, setOk] = useState(''); const [denied, setDenied] = useState(false); const [local, setLocal] = useState('');
  const pending = React.useRef<ImagePicker.ImagePickerAsset[]>([]);
  useEffect(() => { setOk(''); }, [rec.version]);
  const ids = rec.photos ?? []; const editable = rec.actions.includes('edit') && ['draft', 'rejected'].includes(rec.status);
  if (!ids.length && !editable) return null;
  const OKT = ['image/jpeg', 'image/png', 'image/webp'];
  const send = (assets: ImagePicker.ImagePickerAsset[]) => { pending.current = assets; setOk(''); setLocal(''); void a.run(async () => {
    let v = rec.version;
    while (pending.current.length) {
      const as = pending.current[0]; const mime = as.mimeType ?? (/\.png$/i.test(as.uri) ? 'image/png' : /\.webp$/i.test(as.uri) ? 'image/webp' : 'image/jpeg');
      if (!OKT.includes(mime) || (as.fileSize ?? 0) > 6 * 1024 * 1024) { pending.current = []; throw Object.assign(new Error('bad'), { status: 415 }); }
      const blob = await (await fetch(as.uri)).blob();
      if (blob.size > 6 * 1024 * 1024 || blob.size === 0) { pending.current = []; throw Object.assign(new Error('bad'), { status: 413 }); }
      const r = await uploadResidentListingPhoto(rec.id, blob, { version: v });
      v = r.version; pending.current = pending.current.slice(1);
    }
    setOk(L(l, LT.uploaded));
  }); };
  const pick = async () => {
    setLocal(''); setDenied(false);
    if (ids.length >= 10) return setLocal(L(l, LT.tooMany));
    // The image-only system picker grants access to selected assets, not the
    // entire library. Do not require blocked legacy Android storage permissions.
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10 - ids.length, quality: 0.85 });
    if (res.canceled || !res.assets.length) return;
    if (ids.length + res.assets.length > 10) return setLocal(L(l, LT.tooMany));
    send(res.assets);
  };
  const del = (pid: string) => Alert.alert(L(l, S.confirm), undefined, [{ text: L(l, ['Ոչ', 'Нет', 'No']), style: 'cancel' }, { text: L(l, LT.delPhoto), style: 'destructive', onPress: () => void a.run(async () => { await deleteResidentListingPhoto(rec.id, pid, { version: rec.version }); setOk(L(l, LT.removed)); }) }]);
  return <View style={{ gap: 8 }}>
    <Text style={st.h}>{L(l, LT.photos)} ({ids.length}/10)</Text>
    <View style={st.row}>{ids.map(id => <Photo key={id} rec={rec} id={id} busy={a.busy} label={L(l, LT.delPhoto)} onDelete={editable ? () => del(id) : undefined} />)}</View>
    {!ids.length ? <Text style={st.m}>{L(l, LT.noPhotos)}</Text> : null}
    {editable ? <><Btn kind="secondary" label={L(l, LT.upload)} onPress={() => void pick().catch((e:unknown) => { if (/permission/i.test(String((e as {code?:string})?.code))) setDenied(true); else setLocal(L(l,S.fail)); })} busy={a.busy} disabled={ids.length >= 10} /><Text style={st.m}>{L(l, LT.photoRules)}</Text></> : null}
    {denied ? <View style={{ gap: 6 }}><Text style={st.m} accessibilityRole="alert">{L(l, LT.perm)}</Text>{Platform.OS !== 'web' && <Btn kind="secondary" label={L(l, LT.settings)} onPress={() => void Linking.openSettings().catch(() => setLocal(L(l,S.fail)))} />}</View> : null}
    {local ? <Text style={st.m} accessibilityRole="alert">{local}</Text> : null}
    {a.err && pending.current.length ? <Btn kind="secondary" label={L(l, LT.retry)} onPress={() => send(pending.current)} busy={a.busy} /> : null}
    {ok ? <Text style={st.m} accessibilityRole="alert">{ok}</Text> : null}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
const st = StyleSheet.create({ img: { width: 120, height: 90, borderRadius: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, h: { fontWeight: '800', color: palette.foreground }, m: { color: palette.mutedForeground, fontSize: 12 } });
