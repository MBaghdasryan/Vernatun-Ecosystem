import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, DoorOpen, Lock, LoaderCircle, ShieldAlert } from 'lucide-react';
import { DEVICE_ACTION_REGISTRY } from '@workspace/api-zod';
import { request } from '../client';
import type { Language } from '../i18n';
import type { RoleContext } from '../types';
import type { Row } from './ui';

type Command = { command_id?: string; commandId?: string; status: string; error_code?: string; errorCode?: string };
type Props = { context: RoleContext; language: Language; node: Row; device: Row; state: string };
const COPY = {
  hy: { open: 'Բացել', close: 'Փակել', lock: 'Կողպել', unlock: 'Բացել կողպեքը', send: 'Ուղարկվում է…', confirm: 'Փակե՞լ սարքը', cancel: 'Չեղարկել', yes: 'Հաստատել', offline: 'Edge-ը կամ սարքը հասանելի չէ. հրամանը չի ուղարկվի։', adapter: 'Սարքի ադապտերը հաստատված չէ', safety: 'Անվտանգության կառավարումն արգելափակված է', sent: 'Հրամանի վիճակ', success: 'Կատարված է', failed: 'Չհաջողվեց', unknown: 'Վիճակը հայտնի չէ' },
  ru: { open: 'Открыть', close: 'Закрыть', lock: 'Заблокировать', unlock: 'Разблокировать', send: 'Отправка…', confirm: 'Закрыть устройство?', cancel: 'Отмена', yes: 'Подтвердить', offline: 'Edge или устройство недоступны. Команда не будет отправлена.', adapter: 'Адаптер устройства не подтверждён', safety: 'Управление безопасностью заблокировано', sent: 'Статус команды', success: 'Выполнено', failed: 'Не выполнено', unknown: 'Состояние неизвестно' },
  en: { open: 'Open', close: 'Close', lock: 'Lock', unlock: 'Unlock', send: 'Sending…', confirm: 'Close device?', cancel: 'Cancel', yes: 'Confirm', offline: 'Edge or device is unavailable. The command will not be sent.', adapter: 'Device adapter is not verified', safety: 'Safety control is blocked', sent: 'Command status', success: 'Completed', failed: 'Failed', unknown: 'State unknown' },
} as const;
const pending = (status: string) => ['REQUESTED', 'AUTHORIZED', 'QUEUED', 'DELIVERED', 'ACKNOWLEDGED'].includes(status.toUpperCase());
const shape = (value: Command): Command => ({ ...value, commandId: value.commandId ?? value.command_id });

export default function DeviceActions({ context, language, node, device, state }: Props) {
  const t = COPY[language] ?? COPY.en;
  const [command, setCommand] = useState<Command>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState('');
  const [error, setError] = useState('');
  const profile = DEVICE_ACTION_REGISTRY.find(item => item.profile === device.profile);
  const supported = Array.isArray(device.capabilities) ? device.capabilities as string[] : [];
  const enabled = Array.isArray(device.enabled_capabilities) ? device.enabled_capabilities as string[] : [];
  const isOnline = device.reported_online === true && node.status === 'ONLINE' && node.web_socket_open === true;
  const active = !!command && pending(command.status);

  useEffect(() => {
    if (!command?.commandId || !pending(command.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = shape(await request<Command>(`/me/edge-commands/${encodeURIComponent(command.commandId!)}`));
        if (cancelled) return;
        setCommand(next);
        if (pending(next.status)) timer = setTimeout(poll, 1500);
      } catch {
        if (!cancelled) setError(t.failed);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [command?.commandId, command?.status, t.failed]);

  if (!profile) return null;
  if (profile.hardDenied.length) return <small className="em-status-reasons"><ShieldAlert size={14} /> {t.safety}</small>;
  const eligible = profile.actions.filter(action =>
    action.adapterVerified && supported.includes(action.capability) && enabled.includes(action.capability) &&
    context.permissions.includes(action.permission)
  );
  if (!eligible.length) {
    return profile.actions.length ? <small className="em-status-reasons"><AlertCircle size={14} /> {t.adapter}</small> : null;
  }

  const send = async (capability: string) => {
    if (busy || active || !isOnline) return;
    setBusy(true); setError('');
    try {
      const result = shape(await request<Command>(
        `/buildings/${encodeURIComponent(String(device.building_id))}/devices/${encodeURIComponent(String(device.id))}/commands`,
        'POST',
        { capability, reason: 'manual_control', idempotencyKey: crypto.randomUUID() },
      ));
      setCommand(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failed);
    } finally {
      setBusy(false); setConfirming('');
    }
  };

  const label = (capability: string) => capability.endsWith('.OPEN') ? t.open : capability.endsWith('.CLOSE') ? t.close : capability.endsWith('.LOCK') ? t.lock : capability.endsWith('.UNLOCK') ? t.unlock : capability;
  const blockForState = (capability: string) => profile.actions.find(x => x.capability === capability)?.blocksWhenState?.includes(state);

  return <div className="em-form" data-testid={`device-actions-${device.id}`}>
    {!isOnline && <small className="em-status-reasons" role="status">{t.offline}</small>}
    {state && <small>{state}</small>}
    <div className="em-actions">
      {eligible.map(action => {
        const isOpen = action.capability.endsWith('.OPEN');
        const blocked = !isOnline || !!blockForState(action.capability) || active || busy;
        return <button key={action.capability} type="button" className={`em-btn ${isOpen ? 'pri' : ''}`}
          disabled={blocked} aria-label={`${label(action.capability)}: ${device.label || device.name}`}
          data-testid={`device-action-${action.capability.toLowerCase().replaceAll('.', '-')}-${device.id}`}
          onClick={() => action.confirmation ? setConfirming(action.capability) : void send(action.capability)}>
          {(busy || active) ? <LoaderCircle size={15} /> : isOpen ? <DoorOpen size={15} /> : <Lock size={15} />}
          {busy || active ? t.send : label(action.capability)}
        </button>;
      })}
    </div>
    {confirming && <div role="group" aria-label={t.confirm} className="em-actions">
      <span>{t.confirm} · {device.label || device.name}</span>
      <button type="button" className="em-btn" onClick={() => setConfirming('')}>{t.cancel}</button>
      <button type="button" className="em-btn bad" disabled={busy || !isOnline} onClick={() => void send(confirming)}>{t.yes}</button>
    </div>}
    {command && <small role="status" className={command.status === 'SUCCESS' ? 'em-alert ok' : command.status === 'FAILED' || command.status === 'DENIED' ? 'em-alert bad' : 'em-alert info'}>
      {command.status === 'SUCCESS' ? <CheckCircle2 size={14} /> : <span>{t.sent}: {command.status}</span>}
      {command.status === 'SUCCESS' && t.success}
      {command.error_code && ` · ${command.error_code}`}
    </small>}
    {error && <small className="em-alert bad" role="alert">{error}</small>}
  </div>;
}
