import * as ImagePicker from 'expo-image-picker';
import type { Language } from '@/lib/resident/text';
import { tt } from './core';
export type Picked = { blob: Blob; uri: string } | { error: string } | null;
const OK = ['image/jpeg', 'image/png', 'image/webp'];
export async function pickImage(l: Language, maxBytes: number, square: boolean): Promise<Picked> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { error: tt(l, 'Մուտքը դեպի լուսանկարներ թույլատրված չէ։ Միացրեք կարգավորումներում։', 'Нет доступа к фото. Разрешите его в настройках.', 'Photo access is not allowed. Enable it in settings.') };
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: square, aspect: square ? [1, 1] : undefined, quality: 0.8, exif: false });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  if (a.mimeType && !OK.includes(a.mimeType)) return { error: tt(l, 'Թույլատրվում են JPEG, PNG, WebP։', 'Допустимы JPEG, PNG, WebP.', 'Only JPEG, PNG or WebP are allowed.') };
  const blob = await (await fetch(a.uri)).blob();
  if (blob.size > maxBytes) return { error: tt(l, 'Ֆայլը շատ մեծ է։', 'Файл слишком большой.', 'The file is too large.') };
  return { blob, uri: a.uri };
}
