import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useAppPalette, useAppTheme } from '@/hooks/useAppTheme';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Redirect, Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useLang } from '@/lib/resident/hooks';
import { tabLabels, tr } from '@/lib/resident/shell';
import { useGetMobileAuthSession } from '@workspace/api-client-react';
import { useWorkspace } from '@/lib/resident/hooks';
import { domainAvailable } from '@/lib/resident/domain';
import { isImTunResidentContext, residentRole, residentSectionAllowed, type ResidentRole } from '@/lib/resident/navigation';

type TabRoute = 'index' | 'access' | 'bills' | 'requests' | 'community' | 'profile' | 'more';
const routeMeta: Record<TabRoute, { icon: keyof typeof Feather.glyphMap; systemIcon: string; systemSelected: string }> = {
  index: { icon: 'home', systemIcon: 'house', systemSelected: 'house.fill' },
  access: { icon: 'key', systemIcon: 'key', systemSelected: 'key.fill' },
  bills: { icon: 'credit-card', systemIcon: 'creditcard', systemSelected: 'creditcard.fill' },
  requests: { icon: 'tool', systemIcon: 'wrench.and.screwdriver', systemSelected: 'wrench.and.screwdriver.fill' },
  community: { icon: 'message-circle', systemIcon: 'bubble.left.and.bubble.right', systemSelected: 'bubble.left.and.bubble.right.fill' },
  profile: { icon: 'user', systemIcon: 'person.crop.circle', systemSelected: 'person.crop.circle.fill' },
  more: { icon: 'grid', systemIcon: 'ellipsis', systemSelected: 'ellipsis' },
};

function useResidentTabs(): { role: ResidentRole; order: TabRoute[]; labels: Record<TabRoute, string> } {
  const session = useGetMobileAuthSession();
  const workspace = useWorkspace();
  const l = useLang();
  const context = session.data?.contexts.find((item) => item.id === session.data?.contextId);
  const role = residentRole(context);
  const visible = (allowed: boolean) => session.isPending || session.isError ? false : !!context && allowed;
  const showBills = visible(domainAvailable(context, 'finance'));
  const showRequests = visible(!!context?.permissions.includes('requests.own'));
  const showCommunity = visible(workspace.data?.capabilities?.conversations === true
    || workspace.data?.capabilities?.discussions === true
    || domainAvailable(context, 'announcements')
    || domainAvailable(context, 'meetings'));
  const showAccess = visible(residentSectionAllowed(context, workspace.data, 'access'));
  const desired: Record<ResidentRole, TabRoute[]> = {
    owner: ['index', 'bills', 'access', 'requests', 'profile'],
    renter: ['index', 'access', 'requests', 'bills', 'more'],
    family: ['index', 'access', 'requests', 'community', 'more'],
    resident: ['index', 'bills', 'access', 'requests', 'profile'],
  };
  const allowed: Record<TabRoute, boolean> = {
    index: true, access: showAccess, bills: showBills, requests: showRequests,
    community: showCommunity, profile: true, more: true,
  };
  const order = desired[role].filter((route) => allowed[route]);
  const labels = {
    index: tr(l, role === 'owner'
      ? ['Իմ տունը', 'Мой дом', 'My home']
      : role === 'renter' ? ['Իմ վարձակալությունը', 'Моя аренда', 'My rental']
        : role === 'family' ? ['Մեր տունը', 'Наш дом', 'Our home'] : tabLabels.home),
    access: tr(l, ['Մուտք', 'Доступ', 'Access']),
    bills: tr(l, role === 'renter'
      ? ['Վարձ և վճարներ', 'Аренда и платежи', 'Rent & bills']
      : role === 'owner' ? ['Ֆինանսներ', 'Финансы', 'Finance'] : tabLabels.bills),
    requests: tr(l, role === 'renter'
      ? ['Խնդիրներ', 'Проблемы', 'Issues'] : tabLabels.requests),
    community: tr(l, role === 'family'
      ? ['Չաթ', 'Чат', 'Chat'] : role === 'renter'
        ? ['Համայնք', 'Дом', 'Community'] : tabLabels.community),
    profile: tr(l, tabLabels.profile),
    more: tr(l, ['Ավելին', 'Ещё', 'More']),
  };
  return { role, order, labels };
}

// Route order and labels follow the authenticated resident context; unavailable
// sections are removed from the bar rather than displayed as dead tabs.
function NativeTabLayout() {
  const { order, labels } = useResidentTabs();
  const all: TabRoute[] = ['index', 'access', 'bills', 'requests', 'community', 'profile', 'more'];
  return (
    <NativeTabs>
      {[...order, ...all.filter((route) => !order.includes(route))].map((route) => {
        const meta = routeMeta[route];
        return <NativeTabs.Trigger key={route} name={route} hidden={!order.includes(route)}>
          <NativeTabs.Trigger.Icon sf={{ default: meta.systemIcon as never, selected: meta.systemSelected as never }} />
          <NativeTabs.Trigger.Label>{labels[route]}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>;
      })}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useAppPalette();
  const isDark = useAppTheme().name === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const { order, labels } = useResidentTabs();
  const icon = (name: keyof typeof Feather.glyphMap) => ({ color }: { color: import("react-native").ColorValue }) => <Feather name={name} size={21} color={color} />;
  const all: TabRoute[] = ['index', 'access', 'bills', 'requests', 'community', 'profile', 'more'];
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarStyle: { position: isIOS ? 'absolute' : 'relative', backgroundColor: isIOS ? 'transparent' : colors.background, borderTopWidth: isWeb ? 1 : 0, borderTopColor: colors.border, elevation: 0, ...(isWeb ? { height: 84 } : {}) },
        tabBarBackground: () => isIOS ? <BlurView intensity={100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : isWeb ? <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} /> : null,
      }}
    >
      {[...order, ...all.filter((route) => !order.includes(route))].map((route) => (
        <Tabs.Screen key={route} name={route} options={{ title: labels[route], href: order.includes(route) ? undefined : null, tabBarIcon: icon(routeMeta[route].icon) }} />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  const palette = useAppPalette();
  const session = useGetMobileAuthSession();
  const activeResidentContext = session.data?.contexts.find((context) =>
    context.id === session.data?.contextId && isImTunResidentContext(context),
  );

  if (session.isPending && !session.data) {
    return <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }]}>
      <ActivityIndicator color={palette.primary} />
    </View>;
  }

  if (!session.data?.user || !activeResidentContext) {
    return <Redirect href="/" />;
  }

  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}
