import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';

export function Card({ children }: { children: React.ReactNode }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]); return <View style={s.card}>{children}</View>; }
export function Btn({ label, onPress, kind = 'primary', busy, disabled, testID }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; testID?: string }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]);
  const bg = kind === 'primary' ? palette.primary : palette.surface;
  return <Pressable accessibilityRole="button" testID={testID} disabled={busy || disabled} onPress={onPress} style={[s.btn, { backgroundColor: bg, borderColor: kind === 'danger' ? palette.dangerBorder : kind === 'secondary' ? palette.border : palette.primary, opacity: busy || disabled ? 0.6 : 1 }]}>
    {busy ? <ActivityIndicator color={palette.foreground} /> : <Text style={[s.btnText, kind === 'danger' && { color: palette.dangerText }]}>{label}</Text>}
  </Pressable>;
}
export function Chip({ label, tone = 'ok' }: { label: string; tone?: 'ok' | 'warn' }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]);
  return <View style={[s.chip, { backgroundColor: tone === 'ok' ? palette.successSurface : palette.accent }]}><Text style={[s.chipText, { color: tone === 'ok' ? palette.successStrong : palette.warningText }]}>{label}</Text></View>;
}
export function Field({ label, value, onChange, multiline, keyboard, maxLength, testID }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; keyboard?: KeyboardTypeOptions; maxLength?: number; testID?: string }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]);
  return <View style={{ gap: 5 }}><Text style={s.label}>{label}</Text><TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} keyboardType={keyboard} maxLength={maxLength} placeholderTextColor={palette.placeholder} style={[s.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} /></View>;
}
export function Toggle({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]);
  return <View style={s.toggle}><Text style={[s.label, { flex: 1 }]}>{label}</Text><Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: palette.primary, false: palette.border }} /></View>;
}
export function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]);
  return <View style={{ gap: 5 }}><Text style={s.label}>{label}</Text><View style={s.seg}>{options.map(([k, t]) => <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: value === k }} onPress={() => onChange(k)} style={[s.segItem, value === k && { backgroundColor: palette.accent, borderColor: palette.selectedBorder }]}><Text style={s.segText}>{t}</Text></Pressable>)}</View></View>;
}
export function ErrorBox({ message, retryLabel, onRetry }: { message: string; retryLabel?: string; onRetry?: () => void }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]);
  return <View style={s.err} accessibilityRole="alert"><Text style={s.errText}>{message}</Text>{onRetry && retryLabel ? <Pressable onPress={onRetry}><Text style={s.retry}>{retryLabel}</Text></Pressable> : null}</View>;
}
export function Skeleton() { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]); return <View style={s.skel} />; }
export function Empty({ text }: { text: string }) { const palette = useAppPalette(); const s = React.useMemo(() => make_s(palette), [palette]); return <View style={[s.card, { alignItems: 'center' }]}><Text style={s.muted}>{text}</Text></View>; }
const make_s = (palette: Palette) => StyleSheet.create({
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 15, padding: 18, gap: 10 },
  btn: { minHeight: 46, borderRadius: 11, borderWidth: 1, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: palette.foreground, fontWeight: '800', fontSize: 14 },
  chip: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }, chipText: { fontSize: 11, fontWeight: '700' },
  label: { color: palette.foreground, fontWeight: '700', fontSize: 12 },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: palette.surface, color: palette.foreground, fontSize: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, segItem: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', backgroundColor: palette.surface }, segText: { fontSize: 13, color: palette.foreground, fontWeight: '600' },
  err: { backgroundColor: palette.destructiveSurface, borderRadius: 10, padding: 12, gap: 6 }, errText: { color: palette.destructiveForeground, fontSize: 12 }, retry: { color: palette.accentForeground, fontWeight: '800', fontSize: 12 },
  skel: { height: 78, borderRadius: 14, backgroundColor: palette.skeleton }, muted: { color: palette.mutedForeground, fontSize: 13 },
});

