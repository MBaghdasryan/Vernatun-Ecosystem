import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import { useLang } from '@/lib/resident/hooks';
import type { Language } from '@/lib/resident/text';

type Tri = readonly [string, string, string];
type LegalKind = 'privacy' | 'terms';
const languageOrder: Language[] = ['hy', 'ru', 'en'];
const languageIndex: Record<Language, number> = { hy: 0, ru: 1, en: 2 };
const localize = (value: Tri, language: Language) => value[languageIndex[language]];

const pages: Record<LegalKind, { title: Tri; intro: Tri; draft: Tri; sections: readonly (readonly [Tri, Tri])[] }> = {
  privacy: {
    title: ['Գաղտնիության քաղաքականություն', 'Политика конфиденциальности', 'Privacy policy'],
    intro: [
      'Այս նախագիծը նկարագրում է, թե ինչպես կարող է Vernatun-ը մշակել տվյալները ImTun-ից և տան ծառայություններից օգտվելիս։ Այն պետք է վերանայվի մինչև պաշտոնական հրապարակումը։',
      'Этот черновик описывает, как Vernatun может обрабатывать данные при использовании ImTun и сервисов дома. Перед официальной публикацией текст нужно согласовать.',
      'This draft describes how Vernatun may process information when people use ImTun and home services. It must be reviewed before official publication.',
    ],
    draft: [
      'Մինչև վերջնական հրապարակումը լրացրեք տվյալների օպերատորի իրավաբանական անվանումը, հասցեն, կապի տվյալները, պահպանման ժամկետները և կիրառելի իրավական հիմքերը։',
      'До публикации укажите юридическое наименование оператора данных, адрес, контакты, сроки хранения и применимые правовые основания.',
      'Before publication, add the data controller’s legal name, address, contact details, retention periods, and applicable legal bases.',
    ],
    sections: [
      [
        ['Ով է պատասխանատու տվյալների համար', 'Кто отвечает за данные', 'Who is responsible for data'],
        [
          'Օպերատորի տվյալները կհրապարակվեն այս քաղաքականության վերջնական տարբերակում։ Կախված միացված շենքից՝ որոշ տեղեկություններ կարող են մշակվել այդ շենքը կառավարող կազմակերպության հետ։',
          'Оператор будет указан в окончательной редакции. В зависимости от подключённого дома отдельные сведения могут обрабатываться совместно с управляющей организацией.',
          'The operator will be identified in the final version. Depending on the connected building, some information may also be handled with its management organization.',
        ],
      ],
      [
        ['Ինչ տվյալներ կարող են մշակվել', 'Какие данные могут обрабатываться', 'Information that may be processed'],
        [
          'Կախված գործառույթից՝ կարող են մշակվել հաշվի և կապի տվյալներ, բնակարանի ու մուտքի իրավունքի մասին տեղեկություններ, դիմումներ, հաղորդագրություններ, լուսանկարներ, հյուրերի անցագրեր, ծանուցումների նախընտրություններ և տեխնիկական մատյաններ։',
          'В зависимости от функций могут обрабатываться данные аккаунта и контактов, сведения о квартире и доступе, заявки, сообщения, фотографии, гостевые пропуска, настройки уведомлений и технические журналы.',
          'Depending on the feature, information may include account and contact details, home and access information, requests, messages, photos, guest passes, notification preferences, and technical logs.',
        ],
      ],
      [
        ['Ինչ նպատակով են օգտագործվում տվյալները', 'Для чего используются данные', 'How information may be used'],
        [
          'Տվյալները կարող են օգտագործվել հաշիվը պաշտպանելու, տան հասանելիությունը ստուգելու, ընտրված գործառույթները տրամադրելու, դիմումներին պատասխանելու, աջակցության և անվտանգության համար։',
          'Данные могут использоваться для защиты аккаунта, проверки доступа к дому, предоставления функций, обработки обращений, поддержки и безопасности.',
          'Information may be used to secure accounts, verify home access, provide selected features, respond to requests, and support service safety.',
        ],
      ],
      [
        ['Հասանելիություն և փոխանցում', 'Доступ и передача', 'Access and sharing'],
        [
          'Հասանելիությունը պետք է սահմանափակվի օգտատիրոջ դերի և ծառայության աշխատանքի համար անհրաժեշտ ծավալով։ Տվյալները կարող են հասանելի լինել լիազորված կառավարման աշխատակիցներին և տեխնիկական մատակարարներին։',
          'Доступ ограничивается ролью пользователя и необходимостью работы сервиса. Данные могут быть доступны уполномоченным сотрудникам управляющей организации и техническим поставщикам.',
          'Access should be limited to each user’s role and what the service needs. Information may be available to authorized building staff and technical providers.',
        ],
      ],
      [
        ['Պահպանում և պաշտպանություն', 'Хранение и защита', 'Retention and security'],
        [
          'Տվյալները պահվում են այնքան, որքան անհրաժեշտ է ծառայության աշխատանքի և պարտադիր պահանջների համար։ Կատեգորիաների ժամկետները կհստակեցվեն վերջնական տարբերակում։ Կիրառվում են տեխնիկական և կազմակերպական պաշտպանության միջոցներ։',
          'Данные хранятся столько, сколько необходимо для работы сервиса и выполнения обязательных требований. Сроки для каждой категории будут уточнены. Применяются технические и организационные меры защиты.',
          'Information is retained as needed to operate the service and meet applicable requirements. Category-specific periods will be specified in the final version. Technical and organizational safeguards are used.',
        ],
      ],
      [
        ['Ձեր հարցումները և կապը', 'Ваши запросы и контакты', 'Requests and contact'],
        [
          'Տվյալներին հասանելիության, ուղղման կամ մշակման վերաբերյալ հարցերի համար կապի տվյալները կհրապարակվեն վերջնական տարբերակում։ Ջնջման կամ սահմանափակման հնարավորությունը կարող է կախված լինել պարտադիր հաշվառման պահանջներից։',
          'Контакты для запросов о доступе к данным, исправлении или обработке будут опубликованы в окончательной версии. Удаление или ограничение может зависеть от обязательных требований к учёту.',
          'Contact details for access, correction, or processing requests will be published in the final version. Erasure or restriction may depend on required records.',
        ],
      ],
    ],
  },
  terms: {
    title: ['Օգտագործման պայմաններ', 'Условия использования', 'Terms of use'],
    intro: [
      'Այս պայմանները նկարագրում են ImTun-ի և Vernatun-ի հարակից թվային ծառայությունների օգտագործման հիմնական կանոնները։ Տեքստը խմբագրվող նախագիծ է, ոչ թե վերջնական իրավական փաստաթուղթ։',
      'Эти условия описывают основные правила использования ImTun и связанных цифровых сервисов Vernatun. Это редактируемый черновик, а не окончательный юридический документ.',
      'These terms outline basic rules for using ImTun and related Vernatun digital services. This is an editable draft, not a final legal document.',
    ],
    draft: [
      'Հրապարակումից առաջ համաձայնեցրեք պայմանագրի կողմերին, կազմակերպությունների կանոնները, վճարումները, կիրառելի իրավունքն ու կապի տվյալները։',
      'Перед публикацией согласуйте стороны договора, правила организаций, платежи, применимое право и контактные данные.',
      'Before publication, confirm the contracting parties, organization rules, payments, governing law, and contact details.',
    ],
    sections: [
      [
        ['Ծառայությունից օգտվելը', 'Использование сервиса', 'Using the service'],
        [
          'ImTun-ը բնակիչներին տրամադրում է տան և շենքի թվային ծառայություններ։ Հասանելի գործառույթները կախված են շենքի միացումից և օգտատիրոջ նշանակված իրավունքներից։',
          'ImTun предоставляет жителям цифровые сервисы дома и здания. Доступные функции зависят от подключения здания и назначенных пользователю прав.',
          'ImTun provides residents with digital home and building services. Available features depend on the building connection and permissions assigned to the user.',
        ],
      ],
      [
        ['Հաշիվ և հասանելիություն', 'Аккаунт и доступ', 'Accounts and access'],
        [
          'Օգտատերը պետք է տրամադրի հավաստի տեղեկություններ, պաշտպանի մուտքի տվյալները և օգտվի միայն իրեն հասանելի օբյեկտներից։ Բնակարանի կամ շենքի հասանելիությունը կարող է պահանջել սեփականատիրոջ կամ կառավարման կազմակերպության հաստատումը։',
          'Пользователь должен указывать достоверные данные, защищать учётные данные и использовать только доступные ему объекты. Доступ к квартире или зданию может требовать подтверждения владельца или управляющей организации.',
          'Users must provide accurate information, protect sign-in credentials, and use only authorized properties. Access may require verification by the owner or building-management organization.',
        ],
      ],
      [
        ['Նյութեր և վարքագիծ', 'Материалы и поведение', 'Content and conduct'],
        [
          'Օգտատերը պատասխանատու է իր ուղարկած հաղորդագրությունների, լուսանկարների և դիմումների համար։ Արգելվում է ապօրինի մուտքը, ուրիշների իրավունքների խախտումը կամ համակարգերի ու սարքերի աշխատանքին միջամտությունը։',
          'Пользователь отвечает за отправленные сообщения, фотографии и заявки. Запрещены незаконный доступ, нарушение чужих прав и вмешательство в работу систем или устройств.',
          'Users are responsible for their messages, photos, and requests. Unauthorized access, rights violations, and interference with systems or devices are prohibited.',
        ],
      ],
      [
        ['Վճարումներ և միացված գործառույթներ', 'Платежи и подключённые функции', 'Payments and connected features'],
        [
          'Միացված վճարումների դեպքում գումարն ու պայմանները ցուցադրվում են հաստատումից առաջ։ Սարքերի կառավարումը, տեսախցիկները և այլ ինտեգրացիաները հասանելի են միայն առանձին միացումից ու կարգավորումից հետո։',
          'Если платежи включены, сумма и условия показываются до подтверждения. Управление устройствами, камеры и другие интеграции доступны только после отдельного подключения и настройки.',
          'When payments are enabled, the amount and terms are shown before confirmation. Device controls, cameras, and other integrations require separate connection and configuration.',
        ],
      ],
      [
        ['Հասանելիություն և փոփոխություններ', 'Доступность и изменения', 'Availability and changes'],
        [
          'Որոշ գործառույթներ կարող են ժամանակավորապես սահմանափակվել սպասարկման, անվտանգության կամ խնդիրների լուծման նպատակով։ Վերջնական պայմաններում կնկարագրվեն փոփոխությունների մասին ծանուցումն ու հասանելիության դադարեցումը։',
          'Отдельные функции могут временно ограничиваться для обслуживания, безопасности или устранения проблем. Окончательная версия опишет уведомления об изменениях и прекращение доступа.',
          'Some features may be temporarily limited for maintenance, security, or troubleshooting. The final terms will describe change notices and how access may end.',
        ],
      ],
      [
        ['Պատասխանատվություն և կապ', 'Ответственность и связь', 'Liability and contact'],
        [
          'Կողմերի պատասխանատվությունը, կիրառելի իրավունքը և վեճերի լուծման կարգը պետք է նշվեն վերջնական տարբերակում՝ ըստ ծառայության իրական օպերատորի և պայմանագրերի։',
          'Ответственность сторон, применимое право и порядок разрешения споров необходимо указать в окончательной версии с учётом оператора сервиса и договоров.',
          'The final version must specify liability, governing law, and dispute procedures based on the actual service operator and agreements.',
        ],
      ],
    ],
  },
};

