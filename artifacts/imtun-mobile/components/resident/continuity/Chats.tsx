import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createResidentDirectChat, getResidentDirectMessages, postResidentDirectMessage, updateResidentDirectChatState } from '@workspace/api-client-react';
import type { ResidentContinuity, ResidentDirectChat, ResidentDirectMessage } from '@workspace/api-client-react';
import { useAppPalette, type Palette } from '@/hooks/useAppTheme';
import type { Language } from '@/lib/resident/text';
import { newUuid, useContextId } from '@/lib/resident/hooks';
import { Btn, Card, Chip, Empty, ErrorBox, Field, Segment, Skeleton } from '../Ui';
import { useAction } from '../useAction';
import { contKey, fmt, tt } from './core';
function Conv({ chat, l, refresh }: { chat: ResidentDirectChat; l: Language; refresh: () => void }) { const palette = useAppPalette();
  const qc = useQueryClient(); const ctx = useContextId();
  const [older, setOlder] = useState<ResidentDirectMessage[]>([]); const [more, setMore] = useState<boolean | null>(null); const [text, setText] = useState('');
  const cid = useRef(newUuid()); const key = ['resident-dm', ctx, chat.id]; const a = useAction(l, refresh);
  const q = useQuery({ queryKey: key, queryFn: () => getResidentDirectMessages(chat.id) });
  const all = [...older, ...(q.data?.items ?? [])]; const hasMore = more ?? q.data?.hasMore ?? false;
  return <Card>
    <Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{chat.name}</Text>
    {chat.unread > 0 && <><Chip tone="warn" label={tt(l, `Չկարդացված՝ ${chat.unread}`, `Непрочитано: ${chat.unread}`, `Unread: ${chat.unread}`)} /><Btn kind="secondary" label={tt(l, 'Նշել կարդացված', 'Отметить прочитанным', 'Mark as read')} busy={a.busy} onPress={() => void a.run(() => updateResidentDirectChatState(chat.id, { action: 'read' }))} /></>}
    {(!chat.blocked || chat.blockedByMe) && <Btn kind="secondary" label={chat.blockedByMe ? tt(l, 'Ապաարգելափակել', 'Разблокировать', 'Unblock') : tt(l, 'Արգելափակել', 'Заблокировать', 'Block')} busy={a.busy} onPress={() => void a.run(() => updateResidentDirectChatState(chat.id, { action: chat.blockedByMe ? 'unblock' : 'block' }))} />}
    {q.isPending && <Skeleton />}{q.isError && <ErrorBox message={tt(l, 'Չհաջողվեց բեռնել։', 'Не удалось загрузить.', 'Could not load.')} retryLabel={tt(l, 'Կրկնել', 'Повторить', 'Retry')} onRetry={() => q.refetch()} />}
    {hasMore && <Btn kind="secondary" label={tt(l, 'Ավելի վաղ', 'Загрузить раньше', 'Load earlier')} busy={a.busy} onPress={() => void a.run(async () => { const f = all[0]; if (!f) return; const r = await getResidentDirectMessages(chat.id, { before: f.id }); setOlder([...r.items, ...older]); setMore(r.hasMore); })} />}
    {all.map(m => <View key={m.id} style={{ alignSelf: m.own ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: 10, borderRadius: 12, backgroundColor: m.own ? palette.accent : palette.muted }}><Text style={{ color: palette.foreground }}>{m.body}</Text><Text style={{ fontSize: 11, color: palette.mutedForeground }}>{fmt(l, m.createdAt)}</Text></View>)}
    {q.data && !all.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Հաղորդագրություններ դեռ չկան', 'Сообщений пока нет', 'No messages yet')}</Text>}
    {chat.blocked ? <Text style={{ color: palette.foreground }}>{chat.blockedByMe ? tt(l, 'Դուք արգելափակել եք այս հարևանին։', 'Вы заблокировали этого соседа.', 'You blocked this neighbor.') : tt(l, 'Զրույցը հասանելի չէ։', 'Чат недоступен.', 'This chat is unavailable.')}</Text> : <>
      <Field label={tt(l, 'Հաղորդագրություն', 'Сообщение', 'Message')} value={text} onChange={setText} multiline maxLength={2000} />
      <Btn label={tt(l, 'Ուղարկել', 'Отправить', 'Send')} busy={a.busy} disabled={!text.trim()} onPress={() => { const body = text.trim(); if (!body) return; void a.run(async () => { await postResidentDirectMessage(chat.id, { body, clientId: cid.current }); cid.current = newUuid(); setText(''); await qc.invalidateQueries({ queryKey: key }); }); }} /></>}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </Card>;
}
export default function Chats({ d, l }: { d: ResidentContinuity; l: Language }) { const palette = useAppPalette();
  const qc = useQueryClient(); const ctx = useContextId(); const [open, setOpen] = useState('');
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: contKey(ctx) }); });
  if (!d.canChat) return <Empty text={tt(l, 'Անձնական զրույցները միացված չեն։', 'Личные чаты не включены.', 'Private chats are not enabled.')} />;
  const cur = d.chats.find(c => c.id === open) ?? d.chats[0];
  return <>
    <Card><Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{tt(l, 'Սկսել զրույց հարևանի հետ', 'Начать чат с соседом', 'Chat with a neighbor')}</Text>
      {d.neighbors.map(n => <Btn key={n.id} kind="secondary" label={n.name} busy={a.busy} onPress={() => void a.run(async () => { const c = await createResidentDirectChat({ recipientId: n.id }); setOpen(c.id); })} />)}
      {!d.neighbors.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Ցուցակում հարևաններ դեռ չկան։', 'В справочнике пока нет соседей.', 'No neighbors have opted in yet.')}</Text>}{a.err ? <ErrorBox message={a.err} /> : null}</Card>
    {d.chats.length > 1 && <Segment label={tt(l, 'Զրույցներ', 'Чаты', 'Chats')} value={cur?.id ?? ''} options={d.chats.map(c => [c.id, c.unread ? `${c.name} (${c.unread})` : c.name] as [string, string])} onChange={setOpen} />}
    {cur ? <Conv key={cur.id} chat={cur} l={l} refresh={() => void qc.invalidateQueries({ queryKey: contKey(ctx) })} /> : <Empty text={tt(l, 'Զրույցներ դեռ չկան', 'Чатов пока нет', 'No chats yet')} />}
  </>;
}
