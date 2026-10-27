import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMobileAuthSession, useLoginMobileAuth, useSwitchMobileAuthContext, type MobileAuthContext } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { friendlyError } from '@/constants/armenian';
import { csrfSessionRef } from './_layout';
import SavedProfiles from '@/components/SavedProfiles';
import { rememberSavedProfile } from '@/lib/savedProfiles';
import OwnerOnboarding from '@/components/OwnerOnboarding';
import { isImTunResidentContext } from '@/lib/resident/navigation';

type EntryRole = 'owner' | 'family' | 'renter';
type EntryLanguage = 'hy' | 'ru' | 'en';
const entryCopy = {
  hy: { kicker: 'ՁԵՐ ՏԱՆ ԿԱՐԳՈՒԿԱՆՈՆԸ ՍԿՍՎՈՒՄ Է ԱՅՍՏԵՂԻՑ', welcome: 'Մուտք գործել ImTun', explain: 'Ընտրեք ձեր դերը՝ մուտքի էկրանի համապատասխան տարբերակը տեսնելու համար։ Հասանելիությունը որոշում է սերվերը։', owner: 'Սեփականատեր', family: 'Ընտանիքի անդամ', renter: 'Վարձակալ', ownerSub: 'Գրանցվեք և հարցրեք մուտք', invited: 'Մուտք՝ հրավերով', familyNote: 'Ընտանիքի անդամները գրանցվում են միայն տան սեփականատիրոջ հրավերով։', renterNote: 'Վարձակալները մուտք են գործում միայն սեփականատիրոջ հրավերով։', email: 'Էլեկտրոնային փոստ', password: 'Գաղտնաբառ', remember: 'Հիշել հաշիվը այս սարքում (առանց գաղտնաբառի)', code: 'Հաստատման կոդ', codeToggle: 'Մուտքագրե՞լ հաստատման կոդը', submit: 'Մուտք գործել', ownerRegister: 'Գրանցվել որպես սեփականատեր', secure: 'Մուտքը պաշտպանված է սեսիայի միջոցով', busy: 'Մուտք ենք գործում…' },
  ru: { kicker: 'ПОРЯДОК В ДОМЕ НАЧИНАЕТСЯ ЗДЕСЬ', welcome: 'Войти в ImTun', explain: 'Выберите роль, чтобы увидеть подходящий вариант входа. Доступ определяет сервер.', owner: 'Собственник', family: 'Член семьи', renter: 'Арендатор', ownerSub: 'Регистрация и запрос доступа', invited: 'Вход только по приглашению', familyNote: 'Члены семьи получают доступ только по приглашению собственника.', renterNote: 'Арендаторы входят только по приглашению собственника.', email: 'Электронная почта', password: 'Пароль', remember: 'Запомнить аккаунт на этом устройстве (без пароля)', code: 'Код подтверждения', codeToggle: 'Ввести код подтверждения', submit: 'Войти', ownerRegister: 'Зарегистрироваться как собственник', secure: 'Вход защищён сессией', busy: 'Выполняется вход…' },
  en: { kicker: 'A BETTER-RUN HOME STARTS HERE', welcome: 'Sign in to ImTun', explain: 'Choose a role to filter the sign-in experience. The server determines actual access.', owner: 'Owner', family: 'Family member', renter: 'Renter', ownerSub: 'Register and request access', invited: 'Invitation-only sign-in', familyNote: 'Family members can join only with an invitation from the owner.', renterNote: 'Renters can join only with an invitation from the owner.', email: 'Email address', password: 'Password', remember: 'Remember this account on this device (never the password)', code: 'Verification code', codeToggle: 'Enter a verification code', submit: 'Sign in', ownerRegister: 'Register as an owner', secure: 'Sign-in is protected by a secure session', busy: 'Signing in…' },
} as const;

function matchesEntryRole(context: MobileAuthContext, role: EntryRole) {
  const key = context.role_key.toLowerCase();
  if (role === 'owner') return key === 'unit_owner' || key === 'owner';
  if (role === 'family') return key === 'family' || key.includes('family');
  return key === 'renter' || key.includes('renter');
}

