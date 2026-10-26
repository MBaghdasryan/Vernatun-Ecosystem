import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, DoorOpen, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { request, ApiClientError } from './client';
import type { Language } from './i18n';
import type { RoleContext } from './types';

type ResidentDevice = {
  id: string; edge_device_id: string; name: string; label?: string | null; profile?: string | null;
  device_type?: string | null; unit_id?: string | null; reported_online?: boolean | null;
  health_status?: 'ONLINE'|'STALE'|'OFFLINE'|'UNKNOWN'; health_reason?: string; edge_online?: boolean;
  thingsboard_active?: boolean|null; gateway_available?: boolean|null; adapter_status?: string;
  last_seen_at?: string | null; last_telemetry_at?: string | null; permittedCapabilities: string[];
  availability?: { online: boolean; state: string | null; actions: { capability: string; enabled: boolean }[] };
};
type CommandResult = { commandId: string; command_id?: string; status: string; [key: string]: unknown };
const COPY: Record<string, [string, string, string]> = {
  title: ['Իմ շենքի սարքերը', 'Устройства моего дома', 'Devices in my building'],
  subtitle: ['Ստուգեք սարքերի վիճակը և օգտագործեք միայն ձեզ թույլատրված հրամանները։', 'Проверяйте состояние устройств и используйте только разрешённые команды.', 'Check device status and use only commands permitted for your unit.'],
  device: ['Սարք', 'Устройство', 'Device'], state: ['Կապ', 'Связь', 'Connection'], lastSeen: ['Վերջին կապ', 'Последняя связь', 'Last seen'],
  online: ['Առցանց', 'В сети', 'Online'], offline: ['Անցանց', 'Не в сети', 'Offline'], unavailable: ['Անհայտ', 'Нет данных', 'Unavailable'],
  stale: ['Տվյալները հնացած են', 'Данные устарели', 'Stale telemetry'],
  unknown: ['Տվյալներ դեռ չկան', 'Пока нет данных', 'No device data yet'],
  noActivity: ['Սարքի վերջին հեռաչափություն կամ իրադարձություն չի ստացվել։', 'Телеметрия или событие устройства ещё не поступали.', 'No telemetry or device event has been received yet.'],
  deviceOfflineReason: ['Սարքը հայտնել է, որ հասանելի չէ։', 'Устройство сообщило, что оно не в сети.', 'Device reported offline.'],
  edgeOfflineReason: ['Edge կապը կամ heartbeat-ը հասանելի չէ։', 'Edge-соединение или heartbeat недоступны.', 'Edge connection or heartbeat is unavailable.'],
  staleReason: ['Սարքի տվյալները հնացել են։', 'Данные устройства устарели.', 'Device data is stale.'],
  gatewayUnavailable: ['Gateway-ը հասանելի չէ։', 'Gateway недоступен.', 'Gateway is unavailable.'],
  gatewayUnknown: ['Gateway-ի կապի վիճակը չի հաղորդվում։', 'Состояние Gateway не передаётся.', 'Gateway connectivity is not reported.'],
  gatewayAvailable: ['Gateway-ը հասանելի է։', 'Gateway доступен.', 'Gateway is available.'],
  open: ['Բացել մուտքը', 'Открыть шлагбаум', 'Open barrier'], reason: ['Պատճառը', 'Причина', 'Reason'],
  reasonHint: ['Նշեք, թե ինչու եք բացում մուտքը', 'Укажите причину открытия', 'Tell us why you are opening access'],
  submit: ['Ուղարկել հրամանը', 'Отправить команду', 'Send command'], confirm: ['Հաստատել բացումը', 'Подтвердить открытие', 'Confirm opening'],
  warning: ['Սա սարքին հրաման է ուղարկում։ Այն կկատարվի միայն ձեր հաստատումից հետո։', 'Это отправит команду устройству. Она будет выполнена только после вашего подтверждения.', 'This sends a command to a device. It will be issued only after you confirm.'],
  cancel: ['Չեղարկել', 'Отмена', 'Cancel'], loading: ['Բեռնվում է…', 'Загрузка…', 'Loading…'], retry: ['Կրկնել', 'Повторить', 'Retry'],
  refresh: ['Թարմացնել', 'Обновить', 'Refresh'], error: ['Չհաջողվեց բեռնել սարքերը։', 'Не удалось загрузить устройства.', 'Could not load devices.'],
  empty: ['Այս բնակարանի համար հասանելի սարքեր չկան։', 'Для этой квартиры нет доступных устройств.', 'No devices are available for this unit.'],
  noBuilding: ['Բնակարանի շենքը նշված չէ։', 'Здание квартиры не указано.', 'This unit has no building selected.'],
  pending: ['Կատարման ընթացքը ստուգվում է…', 'Проверяем выполнение…', 'Checking command progress…'], command: ['Հրաման', 'Команда', 'Command'],
  queued: ['Հերթում', 'В очереди', 'Queued'], sent: ['Ուղարկված', 'Отправлена', 'Sent'], completed: ['Ավարտված', 'Завершена', 'Completed'],
  failed: ['Չհաջողվեց', 'Ошибка', 'Failed'], success: ['Հրամանն ընդունվել է։', 'Команда принята.', 'Command accepted.'],
};
const ix = (l: Language) => l === 'hy' ? 0 : l === 'ru' ? 1 : 2;
const dateText = (v: string | null | undefined, l: Language) => v ? new Intl.DateTimeFormat(l === 'hy' ? 'hy-AM' : l === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—';
const css = `
.rda{--r-ink:#283a35;--r-muted:#718079;--r-line:#dce5dd;--r-green:#376b55;color:var(--r-ink);display:grid;gap:1rem}
.rda *{box-sizing:border-box}.rda-hero{border:1px solid var(--r-line);border-radius:20px;padding:clamp(1.25rem,3vw,2rem);background:linear-gradient(118deg,#e8efe3,#f4f3e9);display:flex;justify-content:space-between;align-items:flex-end;gap:1rem}
.rda-hero h1{font-size:clamp(1.55rem,3vw,2.4rem);letter-spacing:-.045em;margin:.4rem 0}.rda-hero p{color:var(--r-muted);margin:0;max-width:42rem}.rda-kicker{font:600 .72rem ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--r-green)}
 .rda-card{background:#fffefa;border:1px solid var(--r-line);border-radius:16px;padding:1rem}.rda-list{display:grid;gap:.65rem}.rda-device{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.9rem;align-items:center;border:1px solid var(--r-line);border-radius:13px;padding:1rem;background:#fff}.rda-name{display:flex;align-items:center;gap:.65rem}.rda-name h2{font-size:1rem;margin:0}.rda-name small,.rda-meta{color:var(--r-muted);font-size:.8rem}.rda-meta{margin:.4rem 0 0 2.2rem}.rda-pill{display:inline-flex;border-radius:99px;padding:.3rem .6rem;background:#edf0ea;font-size:.75rem}.rda-pill.online{background:#e4f1e6;color:#315e42}.rda-pill.stale{background:#fff2cf;color:#7a5800}.rda-pill.offline{background:#f6e7e3;color:#8e4235}
.rda-button{min-height:42px;display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border:1px solid #376b55;border-radius:10px;background:#376b55;color:white;padding:.65rem .85rem;font:600 .88rem inherit;cursor:pointer}.rda-button:hover{background:#2d5c48}.rda-button:disabled{opacity:.6;cursor:wait}.rda-button:focus-visible,.rda-input:focus-visible{outline:3px solid #b6d58b;outline-offset:2px}.rda-loading,.rda-empty,.rda-error{border-radius:12px;padding:1rem}.rda-loading,.rda-empty{border:1px dashed var(--r-line);color:var(--r-muted)}.rda-error{background:#fbefec;color:#8e4235}.rda-dialog-backdrop{position:fixed;inset:0;background:#17291f99;z-index:1000;display:grid;place-items:center;padding:1rem}.rda-dialog{width:min(100%,29rem);background:#fffefa;border-radius:18px;padding:1.25rem;box-shadow:0 20px 70px #17291f33}.rda-dialog h2{margin:.2rem 0 .55rem}.rda-dialog p{line-height:1.55}.rda-input{display:block;width:100%;min-height:44px;border:1px solid var(--r-line);border-radius:9px;padding:.65rem;font:inherit;margin:.45rem 0 1rem}.rda-actions{display:flex;justify-content:flex-end;gap:.6rem;flex-wrap:wrap}.rda-secondary{background:#fffefa;color:var(--r-ink);border-color:var(--r-line)}
.rda-command{border-radius:11px;background:#f1f5e9;padding:.8rem;display:flex;gap:.6rem;align-items:flex-start}.rda-command strong,.rda-command small{display:block}.rda-command small{color:var(--r-muted);margin-top:.2rem}
@media(max-width:600px){.rda-hero{align-items:flex-start;flex-direction:column}.rda-device{grid-template-columns:1fr}.rda-device .rda-button{width:100%}}
`;
const pendingState = (s: string) => ['requested','authorized','pending','queued','accepted','sent','delivered','acknowledged','running','processing'].includes(s.toLowerCase());
const commandShape = (value: CommandResult): CommandResult => ({ ...value, commandId: value.commandId ?? value.command_id ?? '' });

export default function ResidentDeviceAccess({ c, language }: { c: RoleContext; language: Language }) {
  const t = (key: keyof typeof COPY) => COPY[key][ix(language)];
  const [devices, setDevices] = useState<ResidentDevice[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<ResidentDevice>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<CommandResult>();
  const [commandError, setCommandError] = useState('');
  const [polling, setPolling] = useState(false);
  const activePoll = useRef(false);
  const commandKeys = useRef<Record<string, string>>({});
  const buildingId = c.building_id;

  const load = useCallback(async () => {
    if (!buildingId) { setDevices([]); setLoading(false); return; }
    setLoading(true); setError(undefined);
    try { setDevices(await request<ResidentDevice[]>(`/me/buildings/${encodeURIComponent(buildingId)}/devices`)); }
    catch (e) { setError(e); } finally { setLoading(false); }
  }, [buildingId]);
  useEffect(() => { void load(); }, [load, c.id]);

  useEffect(() => {
    if (!command?.commandId || !pendingState(command.status) || activePoll.current) return;
    activePoll.current = true; setPolling(true);
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = commandShape(await request<CommandResult>(`/me/edge-commands/${encodeURIComponent(command.commandId)}`));
        if (cancelled) return;
        setCommand(next);
        if (pendingState(next.status)) timer = setTimeout(poll, 1800);
        else { commandKeys.current = {}; void load(); }
      } catch (e) { if (!cancelled) setCommandError(e instanceof ApiClientError ? `${t('error')} (${e.status || e.code})` : t('error')); }
    };
    timer = setTimeout(poll, 1200);
    return () => { cancelled = true; clearTimeout(timer); activePoll.current = false; setPolling(false); };
  }, [command?.commandId, command?.status]);

  const sendCommand = async () => {
    if (!selected || reason.trim().length < 3 || busy || !selected.availability?.actions.some(a=>a.capability==='BARRIER.OPEN'&&a.enabled) || !buildingId) return;
    setBusy(true); setCommandError('');
    try {
      const result = commandShape(await request<CommandResult>(`/me/buildings/${encodeURIComponent(buildingId)}/devices/${encodeURIComponent(selected.id)}/commands`, 'POST', {
        capability: 'BARRIER.OPEN', reason: reason.trim(), idempotencyKey: commandKeys.current[selected.id] ??= crypto.randomUUID(),
      }));
      setCommand(result); setReason(''); setSelected(undefined);
    } catch (e) { setCommandError(e instanceof ApiClientError ? `${t('error')} (${e.status || e.code})` : t('error')); }
    finally { setBusy(false); }
  };
  const statusText = (status: string) => {
    const k = status.toLowerCase();
    if (['requested','authorized','queued','pending','accepted','running','processing'].includes(k)) return t('queued');
    if (['sent','delivered','acknowledged'].includes(k)) return t('sent');
    if (['completed','succeeded','success'].includes(k)) return t('completed');
    if (['failed','rejected','error','cancelled','denied','timeout'].includes(k)) return t('failed');
    return status;
  };

  return <div className="rda" data-testid="resident-device-access">
    <style>{css}</style>
    <section className="rda-hero"><div><span className="rda-kicker">ImTun · Vernatun</span><h1>{t('title')}</h1><p>{t('subtitle')}</p></div><button className="rda-button rda-secondary" onClick={() => void load()} disabled={loading} data-testid="button-refresh-resident-devices"><RefreshCw size={16}/>{t('refresh')}</button></section>
    {!buildingId && <p className="rda-error" role="alert" data-testid="status-resident-no-building">{t('noBuilding')}</p>}
    {!!error && <div className="rda-error" role="alert" data-testid="status-resident-error">{error instanceof ApiClientError ? `${t('error')} (${error.status || error.code})` : t('error')} <button className="rda-button rda-secondary" onClick={() => void load()} data-testid="button-retry-resident-devices">{t('retry')}</button></div>}
    {loading && !devices ? <div className="rda-loading" role="status" aria-busy="true" data-testid="status-resident-loading">{t('loading')}</div> :
      devices?.length ? <section className="rda-list" aria-label={t('title')}>{devices.map(d=>{
         const status = d.health_status ?? 'UNKNOWN';
         const isOnline = status === 'ONLINE';
         const healthLabel = status === 'ONLINE' ? t('online') : status === 'STALE' ? t('stale') :
           status === 'OFFLINE' ? t('offline') : t('unknown');
         const reason = d.health_reason === 'device_reported_offline' ? t('deviceOfflineReason') :
           d.health_reason === 'edge_offline' ? t('edgeOfflineReason') :
           d.health_reason === 'gateway_unavailable' ? t('gatewayUnavailable') :
           d.health_reason === 'device_activity_stale' || d.health_reason === 'device_activity_expired' ? t('staleReason') : '';
         const gatewayTitle = d.gateway_available === false ? t('gatewayUnavailable') : d.gateway_available === true ? t('gatewayAvailable') : t('gatewayUnknown');
         const healthTitle = [reason,d.last_seen_at ? `${t('lastSeen')}: ${dateText(d.last_seen_at,language)}` : t('noActivity'),gatewayTitle].filter(Boolean).join(' · ');
         const adapterTitle = typeof d.thingsboard_active === 'boolean' ? ` · ThingsBoard active=${d.thingsboard_active} (metadata only)` : '';
        const allowed = d.permittedCapabilities?.includes('BARRIER.OPEN');
        return <article className="rda-device" key={d.id} data-testid={'card-resident-device-'+d.id}>
          <div><div className="rda-name"><span className="rda-pill"><Radio size={15}/></span><div><h2>{d.label||d.name}</h2><small>{d.device_type||d.profile||d.edge_device_id}</small></div></div>
            <p className="rda-meta">{t('state')}: <span title={healthTitle+adapterTitle} className={'rda-pill '+(status==='ONLINE'?'online':status==='OFFLINE'?'offline':status==='STALE'?'stale':'')}>{healthLabel}</span> · {t('lastSeen')}: {dateText(d.last_seen_at,language)}</p>
          </div>
          {allowed && <button className="rda-button" disabled={busy||!!command&&pendingState(command.status)||!d.availability?.actions.some(a=>a.capability==='BARRIER.OPEN'&&a.enabled)} onClick={()=>{setSelected(d);setReason('');setCommandError('')}} data-testid={'button-open-device-'+d.id}><DoorOpen size={17}/>{t('open')}</button>}
        </article>;
      })}</section> : !loading && !error && buildingId ? <p className="rda-empty" data-testid="text-resident-devices-empty">{t('empty')}</p> : null}
    {command && <section className="rda-command" role="status" data-testid={'status-resident-command-'+command.commandId}>
      {['completed','succeeded','success'].includes(command.status.toLowerCase())?<CheckCircle2 size={19}/>:['failed','rejected','error'].includes(command.status.toLowerCase())?<AlertCircle size={19}/>:<ShieldCheck size={19}/>}
      <div><strong>{t('command')}: {statusText(command.status)}</strong><small>{polling?t('pending'):commandError||t('success')} · {command.commandId}</small></div>
    </section>}
    {commandError && !command && <p className="rda-error" role="alert" data-testid="status-resident-command-error">{commandError}</p>}
    {selected && <div className="rda-dialog-backdrop" role="presentation"><section className="rda-dialog" role="dialog" aria-modal="true" aria-labelledby="resident-command-title" data-testid="dialog-resident-command">
      <h2 id="resident-command-title">{t('confirm')}</h2><p>{selected.label||selected.name} · {t('open')}</p><p>{t('warning')}</p>
      <label htmlFor="resident-command-reason">{t('reason')}<input id="resident-command-reason" className="rda-input" required minLength={3} maxLength={300} autoFocus placeholder={t('reasonHint')} value={reason} onChange={e=>setReason(e.target.value)} data-testid="input-resident-command-reason"/></label>
      {commandError && <p className="rda-error" role="alert" data-testid="status-resident-command-error">{commandError}</p>}
      <div className="rda-actions"><button className="rda-button rda-secondary" onClick={()=>setSelected(undefined)} disabled={busy} data-testid="button-cancel-resident-command">{t('cancel')}</button><button className="rda-button" disabled={busy||reason.trim().length<3} onClick={()=>void sendCommand()} data-testid="button-submit-resident-command">{busy?t('loading'):t('submit')}<DoorOpen size={16}/></button></div>
    </section></div>}
  </div>;
}
