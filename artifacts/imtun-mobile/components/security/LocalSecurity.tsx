import React, { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useGetMobileAuthSession } from '@workspace/api-client-react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { useLang } from '@/lib/resident/hooks';
import { biometricAvailable, disableLocalLock, enrollLocalPin, localLockAvailable } from '@/lib/localSecurity';
import { useAppLock } from './AppLock';

export default function LocalSecurity() {
  const c = useAppPalette(); const lang = useLang(); const session = useGetMobileAuthSession(); const userId = session.data?.user?.id;
  const appLock = useAppLock(); const [available, setAvailable] = useState<boolean | null>(null); const [bioAvailable, setBioAvailable] = useState(false);
  const [pin, setPin] = useState(''); const [confirmation, setConfirmation] = useState(''); const [bio, setBio] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const t = (hy: string, ru: string, en: string) => lang === 'ru' ? ru : lang === 'en' ? en : hy;
  useEffect(() => { Promise.all([localLockAvailable(), biometricAvailable()]).then(([a, b]) => { setAvailable(a); setBioAvailable(b); }).catch(() => setAvailable(false)); }, []);
  async function save() {
    if (!userId || busy) return;
    if (!appLock.enabled && (pin.length !== 6 || pin !== confirmation)) { setMessage(t('PIN-երը պետք է համընկնեն և ունենան 6 թվանշան։', 'PIN должен состоять из 6 цифр и совпадать в обоих полях.', 'Enter the same six-digit PIN in both fields.')); return; }
    setBusy(true); setMessage('');
    try {
      if (appLock.enabled) await disableLocalLock(userId, pin);
      else await enrollLocalPin(userId, pin, bio);
      await appLock.refresh(); setPin(''); setConfirmation('');
      setMessage(t('Կարգավորումը պահպանված է։', 'Настройка сохранена.', 'Setting saved.'));
    } catch { setMessage(t('Չհաջողվեց պահպանել։ Ստուգեք PIN-ը կամ փորձեք ավելի ուշ։', 'Не удалось сохранить. Проверьте PIN или попробуйте позже.', 'Could not save. Check the PIN or try later.')); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 16, backgroundColor: c.surface, borderRadius: 16, padding: 18, borderColor: c.border, borderWidth: 1 }}>
    <Text style={{ fontWeight: '800', fontSize: 20, color: c.foreground }}>{t('Հավելվածի պաշտպանություն', 'Защита приложения', 'App security')}</Text>
    <Text style={{ color: c.mutedForeground }}>{t('PIN-ը պահվում է այս սարքի պաշտպանված պահոցում։ Այն չի փոխարինում սերվերի մուտքին և MFA-ին։', 'PIN защищает приложение только на этом устройстве и хранится в защищённом хранилище. Он не заменяет вход и MFA.', 'The PIN protects this device and uses its secure vault. It does not replace server sign-in or MFA.')}</Text>
    {available === false ? <Text style={{ color: c.mutedForeground }}>{t('Հասանելի է միայն աջակցվող iOS/Android հավելվածում։', 'Доступно только в поддерживаемом приложении iOS/Android.', 'Available only in the supported iOS/Android app.')}</Text> : available === null ? <Text style={{ color: c.mutedForeground }}>{t('Ստուգում…', 'Проверяем…', 'Checking…')}</Text> : <>
      <Text style={{ color: c.foreground }}>{appLock.enabled ? t('Բլոկավորումը միացված է', 'Блокировка включена', 'App lock is enabled') : t('Բլոկավորումը անջատված է', 'Блокировка выключена', 'App lock is disabled')}</Text>
      <TextInput value={pin} onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 6))} maxLength={6} secureTextEntry keyboardType="number-pad" autoComplete="off" accessibilityLabel={t('6-նիշ PIN', 'PIN из 6 цифр', 'Six-digit PIN')} placeholder={appLock.enabled ? t('Ընթացիկ PIN', 'Текущий PIN', 'Current PIN') : t('Նոր PIN', 'Новый PIN', 'New PIN')} placeholderTextColor={c.mutedForeground} style={{ color: c.foreground, padding: 14, minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: c.border }} />
      {!appLock.enabled && <><TextInput value={confirmation} onChangeText={v => setConfirmation(v.replace(/\D/g, '').slice(0, 6))} maxLength={6} secureTextEntry keyboardType="number-pad" autoComplete="off" accessibilityLabel={t('Կրկնել PIN-ը', 'Повторить PIN', 'Repeat PIN')} placeholder={t('Կրկնել PIN-ը', 'Повторить PIN', 'Repeat PIN')} placeholderTextColor={c.mutedForeground} style={{ color: c.foreground, padding: 14, minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: c.border }} />
        {bioAvailable && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}><Text style={{ color: c.foreground, flex: 1 }}>{t('Բիոմետրիկ բացում', 'Биометрическая разблокировка', 'Biometric unlock')}</Text><Switch value={bio} onValueChange={setBio} accessibilityLabel={t('Բիոմետրիա', 'Биометрия', 'Biometrics')} /></View>}
      </>}
      <Pressable accessibilityRole="button" disabled={busy || pin.length !== 6} onPress={() => void save()} style={{ minHeight: 48, padding: 14, borderRadius: 10, backgroundColor: c.primary, opacity: busy ? 0.5 : 1 }}><Text style={{ color: c.primaryForeground, fontWeight: '700' }}>{appLock.enabled ? t('Անջատել բլոկավորումը', 'Выключить блокировку', 'Disable app lock') : t('Միացնել բլոկավորումը', 'Включить блокировку', 'Enable app lock')}</Text></Pressable>
      {appLock.enabled && <Pressable accessibilityRole="button" onPress={appLock.lock} style={{ minHeight: 48, padding: 14 }}><Text style={{ color: c.foreground }}>{t('Բլոկավորել հիմա', 'Заблокировать сейчас', 'Lock now')}</Text></Pressable>}
    </>}
    {!!message && <Text accessibilityRole="alert" style={{ color: c.foreground }}>{message}</Text>}
  </View>;
}