/* ---- ImTun shared shell primitives (reference-aligned) ---- */
import { Feather as _F } from '@expo/vector-icons';
type Icon = keyof typeof _F.glyphMap;
export function SectionHead({ title, action, onAction, testID }: { title: string; action?: string; onAction?: () => void; testID?: string }) { const palette = useAppPalette(); const u = React.useMemo(() => make_u(palette), [palette]);
  return <View style={u.sh}><Text style={u.shT} accessibilityRole="header">{title}</Text>{action && onAction ? <Pressable accessibilityRole="button" testID={testID} onPress={onAction} hitSlop={10} style={u.shA}><Text style={u.shAT}>{action}</Text><_F name="chevron-right" size={14} color={palette.accentForeground} /></Pressable> : null}</View>;
}
export function Row({ icon, title, subtitle, onPress, tone = 'accent', right, testID, label }: { icon: Icon; title: string; subtitle?: string; onPress?: () => void; tone?: 'accent' | 'plain' | 'ok' | 'danger'; right?: React.ReactNode; testID?: string; label?: string }) { const palette = useAppPalette(); const u = React.useMemo(() => make_u(palette), [palette]);
  const bg = tone === 'accent' ? palette.accent : tone === 'ok' ? palette.successSurface : tone === 'danger' ? palette.destructiveSurface : palette.alternateSurface;
  const fg = tone === 'accent' ? palette.primary : tone === 'ok' ? palette.successStrong : tone === 'danger' ? palette.destructive : palette.foreground;
  const body = <><View style={[u.ri, { backgroundColor: bg }]}><_F name={icon} size={18} color={fg} /></View><View style={{ flex: 1 }}><Text style={u.rT} numberOfLines={2}>{title}</Text>{subtitle ? <Text style={u.rS} numberOfLines={2}>{subtitle}</Text> : null}</View>{right ?? (onPress ? <_F name="chevron-right" size={18} color={palette.subdued} /> : null)}</>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} testID={testID} onPress={onPress} style={({ pressed }) => [u.row, pressed && u.pressed]}>{body}</Pressable> : <View style={u.row}>{body}</View>;
}
export function Tile({ icon, label, onPress, testID }: { icon: Icon; label: string; onPress: () => void; testID?: string }) { const palette = useAppPalette(); const u = React.useMemo(() => make_u(palette), [palette]);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ pressed }) => [u.tile, pressed && u.pressed]}><View style={u.tileI}><_F name={icon} size={20} color={palette.primary} /></View><Text style={u.tileT} numberOfLines={2}>{label}</Text></Pressable>;
}
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string, number?][]; onChange: (v: T) => void }) { const palette = useAppPalette(); const u = React.useMemo(() => make_u(palette), [palette]);
  return <View style={u.tabs} accessibilityRole="tablist">{options.map(([k, t, n]) => { const on = k === value; return <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={'tab-' + k} onPress={() => onChange(k)} style={[u.tab, on && u.tabOn]}><Text style={[u.tabT, on && u.tabTOn]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{t}{n ? ` ${n}` : ''}</Text></Pressable>; })}</View>;
}
export function EmptyState({ icon = 'inbox', title, text }: { icon?: Icon; title: string; text?: string }) { const palette = useAppPalette(); const u = React.useMemo(() => make_u(palette), [palette]);
  return <View style={u.empty}><_F name={icon} size={24} color={palette.subdued} /><Text style={u.eT}>{title}</Text>{text ? <Text style={u.eS}>{text}</Text> : null}</View>;
}
const make_u = (palette: Palette) => StyleSheet.create({
  sh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }, shT: { fontSize: 17, fontWeight: '800', color: palette.foreground, letterSpacing: -0.3 }, shA: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 2 }, shAT: { fontSize: 13, fontWeight: '700', color: palette.accentForeground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, padding: 12, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  ri: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, rT: { fontSize: 14, fontWeight: '700', color: palette.foreground }, rS: { fontSize: 12, color: palette.mutedForeground, marginTop: 3, lineHeight: 16 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  tile: { flexBasis: '22%', minWidth: 72, flexGrow: 1, minHeight: 88, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  tileI: { width: 42, height: 42, borderRadius: 13, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' }, tileT: { fontSize: 11, fontWeight: '700', color: palette.foreground, textAlign: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: palette.secondary, borderRadius: 12, padding: 3, gap: 3 }, tab: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, tabOn: { backgroundColor: palette.foreground }, tabT: { fontSize: 12, fontWeight: '700', color: palette.mutedForeground, textAlign: 'center' }, tabTOn: { color: palette.surface },
  empty: { alignItems: 'center', gap: 6, padding: 22, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, eT: { fontSize: 14, fontWeight: '700', color: palette.foreground, textAlign: 'center' }, eS: { fontSize: 12, color: palette.mutedForeground, textAlign: 'center', lineHeight: 17 },
});
