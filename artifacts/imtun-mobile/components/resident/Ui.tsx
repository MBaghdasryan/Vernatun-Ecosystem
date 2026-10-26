import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { palette } from '@/constants/colors';

export function Card({ children }: { children: React.ReactNode }) { return <View style={s.card}>{children}</View>; }
export function Btn({ label, onPress, kind = 'primary', busy, disabled, testID }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; testID?: string }) {
  const bg = kind === 'primary' ? palette.primary : palette.surface;
  return <Pressable accessibilityRole="button" testID={testID} disabled={busy || disabled} onPress={onPress} style={[s.btn, { backgroundColor: bg, borderColor: kind === 'danger' ? palette.dangerBorder : kind === 'secondary' ? palette.border : palette.primary, opacity: busy || disabled ? 0.6 : 1 }]}>
    {busy ? <ActivityIndicator color={palette.foreground} /> : <Text style={[s.btnText, kind === 'danger' && { color: palette.dangerText }]}>{label}</Text>}
  </Pressable>;
}
export function Chip({ label, tone = 'ok' }: { label: string; tone?: 'ok' | 'warn' }) {
  return <View style={[s.chip, { backgroundColor: tone === 'ok' ? palette.successSurface : '#fff0ba' }]}><Text style={[s.chipText, { color: tone === 'ok' ? palette.successStrong : '#694500' }]}>{label}</Text></View>;
}
export function Field({ label, value, onChange, multiline, keyboard, maxLength }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; keyboard?: KeyboardTypeOptions; maxLength?: number }) {
  return <View style={{ gap: 5 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} keyboardType={keyboard} maxLength={maxLength} placeholderTextColor={palette.placeholder} style={[s.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} /></View>;
}
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <View style={s.toggle}><Text style={[s.label, { flex: 1 }]}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ true: palette.primary, false: palette.border }} /></View>;
}
export function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <View style={{ gap: 5 }}><Text style={s.label}>{label}</Text><View style={s.seg}>{options.map(([k, t]) => <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: value === k }} onPress={() => onChange(k)} style={[s.segItem, value === k && { backgroundColor: palette.accent, borderColor: palette.selectedBorder }]}><Text style={s.segText}>{t}</Text></Pressable>)}</View></View>;
}
export function ErrorBox({ message, retryLabel, onRetry }: { message: string; retryLabel?: string; onRetry?: () => void }) {
  return <View style={s.err} accessibilityRole="alert"><Text style={s.errText}>{message}</Text>{onRetry && retryLabel ? <Pressable onPress={onRetry}><Text style={s.retry}>{retryLabel}</Text></Pressable> : null}</View>;
}
export function Skeleton() { return <View style={s.skel} />; }
export function Empty({ text }: { text: string }) { return <View style={[s.card, { alignItems: 'center' }]}><Text style={s.muted}>{text}</Text></View>; }
const s = StyleSheet.create({
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 15, padding: 18, gap: 10 },
  btn: { minHeight: 46, borderRadius: 11, borderWidth: 1, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: palette.foreground, fontWeight: '800', fontSize: 14 },
  chip: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }, chipText: { fontSize: 11, fontWeight: '700' },
  label: { color: palette.foreground, fontWeight: '700', fontSize: 12 },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', color: palette.foreground, fontSize: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, segItem: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', backgroundColor: '#fff' }, segText: { fontSize: 13, color: palette.foreground, fontWeight: '600' },
  err: { backgroundColor: palette.destructiveSurface, borderRadius: 10, padding: 12, gap: 6 }, errText: { color: palette.destructiveForeground, fontSize: 12 }, retry: { color: palette.accentForeground, fontWeight: '800', fontSize: 12 },
  skel: { height: 78, borderRadius: 14, backgroundColor: palette.skeleton }, muted: { color: palette.mutedForeground, fontSize: 13 },
});
