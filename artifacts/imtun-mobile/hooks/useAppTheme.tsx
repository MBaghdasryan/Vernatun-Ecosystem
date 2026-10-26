import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { palette as lightPalette } from '@/constants/colors';
import { useWorkspace } from '@/lib/resident/hooks';

export type Palette = typeof lightPalette;
export type ThemeName = 'light' | 'dark';

export const darkPalette: Palette = {
  background: '#0c1a23', foreground: '#eef2f2', surface: '#13252f', warmSurface: '#172b36', primary: '#ff7d24', primaryForeground: '#0b2230',
  secondary: '#1b313d', muted: '#1a2e39', mutedForeground: '#a9b8bf', subdued: '#8a9ba3', placeholder: '#7d8f98', border: '#28414e',
  accent: '#3a2414', accentForeground: '#ffb27a', destructive: '#ef7b6d', destructiveForeground: '#ffb3a9', destructiveSurface: '#3a1d1a',
  skeleton: '#1f3542', alternateSurface: '#1b313d', heroMuted: '#a9b8bf', success: '#6cbf93', successStrong: '#86d3a9', successDeep: '#9fe0bc',
  successSurface: '#15302a', successSoft: '#1d3d33', warning: '#e8a54d', warningText: '#f1c27f', dangerText: '#ff9d90', dangerBorder: '#5a2f2a',
  dangerSurface: '#2c1816', selectedBorder: '#c46a2c', selectedSurface: '#2a1d14', divider: '#203845', handle: '#3d5560', version: '#6f828b',
  overlay: 'rgba(0,0,0,0.6)', heroOverlay: 'rgba(255,255,255,0.10)', heroDecoration: 'rgba(255,255,255,0.05)', shadow: '#000000',
};
// The hero/finance cards use `foreground` as a dark surface in light mode; in dark mode keep them distinct.
type Theme = { name: ThemeName; palette: Palette; hero: string; onHero: string };
const make = (name: ThemeName): Theme => name === 'dark'
  ? { name, palette: darkPalette, hero: '#1d3a49', onHero: '#f4f7f7' }
  : { name, palette: lightPalette, hero: lightPalette.foreground, onHero: lightPalette.surface };
const Ctx = createContext<Theme>(make('light'));

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const ws = useWorkspace(); // context-scoped; disabled while signed out -> system fallback
  const pref = ws.data?.profile.theme;
  const name: ThemeName = pref === 'dark' || pref === 'light' ? pref : system === 'dark' ? 'dark' : 'light';
  const value = useMemo(() => make(name), [name]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAppTheme = () => useContext(Ctx);
export const useAppPalette = () => useContext(Ctx).palette;
/** Memoised dynamic stylesheet: `const st = useThemedStyles(makeStyles)`. */
export function useThemedStyles<S>(factory: (p: Palette, t: Theme) => S): S {
  const t = useContext(Ctx);
  return useMemo(() => factory(t.palette, t), [t, factory]);
}
