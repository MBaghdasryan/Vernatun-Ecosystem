import React, { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';
import { deleteResidentAvatar, getResidentAvatar, uploadResidentAvatar } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { Btn, Card, ErrorBox } from '../Ui';
import { useAction } from '../useAction';
import { tt } from './core';
import { pickImage } from './media';
function toDataUri(b: Blob): Promise<string> { return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => (typeof f.result === 'string' ? res(f.result) : rej(new Error('read'))); f.onerror = () => rej(new Error('read')); f.readAsDataURL(b); }); }
export default function Avatar({ l, available, ctx, refresh }: { l: Language; available: boolean; ctx: string | null; refresh: () => void }) {
  const [uri, setUri] = useState(''); const [msg, setMsg] = useState(''); const a = useAction(l, refresh);
  useEffect(() => { let live = true; setUri(''); if (!available) return; void getResidentAvatar().then(toDataUri).then(u => { if (live) setUri(u); }).catch(() => { if (live) setMsg(tt(l, 'Նկարը չհաջողվեց բեռնել։', 'Не удалось загрузить фото.', 'Could not load the photo.')); }); return () => { live = false; }; }, [available, ctx, l]);
  return <Card>
    <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Պրոֆիլի նկար', 'Фото профиля', 'Profile photo')}</Text>
    {uri ? <Image source={{ uri }} accessibilityLabel={tt(l, 'Ձեր նկարը', 'Ваше фото', 'Your photo')} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Text>{tt(l, 'Նկար չկա', 'Фото не загружено', 'No photo')}</Text>}
    <Btn label={tt(l, 'Ընտրել նկար', 'Выбрать фото', 'Choose a photo')} busy={a.busy} onPress={() => { setMsg(''); void a.run(async () => { const p = await pickImage(l, 3 * 1024 * 1024, true); if (!p) return; if ('error' in p) { setMsg(p.error); return; } await uploadResidentAvatar(p.blob); }); }} />
    {available && <Btn kind="danger" label={tt(l, 'Հեռացնել', 'Удалить', 'Remove')} busy={a.busy} onPress={() => void a.run(async () => { await deleteResidentAvatar(); setUri(''); })} />}
    <Text style={{ fontSize: 11 }}>{tt(l, 'Նկարը մասնավոր է, հանրային հղում չկա։', 'Фото приватное, публичной ссылки нет.', 'The photo is private; there is no public link.')}</Text>
    {msg ? <ErrorBox message={msg} /> : null}{a.err ? <ErrorBox message={a.err} /> : null}
  </Card>;
}