export default function LegalDocumentScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ document?: string | string[]; lang?: string | string[] }>();
  const savedLanguage = useLang();
  const documentParam = Array.isArray(params.document) ? params.document[0] : params.document;
  const languageParam = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const language = languageOrder.includes(languageParam as Language) ? languageParam as Language : savedLanguage;
  const kind = documentParam === 'privacy' || documentParam === 'terms' ? documentParam : null;
  const st = React.useMemo(() => makeStyles(palette), [palette]);

  const changeLanguage = (next: Language) => {
    if (!kind) return;
    router.replace({ pathname: '/legal/[document]', params: { document: kind, lang: next } });
  };
  const openOtherDocument = () => {
    if (!kind) return;
    const next: LegalKind = kind === 'privacy' ? 'terms' : 'privacy';
    router.replace({ pathname: '/legal/[document]', params: { document: next, lang: language } });
  };

  if (!kind) {
    return <SafeAreaView style={st.screen} edges={['top', 'bottom']}><View style={st.notFound}>
      <Feather name="file-text" size={28} color={palette.mutedForeground} />
      <Text style={st.title}>{language === 'hy' ? 'Փաստաթուղթը չի գտնվել' : language === 'ru' ? 'Документ не найден' : 'Document not found'}</Text>
      <Pressable accessibilityRole="button" testID="legal-home" onPress={() => router.replace('/')} style={st.homeButton}><Text style={st.homeText}>{language === 'hy' ? 'Գլխավոր էջ' : language === 'ru' ? 'На главную' : 'Home'}</Text></Pressable>
    </View></SafeAreaView>;
  }

  const page = pages[kind];
  const otherLabel: Tri = kind === 'privacy'
    ? ['Օգտագործման պայմաններ', 'Условия использования', 'Terms of use']
    : ['Գաղտնիության քաղաքականություն', 'Политика конфиденциальности', 'Privacy policy'];

  return <SafeAreaView style={st.screen} edges={['top', 'bottom']}>
    <View style={st.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={localize(['Հետ', 'Назад', 'Back'], language)} testID="legal-back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={st.back}>
        <Feather name="arrow-left" size={20} color={palette.foreground} />
        <Text style={st.backText}>{localize(['Հետ', 'Назад', 'Back'], language)}</Text>
      </Pressable>
      <View style={st.languageSwitch} accessibilityLabel={localize(['Լեզու', 'Язык', 'Language'], language)}>
        {languageOrder.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: language === option }} testID={`legal-language-${option}`} onPress={() => changeLanguage(option)} style={[st.languageButton, language === option && st.languageSelected]}>
          <Text style={[st.languageText, language === option && st.languageTextSelected]}>{option.toUpperCase()}</Text>
        </Pressable>)}
      </View>
    </View>
    <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
      <Text style={st.kicker}>{localize(['IMTUN · VERNATUN', 'IMTUN · VERNATUN', 'IMTUN · VERNATUN'], language)}</Text>
      <Text accessibilityRole="header" style={st.title}>{localize(page.title, language)}</Text>
      <Text style={st.intro}>{localize(page.intro, language)}</Text>
      <View style={st.draftCard}>
        <View style={st.draftIcon}><Feather name="file-text" size={17} color={palette.accentForeground} /></View>
        <View style={st.draftCopy}>
          <Text style={st.draftLabel}>{localize(['ՆԱԽԱԳԻԾ', 'ЧЕРНОВИК', 'DRAFT'], language)}</Text>
          <Text style={st.draftText}>{localize(page.draft, language)}</Text>
        </View>
      </View>
      <View style={st.sections}>
        {page.sections.map(([heading, body], index) => <View key={index} style={st.section}>
          <Text accessibilityRole="header" style={st.sectionTitle}>{localize(heading, language)}</Text>
          <Text style={st.body}>{localize(body, language)}</Text>
        </View>)}
      </View>
      <Pressable accessibilityRole="button" testID="legal-switch-document" onPress={openOtherDocument} style={st.otherDocument}>
        <View style={st.otherIcon}><Feather name="file-text" size={18} color={palette.accentForeground} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.otherLabel}>{localize(['Կարդալ նաև', 'Также прочитать', 'Also read'], language)}</Text>
          <Text style={st.otherTitle}>{localize(otherLabel, language)}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={palette.mutedForeground} />
      </Pressable>
      <Text style={st.footer}>{localize(['IMTUN · VERNATUN-Ի ԿՈՂՄԻՑ', 'IMTUN · ОТ VERNATUN', 'IMTUN · BY VERNATUN'], language)}</Text>
    </ScrollView>
  </SafeAreaView>;
}

