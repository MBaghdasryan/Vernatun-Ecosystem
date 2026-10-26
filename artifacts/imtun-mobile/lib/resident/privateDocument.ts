import { downloadResidentDocument } from '@workspace/api-client-react';

export interface PrivateDocument {
  id: string;
  title: string;
  media_type: string;
}

// Platform-specific implementations keep native filesystem modules out of web.
export function clearPrivateDocumentCache(): void {}

export async function openPrivateDocument(doc: PrivateDocument, signal?: AbortSignal): Promise<void> {
  const blob = await downloadResidentDocument(doc.id, { signal });
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  try {
    const el = document.createElement('a');
    el.href = url;
    el.download = doc.title;
    el.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
