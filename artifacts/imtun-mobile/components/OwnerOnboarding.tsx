import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  getGetOwnerRegistrationStatusQueryKey,
  useCreateOwnerAccessClaim,
  useCreateOwnerRegistration,
  useGetOwnerRegistrationCatalog,
  useGetOwnerRegistrationStatus,
  useResendOwnerRegistrationCode,
  useVerifyOwnerRegistrationEmail,
} from '@workspace/api-client-react';
import type { OwnerRegistrationBuilding } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';

type Language = 'hy' | 'ru' | 'en';
type Props = {
  mode: 'register' | 'claim' | 'status';
  email?: string;
  language?: Language;
  onBack: () => void;
  onAuthenticate?: (email: string, password: string) => Promise<void>;
  onDone?: () => void;
};
const words = {
  hy: {
    back: 'Հետ', owner: 'Սեփականատիրոջ մուտք', title: 'Ձեր տունը՝ ImTun-ում', intro: 'Ընտրեք կառավարման ընկերության ցանկում առկա բնակարանը։ Մուտքը կբացվի միայն հաստատումից հետո։',
    name: 'Անուն Ազգանուն', email: 'Էլեկտրոնային փոստ', password: 'Գաղտնաբառ', building: 'Շենք', unit: 'Բնակարան', choose: 'Ընտրել', submit: 'Ստեղծել հաշիվ', claimTitle: 'Հայցել սեփականատիրոջ մուտք', claimIntro: 'Ընտրեք ձեր բնակարանը՝ ընկերությանը մուտքի հարցում ուղարկելու համար։', claim: 'Ուղարկել հարցումը',
    verify: 'Հաստատեք էլ. փոստը', verifyCopy: 'Մուտքագրեք ձեր էլ. փոստին ուղարկված վեցանիշ կոդը։', code: 'Վեցանիշ կոդ', verifyButton: 'Հաստատել էլ. փոստը', resend: 'Ուղարկել կոդը կրկին', waiting: 'Հարցումն ուղարկված է', waitingCopy: 'Էլ. փոստը հաստատված է։ Բնակարանի կառավարման ընկերությունը պետք է հաստատի ձեր մուտքը։ Մինչ այդ տան տվյալները հասանելի չեն։', pending: 'Սպասում է ընկերության հաստատմանը', approved: 'Մուտքը հաստատված է', rejected: 'Հարցումը մերժվել է', continue: 'Շարունակել դեպի ImTun', empty: 'Հարցման կարգավիճակ դեռ հասանելի չէ։', loading: 'Բեռնում…', retry: 'Կրկին փորձել', error: 'Չհաջողվեց կատարել գործողությունը։ Ստուգեք տվյալները և կրկին փորձեք։', noBuildings: 'Այս պահին հասանելի շենքեր չկան։', chooseBuilding: 'Ընտրել շենքը', chooseUnit: 'Ընտրել բնակարանը', secure: 'Տվյալները փոխանցվում են անվտանգ սեսիայով։', language: 'Լեզու', step: 'ՔԱՅԼ',
  },
  ru: {
    back: 'Назад', owner: 'Доступ собственника', title: 'Ваш дом в ImTun', intro: 'Выберите квартиру из каталога управляющей компании. Доступ появится только после одобрения.',
    name: 'Имя и фамилия', email: 'Электронная почта', password: 'Пароль', building: 'Здание', unit: 'Квартира', choose: 'Выбрать', submit: 'Создать аккаунт', claimTitle: 'Запросить доступ собственника', claimIntro: 'Выберите квартиру, чтобы отправить запрос в управляющую компанию.', claim: 'Отправить запрос',
    verify: 'Подтвердите почту', verifyCopy: 'Введите шестизначный код, отправленный на вашу почту.', code: 'Шестизначный код', verifyButton: 'Подтвердить почту', resend: 'Отправить код повторно', waiting: 'Запрос отправлен', waitingCopy: 'Почта подтверждена. Управляющая компания должна одобрить доступ к квартире. До этого данные дома недоступны.', pending: 'Ожидает одобрения компании', approved: 'Доступ одобрен', rejected: 'Запрос отклонён', continue: 'Перейти в ImTun', empty: 'Статус запроса пока недоступен.', loading: 'Загрузка…', retry: 'Повторить', error: 'Не удалось выполнить действие. Проверьте данные и попробуйте снова.', noBuildings: 'Доступных зданий пока нет.', chooseBuilding: 'Выберите здание', chooseUnit: 'Выберите квартиру', secure: 'Данные передаются через защищённую сессию.', language: 'Язык', step: 'ШАГ',
  },
  en: {
    back: 'Back', owner: 'Owner access', title: 'Your home, in ImTun', intro: 'Choose an apartment listed by its management company. Access is granted only after approval.',
    name: 'Full name', email: 'Email address', password: 'Password', building: 'Building', unit: 'Apartment', choose: 'Choose', submit: 'Create account', claimTitle: 'Request owner access', claimIntro: 'Choose your apartment to send an access request to its management company.', claim: 'Send request',
    verify: 'Verify your email', verifyCopy: 'Enter the six-digit code sent to your email address.', code: 'Six-digit code', verifyButton: 'Verify email', resend: 'Resend code', waiting: 'Request submitted', waitingCopy: 'Your email is verified. The apartment management company must approve your access. Home information stays unavailable until then.', pending: 'Waiting for company approval', approved: 'Access approved', rejected: 'Request declined', continue: 'Continue to ImTun', empty: 'Request status is not available yet.', loading: 'Loading…', retry: 'Try again', error: 'We could not complete that action. Check your details and try again.', noBuildings: 'No buildings are available right now.', chooseBuilding: 'Choose a building', chooseUnit: 'Choose an apartment', secure: 'Your information is sent through a secure session.', language: 'Language', step: 'STEP',
  },
} as const;

