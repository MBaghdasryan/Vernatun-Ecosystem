import React, { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLogoutMobileAuth, useGetMobileAuthSession, useSwitchMobileAuthContext, type MobileAuthContext } from '@workspace/api-client-react';
import { useRouter } from 'expo-router';
import { palette } from '@/constants/colors';
import { csrfSessionRef } from '../_layout';
import { useColors } from '@/hooks/useColors';

function isResidentContext(context: MobileAuthContext) {
  const product = [context.product, ...(context.products ?? [])].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
  return product.includes('imtun') || context.role_key.toLowerCase().includes('resident');
}

export default function ProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const session = useGetMobileAuthSession();
  const logout = useLogoutMobileAuth();
  const switchContext = useSwitchMobileAuthContext();
  const [contextSheet, setContextSheet] = useState(false);
  const [error, setError] = useState('');
  csrfSessionRef.current = session.data?.csrf ?? csrfSessionRef.current;
  const contexts = useMemo(() => (session.data?.contexts ?? []).filter(isResidentContext), [session.data?.contexts]);
  const active = contexts.find((context) => context.id === session.data?.contextId);
  const user = session.data?.user;

  const changeContext = (context: MobileAuthContext) => {
    setError('');
    switchContext.mutate({ data: { id: context.id } }, {
      onSuccess: () => {
        setContextSheet(false);
        client.invalidateQueries({ queryKey: session.queryKey });
      },
      onError: (cause) => setError(cause instanceof Error ? cause.message : 'Не удалось переключить дом. Попробуйте ещё раз.'),
    });
  };

  const signOut = () => {
    setError('');
    logout.mutate(undefined, {
      onSuccess: () => {
        csrfSessionRef.current = null;
        client.clear();
        router.replace('/');
      },
      onError: (cause) => setError(cause instanceof Error ? cause.message : 'Не удалось завершить сеанс. Попробуйте снова.'),
    });
  };

  if (session.isLoading) return <View style={styles.center}><View style={styles.skeleton} /><View style={[styles.skeleton, { width: '65%' }]} /><View style={[styles.skeleton, { height: 170 }]} /></View>;
  if (session.isError && !session.data) return <View style={styles.center}><Feather name="wifi-off" size={27} color={colors.mutedForeground} /><Text style={styles.title}>Профиль недоступен</Text><Text style={styles.muted}>Не удалось получить сведения аккаунта.</Text><Pressable accessibilityRole="button" testID="profile-retry" onPress={() => session.refetch()} style={styles.retry}><Text style={styles.retryText}>Повторить</Text></Pressable></View>;

  const initials = (user?.name || ' ').trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || '•';
  return <>
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.top}><Image source={require('@/assets/imtun-original.png')} resizeMode="contain" style={styles.logo} /><Text style={styles.kicker}>ВАШ АККАУНТ</Text></View>
      <Text style={styles.title}>Профиль</Text><Text style={styles.subtitle}>Личные данные и выбранный дом.</Text>
      <View style={styles.identityCard}><View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View><View style={{ flex: 1 }}><Text style={styles.name}>{user?.name || 'Пользователь ImTun'}</Text><Text style={styles.email}>{user?.email || 'Электронная почта не указана'}</Text></View><Feather name="check-circle" size={19} color={palette.success} /></View>
      <Text style={styles.section}>ДОМ И КВАРТИРА</Text>
      <Pressable accessibilityRole="button" testID="profile-change-context" disabled={contexts.length < 2} onPress={() => setContextSheet(true)} style={[styles.listCard, contexts.length < 2 && styles.notInteractive]}>
        <View style={styles.listIcon}><Feather name="home" size={19} color={palette.accentForeground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>{active?.building_name || active?.organization_name || 'Жилой дом'}</Text><Text style={styles.itemDescription}>{active?.unit_number ? `Квартира ${active.unit_number}` : 'Активный контекст жителя'}{active?.organization_name && active.building_name ? ` · ${active.organization_name}` : ''}</Text></View>{contexts.length > 1 ? <Feather name="chevron-right" size={19} color={palette.mutedForeground} /> : <Feather name="check" size={18} color={palette.success} />}
      </Pressable>
      <Text style={styles.section}>АККАУНТ</Text>
      <View style={styles.listCard}>
        <View style={[styles.listIcon, { backgroundColor: palette.alternateSurface }]}><Feather name="mail" size={18} color={palette.foreground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>Электронная почта</Text><Text style={styles.itemDescription}>{user?.email || 'Не указана'}</Text></View>
      </View>
      <View style={styles.listCard}>
        <View style={[styles.listIcon, { backgroundColor: palette.alternateSurface }]}><Feather name="globe" size={18} color={palette.foreground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>Язык и валюта</Text><Text style={styles.itemDescription}>{user?.locale || '—'}{user?.currency ? ` · ${user.currency}` : ''}</Text></View>
      </View>
      {error ? <View style={styles.errorBox}><Feather name="alert-circle" size={16} color={palette.destructive} /><Text style={styles.errorText}>{error}</Text></View> : null}
      <View style={styles.security}><View style={styles.securityIcon}><Feather name="shield" size={17} color={palette.success} /></View><View style={{ flex: 1 }}><Text style={styles.securityTitle}>Защищённый сеанс</Text><Text style={styles.securityText}>Доступ к дому определяется сервером и выбранным контекстом.</Text></View></View>
      <Pressable accessibilityRole="button" testID="profile-logout" disabled={logout.isPending} onPress={signOut} style={styles.logout}><Feather name="log-out" size={17} color={palette.dangerText} /><Text style={styles.logoutText}>{logout.isPending ? 'Завершаем сеанс…' : 'Выйти из аккаунта'}</Text></Pressable>
      <Text style={styles.version}>IMTUN · BY VERNATUN</Text>
    </ScrollView>
    <Modal visible={contextSheet} transparent animationType="slide" onRequestClose={() => setContextSheet(false)}>
      <View style={styles.sheetBackdrop}><Pressable accessibilityRole="button" accessibilityLabel="Закрыть выбор дома" testID="context-sheet-backdrop" onPress={() => setContextSheet(false)} style={StyleSheet.absoluteFill} /><View style={styles.sheet}>
        <View style={styles.sheetHandle} /><View style={styles.sheetTitleRow}><View><Text style={styles.kicker}>ВАШ ДОСТУП</Text><Text style={styles.sheetTitle}>Выберите дом</Text></View><Pressable accessibilityRole="button" testID="context-sheet-close" onPress={() => setContextSheet(false)} style={styles.close}><Feather name="x" size={20} color={palette.foreground} /></Pressable></View>
        <Text style={styles.sheetDescription}>Переключение меняет только активный контекст. Права доступа проверяются сервером.</Text>
        {contexts.map((context) => {
          const selected = context.id === session.data?.contextId;
          return <Pressable accessibilityRole="button" testID={`profile-context-${context.id}`} key={context.id} disabled={selected || switchContext.isPending} onPress={() => changeContext(context)} style={[styles.contextOption, selected && styles.contextSelected]}>
            <View style={[styles.listIcon, selected && { backgroundColor: palette.accent }]}><Feather name="home" size={18} color={selected ? palette.accentForeground : palette.mutedForeground} /></View><View style={{ flex: 1 }}><Text style={styles.itemLabel}>{context.building_name || context.organization_name || 'Жилой дом'}</Text><Text style={styles.itemDescription}>{context.unit_number ? `Квартира ${context.unit_number}` : 'Контекст жителя'}</Text></View>{selected ? <Feather name="check-circle" size={19} color={palette.success} /> : <Feather name="arrow-right" size={17} color={palette.subdued} />}
          </Pressable>;
        })}
        {switchContext.isPending ? <Text style={styles.muted}>Переключаем дом…</Text> : null}
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background }, content: { paddingHorizontal: 21, paddingTop: 20, paddingBottom: 40 },
  top: { marginBottom: 17 }, logo: { width: 115, height: 49, marginLeft: -5 }, kicker: { color: palette.subdued, fontSize: 9, letterSpacing: 1.4, fontWeight: '800', marginTop: 8 },
  title: { color: palette.foreground, fontSize: 29, lineHeight: 35, letterSpacing: -0.7, fontWeight: '800' }, subtitle: { color: palette.mutedForeground, fontSize: 13, marginTop: 5, marginBottom: 21 },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 84, padding: 14, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.foreground, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: palette.surface, fontSize: 16, fontWeight: '800' },
  name: { color: palette.foreground, fontSize: 15, fontWeight: '800' }, email: { color: palette.mutedForeground, fontSize: 11, marginTop: 4 },
  section: { color: palette.subdued, fontSize: 9, fontWeight: '800', letterSpacing: 1.3, marginTop: 24, marginBottom: 9 },
  listCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, minHeight: 68, borderRadius: 13, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginBottom: 8 },
  listIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' }, itemLabel: { color: palette.foreground, fontSize: 13, fontWeight: '800' }, itemDescription: { color: palette.mutedForeground, fontSize: 11, marginTop: 4, lineHeight: 16 }, notInteractive: { opacity: 1 },
  security: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, marginTop: 16, borderRadius: 13, backgroundColor: palette.successSurface }, securityIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: palette.successSoft, alignItems: 'center', justifyContent: 'center' }, securityTitle: { color: palette.successDeep, fontSize: 12, fontWeight: '800' }, securityText: { color: palette.mutedForeground, fontSize: 10, lineHeight: 15, marginTop: 3 },
  logout: { marginTop: 20, minHeight: 49, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 12, borderWidth: 1, borderColor: palette.dangerBorder, backgroundColor: palette.dangerSurface }, logoutText: { color: palette.dangerText, fontSize: 13, fontWeight: '800' },
  version: { textAlign: 'center', color: palette.version, fontSize: 9, letterSpacing: 1.3, fontWeight: '700', marginTop: 23 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 11, backgroundColor: palette.destructiveSurface, borderRadius: 10, marginTop: 13 }, errorText: { color: palette.destructiveForeground, flex: 1, fontSize: 12, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 25, gap: 11, backgroundColor: palette.background }, muted: { color: palette.mutedForeground, textAlign: 'center', padding: 10, fontSize: 12 },
  retry: { backgroundColor: palette.primary, paddingHorizontal: 21, paddingVertical: 11, borderRadius: 10, marginTop: 5 }, retryText: { color: palette.foreground, fontWeight: '800' }, skeleton: { height: 18, width: '100%', borderRadius: 8, backgroundColor: palette.skeleton, marginBottom: 13 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: palette.overlay }, sheet: { backgroundColor: palette.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 11, paddingHorizontal: 20, paddingBottom: 30, maxHeight: '82%' },
  sheetHandle: { width: 38, height: 4, borderRadius: 3, backgroundColor: palette.handle, alignSelf: 'center', marginBottom: 17 }, sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: palette.foreground, fontSize: 23, letterSpacing: -0.5, fontWeight: '800', marginTop: 4 }, sheetDescription: { fontSize: 12, color: palette.mutedForeground, lineHeight: 18, marginTop: 9, marginBottom: 14 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  contextOption: { minHeight: 69, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 13, padding: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, contextSelected: { borderColor: palette.selectedBorder, backgroundColor: palette.selectedSurface },
});
