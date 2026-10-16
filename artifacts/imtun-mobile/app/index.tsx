import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMobileAuthSession, useLoginMobileAuth, useSwitchMobileAuthContext, type MobileAuthContext } from '@workspace/api-client-react';
import { palette } from '@/constants/colors';
import { csrfSessionRef } from './_layout';

function isImTunResident(context: MobileAuthContext) {
  const productLabels = [context.product, ...(context.products ?? [])].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
  return productLabels.includes('imtun') || context.role_key.toLowerCase().includes('resident');
}

export default function EntryScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const session = useGetMobileAuthSession();
  const login = useLoginMobileAuth();
  const switchContext = useSwitchMobileAuthContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [message, setMessage] = useState('');
  const contexts = useMemo(() => (session.data?.contexts ?? []).filter(isImTunResident), [session.data?.contexts]);
  const selected = contexts.find((context) => context.id === session.data?.contextId);

  csrfSessionRef.current = session.data?.csrf ?? csrfSessionRef.current;

  useEffect(() => {
    if (selected) router.replace('/(tabs)');
  }, [selected, router]);

  const submitLogin = () => {
    setMessage('');
    login.mutate({ data: { email: email.trim(), password, ...(code.trim() ? { code: code.trim() } : {}) } }, {
      onSuccess: (result) => {
        csrfSessionRef.current = result.csrf;
        client.invalidateQueries({ queryKey: session.queryKey });
      },
      onError: (error) => {
        setMessage(error instanceof Error ? error.message : 'Не удалось войти. Проверьте данные и попробуйте снова.');
      },
    });
  };

  const chooseContext = (context: MobileAuthContext) => {
    setMessage('');
    switchContext.mutate({ data: { id: context.id } }, {
      onSuccess: () => client.invalidateQueries({ queryKey: session.queryKey }),
      onError: (error) => setMessage(error instanceof Error ? error.message : 'Не удалось выбрать квартиру. Попробуйте ещё раз.'),
    });
  };

  if (session.isLoading) return <View style={styles.loading}><View style={styles.skeleton} /><View style={[styles.skeleton, { width: '70%' }]} /><View style={[styles.skeleton, { height: 180 }]} /></View>;
  if (session.isError && !session.data?.user) {
    return <View style={styles.center}><Feather name="wifi-off" size={30} color={palette.mutedForeground} /><Text style={styles.heading}>Нет связи с ImTun</Text><Text style={styles.body}>Не удалось проверить сессию. Проверьте интернет и повторите попытку.</Text><Pressable accessibilityRole="button" testID="session-retry" onPress={() => session.refetch()} style={styles.primaryButton}><Text style={styles.primaryText}>Повторить</Text></Pressable></View>;
  }

  if (session.data?.user && !contexts.length) {
    return <View style={styles.center}><Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} /><View style={styles.lockIcon}><Feather name="home" size={23} color={palette.primary} /></View><Text style={styles.heading}>Нет доступного дома</Text><Text style={styles.body}>Для этого аккаунта не найден ImTun-контекст жителя. Обратитесь к управляющей компании, чтобы проверить доступ.</Text><Pressable accessibilityRole="button" testID="no-context-refresh" onPress={() => session.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Проверить снова</Text></Pressable></View>;
  }

  if (session.data?.user && contexts.length) {
    return <View style={styles.screen}><View style={styles.brandTop}><Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} /><Text style={styles.kicker}>ВАШ ДОМ. ВАШ IMTUN.</Text></View><Text style={styles.heading}>Выберите дом</Text><Text style={styles.body}>Продолжая, вы входите в контекст жителя. Доступы проверяет сервер.</Text>
      {message ? <View style={styles.errorBox}><Feather name="alert-circle" size={17} color={palette.destructive} /><Text style={styles.errorText}>{message}</Text></View> : null}
      <ScrollView contentContainerStyle={styles.contextList}>
        {contexts.map((context) => <Pressable accessibilityRole="button" key={context.id} testID={`context-${context.id}`} disabled={switchContext.isPending} onPress={() => chooseContext(context)} style={styles.contextCard}>
          <View style={styles.contextIcon}><Feather name="home" size={19} color={palette.accentForeground} /></View><View style={{ flex: 1 }}><Text style={styles.contextTitle}>{context.building_name || context.organization_name || 'Жилой дом'}</Text><Text style={styles.contextSub}>{context.unit_number ? `Квартира ${context.unit_number}` : 'Контекст жителя'}{context.organization_name && context.building_name ? ` · ${context.organization_name}` : ''}</Text></View><Feather name={switchContext.isPending ? 'loader' : 'arrow-right'} size={19} color={palette.mutedForeground} /></Pressable>)}
      </ScrollView>
      {switchContext.isPending ? <Text style={styles.muted}>Открываем выбранный дом…</Text> : null}
    </View>;
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
    <View style={styles.brandTop}><Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} /><Text style={styles.kicker}>ПОРЯДОК В ДОМЕ НАЧИНАЕТСЯ ЗДЕСЬ</Text></View>
    <View style={styles.welcome}><View style={styles.welcomeIcon}><Feather name="key" size={19} color={palette.primary} /></View><Text style={styles.heading}>Войти в ImTun</Text><Text style={styles.body}>Управляйте обращениями и делами вашего дома в одном месте.</Text></View>
    <View style={styles.form}>
      <Text style={styles.label}>Электронная почта</Text><TextInput testID="login-email" accessibilityLabel="Электронная почта" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor={palette.placeholder} style={styles.input} />
      <Text style={styles.label}>Пароль</Text><TextInput testID="login-password" accessibilityLabel="Пароль" autoComplete="password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Введите пароль" placeholderTextColor={palette.placeholder} style={styles.input} />
      {showCode ? <><Text style={styles.label}>Код подтверждения</Text><TextInput testID="login-code" accessibilityLabel="Код подтверждения" keyboardType="number-pad" value={code} onChangeText={setCode} placeholder="Код MFA, если требуется" placeholderTextColor={palette.placeholder} style={styles.input} /></> : <Pressable accessibilityRole="button" testID="show-code" onPress={() => setShowCode(true)} style={styles.codeToggle}><Feather name="shield" size={15} color={palette.mutedForeground} /><Text style={styles.codeToggleText}>Нужен код подтверждения?</Text></Pressable>}
      {message ? <View style={styles.errorBox}><Feather name="alert-circle" size={17} color={palette.destructive} /><Text style={styles.errorText}>{message}</Text></View> : null}
      <Pressable accessibilityRole="button" testID="login-submit" disabled={!email.trim() || !password || login.isPending} onPress={submitLogin} style={[styles.primaryButton, (!email.trim() || !password || login.isPending) && styles.disabled]}><Text style={styles.primaryText}>{login.isPending ? 'Входим…' : 'Войти'}</Text>{!login.isPending ? <Feather name="arrow-right" size={17} color={palette.foreground} /> : null}</Pressable>
      <Text style={styles.secureNote}><Feather name="lock" size={12} color={palette.subdued} /> Вход защищён сессионной авторизацией</Text>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, paddingHorizontal: 23 },
  loginContent: { paddingTop: 38, paddingBottom: 40, maxWidth: 500, width: '100%', alignSelf: 'center' },
  brandTop: { alignItems: 'flex-start', marginBottom: 34 }, logo: { width: 156, height: 67, marginLeft: -7 }, kicker: { fontSize: 9, letterSpacing: 1.5, fontWeight: '800', color: palette.subdued, marginTop: 12 },
  welcome: { marginBottom: 26 }, welcomeIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  heading: { color: palette.foreground, fontSize: 27, fontWeight: '800', letterSpacing: -0.7, marginBottom: 7 }, body: { color: palette.mutedForeground, fontSize: 14, lineHeight: 21, maxWidth: 340 },
  form: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 17, padding: 18 },
  label: { fontSize: 12, fontWeight: '700', color: palette.foreground, marginBottom: 7, marginTop: 4 }, input: { minHeight: 49, backgroundColor: palette.warmSurface, borderColor: palette.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 14, color: palette.foreground, marginBottom: 15 },
  codeToggle: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, marginBottom: 12 }, codeToggleText: { color: palette.mutedForeground, fontSize: 12, fontWeight: '600' },
  primaryButton: { minHeight: 51, backgroundColor: palette.primary, borderRadius: 12, paddingHorizontal: 17, alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row', marginTop: 6 },
  primaryText: { fontSize: 14, fontWeight: '800', color: palette.foreground }, disabled: { opacity: 0.52 }, secureNote: { fontSize: 10, color: palette.subdued, textAlign: 'center', marginTop: 16 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 11, backgroundColor: palette.destructiveSurface, borderRadius: 10, marginBottom: 12 }, errorText: { color: palette.destructiveForeground, flex: 1, fontSize: 12, lineHeight: 17 },
  contextList: { paddingTop: 18, paddingBottom: 30, gap: 10 }, contextCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 77, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 14 },
  contextIcon: { height: 42, width: 42, borderRadius: 13, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' }, contextTitle: { fontSize: 14, color: palette.foreground, fontWeight: '800' }, contextSub: { fontSize: 11, color: palette.mutedForeground, marginTop: 4 }, muted: { color: palette.mutedForeground, fontSize: 12, textAlign: 'center', padding: 12 },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: 11, paddingHorizontal: 16, justifyContent: 'center', marginTop: 14, backgroundColor: palette.surface }, secondaryText: { color: palette.foreground, fontWeight: '700', textAlign: 'center' },
  center: { flex: 1, backgroundColor: palette.background, paddingHorizontal: 30, alignItems: 'center', justifyContent: 'center' }, lockIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginTop: 26, marginBottom: 16 },
  loading: { flex: 1, backgroundColor: palette.background, justifyContent: 'center', padding: 25 }, skeleton: { width: '100%', height: 18, borderRadius: 8, backgroundColor: palette.skeleton, marginBottom: 14 },
});
