import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';

export type LocalLock = { version: 1; salt: string; digest: string; biometric: boolean; failures: number; retryAt: number };
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
function key(userId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) throw new Error('INVALID_USER');
  return `imtun.local-lock.v1.${userId}`;
}
export async function localLockAvailable(): Promise<boolean> {
  return Platform.OS !== 'web' && await SecureStore.isAvailableAsync();
}
export async function biometricAvailable(): Promise<boolean> {
  return await localLockAvailable() && await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
}
export async function readLocalLock(userId: string): Promise<LocalLock | null> {
  if (!await localLockAvailable()) return null;
  const raw = await SecureStore.getItemAsync(key(userId), options);
  if (!raw) return null;
  const value = JSON.parse(raw) as LocalLock;
  if (value.version !== 1 || !/^[0-9a-f]{64}$/.test(value.salt) || !/^[0-9a-f]{64}$/.test(value.digest) ||
    typeof value.biometric !== 'boolean' || !Number.isInteger(value.failures) || value.failures < 0 || !Number.isFinite(value.retryAt) || value.retryAt < 0) throw new Error('LOCAL_LOCK_UNREADABLE');
  return value;
}
async function write(userId: string, value: LocalLock): Promise<void> {
  await SecureStore.setItemAsync(key(userId), JSON.stringify(value), options);
}
async function digestPin(pin: string, salt: string): Promise<string> {
  // Encrypted device-only keychain storage plus persistent application throttling.
  // This protects the local screen, not backend login or MFA.
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `ImTun-local-lock-v1:${salt}:${pin}`);
}
function sameDigest(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  for (let n = 0; n < a.length; n++) mismatch |= a.charCodeAt(n) ^ (b.charCodeAt(n) || 0);
  return mismatch === 0;
}
export async function enrollLocalPin(userId: string, pin: string, biometric: boolean): Promise<void> {
  if (!await localLockAvailable()) throw new Error('LOCAL_LOCK_UNAVAILABLE');
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN_SIX_DIGITS');
  // Callers must disable an existing lock using its PIN before replacing it.
  if (await readLocalLock(userId)) throw new Error('LOCAL_LOCK_ALREADY_ENABLED');
  if (biometric && !await biometricAvailable()) throw new Error('BIOMETRIC_UNAVAILABLE');
  const salt = Array.from(await Crypto.getRandomBytesAsync(32)).map(b => b.toString(16).padStart(2, '0')).join('');
  await write(userId, { version: 1, salt, digest: await digestPin(pin, salt), biometric, failures: 0, retryAt: 0 });
}
export async function verifyLocalPin(userId: string, pin: string): Promise<boolean> {
  const value = await readLocalLock(userId);
  if (!value) return false;
  if (value.retryAt > Date.now()) throw new Error('PIN_RATE_LIMITED');
  if (!sameDigest(await digestPin(pin, value.salt), value.digest)) {
    value.failures += 1;
    if (value.failures >= 5) value.retryAt = Date.now() + Math.min(900_000, 60_000 * 2 ** Math.min(4, value.failures - 5));
    await write(userId, value); return false;
  }
  await write(userId, { ...value, failures: 0, retryAt: 0 }); return true;
}
export async function verifyLocalBiometric(userId: string, promptMessage: string): Promise<boolean> {
  const value = await readLocalLock(userId);
  if (!value?.biometric || !await biometricAvailable()) return false;
  // Device passcode fallback is deliberately not an alternate app-PIN bypass.
  const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: true, biometricsSecurityLevel: 'strong' });
  return result.success;
}
export async function disableLocalLock(userId: string, pin: string): Promise<void> {
  if (!await verifyLocalPin(userId, pin)) throw new Error('PIN_INCORRECT');
  await SecureStore.deleteItemAsync(key(userId), options);
}
