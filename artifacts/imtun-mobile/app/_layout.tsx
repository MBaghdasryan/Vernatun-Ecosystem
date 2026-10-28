import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setBaseUrl, setCsrfTokenGetter } from '@workspace/api-client-react';
import { AppThemeProvider, useAppPalette } from '@/hooks/useAppTheme';
import { AppLockProvider } from '@/components/security/AppLock';
import { palette } from '@/constants/colors';
import { clearPrivateDocumentCache } from '@/lib/resident/privateDocument';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const csrfSessionRef: { current: string | null } = { current: null };
// Development must never inherit a production API URL from an exported build
// setting. Web uses Metro's local-only proxy so cookies remain same-origin.
const configuredApiUrl = __DEV__
  ? (Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.origin}/__imtun_dev_api`
    : process.env.EXPO_PUBLIC_DEV_API_URL?.trim())
  : (process.env.EXPO_PUBLIC_API_URL?.trim() || process.env.EXPO_PUBLIC_DOMAIN?.trim());
if (!configuredApiUrl) {
  throw new Error('API endpoint missing. Start the development workflow, or configure the release API URL.');
}
setBaseUrl(
  /^https?:\/\//i.test(configuredApiUrl)
    ? configuredApiUrl.replace(/\/+$/, '')
    : `https://${configuredApiUrl.replace(/\/+$/, '')}`,
);
setCsrfTokenGetter(() => csrfSessionRef.current);

const queryClient = new QueryClient();

function RootLayoutNav() {
  const palette = useAppPalette();
  return (
    <Stack initialRouteName="index" screenOptions={{ headerBackTitle: 'Հետ', headerShown: false, contentStyle: { backgroundColor: palette.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="legal/[document]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    // Remove private bytes left by an interrupted native share before use.
    clearPrivateDocumentCache();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AppThemeProvider><AppLockProvider><RootLayoutNav /></AppLockProvider></AppThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