function roleFromContext(context: MobileAuthContext): EntryRole | null {
  const key = context.role_key.toLowerCase();
  if (key === 'unit_owner' || key === 'owner') return 'owner';
  if (key === 'family' || key.includes('family')) return 'family';
  if (key === 'renter' || key.includes('renter')) return 'renter';
  return null;
}

const roleGuardCopy = {
  hy: {
    noMatch: 'Այս հաշվում ընտրված դերի մուտք չկա։ Ընտրեք ձեզ արդեն տրամադրված դերը։',
    inviteOnly: 'Այս դերի մուտքը հասանելի է միայն տան սեփականատիրոջ հրավերով։',
  },
  ru: {
    noMatch: 'Для выбранной роли в этом аккаунте нет доступа. Выберите роль, уже выданную вам.',
    inviteOnly: 'Для этой роли нужен вход по приглашению от собственника.',
  },
  en: {
    noMatch: 'This account has no access for the selected role. Choose a role already assigned to you.',
    inviteOnly: 'This role can sign in only after an invitation from the owner.',
  },
};

export default function EntryScreen() { const palette = useAppPalette(); const styles = React.useMemo(() => make_styles(palette), [palette]);
  const router = useRouter();
  const client = useQueryClient();
  const session = useGetMobileAuthSession();
  const login = useLoginMobileAuth();
  const switchContext = useSwitchMobileAuthContext();
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [message, setMessage] = useState('');
  const [entryRole, setEntryRole] = useState<EntryRole>('owner');
  const [entryLanguage, setEntryLanguage] = useState<EntryLanguage>('hy');
  const [onboarding, setOnboarding] = useState<'register' | 'claim' | 'status' | null>(null);
  const allResidentContexts = useMemo(() => (session.data?.contexts ?? []).filter(isImTunResidentContext), [session.data?.contexts]);
  const contexts = useMemo(() => allResidentContexts.filter((context) => matchesEntryRole(context, entryRole)), [allResidentContexts, entryRole]);
  const selected = contexts.find((context) => context.id === session.data?.contextId);
  const copy = entryCopy[entryLanguage];

  csrfSessionRef.current = session.data?.csrf ?? csrfSessionRef.current;

  useEffect(() => {
    const active = session.data?.contexts.find((context) => context.id === session.data?.contextId);
    const role = active ? roleFromContext(active) : null;
    if (role) setEntryRole(role);
  }, [session.data?.contextId, session.data?.contexts]);

  useEffect(() => {
    if (selected) router.replace('/(tabs)');
  }, [selected, router]);

  const submitLogin = () => {
    setMessage('');
    login.mutate({ data: { email: email.trim(), password, ...(code.trim() ? { code: code.trim() } : {}) } }, {
      onSuccess: (result) => {
        csrfSessionRef.current = result.csrf;
        setStoreError('');
        if (remember && result.user?.email) {
          Promise.resolve(rememberSavedProfile({ email: result.user.email, name: result.user.name ?? '' })).catch(() => setStoreError('Չհաջողվեց պահպանել հաշիվը սարքում։ Մուտքը կատարված է։'));
        }
        client.invalidateQueries({ queryKey: session.queryKey });
      },
      onError: (error) => {
        setMessage(friendlyError(error, 'Մուտքը չհաջողվեց։ Ստուգեք տվյալները և կրկին փորձեք։'));
      },
    });
  };

  const authenticateOwner = (accountEmail: string, accountPassword: string) => new Promise<void>((resolve, reject) => {
    login.mutate({ data: { email: accountEmail, password: accountPassword } }, {
      onSuccess: (result) => {
        csrfSessionRef.current = result.csrf;
        client.invalidateQueries({ queryKey: session.queryKey });
        resolve();
      },
      onError: reject,
    });
  });

  const continueAfterOwnerApproval = () => {
    setOnboarding(null);
    client.clear();
    void session.refetch();
  };

  const chooseContext = (context: MobileAuthContext) => {
    setMessage('');
    switchContext.mutate({ data: { id: context.id } }, {
      onSuccess: () => { client.clear(); void session.refetch(); },
      onError: (error) => setMessage(friendlyError(error, 'Չհաջողվեց ընտրել բնակարանը։ Կրկին փորձեք։')),
    });
  };

  if (session.isLoading) return <View style={styles.loading}><View style={styles.skeleton} /><View style={[styles.skeleton, { width: '70%' }]} /><View style={[styles.skeleton, { height: 180 }]} /></View>;
  if (session.isError && !session.data?.user) {
    return <View style={styles.center}><Feather name="wifi-off" size={30} color={palette.mutedForeground} /><Text style={styles.heading}>ImTun-ի հետ կապ չկա</Text><Text style={styles.body}>Չհաջողվեց ստուգել մուտքը։ Ստուգեք ինտերնետային կապը և կրկին փորձեք։</Text><Pressable accessibilityRole="button" testID="session-retry" onPress={() => session.refetch()} style={styles.primaryButton}><Text style={styles.primaryText}>Կրկին փորձել</Text></Pressable></View>;
  }

  if (session.data?.user && !contexts.length) {
    if (allResidentContexts.length) {
      const availableRoles = [...new Set(allResidentContexts.map(roleFromContext).filter((role): role is EntryRole => role !== null))];
      return <View style={styles.center}><View style={styles.lockIcon}><Feather name="users" size={22} color={palette.primary} /></View><Text style={styles.heading}>{copy.welcome}</Text><Text style={styles.body}>{roleGuardCopy[entryLanguage].noMatch}</Text><View style={styles.roleList}>{availableRoles.map((role) => <Pressable key={role} accessibilityRole="button" testID={`available-role-${role}`} onPress={() => setEntryRole(role)} style={styles.roleCard}><Text style={styles.roleTitle}>{copy[role]}</Text><Feather name="arrow-right" size={17} color={palette.primary} /></Pressable>)}</View></View>;
    }
    if (entryRole !== 'owner') {
      return <View style={styles.center}><View style={styles.lockIcon}><Feather name="mail" size={22} color={palette.primary} /></View><Text style={styles.heading}>{copy[entryRole]}</Text><Text style={styles.body}>{roleGuardCopy[entryLanguage].inviteOnly}</Text><Pressable accessibilityRole="button" testID="choose-owner-registration" onPress={() => setEntryRole('owner')} style={styles.secondaryButton}><Text style={styles.secondaryText}>{copy.owner}</Text></Pressable></View>;
    }
    return <OwnerOnboarding mode={onboarding === 'register' ? 'register' : onboarding === 'status' ? 'status' : 'claim'} email={email || session.data.user.email || ''} language={entryLanguage} onAuthenticate={authenticateOwner} onBack={() => { setOnboarding(null); void session.refetch(); }} onDone={continueAfterOwnerApproval} />;
  }

  if (session.data?.user && contexts.length) {
    return <View style={styles.screen}><View style={styles.brandTop}><Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} /><Text style={styles.kicker}>ՁԵՐ ՏՈՒՆԸ։ ՁԵՐ IMTUN-Ը։</Text></View><Text style={styles.heading}>Ընտրեք տունը</Text><Text style={styles.body}>Շարունակելով՝ կմտնեք որպես բնակիչ։ Մուտքի իրավունքը ստուգում է սերվերը։</Text>
      {message ? <View style={styles.errorBox}><Feather name="alert-circle" size={17} color={palette.destructive} /><Text style={styles.errorText}>{message}</Text></View> : null}
      <ScrollView contentContainerStyle={styles.contextList}>
        {contexts.map((context) => <Pressable accessibilityRole="button" key={context.id} testID={`context-${context.id}`} disabled={switchContext.isPending} onPress={() => chooseContext(context)} style={styles.contextCard}>
          <View style={styles.contextIcon}><Feather name="home" size={19} color={palette.accentForeground} /></View><View style={{ flex: 1 }}><Text style={styles.contextTitle}>{context.building_name || context.organization_name || 'Բնակելի շենք'}</Text><Text style={styles.contextSub}>{context.unit_number ? `Բնակարան ${context.unit_number}` : 'Բնակչի մուտք'}{context.organization_name && context.building_name ? ` · ${context.organization_name}` : ''}</Text></View><Feather name={switchContext.isPending ? 'loader' : 'arrow-right'} size={19} color={palette.mutedForeground} /></Pressable>)}
      </ScrollView>
      {switchContext.isPending ? <Text style={styles.muted}>Բացում ենք ընտրված տունը…</Text> : null}
    </View>;
  }

  if (onboarding) return <OwnerOnboarding mode={onboarding} email={email} language={entryLanguage} onAuthenticate={authenticateOwner} onBack={() => setOnboarding(null)} onDone={continueAfterOwnerApproval} />;

  const roleOptions: { id: EntryRole; title: string; subtitle: string; icon: 'home' | 'users' | 'key' }[] = [
    { id: 'owner', title: copy.owner, subtitle: copy.ownerSub, icon: 'home' },
    { id: 'family', title: copy.family, subtitle: copy.invited, icon: 'users' },
    { id: 'renter', title: copy.renter, subtitle: copy.invited, icon: 'key' },
  ];

  return <ScrollView style={styles.screen} contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
    <View style={styles.loginLanguage} accessibilityLabel="Language">
      {(['hy', 'ru', 'en'] as EntryLanguage[]).map(language => <Pressable key={language} accessibilityRole="button" accessibilityState={{ selected: language === entryLanguage }} testID={`login-language-${language}`} onPress={() => setEntryLanguage(language)} style={[styles.loginLanguageChoice, language === entryLanguage && styles.loginLanguageSelected]}><Text style={[styles.loginLanguageText, language === entryLanguage && styles.loginLanguageTextSelected]}>{language.toUpperCase()}</Text></Pressable>)}
    </View>
    <View style={styles.brandTop}><Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} /><Text style={styles.kicker}>{copy.kicker}</Text></View>
    <View style={styles.welcome}><View style={styles.welcomeIcon}><Feather name="key" size={19} color={palette.primary} /></View><Text style={styles.heading}>{copy.welcome}</Text><Text style={styles.body}>{copy.explain}</Text></View>
    <View style={styles.roleList} accessibilityLabel="Մուտքի դերի ընտրություն">
      {roleOptions.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected: entryRole === option.id }} testID={`login-role-${option.id}`} onPress={() => setEntryRole(option.id)} style={[styles.roleCard, entryRole === option.id && styles.roleSelected]}>
        <View style={[styles.roleIcon, entryRole === option.id && styles.roleIconSelected]}><Feather name={option.icon} size={17} color={entryRole === option.id ? palette.accentForeground : palette.mutedForeground} /></View><View style={{ flex: 1 }}><Text style={styles.roleTitle}>{option.title}</Text><Text style={styles.roleSubtitle}>{option.subtitle}</Text></View><Feather name={entryRole === option.id ? 'check-circle' : 'circle'} size={18} color={entryRole === option.id ? palette.primary : palette.subdued} />
      </Pressable>)}
    </View>
    {entryRole !== 'owner' ? <View testID="invitation-only-note" style={styles.inviteNote}><Feather name="mail" size={16} color={palette.primary} /><Text style={styles.inviteNoteText}>{entryRole === 'family' ? copy.familyNote : copy.renterNote}</Text></View> : null}
    <SavedProfiles onSelect={nextEmail => { setEmail(nextEmail); setPassword(''); setCode(''); setMessage(''); }} />
    <View style={styles.form}>
      <Text style={styles.label}>{copy.email}</Text><TextInput testID="login-email" accessibilityLabel={copy.email} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor={palette.placeholder} style={styles.input} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} testID="login-remember" onPress={() => setRemember(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}><Feather name={remember ? 'check-square' : 'square'} size={18} color={palette.primary} /><Text style={styles.label}>{copy.remember}</Text></Pressable>{storeError ? <Text style={{ color: palette.destructive, fontSize: 12 }}>{storeError}</Text> : null}<Text style={styles.label}>{copy.password}</Text><TextInput testID="login-password" accessibilityLabel={copy.password} autoComplete="password" secureTextEntry value={password} onChangeText={setPassword} placeholder={entryLanguage === 'hy' ? 'Մուտքագրեք գաղտնաբառը' : entryLanguage === 'ru' ? 'Введите пароль' : 'Enter your password'} placeholderTextColor={palette.placeholder} style={styles.input} />
      {showCode ? <><Text style={styles.label}>{copy.code}</Text><TextInput testID="login-code" accessibilityLabel={copy.code} keyboardType="number-pad" value={code} onChangeText={setCode} placeholder={entryLanguage === 'hy' ? 'Մուտքագրեք անվտանգության կոդը' : entryLanguage === 'ru' ? 'Введите код безопасности' : 'Enter security code'} placeholderTextColor={palette.placeholder} style={styles.input} /></> : <Pressable accessibilityRole="button" testID="show-code" onPress={() => setShowCode(true)} style={styles.codeToggle}><Feather name="shield" size={15} color={palette.mutedForeground} /><Text style={styles.codeToggleText}>{copy.codeToggle}</Text></Pressable>}
      {message ? <View style={styles.errorBox}><Feather name="alert-circle" size={17} color={palette.destructive} /><Text style={styles.errorText}>{message}</Text></View> : null}
      <Pressable accessibilityRole="button" testID="login-submit" disabled={!email.trim() || !password || login.isPending} onPress={submitLogin} style={[styles.primaryButton, (!email.trim() || !password || login.isPending) && styles.disabled]}><Text style={styles.primaryText}>{login.isPending ? copy.busy : copy.submit}</Text>{!login.isPending ? <Feather name="arrow-right" size={17} color={palette.foreground} /> : null}</Pressable>
      {entryRole === 'owner' ? <Pressable accessibilityRole="button" testID="owner-register-open" onPress={() => { setOnboarding('register'); setMessage(''); }} style={styles.createOwner}><Feather name="plus" size={16} color={palette.primary} /><Text style={styles.createOwnerText}>{copy.ownerRegister}</Text></Pressable> : null}
      <Text style={styles.secureNote}><Feather name="lock" size={12} color={palette.subdued} /> {copy.secure}</Text>
    </View>
  </ScrollView>;
}