export default function OwnerOnboarding({ mode, email: initialEmail = '', language = 'hy', onBack, onAuthenticate, onDone }: Props) {
  const palette = useAppPalette();
  const st = useMemo(() => makeStyles(palette), [palette]);
  const [lang, setLang] = useState<Language>(language);
  const t = words[lang];
  const catalog = useGetOwnerRegistrationCatalog({ query: { enabled: mode !== 'status', queryKey: ['owner-registration-catalog'] } });
  const createRegistration = useCreateOwnerRegistration();
  const createClaim = useCreateOwnerAccessClaim();
  const verify = useVerifyOwnerRegistrationEmail();
  const resend = useResendOwnerRegistrationCode();
  const [phase, setPhase] = useState<'form' | 'verify' | 'waiting'>(mode === 'status' ? 'waiting' : 'form');
  const status = useGetOwnerRegistrationStatus({
    query: { enabled: mode === 'status' || phase === 'waiting', queryKey: getGetOwnerRegistrationStatusQueryKey(), refetchInterval: 30000 },
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [building, setBuilding] = useState<OwnerRegistrationBuilding | null>(null);
  const [unitId, setUnitId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const list = catalog.data?.buildings ?? [];
  const busy = createRegistration.isPending || createClaim.isPending || verify.isPending || resend.isPending || signingIn;
  const pickedBuilding = list.find(item => item.buildingId === building?.buildingId) ?? null;
  const pickedUnit = pickedBuilding?.units.find(unit => unit.id === unitId);

  const start = () => {
    setError('');
    if (!unitId) return;
    if (mode === 'claim') {
      createClaim.mutate({ data: { unitId } }, {
        onSuccess: (result) => setPhase(result.status === 'pending_email' ? 'verify' : 'waiting'),
        onError: () => setError(t.error),
      });
      return;
    }
    createRegistration.mutate({ data: { name: name.trim(), email: email.trim(), password, unitId, locale: lang } }, {
      onSuccess: async () => {
        setSigningIn(true);
        try {
          if (!onAuthenticate) throw new Error('owner_authentication_unavailable');
          await onAuthenticate(email.trim(), password);
          setPhase('verify');
        } catch {
          setError(t.error);
        } finally {
          setSigningIn(false);
        }
      },
      onError: () => setError(t.error),
    });
  };
  const submitCode = () => {
    setError('');
    verify.mutate({ data: { code: code.trim() } }, {
      onSuccess: () => setPhase('waiting'),
      onError: () => setError(t.error),
    });
  };
  const currentRequests = status.data?.requests ?? [];

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      <View style={st.topLine}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} testID="owner-onboarding-back" onPress={onBack} style={st.back}>
          <Feather name="arrow-left" size={19} color={palette.foreground} /><Text style={st.backText}>{t.back}</Text>
        </Pressable>
        <View style={st.langRow} accessibilityLabel={t.language}>
          {(['hy', 'ru', 'en'] as Language[]).map(item => <Pressable key={item} testID={`owner-language-${item}`} accessibilityRole="button" accessibilityState={{ selected: lang === item }} onPress={() => setLang(item)} style={[st.lang, lang === item && st.langOn]}><Text style={[st.langText, lang === item && st.langTextOn]}>{item.toUpperCase()}</Text></Pressable>)}
        </View>
      </View>
      <View style={st.brand}>
        <View style={st.brandMark}><Feather name="home" size={23} color={palette.primaryForeground} /></View>
        <Text style={st.brandName}>ImTun</Text><Text style={st.kicker}>{t.owner}</Text>
      </View>
      {phase === 'form' ? <>
        <View style={st.step}><Text style={st.stepLabel}>{t.step} 01</Text><View style={st.stepTrack}><View style={st.stepFill} /></View><Text style={st.stepLabel}>03</Text></View>
        <Text style={st.title}>{mode === 'claim' ? t.claimTitle : t.title}</Text>
        <Text style={st.copy}>{mode === 'claim' ? t.claimIntro : t.intro}</Text>
        <View style={st.panel}>
          {mode !== 'claim' ? <>
            <Label text={t.name} palette={palette} /><TextInput testID="owner-register-name" accessibilityLabel={t.name} value={name} onChangeText={setName} autoCapitalize="words" style={st.input} placeholder={t.name} placeholderTextColor={palette.placeholder} />
            <Label text={t.email} palette={palette} /><TextInput testID="owner-register-email" accessibilityLabel={t.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={st.input} placeholder="name@example.com" placeholderTextColor={palette.placeholder} />
            <Label text={t.password} palette={palette} /><TextInput testID="owner-register-password" accessibilityLabel={t.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" style={st.input} placeholder={lang === 'hy' ? 'Առնվազն 12 նիշ' : lang === 'ru' ? 'Не менее 12 символов' : 'At least 12 characters'} placeholderTextColor={palette.placeholder} />
          </> : <View style={st.info}><Feather name="shield" size={17} color={palette.primary} /><Text style={st.infoText}>{t.secure}</Text></View>}
          <Label text={t.building} palette={palette} />
          {catalog.isLoading ? <View style={st.skeleton}><View style={st.skeletonLine} /><View style={st.skeletonLine} /></View> : catalog.isError ? <View style={st.errorBox}><Text style={st.errorText}>{t.error}</Text><Pressable accessibilityRole="button" testID="owner-catalog-retry" onPress={() => catalog.refetch()}><Text style={st.retry}>{t.retry}</Text></Pressable></View> : !list.length ? <Text style={st.empty}>{t.noBuildings}</Text> :
            list.map(item => <Pressable key={item.buildingId} accessibilityRole="radio" accessibilityState={{ checked: building?.buildingId === item.buildingId }} testID={`owner-building-${item.buildingId}`} onPress={() => { setBuilding(item); setUnitId(''); }} style={[st.option, building?.buildingId === item.buildingId && st.optionSelected]}>
              <View style={[st.optionIcon, building?.buildingId === item.buildingId && st.optionIconSelected]}><Feather name="map-pin" size={16} color={building?.buildingId === item.buildingId ? palette.primaryForeground : palette.primary} /></View>
              <View style={{ flex: 1 }}><Text style={st.optionTitle}>{item.buildingName}</Text><Text style={st.optionSub}>{item.address} · {item.organizationName}</Text></View><Feather name={building?.buildingId === item.buildingId ? 'check-circle' : 'circle'} size={19} color={building?.buildingId === item.buildingId ? palette.primary : palette.subdued} />
            </Pressable>)}
          {pickedBuilding ? <>
            <Label text={t.unit} palette={palette} />
            <View style={st.units}>
              {pickedBuilding.units.map(unit => <Pressable key={unit.id} accessibilityRole="radio" accessibilityState={{ checked: unitId === unit.id }} testID={`owner-unit-${unit.id}`} onPress={() => setUnitId(unit.id)} style={[st.unit, unitId === unit.id && st.unitSelected]}><Text style={[st.unitText, unitId === unit.id && st.unitTextSelected]}>{unit.number}</Text></Pressable>)}
            </View>
          </> : null}
          {error ? <View accessibilityRole="alert" testID="owner-flow-error" style={st.errorBox}><Feather name="alert-circle" size={16} color={palette.destructive} /><Text style={st.errorText}>{error}</Text></View> : null}
          <Pressable accessibilityRole="button" testID={mode === 'claim' ? 'owner-claim-submit' : 'owner-register-submit'} disabled={busy || !unitId || (mode !== 'claim' && (!name.trim() || !email.includes('@') || password.length < 12))} onPress={start} style={[st.primary, (busy || !unitId || (mode !== 'claim' && (!name.trim() || !email.includes('@') || password.length < 12))) && st.disabled]}>
            <Text style={st.primaryText}>{busy ? t.loading : mode === 'claim' ? t.claim : t.submit}</Text><Feather name="arrow-right" size={18} color={palette.primaryForeground} />
          </Pressable>
        </View>
      </> : null}
      {phase === 'verify' ? <>
        <View style={st.step}><Text style={st.stepLabel}>{t.step} 02</Text><View style={st.stepTrack}><View style={[st.stepFill, { width: '68%' }]} /></View><Text style={st.stepLabel}>03</Text></View>
        <Text style={st.title}>{t.verify}</Text><Text style={st.copy}>{t.verifyCopy}</Text>
        <View style={st.panel}>
          <View style={st.mailIcon}><Feather name="mail" size={22} color={palette.primary} /></View>
          <Text style={st.sentTo}>{email}</Text>
          <Label text={t.code} palette={palette} />
          <TextInput testID="owner-verification-code" accessibilityLabel={t.code} value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} style={[st.input, st.codeInput]} placeholder="000000" placeholderTextColor={palette.placeholder} />
          {error ? <View accessibilityRole="alert" testID="owner-flow-error" style={st.errorBox}><Text style={st.errorText}>{error}</Text></View> : null}
          <Pressable accessibilityRole="button" testID="owner-verify-submit" disabled={code.length !== 6 || busy} onPress={submitCode} style={[st.primary, (code.length !== 6 || busy) && st.disabled]}><Text style={st.primaryText}>{busy ? t.loading : t.verifyButton}</Text><Feather name="check" size={18} color={palette.primaryForeground} /></Pressable>
          <Pressable accessibilityRole="button" testID="owner-resend-code" disabled={busy} onPress={() => { setError(''); setNotice(''); resend.mutate(undefined, { onSuccess: () => setNotice(t.resend), onError: () => setError(t.error) }); }} style={st.linkButton}><Text style={st.link}>{resend.isPending ? t.loading : t.resend}</Text></Pressable>
          {notice ? <Text testID="owner-resend-status" accessibilityLiveRegion="polite" style={st.successText}>{notice}</Text> : null}
        </View>
      </> : null}
      {phase === 'waiting' ? <>
        <View style={st.statusHero}><View style={st.statusIcon}><Feather name="clock" size={27} color={palette.primary} /></View><Text style={st.title}>{t.waiting}</Text><Text style={st.copy}>{t.waitingCopy}</Text></View>
        {mode === 'status' || phase === 'waiting' ? <View testID="owner-registration-status" style={st.panel}>
          {status.isLoading ? <View style={st.skeleton}><View style={st.skeletonLine} /><View style={st.skeletonLine} /></View> : status.isError ? <View style={st.errorBox}><Text style={st.errorText}>{t.error}</Text><Pressable accessibilityRole="button" testID="owner-status-retry" onPress={() => status.refetch()}><Text style={st.retry}>{t.retry}</Text></Pressable></View> : currentRequests.length ? currentRequests.map(request => {
            const label = request.status === 'approved' ? t.approved : request.status === 'rejected' ? t.rejected : t.pending;
            return <View key={request.id} testID={`owner-request-${request.id}`} style={st.requestRow}><View style={st.requestIcon}><Feather name={request.status === 'approved' ? 'check' : request.status === 'rejected' ? 'x' : 'clock'} size={18} color={request.status === 'approved' ? palette.success : palette.primary} /></View><View style={{ flex: 1 }}><Text style={st.optionTitle}>{label}</Text><Text style={st.optionSub}>{request.organizationName} · {request.buildingName} · {request.unitNumber}</Text>{request.reviewNote ? <Text style={st.optionSub}>{request.reviewNote}</Text> : null}</View></View>;
          }) : <Text style={st.empty}>{t.empty}</Text>}
          <Pressable accessibilityRole="button" testID="owner-status-refresh" onPress={() => status.refetch()} style={st.secondary}><Feather name="refresh-cw" size={15} color={palette.foreground} /><Text style={st.secondaryText}>{t.retry}</Text></Pressable>
        </View> : <View style={st.panel}><View style={st.requestRow}><View style={st.requestIcon}><Feather name="check" size={18} color={palette.primary} /></View><View style={{ flex: 1 }}><Text style={st.optionTitle}>{t.pending}</Text><Text style={st.optionSub}>{pickedBuilding?.buildingName ?? ''}{pickedUnit ? ` · ${pickedUnit.number}` : ''}</Text></View></View><Text style={st.copy}>{t.secure}</Text></View>}
        {onDone && currentRequests.some(request => request.status === 'approved') ? <Pressable accessibilityRole="button" testID="owner-onboarding-done" onPress={onDone} style={st.primary}><Text style={st.primaryText}>{t.continue}</Text><Feather name="arrow-right" size={18} color={palette.primaryForeground} /></Pressable> : null}
      </> : null}
      <Text style={st.footer}><Feather name="lock" size={12} color={palette.subdued} /> {t.secure}</Text>
    </ScrollView>
  );
}
function Label({ text, palette }: { text: string; palette: Palette }) {
  return <Text style={{ color: palette.foreground, fontSize: 12, fontWeight: '700', marginBottom: 7, marginTop: 7 }}>{text}</Text>;
}
const makeStyles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.background }, content: { paddingHorizontal: 23, paddingTop: 18, paddingBottom: 42, width: '100%', maxWidth: 520, alignSelf: 'center' },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42 }, back: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingRight: 12 }, backText: { color: p.foreground, fontSize: 13, fontWeight: '700' },
  langRow: { flexDirection: 'row', padding: 3, borderRadius: 10, backgroundColor: p.secondary, gap: 2 }, lang: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7 }, langOn: { backgroundColor: p.surface }, langText: { color: p.mutedForeground, fontSize: 10, fontWeight: '800' }, langTextOn: { color: p.foreground },
  brand: { marginTop: 21, marginBottom: 25 }, brandMark: { width: 43, height: 43, borderRadius: 15, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 9 }, brandName: { fontSize: 22, letterSpacing: -0.8, fontWeight: '800', color: p.foreground }, kicker: { color: p.subdued, fontSize: 10, fontWeight: '700', letterSpacing: 1.1, marginTop: 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }, stepLabel: { fontSize: 9, color: p.subdued, fontWeight: '800', letterSpacing: 0.8 }, stepTrack: { flex: 1, height: 4, borderRadius: 4, backgroundColor: p.secondary }, stepFill: { width: '34%', height: 4, borderRadius: 4, backgroundColor: p.primary },
  title: { color: p.foreground, fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.7, marginBottom: 9 }, copy: { color: p.mutedForeground, fontSize: 14, lineHeight: 21, marginBottom: 20, maxWidth: 390 },
  panel: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: 18, padding: 17, gap: 3 }, input: { minHeight: 49, backgroundColor: p.warmSurface, borderColor: p.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 14, color: p.foreground, marginBottom: 9 },
  option: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.warmSurface, marginBottom: 8 }, optionSelected: { borderColor: p.selectedBorder, backgroundColor: p.selectedSurface }, optionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent }, optionIconSelected: { backgroundColor: p.primary }, optionTitle: { color: p.foreground, fontSize: 13, fontWeight: '800' }, optionSub: { color: p.mutedForeground, fontSize: 10, lineHeight: 15, marginTop: 3 },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 9 }, unit: { minWidth: 53, minHeight: 43, borderWidth: 1, borderColor: p.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: p.warmSurface, paddingHorizontal: 11 }, unitSelected: { backgroundColor: p.primary, borderColor: p.primary }, unitText: { color: p.foreground, fontSize: 13, fontWeight: '700' }, unitTextSelected: { color: p.primaryForeground },
  primary: { minHeight: 51, borderRadius: 12, backgroundColor: p.primary, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }, primaryText: { color: p.primaryForeground, fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.48 },
  info: { flexDirection: 'row', gap: 9, alignItems: 'center', padding: 11, backgroundColor: p.accent, borderRadius: 10, marginBottom: 11 }, infoText: { flex: 1, fontSize: 11, lineHeight: 16, color: p.foreground }, errorBox: { padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.destructiveSurface, borderRadius: 10, marginVertical: 8 }, errorText: { flex: 1, color: p.destructiveForeground, fontSize: 12, lineHeight: 17 }, retry: { color: p.primary, fontSize: 12, fontWeight: '800', padding: 6 }, empty: { color: p.mutedForeground, fontSize: 12, paddingVertical: 11, lineHeight: 18 },
  skeleton: { padding: 12, gap: 11 }, skeletonLine: { height: 13, width: '80%', borderRadius: 6, backgroundColor: p.skeleton }, mailIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: 8 }, sentTo: { alignSelf: 'center', color: p.foreground, fontWeight: '700', marginBottom: 13 }, codeInput: { textAlign: 'center', fontSize: 22, letterSpacing: 8, fontWeight: '800' },
  linkButton: { minHeight: 43, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, link: { color: p.primary, fontWeight: '800', fontSize: 12 }, successText: { color: p.success, fontSize: 12, textAlign: 'center', padding: 7 },
  statusHero: { alignItems: 'flex-start', marginTop: 12 }, statusIcon: { width: 57, height: 57, borderRadius: 19, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 19 }, requestRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderColor: p.divider }, requestIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
  secondary: { minHeight: 43, borderColor: p.border, borderWidth: 1, borderRadius: 11, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, secondaryText: { color: p.foreground, fontWeight: '700', fontSize: 12 }, footer: { color: p.subdued, fontSize: 10, textAlign: 'center', marginTop: 24 },
});
