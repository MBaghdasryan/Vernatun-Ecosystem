import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { updateResidentProfile } from '@workspace/api-client-react';
import type { ResidentProfileInput } from '@workspace/api-client-react';
import { L, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, ErrorBox, Field, Segment, Toggle } from './Ui';
import { useAction } from './useAction';
import { useResidentRefresh } from '@/lib/resident/hooks';
type Flag = 'showName' | 'showUnit' | 'showPhone' | 'allowMessages';
const flags: [Flag, T][] = [['showName', ['Ցույց տալ անունը ցուցակում', 'Показывать имя в справочнике', 'Show name in directory']], ['showUnit', ['Ցույց տալ բնակարանը', 'Показывать квартиру', 'Show unit']], ['showPhone', ['Ցույց տալ հեռախոսը', 'Показывать телефон', 'Show phone']], ['allowMessages', ['Թույլատրել հաղորդագրություններ', 'Разрешить сообщения', 'Allow messages']]];
export default function PrefsForm({ profile, l }: { profile: ResidentProfileInput; l: Language }) {
  const refresh = useResidentRefresh(); const [p, setP] = useState(profile); const [ok, setOk] = useState(false);
  const a = useAction(l, refresh);
  const set = <K extends keyof ResidentProfileInput>(k: K, v: ResidentProfileInput[K]) => { setOk(false); setP({ ...p, [k]: v }); };
  return <Card>
    <Field label={L(l, ['Անուն', 'Имя', 'Name'])} value={p.name} onChange={v => set('name', v)} maxLength={120} />
    <Field label={L(l, ['Հեռախոս', 'Телефон', 'Phone'])} value={p.phone} onChange={v => set('phone', v)} keyboard="phone-pad" maxLength={30} />
    <Segment label={L(l, ['Լեզու', 'Язык', 'Language'])} value={p.language} options={[['hy', 'Հայերեն'], ['ru', 'Русский'], ['en', 'English']]} onChange={v => set('language', v)} />
    <Segment label={L(l, ['Թեմա', 'Тема', 'Theme'])} value={p.theme} options={[['system', L(l, ['Համակարգի', 'Системная', 'System'])], ['light', L(l, ['Բաց', 'Светлая', 'Light'])], ['dark', L(l, ['Մութ', 'Тёмная', 'Dark'])]]} onChange={v => set('theme', v)} />
    <Segment label={L(l, ['Նախընտրելի կապ', 'Предпочтительный канал', 'Preferred channel'])} value={p.preferredChannel} options={[['email', 'Email'], ['phone', L(l, ['Հեռախոս', 'Телефон', 'Phone'])]]} onChange={v => set('preferredChannel', v)} />
    {flags.map(([k, lab]) => <Toggle key={k} label={L(l, lab)} value={p[k]} onChange={v => set(k, v)} />)}
    <Btn label={L(l, ['Պահպանել', 'Сохранить', 'Save'])} busy={a.busy} onPress={() => void a.run(async () => { await updateResidentProfile(p); setOk(true); })} />
    {ok && <View><Text>{L(l, ['Պահպանված է', 'Сохранено', 'Saved'])}</Text></View>}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </Card>;
}