const make_styles = (palette: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, paddingHorizontal: 23 },
  loginContent: { paddingTop: 38, paddingBottom: 40, maxWidth: 500, width: '100%', alignSelf: 'center' },
  brandTop: { alignItems: 'flex-start', marginBottom: 34 }, logo: { width: 156, height: 67, marginLeft: -7 }, kicker: { fontSize: 9, letterSpacing: 1.5, fontWeight: '800', color: palette.subdued, marginTop: 12 },
  welcome: { marginBottom: 26 }, welcomeIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  heading: { color: palette.foreground, fontSize: 27, fontWeight: '800', letterSpacing: -0.7, marginBottom: 7 }, body: { color: palette.mutedForeground, fontSize: 14, lineHeight: 21, maxWidth: 340 },
  form: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 17, padding: 18 },
  roleList: { gap: 8, marginBottom: 14 }, roleCard: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 13 }, roleSelected: { borderColor: palette.selectedBorder, backgroundColor: palette.selectedSurface }, roleIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: palette.secondary, alignItems: 'center', justifyContent: 'center' }, roleIconSelected: { backgroundColor: palette.accent }, roleTitle: { color: palette.foreground, fontSize: 13, fontWeight: '800' }, roleSubtitle: { color: palette.mutedForeground, fontSize: 10, marginTop: 3 }, inviteNote: { flexDirection: 'row', gap: 9, alignItems: 'center', padding: 12, marginBottom: 13, borderRadius: 11, backgroundColor: palette.accent }, inviteNoteText: { color: palette.foreground, flex: 1, fontSize: 11, lineHeight: 16 }, createOwner: { minHeight: 45, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: palette.border, borderRadius: 11 }, createOwnerText: { color: palette.primary, fontSize: 12, fontWeight: '800' },
  loginLanguage: { flexDirection: 'row', justifyContent: 'flex-end', gap: 3, marginBottom: 10 }, loginLanguageChoice: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 7 }, loginLanguageSelected: { backgroundColor: palette.secondary }, loginLanguageText: { color: palette.subdued, fontSize: 10, fontWeight: '800' }, loginLanguageTextSelected: { color: palette.foreground },
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
