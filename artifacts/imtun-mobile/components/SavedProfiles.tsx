import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppPalette } from '@/hooks/useAppTheme';
import { getSavedProfiles, removeSavedProfile, type SavedProfile } from '@/lib/savedProfiles';

export default function SavedProfiles({ onSelect, language = 'hy' }: { onSelect: (email: string) => void; language?: string }) {
  const c = useAppPalette(); const [rows, setRows] = useState<SavedProfile[]>([]); const [error, setError] = useState(false);
  const t = (hy: string, ru: string, en: string) => language === 'ru' ? ru : language === 'en' ? en : hy;
  useEffect(() => { getSavedProfiles().then(setRows).catch(() => setError(true)); }, []);
  async function forget(email: string) {
    try { await removeSavedProfile(email); setRows(await getSavedProfiles()); setError(false); }
    catch { setError(true); }
  }
  if (!rows.length && !error) return null;
  return <View style={{ marginBottom: 18, gap: 8 }}>
    <Text style={{ color: c.foreground, fontWeight: '700' }}>{t('Պահված հաշիվներ', 'Сохранённые аккаунты', 'Saved accounts')}</Text>
    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{t('Միայն հաշվի հուշում։ Մուտքի համար պետք է գաղտնաբառ։', 'Сохранено только имя аккаунта. Для входа нужен пароль.', 'Account hints only. Your password is still required.')}</Text>
    {rows.map(p => <View key={p.email} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t(`Ընտրել ${p.email}`, `Выбрать ${p.email}`, `Choose ${p.email}`)} onPress={() => onSelect(p.email)} style={{ padding: 12, minHeight: 48, flex: 1 }}>
        {!!p.name && <Text style={{ color: c.foreground, fontWeight: '600' }}>{p.name}</Text>}
        <Text style={{ color: c.mutedForeground }}>{p.email}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Հեռացնել պահված հաշիվը', 'Удалить сохранённый аккаунт', 'Remove saved account')} onPress={() => void forget(p.email)} style={{ width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Feather name="x" size={18} color={c.mutedForeground} /></Pressable>
    </View>)}
    {error && <Text accessibilityRole="alert" style={{ color: c.destructive }}>{t('Չհաջողվեց կարդալ կամ պահպանել հաշիվները։', 'Не удалось прочитать или сохранить аккаунты.', 'Could not read or save account hints.')}</Text>}
  </View>;
}
