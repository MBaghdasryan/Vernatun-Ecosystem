import React, { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createResidentRecord } from '@workspace/api-client-react';
import { palette } from '@/constants/colors';
import { newUuid } from '@/lib/resident/hooks';
import { L, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, ErrorBox } from './Ui';
import { useAction } from './useAction';
const KEY = 'imtun.installationId';
const tx = { title: ['Այս սարքը', 'Это устройство', 'This device'] as T, add: ['Գրանցել սարքը', 'Зарегистрировать устройство', 'Register this device'] as T, note: ['Push ծանուցումները դեռ միացված չեն․ գրանցվում է միայն սարքը։', 'Push-уведомления пока не подключены: регистрируется только устройство.', 'Push notifications are not connected yet: only the device is registered.'] as T };
export default function DeviceRegister({ l, after }: { l: Language; after: () => void }) {
  const [id, setId] = useState('');
  const a = useAction(l, after);
  useEffect(() => { let live = true; void (async () => { let v = await AsyncStorage.getItem(KEY); if (!v) { v = newUuid(); await AsyncStorage.setItem(KEY, v); } if (live) setId(v); })(); return () => { live = false; }; }, []);
  const register = () => void a.run(() => createResidentRecord('mobile-devices', {
    title: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 200), body: '', installationId: id,
    platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
    appVersion: String(Constants.expoConfig?.version ?? '').slice(0, 40) || undefined, osVersion: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 80),
  }));
  return <Card><Text style={{ fontWeight: '800', color: palette.foreground }}>{L(l, tx.title)}</Text><Text style={{ color: palette.mutedForeground, fontSize: 12 }}>{L(l, tx.note)}</Text><Btn label={L(l, tx.add)} onPress={register} busy={a.busy} disabled={!id} />{a.err ? <ErrorBox message={a.err} /> : null}</Card>;
}
