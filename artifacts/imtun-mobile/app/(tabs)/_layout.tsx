import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useAppPalette, useAppTheme } from '@/hooks/useAppTheme';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useLang } from '@/lib/resident/hooks';
import { tabLabels, tr } from '@/lib/resident/shell';

// iOS 26: NativeTabs (system liquid glass). Exactly five triggers; the `more`
// route stays registered for contextual navigation but is never a tab.
function NativeTabLayout() {
  const l = useLang();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index"><NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} /><NativeTabs.Trigger.Label>{tr(l, tabLabels.home)}</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="bills"><NativeTabs.Trigger.Icon sf={{ default: 'creditcard', selected: 'creditcard.fill' }} /><NativeTabs.Trigger.Label>{tr(l, tabLabels.bills)}</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="requests"><NativeTabs.Trigger.Icon sf={{ default: 'wrench.and.screwdriver', selected: 'wrench.and.screwdriver.fill' }} /><NativeTabs.Trigger.Label>{tr(l, tabLabels.requests)}</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="community"><NativeTabs.Trigger.Icon sf={{ default: 'person.3', selected: 'person.3.fill' }} /><NativeTabs.Trigger.Label>{tr(l, tabLabels.community)}</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile"><NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} /><NativeTabs.Trigger.Label>{tr(l, tabLabels.profile)}</NativeTabs.Trigger.Label></NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useAppPalette();
  const isDark = useAppTheme().name === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const l = useLang();
  const icon = (name: keyof typeof Feather.glyphMap) => ({ color }: { color: import("react-native").ColorValue }) => <Feather name={name} size={21} color={color} />;
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
      <Tabs.Screen name="index" options={{ title: tr(l, tabLabels.home), tabBarIcon: icon('home') }} />
      <Tabs.Screen name="bills" options={{ title: tr(l, tabLabels.bills), tabBarIcon: icon('credit-card') }} />
      <Tabs.Screen name="requests" options={{ title: tr(l, tabLabels.requests), tabBarIcon: icon('tool') }} />
      <Tabs.Screen name="community" options={{ title: tr(l, tabLabels.community), tabBarIcon: icon('users') }} />
      <Tabs.Screen name="profile" options={{ title: tr(l, tabLabels.profile), tabBarIcon: icon('user') }} />
      <Tabs.Screen name="more" options={{ href: null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}
