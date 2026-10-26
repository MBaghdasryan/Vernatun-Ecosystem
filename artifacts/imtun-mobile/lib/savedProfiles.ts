import AsyncStorage from '@react-native-async-storage/async-storage';

// Public account hints only. This storage must never contain credentials,
// session cookies, CSRF tokens, property data or a "logged in" assertion.
const KEY = 'imtun.account-hints.v1';
export type SavedProfile = { email: string; name: string };
export function normalizeSavedProfiles(value: unknown): SavedProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const input = row as Record<string, unknown>;
    if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.length > 254) return [];
    const email = input.email.trim().toLowerCase();
    if (seen.has(email)) return [];
    seen.add(email);
    return [{ email, name: typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '' }];
  }).slice(0, 5);
}
export async function getSavedProfiles(): Promise<SavedProfile[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  // Corrupt storage is not an authenticated profile.
  try { return normalizeSavedProfiles(JSON.parse(raw)); } catch { return []; }
}
export async function rememberSavedProfile(profile: SavedProfile): Promise<void> {
  const clean = normalizeSavedProfiles([profile]);
  if (!clean.length) throw new Error('INVALID_ACCOUNT_HINT');
  const existing = await getSavedProfiles();
  await AsyncStorage.setItem(KEY, JSON.stringify(normalizeSavedProfiles([...clean, ...existing])));
}
export async function removeSavedProfile(email: string): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify((await getSavedProfiles()).filter(p => p.email !== email.trim().toLowerCase())));
}
