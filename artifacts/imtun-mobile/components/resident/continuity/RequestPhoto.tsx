import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { uploadOperationalPhoto } from '@workspace/api-client-react';
import { useLang } from '@/lib/resident/hooks';
import { Btn, ErrorBox } from '../Ui';
import { useAction } from '../useAction';
import { tt } from './core';
import { pickImage } from './media';
export default function RequestPhoto({ requestId }: { requestId: string }) {
  const l = useLang(); const [msg, setMsg] = useState(''); const [done, setDone] = useState(0); const a = useAction(l, () => undefined);
  return <View style={{ gap: 6, marginTop: 10 }}>
    <Btn kind="secondary" label={tt(l, 'Կցել լուսանկար', 'Прикрепить фото', 'Attach a photo')} busy={a.busy} onPress={() => { setMsg(''); void a.run(async () => { const p = await pickImage(l, 8 * 1024 * 1024, false); if (!p) return; if ('error' in p) { setMsg(p.error); return; } await uploadOperationalPhoto(requestId, p.blob, { photoType: 'evidence' }); setDone(n => n + 1); }); }} />
    {done > 0 && <Text accessibilityRole="alert">{tt(l, `Կցված լուսանկարներ՝ ${done}`, `Прикреплено фото: ${done}`, `Photos attached: ${done}`)}</Text>}
    {msg ? <ErrorBox message={msg} /> : null}{a.err ? <ErrorBox message={a.err} /> : null}
  </View>;
}
