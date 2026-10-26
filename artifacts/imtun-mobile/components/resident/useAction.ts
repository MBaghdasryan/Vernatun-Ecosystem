import { useState } from 'react';
import { safeError, type Language } from '@/lib/resident/text';
export function useAction(l: Language, after: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(safeError(l, e)); } finally { setBusy(false); after(); }
  };
  return { busy, err, run };
}
