import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, DoorOpen, Lock, LoaderCircle, ShieldAlert } from 'lucide-react';
import { request } from '../client';
import type { Language } from '../i18n';
import type { RoleContext } from '../types';
import type { Row } from './ui';

type Command = { command_id?: string; commandId?: string; status: string; error_code?: string; errorCode?: string };
type AvailableAction = { capability: string; enabled: boolean; reason: string | null; confirmation: boolean; adapterVerified: boolean };
type Availability = { online: boolean; state: string | null; actions: AvailableAction[]; safetyLocked: string[] };
type Props = { context: RoleContext; language: Language; node: Row; device: Row };
const COPY = {
  hy: { open: 'Բացել', close: 'Փակել', lock: 'Կողպել', unlock: 'Բացել կողպեքը', send: 'Ուղարկվում է…', confirm: 'Փակե՞լ սարքը', cancel: 'Չեղարկել', yes: 'Հաստատել', offline: 'Edge-ը կամ սարքը հասանելի չէ. հրամանը չի ուղարկվի։', adapter: 'Սարքի ադապտերը հաստատված չէ', safety: 'Անվտանգության կառավարումն արգելափակված է', sent: 'Հրամանի վիճակ', success: 'Կատարված է', failed: 'Չհաջողվեց', unknown: 'Վիճակը հայտնի չէ' },
  ru: { open: 'Открыть', close: 'Закрыть', lock: 'Заблокировать', unlock: 'Разблокировать', send: 'Отправка…', confirm: 'Закрыть устройство?', cancel: 'Отмена', yes: 'Подтвердить', offline: 'Edge или устройство недоступны. Команда не будет отправлена.', adapter: 'Адаптер устройства не подтверждён', safety: 'Управление безопасностью заблокировано', sent: 'Статус команды', success: 'Выполнено', failed: 'Не выполнено', unknown: 'Состояние неизвестно' },
  en: { open: 'Open', close: 'Close', lock: 'Lock', unlock: 'Unlock', send: 'Sending…', confirm: 'Close device?', cancel: 'Cancel', yes: 'Confirm', offline: 'Edge or device is unavailable. The command will not be sent.', adapter: 'Device adapter is not verified', safety: 'Safety control is blocked', sent: 'Command status', success: 'Completed', failed: 'Failed', unknown: 'State unknown' },
} as const;
const pending = (status: string) => ['REQUESTED', 'AUTHORIZED', 'QUEUED', 'DELIVERED', 'ACKNOWLEDGED'].includes(status.toUpperCase());
const shape = (value: Command): Command => ({ ...value, commandId: value.commandId ?? value.command_id });

