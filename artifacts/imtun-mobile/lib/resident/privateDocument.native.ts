import { downloadResidentDocument } from '@workspace/api-client-react';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { PrivateDocument } from './privateDocument';

const root = () => new Directory(Paths.cache, 'imtun-private-documents');

export function clearPrivateDocumentCache(): void {
  const directory = root();
  if (directory.exists) directory.delete();
}

function base64(blob: Blob): Promise<string> {
  // React Native Blob.arrayBuffer is not available on every supported runtime.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Document could not be read'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string' || !result.includes(';base64,')) {
        reject(new Error('Invalid document data'));
        return;
      }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export async function openPrivateDocument(doc: PrivateDocument, signal?: AbortSignal): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error('System file sharing is unavailable');
  // Authorization is rechecked by the existing API for every download. No
  // signed/public URLs, token query parameters, or separate filesystem fetch.
  const blob = await downloadResidentDocument(doc.id, { signal });
  const bytes = await base64(blob);
  signal?.throwIfAborted();
  const directory = new Directory(root(), `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  directory.create({ intermediates: true });
  // Use only server-approved MIME types, never a title as a filesystem path.
  const mediaType = blob.type.split(';')[0].toLowerCase();
  const extension: Record<string, string> = {
    'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'text/plain': 'txt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  const file = new File(directory, `document.${extension[mediaType] ?? 'bin'}`);
  let shared = false;
  try {
    file.write(bytes, { encoding: 'base64' });
    signal?.throwIfAborted();
    // Explicit user action exports a temporary local file through the OS.
    await Sharing.shareAsync(file.uri, { mimeType: mediaType || 'application/octet-stream', dialogTitle: doc.title });
    shared = true;
  } finally {
    // Android's chooser can resolve before the receiving app reads its content
    // URI. Keep that sandboxed cache file until the next cold start rather than
    // handing the receiver a deleted file. Errors and iOS completion clean up now.
    if ((!shared || Platform.OS !== 'android') && directory.exists) directory.delete();
  }
}