const makeStyles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.background },
  header: { minHeight: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: p.border, backgroundColor: p.surface },
  back: { minHeight: 44, minWidth: 68, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 13, color: p.foreground, fontWeight: '700' },
  languageSwitch: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 10, backgroundColor: p.secondary },
  languageButton: { minWidth: 36, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 7, paddingHorizontal: 7 },
  languageSelected: { backgroundColor: p.surface },
  languageText: { fontSize: 10, color: p.mutedForeground, fontWeight: '800' },
  languageTextSelected: { color: p.foreground },
  content: { paddingHorizontal: 21, paddingTop: 27, paddingBottom: 34, maxWidth: 700, width: '100%', alignSelf: 'center' },
  kicker: { color: p.subdued, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 11 },
  title: { color: p.foreground, fontSize: 27, lineHeight: 34, letterSpacing: -0.6, fontWeight: '800' },
  intro: { color: p.mutedForeground, fontSize: 14, lineHeight: 22, marginTop: 12 },
  draftCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 14, marginTop: 19, borderRadius: 13, borderWidth: 1, borderColor: p.selectedBorder, backgroundColor: p.selectedSurface },
  draftIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent },
  draftCopy: { flex: 1, gap: 5 },
  draftLabel: { color: p.accentForeground, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  draftText: { color: p.foreground, fontSize: 11, lineHeight: 17 },
  sections: { marginTop: 10 },
  section: { paddingTop: 21, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: p.divider },
  sectionTitle: { color: p.foreground, fontSize: 16, lineHeight: 22, fontWeight: '800', marginBottom: 8 },
  body: { color: p.mutedForeground, fontSize: 13, lineHeight: 21 },
  otherDocument: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, marginTop: 19, borderRadius: 13, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface },
  otherIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent },
  otherLabel: { color: p.subdued, fontSize: 10, marginBottom: 3 },
  otherTitle: { color: p.foreground, fontSize: 12, fontWeight: '800' },
  footer: { color: p.version, fontSize: 9, letterSpacing: 1.2, textAlign: 'center', fontWeight: '700', marginTop: 24 },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 14 },
  homeButton: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 11, backgroundColor: p.primary },
  homeText: { color: p.primaryForeground, fontSize: 13, fontWeight: '800' },
});
