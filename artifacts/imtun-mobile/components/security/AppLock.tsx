import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { useGetMobileAuthSession } from '@workspace/api-client-react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { useLang } from '@/lib/resident/hooks';
import { readLocalLock, verifyLocalBiometric, verifyLocalPin, type LocalLock } from '@/lib/localSecurity';

type State = { enabled: boolean; refresh: () => Promise<void>; lock: () => void };
const Context = createContext<State>({ enabled: false, refresh: async () => {}, lock: () => {} });
export const useAppLock = () => useContext(Context);
export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const c = useAppPalette(); const session = useGetMobileAuthSession(); const userId = session.data?.user?.id; const lang = useLang();
  const [enrollment, setEnrollment] = useState<LocalLock | null>(null);
  const [ready, setReady] = useState(false); const [locked, setLocked] = useState(true); const [pin, setPin] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const activeUser = useRef(userId);
  const t = (hy: string, ru: string, en: string) => lang === 'ru' ? ru : lang === 'en' ? en : hy;
  const refresh = useCallback(async () => {
    if (userId) setEnrollment(await readLocalLock(userId));
    else setEnrollment(null);
  }, [userId]);
  useEffect(() => {
    activeUser.current = userId; setReady(false); setPin(''); setError(''); setEnrollment(null); setLocked(true);
    const target = userId;
    (target ? readLocalLock(target) : Promise.resolve(null)).then(value => {
      if (activeUser.current !== target) return;
      setEnrollment(value); setReady(true); setLocked(!!value);
    }).catch(() => {
      if (activeUser.current !== target) return;
      // Corrupt/unavailable vault does not silently bypass an enrolled lock.
      setError(t('Պաշտպանված պահոցը հասանելի չէ։ Փորձեք կրկին։', 'Защищённое хранилище недоступно. Повторите попытку.', 'Secure storage is unavailable. Please retry.'));
    });
  // Language changes must not unlock or re-enroll the local screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active' && enrollment) { setLocked(true); setPin(''); }
    });
    return () => listener.remove();
  }, [enrollment]);
  async function unlock(biometric = false) {
    if (!userId || busy) return;
    const target = userId; setBusy(true); setError('');
    try {
      const ok = biometric ? await verifyLocalBiometric(target, t('Բացել ImTun-ը', 'Разблокировать ImTun', 'Unlock ImTun')) : await verifyLocalPin(target, pin);
      if (activeUser.current !== target) return;
      setPin('');
      if (ok) setLocked(false);
      else setError(t('Չհաջողվեց հաստատել։ Փորձեք կրկին։', 'Не удалось подтвердить. Попробуйте снова.', 'Verification failed. Please try again.'));
    } catch (e) {
      setPin(''); setError(e instanceof Error && e.message === 'PIN_RATE_LIMITED'
        ? t('Շատ փորձեր։ Սպասեք առնվազն մեկ րոպե։', 'Слишком много попыток. Подождите не менее минуты.', 'Too many attempts. Wait at least one minute.')
        : t('Պաշտպանված պահոցը հասանելի չէ։', 'Защищённое хранилище недоступно.', 'Secure storage is unavailable.'));
    } finally { setBusy(false); }
  }
  const showLock = !!userId && (!ready || !!enrollment && locked);
  return <Context.Provider value={{ enabled: !!enrollment, refresh, lock: () => setLocked(true) }}>
    {showLock ? <View style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: c.background }}>
      <Text style={{ color: c.foreground, fontSize: 26, fontWeight: '800' }}>ImTun</Text>
      <Text style={{ color: c.foreground }}>{t('Մուտքագրեք հավելվածի PIN-ը', 'Введите PIN приложения', 'Enter your app PIN')}</Text>
      <TextInput value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={6} autoComplete="off" accessibilityLabel={t('Հավելվածի PIN', 'PIN приложения', 'App PIN')} style={{ minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, color: c.foreground }} />
      <Pressable accessibilityRole="button" disabled={busy || !ready || pin.length !== 6} onPress={() => void unlock()} style={{ padding: 16, minHeight: 48, backgroundColor: c.primary, borderRadius: 12, opacity: busy || pin.length !== 6 ? 0.5 : 1 }}><Text style={{ color: c.primaryForeground, fontWeight: '700' }}>{t('Բացել', 'Разблокировать', 'Unlock')}</Text></Pressable>
      {enrollment?.biometric && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void unlock(true)} style={{ padding: 12, minHeight: 48 }}><Text style={{ color: c.foreground }}>{t('Օգտագործել բիոմետրիա', 'Использовать биометрию', 'Use biometrics')}</Text></Pressable>}
      {!!error && <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text>}
      {!ready && <Pressable accessibilityRole="button" onPress={() => {
        void refresh().then(() => { setReady(true); setError(''); }).catch(() => {});
      }} style={{ minHeight: 48, padding: 12 }}><Text style={{ color: c.foreground }}>{t('Կրկնել', 'Повторить', 'Retry')}</Text></Pressable>}
      <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{t('Տեղային պաշտպանությունը չի փոխարինում հաշվի մուտքին։ PIN-ի վերականգնման համար անհրաժեշտ է հավելվածի տեղային տվյալների մաքրում և կրկին մուտք։', 'Локальная блокировка не заменяет вход в аккаунт. При потере PIN потребуется очистить локальные данные приложения и войти заново.', 'Local lock does not replace account sign-in. If you forget the PIN, clear local app data and sign in again.')}</Text>
    </View> : children}
  </Context.Provider>;
}
