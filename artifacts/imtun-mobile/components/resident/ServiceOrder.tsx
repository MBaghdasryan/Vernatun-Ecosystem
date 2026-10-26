import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import type { ResidentRecord } from '@workspace/api-client-react';
import { L, S, type Language } from '@/lib/resident/text';
import { Btn, Card } from './Ui';
import RecordForm from './RecordForm';
// Ordering is a local form that creates a subscriptions record linked by parentId; it is not an /actions call.
export default function ServiceOrder({ service, l, after }: { service: ResidentRecord; l: Language; after: () => void }) {
  const [open, setOpen] = useState(false);
  return open ? <Card><RecordForm kind="subscriptions" l={l} parent={service} after={after} onDone={() => setOpen(false)} submitLabel={S.order} /></Card> : <Btn kind="secondary" label={L(l, S.order)} onPress={() => setOpen(true)} />;
}
