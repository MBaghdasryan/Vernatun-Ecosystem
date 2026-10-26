import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { createResidentAiHistory, createResidentPlatformTicket, deleteResidentAiHistory } from '@workspace/api-client-react';
import type { ResidentContinuity } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { newUuid, useContextId } from '@/lib/resident/hooks';
import { useRouter } from 'expo-router';
import { Btn, Card, Chip, ErrorBox, Field } from '../Ui';
import { useAction } from '../useAction';
import { contKey, fmt, tt } from './core';
const ts = (l: Language, v: string) => { const k = v.toLowerCase(); return k === 'open' || k === 'new' ? tt(l, 'Բաց', 'Открыто', 'Open') : k === 'resolved' || k === 'closed' ? tt(l, 'Փակված', 'Закрыто', 'Closed') : k === 'waiting' || k === 'pending' ? tt(l, 'Սպասում է', 'Ожидает', 'Waiting') : tt(l, 'Մշակվում է', 'В работе', 'In progress'); };
export default function Help({ d, l }: { d: ResidentContinuity; l: Language }) {
  const router = useRouter(); const qc = useQueryClient(); const ctx = useContextId(); const after = () => { void qc.invalidateQueries({ queryKey: contKey(ctx) }); };
  const a = useAction(l, after); const b = useAction(l, after);
  const [sub, setSub] = useState(''); const [body, setBody] = useState(''); const [qt, setQt] = useState(''); const [qb, setQb] = useState(''); const cid = useRef(newUuid());
  return <>
    <Card><Text style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Պլատֆորմի աջակցություն', 'Поддержка платформы', 'Platform support')}</Text>
      <Field label={tt(l, 'Թեմա', 'Тема', 'Subject')} value={sub} onChange={setSub} maxLength={160} /><Field label={tt(l, 'Նկարագրություն', 'Описание', 'Details')} value={body} onChange={setBody} multiline maxLength={4000} />
      <Btn label={tt(l, 'Ստեղծել դիմում', 'Создать обращение', 'Create ticket')} busy={a.busy} disabled={!sub.trim() || !body.trim()} onPress={() => void a.run(async () => { await createResidentPlatformTicket({ subject: sub.trim(), body: body.trim() }); setSub(''); setBody(''); })} />{a.err ? <ErrorBox message={a.err} /> : null}</Card>
    {d.tickets.map(t => <Card key={t.id}><Text style={{ fontWeight: '800' }}>{t.subject}</Text><Chip label={ts(l, t.status)} tone="warn" /><Text>{t.body}</Text><Text>{t.reply ? `${tt(l, 'Պատասխան', 'Ответ', 'Reply')}: ${t.reply}` : tt(l, 'Պատասխան դեռ չկա', 'Ответа пока нет', 'No reply yet')}</Text><Text style={{ fontSize: 11 }}>{fmt(l, t.createdAt)}</Text></Card>)}
    <Card><Text style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'AI հարցերի պատմություն', 'История вопросов к ИИ', 'AI question history')}</Text>
      <Text accessibilityRole="alert">{tt(l, 'AI մատակարարը կարգավորված չէ (NOT_CONFIGURED). հարցերը միայն պահվում են, պատասխան չի ստեղծվում։', 'ИИ-провайдер не настроен (NOT_CONFIGURED): вопросы только сохраняются, ответов нет.', 'The AI provider is NOT_CONFIGURED: questions are only saved, no answer is generated.')}</Text>
      <Field label={tt(l, 'Վերնագիր', 'Заголовок', 'Title')} value={qt} onChange={setQt} maxLength={160} /><Field label={tt(l, 'Հարց', 'Вопрос', 'Question')} value={qb} onChange={setQb} multiline maxLength={4000} />
      <Btn label={tt(l, 'Պահել հարցը', 'Сохранить вопрос', 'Save question')} busy={b.busy} disabled={!qt.trim() || !qb.trim()} onPress={() => void b.run(async () => { await createResidentAiHistory({ title: qt.trim(), body: qb.trim(), clientId: cid.current }); cid.current = newUuid(); setQt(''); setQb(''); })} />{b.err ? <ErrorBox message={b.err} /> : null}
      {d.aiHistory.map(h => <View key={h.id} style={{ gap: 4 }}><Text style={{ fontWeight: '700' }}>{h.title}</Text><Text>{h.body}</Text><Text style={{ fontSize: 11 }}>{fmt(l, h.createdAt)} · {h.providerStatus === 'NOT_CONFIGURED' ? tt(l, 'AI-ն կարգավորված չէ', 'ИИ не настроен', 'AI not configured') : tt(l, 'Անհասանելի', 'Недоступно', 'Unavailable')}</Text><Btn kind="danger" label={tt(l, 'Ջնջել', 'Удалить', 'Delete')} busy={b.busy} onPress={() => void b.run(() => deleteResidentAiHistory(h.id))} /></View>)}</Card>
    <Card><Text>{tt(l, 'Լուսանկարից հայտ․ ստեղծեք հայտը ձեր վերնագրով և նկարագրությամբ, ապա կցեք լուսանկարը ձեռքով։ Ավտոմատ ճանաչում չկա։', 'Фото в заявку: создайте заявку со своим заголовком и описанием и приложите фото вручную. Автоматического распознавания нет.', 'Photo to request: create the request with your own title and description, then attach the photo manually. There is no automatic image recognition.')}</Text><Btn kind="secondary" label={tt(l, 'Բացել հայտերը', 'Открыть заявки', 'Open requests')} onPress={() => router.push('/requests')} /></Card>
  </>;
}