export default function DeviceActions({ context, language, node, device }: Props) {
  const t = COPY[language] ?? COPY.en;
  const [command, setCommand] = useState<Command>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState('');
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<Availability>();
  const keys = useRef<Record<string, string>>({});
  const sending = useRef(false);
  const path = `/buildings/${encodeURIComponent(String(device.building_id))}/devices/${encodeURIComponent(String(device.id))}`;
  const refresh = useCallback(async () => {
    try { setAvailability(await request<Availability>(`${path}/actions`)); }
    catch { setAvailability(undefined); }
  }, [path, context.id]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const data = await request<Availability>(`${path}/actions`); if (live) setAvailability(data); }
      catch { if (live) setAvailability(undefined); }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => { live = false; clearInterval(timer); };
  }, [path, context.id, node.status]);
  useEffect(() => { setCommand(undefined); setError(''); setConfirming(''); keys.current = {}; }, [context.id, device.id]);
  const isOnline = availability?.online === true;
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
        else { keys.current = {}; void refresh(); }
      } catch {
        if (!cancelled) { setError(t.failed); timer = setTimeout(poll, 2500); }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [command?.commandId, command?.status, t.failed, refresh]);

  if (!availability) return <small className="em-status-reasons">{t.unknown}</small>;
  if (availability.safetyLocked.length) return <small className="em-status-reasons"><ShieldAlert size={14} /> {t.safety}</small>;
  const eligible = availability.actions.filter(action => action.adapterVerified);
  if (!eligible.length) {
    return availability.actions.length ? <small className="em-status-reasons"><AlertCircle size={14} /> {t.adapter}</small> : null;
  }

  const send = async (capability: string) => {
    if (sending.current || busy || active || !availability.actions.some(action => action.capability === capability && action.enabled)) return;
    sending.current = true;
    setBusy(true); setError('');
    try {
      const idempotencyKey = keys.current[capability] ??= crypto.randomUUID();
      const result = shape(await request<Command>(
        `${path}/commands`,
        'POST',
        { capability, reason: 'manual_control', idempotencyKey },
      ));
      setCommand(result);
    } catch {
      setError(t.failed); void refresh();
    } finally {
      sending.current = false;
      setBusy(false); setConfirming('');
    }
  };

  const label = (capability: string) => capability.endsWith('.OPEN') ? t.open : capability.endsWith('.CLOSE') ? t.close : capability.endsWith('.LOCK') ? t.lock : capability.endsWith('.UNLOCK') ? t.unlock : capability;

  return <div className="em-form" data-testid={`device-actions-${device.id}`}>
    {!isOnline && <small className="em-status-reasons" role="status">{t.offline}</small>}
    <small>{availability.state || t.unknown}</small>
    <div className="em-actions">
      {eligible.map(action => {
        const isOpen = action.capability.endsWith('.OPEN');
        const blocked = !action.enabled || active || busy;
        return <button key={action.capability} type="button" className={`em-btn ${isOpen ? 'pri' : ''}`}
          disabled={blocked} title={action.reason ?? undefined} aria-label={`${label(action.capability)}: ${device.label || device.name}`}
          data-testid={`device-action-${action.capability.toLowerCase().replaceAll('.', '-')}-${device.id}`}
          onClick={() => action.confirmation ? setConfirming(action.capability) : void send(action.capability)}>
          {(busy || active) ? <LoaderCircle size={15} /> : isOpen ? <DoorOpen size={15} /> : <Lock size={15} />}
          {busy || active ? t.send : label(action.capability)}
        </button>;
      })}
    </div>
    {confirming && <div role="group" aria-label={t.confirm} className="em-actions">
      <span>{t.confirm} · {device.label || device.name}</span>
       <button type="button" className="em-btn" disabled={busy} onClick={() => setConfirming('')}>{t.cancel}</button>
       <button type="button" className="em-btn bad" disabled={busy || active || !availability.actions.some(a => a.capability === confirming && a.enabled)} onClick={() => void send(confirming)}>{t.yes}</button>
    </div>}
    {command && <small role="status" className={command.status === 'SUCCESS' ? 'em-alert ok' : command.status === 'FAILED' || command.status === 'DENIED' ? 'em-alert bad' : 'em-alert info'}>
      {command.status === 'SUCCESS' ? <CheckCircle2 size={14} /> : <span>{t.sent}: {command.status}</span>}
      {command.status === 'SUCCESS' && t.success}
      {command.error_code && ` · ${command.error_code}`}
    </small>}
    {error && <small className="em-alert bad" role="alert">{error}</small>}
  </div>;
}

export function DeviceCapabilityPolicy({ device, language, onSaved }: { device: Row; language: Language; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<string[]>(device.enabled_capabilities ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [available, setAvailable] = useState<AvailableAction[]>([]);
  useEffect(() => {
    let live = true;
    void request<Availability>(`/buildings/${encodeURIComponent(String(device.building_id))}/devices/${encodeURIComponent(String(device.id))}/actions`)
      .then(data => { if (live) setAvailable(data.actions); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [device.id, device.building_id]);
  const labels = language === 'ru' ? ['Политика команд', 'Сохранить', 'Не удалось сохранить'] :
    language === 'hy' ? ['Հրամանների քաղաքականություն', 'Պահպանել', 'Չհաջողվեց պահպանել'] : ['Command policy', 'Save', 'Could not save'];
  const actions = available.filter(action =>
    action.adapterVerified && Array.isArray(device.capabilities) && device.capabilities.includes(action.capability));
  if (!actions.length) return null;
  return <details><summary>{labels[0]}</summary><div className="em-form">
    {actions.map(action => <label key={action.capability} className="em-opt">
      <input type="checkbox" checked={enabled.includes(action.capability)} disabled={busy} onChange={e =>
        setEnabled(current => e.target.checked ? [...current, action.capability] : current.filter(cap => cap !== action.capability))} />
      {action.capability}
    </label>)}
    {error && <small role="alert">{labels[2]}</small>}
    <button type="button" className="em-btn" disabled={busy} onClick={async () => {
      setBusy(true); setError(false);
      try { await request(`/edge-console/devices/${encodeURIComponent(String(device.id))}/capabilities`, 'PUT', { enabledCapabilities: enabled }); onSaved(); }
      catch { setError(true); } finally { setBusy(false); }
    }}>{labels[1]}</button>
  </div></details>;
}
