import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, AlertTriangle, Building2, Check, ChevronRight, Copy, KeyRound, Radio, RefreshCw, ShieldAlert, Terminal, X } from 'lucide-react';
import { request, ApiClientError } from './client';
import type { Language } from './i18n';
import type { RoleContext } from './types';

type EdgeNode = {
  id: string; edge_id: string; organization_id: string; building_id: string; name: string; site_code: string;
  status: string; registration_state: string; agent_version: string | null; local_authorization_status: string;
  queue_depth: number; registered_at: string | null; last_seen_at: string | null; last_connected_at: string | null;
  credential_version: number | null; organization_name: string | null; building_name: string | null;
  device_count: number; active_alarms: number;
};
type Building = { id: string; name: string; address: string | null; organization_id: string; organization_name: string | null };
type Device = {
  id: string; edge_device_id: string; thingsboard_id: string | null; name: string; profile: string | null;
  device_type: string | null; label: string | null; unit_id: string | null; capabilities: string[];
  reported_online: boolean | null; last_seen_at: string | null; last_telemetry_at: string | null;
};
type Alarm = { id?: string; command_id?: string; [key: string]: unknown };
type Fleet = { summary: { total: number; online: number; degraded: number; offline: number; activeAlarms: number }; nodes: EdgeNode[] };
type Detail = { node: EdgeNode; devices: Device[]; alarms: Alarm[] };
type TokenResult = { bootstrapToken: string; oneTime: true; instruction?: string; [key: string]: unknown };

const COPY: Record<string, [string, string, string]> = {
  edge: ['Edge կառավարում', 'Управление Edge', 'Edge workspace'], fleet: ['Edge հանգույցների ցանց', 'Сеть Edge-узлов', 'Edge fleet'],
  fleetHint: ['Կառավարեք շենքերի տեղային Edge հանգույցները և դրանց սարքերը։', 'Управляйте локальными Edge-узлами зданий и устройствами.', 'Manage building-local Edge nodes and their devices.'],
  loading: ['Բեռնվում է…', 'Загрузка…', 'Loading…'], retry: ['Կրկնել', 'Повторить', 'Retry'], refresh: ['Թարմացնել', 'Обновить', 'Refresh'],
  error: ['Տվյալները չհաջողվեց բեռնել։', 'Не удалось загрузить данные.', 'Could not load data.'], empty: ['Գրառումներ չկան։', 'Записей пока нет.', 'No records yet.'],
  total: ['Ընդամենը', 'Всего', 'Total'], online: ['Առցանց', 'В сети', 'Online'], degraded: ['Խափանումով', 'С деградацией', 'Degraded'],
  offline: ['Անցանց', 'Не в сети', 'Offline'], alarms: ['Ակտիվ ահազանգեր', 'Активные тревоги', 'Active alarms'],
  bootstrap: ['Գրանցման բանալի ստեղծել', 'Создать ключ регистрации', 'Create bootstrap token'], building: ['Շենք', 'Здание', 'Building'],
  choose: ['Ընտրել շենքը', 'Выберите здание', 'Choose a building'], edgeId: ['Edge ID', 'Edge ID', 'Edge ID'], name: ['Անվանում', 'Название', 'Name'],
  siteCode: ['Տեղանքի կոդ', 'Код объекта', 'Site code'], expires: ['Գործողության ժամկետը (րոպե)', 'Срок действия (минуты)', 'Expires in (minutes)'],
  create: ['Ստեղծել բանալի', 'Создать ключ', 'Create token'], oneTime: ['Այս բանալին ցուցադրվում է միայն մեկ անգամ։ Պահեք այն անվտանգ տեղում։', 'Ключ отображается только один раз. Сохраните его в безопасном месте.', 'This token is shown only once. Store it securely.'],
  copy: ['Պատճենել', 'Копировать', 'Copy'], copied: ['Պատճենված է', 'Скопировано', 'Copied'], dismiss: ['Փակել', 'Закрыть', 'Dismiss'],
  nodes: ['Հանգույցներ', 'Узлы', 'Nodes'], nodeDetails: ['Հանգույցի տվյալներ', 'Данные узла', 'Node details'], devices: ['Սարքեր', 'Устройства', 'Devices'],
  device: ['Սարք', 'Устройство', 'Device'], status: ['Կարգավիճակ', 'Статус', 'Status'], registration: ['Գրանցում', 'Регистрация', 'Registration'],
  authorization: ['Տեղային թույլտվություն', 'Локальная авторизация', 'Local authorization'], queue: ['Հերթ', 'Очередь', 'Queue'],
  agent: ['Գործակալի տարբերակ', 'Версия агента', 'Agent version'], lastSeen: ['Վերջին կապ', 'Последняя связь', 'Last seen'],
  alarmsTitle: ['Ահազանգեր', 'Тревоги', 'Alarms'], commands: ['Հրամաններ', 'Команды', 'Commands'], inventory: ['Սարքերի գույքագրում', 'Инвентаризация устройств', 'Device inventory'],
  access: ['Բնակարանի հասանելիություն', 'Доступ квартиры', 'Unit access'], unitId: ['Բնակարանի ID', 'ID квартиры', 'Unit ID'],
  allow: ['Թույլատրել Barrier Open', 'Разрешить Barrier Open', 'Allow Barrier Open'], removeAccess: ['Հեռացնել թույլտվությունը', 'Удалить доступ', 'Remove access'],
  rotate: ['Փուլային բանալու փոփոխում', 'Ротация учётных данных', 'Rotate credentials'], revoke: ['Անմիջապես չեղարկել', 'Немедленно отозвать', 'Revoke immediately'],
  rotateNote: ['Հին հասանելիությունը մնում է մինչև նոր բանալու օգտագործումը կամ ժամկետի ավարտը։', 'Старый доступ сохраняется, пока новый токен не будет использован или не истечёт.', 'Old access remains until the staged new token is used or expires.'],
  revokeConfirm: ['Չեղարկե՞լ Edge հանգույցի բոլոր մուտքային տվյալները։ Գործողությունն անմիջապես ուժի մեջ կմտնի։', 'Отозвать все учётные данные Edge-узла? Действие вступит в силу немедленно.', 'Revoke all credentials for this Edge node? This takes effect immediately.'],
  cancel: ['Չեղարկել', 'Отмена', 'Cancel'], confirm: ['Հաստատել չեղարկումը', 'Подтвердить отзыв', 'Confirm revocation'], success: ['Գործողությունը կատարված է։', 'Действие выполнено.', 'Action completed.'],
  registered: ['Գրանցված', 'Зарегистрирован', 'Registered'], unregistered: ['Չգրանցված', 'Не зарегистрирован', 'Unregistered'], capabilities: ['Հնարավորություններ', 'Возможности', 'Capabilities'],
  tokenVersion: ['Տարբերակ', 'Версия', 'Version'], tokenExpires: ['Ժամկետը լրանում է', 'Истекает', 'Expires'],
};
const idx = (l: Language) => l === 'hy' ? 0 : l === 'ru' ? 1 : 2;
const when = (v: string | null | undefined, l: Language) => v ? new Intl.DateTimeFormat(l === 'hy' ? 'hy-AM' : l === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—';
const styles = `
.edge-work{--ew-ink:#213932;--ew-muted:#71827a;--ew-line:#dce5dd;--ew-paper:#f5f7f1;--ew-card:#fffefa;--ew-green:#376b55;--ew-lime:#d7e9aa;color:var(--ew-ink);display:grid;gap:1.2rem}
.edge-work *{box-sizing:border-box}.ew-hero{background:linear-gradient(115deg,#e8efe3,#f4f3e9 72%);border:1px solid var(--ew-line);border-radius:20px;padding:clamp(1.2rem,3vw,2rem);display:flex;justify-content:space-between;gap:1rem;align-items:flex-end}
.ew-eyebrow{font:600 .72rem/1.2 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ew-green)}.ew-hero h1{font-size:clamp(1.65rem,3vw,2.5rem);letter-spacing:-.045em;margin:.55rem 0}.ew-hero p{margin:0;color:var(--ew-muted);max-width:44rem}
.ew-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.7rem}.ew-metric,.ew-panel{background:var(--ew-card);border:1px solid var(--ew-line);border-radius:16px;padding:1rem}.ew-metric span{display:block;color:var(--ew-muted);font-size:.8rem}.ew-metric strong{display:block;font-size:1.7rem;letter-spacing:-.04em;margin-top:.3rem}
.ew-columns{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(18rem,.75fr);gap:1rem}.ew-panel header{display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin-bottom:1rem}.ew-panel h2{font-size:1.05rem;margin:0;letter-spacing:-.02em}.ew-list{display:grid;gap:.55rem}.ew-node{border:1px solid var(--ew-line);border-radius:12px;padding:.8rem;display:flex;justify-content:space-between;align-items:center;gap:.8rem;background:#fff}.ew-node.selected{border-color:var(--ew-green);box-shadow:inset 3px 0 var(--ew-green);background:#f4f8ef}.ew-node-main{min-width:0;text-align:left;border:0;background:none;color:inherit;padding:0;flex:1;cursor:pointer}.ew-node-main strong,.ew-node-main small{display:block}.ew-node-main small{color:var(--ew-muted);margin-top:.25rem}
.ew-tag{border-radius:99px;background:#edf2e8;padding:.3rem .55rem;font-size:.72rem;white-space:nowrap}.ew-tag.online{background:#e4f1e6;color:#315e42}.ew-tag.offline{background:#f6e7e3;color:#8e4235}.ew-tag.degraded{background:#f6efda;color:#806523}.ew-button{border:1px solid var(--ew-line);border-radius:9px;padding:.6rem .8rem;background:#fffefa;color:var(--ew-ink);font:600 .83rem inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:40px}.ew-button:hover{background:#edf3e8}.ew-button.primary{background:var(--ew-green);color:#fff;border-color:var(--ew-green)}.ew-button.danger{color:#923e36;border-color:#dfb8b2}.ew-button:disabled{opacity:.55;cursor:wait}
.ew-form{display:grid;gap:.7rem}.ew-form label{display:grid;gap:.28rem;font-size:.8rem;color:var(--ew-muted)}.ew-form input,.ew-form select{width:100%;border:1px solid var(--ew-line);border-radius:8px;background:#fff;padding:.65rem;color:var(--ew-ink);font:inherit;min-height:42px}.ew-form input:focus,.ew-form select:focus,.ew-button:focus-visible,.ew-node-main:focus-visible{outline:3px solid #b6d58b;outline-offset:2px}
.ew-note{padding:.75rem;border-radius:10px;background:#f1f5e9;color:#596b4c;font-size:.82rem}.ew-token{overflow-wrap:anywhere;font: .82rem ui-monospace,monospace;background:#f2f3ec;padding:.75rem;border-radius:8px}.ew-token-actions,.ew-actions{display:flex;gap:.5rem;flex-wrap:wrap}.ew-empty,.ew-loading{padding:1rem;color:var(--ew-muted);border:1px dashed var(--ew-line);border-radius:10px}.ew-error{color:#8e4235;background:#fbefec;border-radius:10px;padding:.8rem}.ew-details{display:grid;gap:.75rem}.ew-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem}.ew-fact{background:#f3f5ef;padding:.7rem;border-radius:9px;min-width:0}.ew-fact small{display:block;color:var(--ew-muted);margin-bottom:.25rem}.ew-fact strong{overflow-wrap:anywhere;font-size:.86rem}.ew-scroll{overflow:auto}.ew-table{width:100%;border-collapse:collapse;font-size:.82rem}.ew-table th,.ew-table td{text-align:left;padding:.65rem .5rem;border-bottom:1px solid var(--ew-line);vertical-align:top}.ew-table th{color:var(--ew-muted);font-weight:600}.ew-modal{position:fixed;inset:0;background:#17291f99;display:grid;place-items:center;z-index:1000;padding:1rem}.ew-dialog{width:min(100%,29rem);background:#fffefa;border-radius:18px;padding:1.25rem;box-shadow:0 20px 70px #17291f33}.ew-dialog h2{margin:.2rem 0 .7rem}.ew-prompt{font-size:.9rem;line-height:1.5}
@media(max-width:850px){.ew-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ew-columns{grid-template-columns:1fr}}@media(max-width:560px){.ew-hero{align-items:flex-start;flex-direction:column}.ew-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.ew-node{align-items:flex-start;flex-direction:column}}
`;

export default function EdgeWorkspace({ c, language }: { c: RoleContext; language: Language }) {
  const tx = (key: keyof typeof COPY) => COPY[key][idx(language)];
  const [fleet, setFleet] = useState<Fleet>();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [commands, setCommands] = useState<Alarm[]>([]);
  const [detail, setDetail] = useState<Detail>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState<TokenResult>();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [form, setForm] = useState({ buildingId: '', edgeId: '', name: '', siteCode: '', expiresInMinutes: '60' });
  const [access, setAccess] = useState<Record<string, string>>({});
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const [f, b, a, cmd] = await Promise.all([
        request<Fleet>('/edge-console/fleet'), request<Building[]>('/edge-console/buildings'),
        request<Alarm[]>('/edge-console/alarms'), request<Alarm[]>('/edge-console/commands'),
      ]);
      setFleet(f); setBuildings(b); setAlarms(a); setCommands(cmd);
      const current = selectedRef.current;
      const nextId = current && f.nodes.some(n => n.id === current) ? current : f.nodes[0]?.id ?? '';
      setSelected(nextId);
      if (nextId) setDetail(await request<Detail>(`/edge-console/nodes/${encodeURIComponent(nextId)}`)); else setDetail(undefined);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [c.id, load]);
  const choose = async (id: string) => {
    setSelected(id); setDetail(undefined); setError(undefined);
    try { setDetail(await request<Detail>(`/edge-console/nodes/${encodeURIComponent(id)}`)); } catch (e) { setError(e); }
  };
  const submitBootstrap = async (e: FormEvent) => {
    e.preventDefault(); setBusy('bootstrap'); setError(undefined); setToken(undefined); setNotice('');
    try {
      const chosenBuilding = buildings.find(b => b.id === form.buildingId);
      const result = await request<TokenResult>('/edge-console/bootstrap-tokens', 'POST', {
        ...((c.organization_id ?? chosenBuilding?.organization_id) ? { organizationId: c.organization_id ?? chosenBuilding?.organization_id } : {}), buildingId: form.buildingId,
        edgeId: form.edgeId.trim(), name: form.name.trim(), siteCode: form.siteCode.trim(), expiresInMinutes: Number(form.expiresInMinutes),
      });
      setToken(result);
    } catch (e) { setError(e); } finally { setBusy(''); }
  };
  const action = async (key: string, path: string, method: string, body?: unknown): Promise<Record<string, unknown> | null | undefined> => {
    setBusy(key); setError(undefined); setNotice('');
    try { const response = await request<Record<string, unknown> | null>(path, method, body); setNotice(tx('success')); return response; }
    catch (e) { setError(e); return undefined; } finally { setBusy(''); }
  };
  const rotate = async () => {
    const result = await action('rotate', `/edge-console/nodes/${encodeURIComponent(selected)}/credentials/rotate`, 'POST');
    if (result && typeof result.accessToken === 'string') { setToken({ ...result, bootstrapToken: result.accessToken, oneTime: true }); await load(); }
  };
  const setDeviceAccess = async (deviceId: string) => {
    const unitId = access[deviceId]?.trim(); if (!unitId) return;
    const result = await action('access-'+deviceId, `/edge-console/devices/${encodeURIComponent(deviceId)}/access`, 'PUT', { unitId, allowedCapabilities: ['BARRIER.OPEN'] });
    if (result !== undefined) { setAccess(x => ({ ...x, [deviceId]: '' })); await choose(selected); }
  };
  const removeDeviceAccess = async (deviceId: string, unitId: string) => {
    const result = await action('remove-'+deviceId, `/edge-console/devices/${encodeURIComponent(deviceId)}/access/${encodeURIComponent(unitId)}`, 'DELETE');
    if (result !== undefined) await choose(selected);
  };
  const copyToken = async () => {
    if (!token?.bootstrapToken) return;
    try { await navigator.clipboard.writeText(token.bootstrapToken); setNotice(tx('copied')); } catch { setError(new Error('clipboard')); }
  };
  const onlineLabel = (s: string) => s.toLowerCase() === 'online' ? tx('online') : s.toLowerCase() === 'offline' ? tx('offline') : s.toLowerCase() === 'degraded' ? tx('degraded') : s;
  const statusClass = (s: string) => s.toLowerCase();
  const errorMessage = error instanceof ApiClientError ? `${tx('error')} (${error.status || error.code})` : tx('error');
  const node = detail?.node;

  return <div className="edge-work" data-testid="edge-workspace">
    <style>{styles}</style>
    <section className="ew-hero"><div><span className="ew-eyebrow">Vernatun OS · HAYAT · Edge</span><h1>{tx('edge')}</h1><p>{tx('fleetHint')}</p></div><button className="ew-button" onClick={() => void load()} disabled={loading} data-testid="button-refresh-edge"><RefreshCw size={16}/>{tx('refresh')}</button></section>
    {!!error && <div className="ew-error" role="alert" data-testid="status-edge-error">{errorMessage}<button className="ew-button" onClick={() => void load()} data-testid="button-retry-edge">{tx('retry')}</button></div>}
    {loading && !fleet ? <div className="ew-loading" role="status" aria-busy="true" data-testid="status-edge-loading">{tx('loading')}</div> : fleet && <>
      <div className="ew-grid" aria-label={tx('fleet')} data-testid="edge-fleet-summary">
        {(['total','online','degraded','offline','activeAlarms'] as const).map((k,i)=><div className="ew-metric" key={k} data-testid={'metric-edge-'+k}><span>{[tx('total'),tx('online'),tx('degraded'),tx('offline'),tx('alarms')][i]}</span><strong>{fleet.summary[k]}</strong></div>)}
      </div>
      <div className="ew-columns">
        <section className="ew-panel"><header><h2><Radio size={18}/> {tx('nodes')}</h2><span className="ew-eyebrow">{fleet.nodes.length}</span></header>
          {fleet.nodes.length ? <div className="ew-list">{fleet.nodes.map(n=><div className={'ew-node '+(selected===n.id?'selected':'')} key={n.id} data-testid={'row-edge-node-'+n.id}>
            <button className="ew-node-main" onClick={() => void choose(n.id)} data-testid={'button-open-node-'+n.id} aria-current={selected===n.id?'true':undefined}>
              <strong>{n.name}</strong><small>{n.building_name ?? n.site_code} · {n.edge_id} · {n.device_count} {tx('devices')}</small>
            </button><span className={'ew-tag '+statusClass(n.status)} data-testid={'status-edge-node-'+n.id}>{onlineLabel(n.status)}</span>
          </div>)}</div> : <p className="ew-empty" data-testid="text-edge-empty">{tx('empty')}</p>}
        </section>
        <section className="ew-panel"><header><h2><KeyRound size={18}/> {tx('bootstrap')}</h2></header>
          {token ? <div data-testid="panel-one-time-token"><p className="ew-note" role="alert">{tx('oneTime')}</p><div className="ew-token" data-testid="text-one-time-token">{token.bootstrapToken}</div>
            <div className="ew-token-actions"><button className="ew-button primary" onClick={() => void copyToken()} data-testid="button-copy-token"><Copy size={15}/>{tx('copy')}</button><button className="ew-button" onClick={() => {setToken(undefined);setNotice('')}} data-testid="button-dismiss-token"><X size={15}/>{tx('dismiss')}</button></div>
            {typeof token.version === 'number' && <p>{tx('tokenVersion')}: {token.version} · {tx('tokenExpires')}: {String(token.expiresAt ?? '—')}</p>}
            {typeof token.instruction === 'string' && <p className="ew-note" data-testid="text-credential-instruction">{token.instruction}</p>}
          </div> : <form className="ew-form" onSubmit={submitBootstrap} data-testid="form-bootstrap-token">
            <label>{tx('building')}<select required value={form.buildingId} onChange={e=>setForm({...form,buildingId:e.target.value})} data-testid="select-bootstrap-building"><option value="">{tx('choose')}</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}{b.organization_name?` · ${b.organization_name}`:''}</option>)}</select></label>
            <label>{tx('edgeId')}<input required maxLength={120} value={form.edgeId} onChange={e=>setForm({...form,edgeId:e.target.value})} data-testid="input-bootstrap-edge-id"/></label>
            <label>{tx('name')}<input required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} data-testid="input-bootstrap-name"/></label>
            <label>{tx('siteCode')}<input required maxLength={80} value={form.siteCode} onChange={e=>setForm({...form,siteCode:e.target.value})} data-testid="input-bootstrap-site-code"/></label>
            <label>{tx('expires')}<input type="number" required min="1" max="10080" value={form.expiresInMinutes} onChange={e=>setForm({...form,expiresInMinutes:e.target.value})} data-testid="input-bootstrap-expiry"/></label>
            <button className="ew-button primary" disabled={busy==='bootstrap'} data-testid="button-create-bootstrap">{busy==='bootstrap'?tx('loading'):tx('create')}<ChevronRight size={16}/></button>
          </form>}
        </section>
      </div>
      {node && <section className="ew-panel ew-details" data-testid={'panel-edge-detail-'+node.id}>
        <header><h2><Building2 size={18}/> {tx('nodeDetails')} · {node.name}</h2><span className={'ew-tag '+statusClass(node.status)}>{onlineLabel(node.status)}</span></header>
        <div className="ew-facts">
          {[[tx('registration'),node.registration_state],[tx('authorization'),node.local_authorization_status],[tx('queue'),node.queue_depth],[tx('agent'),node.agent_version??'—'],[tx('lastSeen'),when(node.last_seen_at,language)],['Edge ID',node.edge_id]].map(([label,value])=><div className="ew-fact" key={label}><small>{label}</small><strong>{value}</strong></div>)}
        </div>
        <div className="ew-actions"><button className="ew-button" disabled={!!busy} onClick={()=>void rotate()} data-testid="button-rotate-edge-credentials"><KeyRound size={15}/>{tx('rotate')}</button><button className="ew-button danger" disabled={!!busy} onClick={()=>setConfirmRevoke(true)} data-testid="button-revoke-edge-credentials"><ShieldAlert size={15}/>{tx('revoke')}</button></div>
        <p className="ew-note">{tx('rotateNote')}</p>
        <h2><Terminal size={17}/> {tx('inventory')} · {detail.devices.length}</h2>
        {detail.devices.length ? <div className="ew-scroll"><table className="ew-table"><thead><tr><th>{tx('device')}</th><th>{tx('status')}</th><th>{tx('capabilities')}</th><th>{tx('access')}</th></tr></thead><tbody>{detail.devices.map(d=><tr key={d.id} data-testid={'row-edge-device-'+d.id}>
          <td><strong>{d.label||d.name}</strong><br/><small>{d.device_type||d.profile||d.edge_device_id}</small></td><td><span className={'ew-tag '+(d.reported_online?'online':'offline')}>{d.reported_online?tx('online'):tx('offline')}</span></td><td>{d.capabilities?.join(', ')||'—'}</td>
          <td>{d.unit_id ? <div className="ew-actions"><span>{d.unit_id}</span><button className="ew-button danger" disabled={!!busy} onClick={()=>void removeDeviceAccess(d.id,d.unit_id!)} data-testid={'button-remove-device-access-'+d.id}>{tx('removeAccess')}</button></div> :
            <form className="ew-actions" onSubmit={e=>{e.preventDefault();void setDeviceAccess(d.id)}}><input aria-label={tx('unitId')} placeholder={tx('unitId')} value={access[d.id]??''} onChange={e=>setAccess({...access,[d.id]:e.target.value})} data-testid={'input-device-unit-'+d.id}/><button className="ew-button" disabled={!!busy||!access[d.id]?.trim()} data-testid={'button-allow-device-'+d.id}>{tx('allow')}</button></form>}</td>
        </tr>)}</tbody></table></div> : <p className="ew-empty" data-testid="text-edge-devices-empty">{tx('empty')}</p>}
      </section>}
      <div className="ew-columns">
        <section className="ew-panel"><header><h2><AlertTriangle size={18}/> {tx('alarmsTitle')}</h2></header>{alarms.length ? <div className="ew-list">{alarms.map((a,i)=><article className="ew-fact" key={a.id??i} data-testid={'row-edge-alarm-'+(a.id??i)}><strong>{String(a.alarm_type??a.title??a.name??a.code??a.type??a.id)}</strong><small>{String(a.severity??'')} · {String(a.status??'')} · {String(a.received_at??a.created_at??a.createdAt??'')}</small></article>)}</div>:<p className="ew-empty" data-testid="text-edge-alarms-empty">{tx('empty')}</p>}</section>
        <section className="ew-panel"><header><h2><Activity size={18}/> {tx('commands')}</h2></header>{commands.length ? <div className="ew-list">{commands.map((a,i)=><article className="ew-fact" key={a.command_id??a.id??i} data-testid={'row-edge-command-'+(a.command_id??a.id??i)}><strong>{String(a.capability??a.command??a.type??a.command_id??a.id)}</strong><small>{String(a.status??'')} · {String(a.requested_at??a.created_at??a.createdAt??'')}</small></article>)}</div>:<p className="ew-empty" data-testid="text-edge-commands-empty">{tx('empty')}</p>}</section>
      </div>
    </>}
    {notice && <p role="status" className="ew-note" data-testid="status-edge-action">{notice}</p>}
    {confirmRevoke && <div className="ew-modal" role="presentation"><section className="ew-dialog" role="alertdialog" aria-modal="true" aria-labelledby="edge-revoke-title" data-testid="dialog-revoke-edge">
      <h2 id="edge-revoke-title">{tx('revoke')}</h2><p className="ew-prompt">{tx('revokeConfirm')}</p>
      <div className="ew-actions"><button className="ew-button" onClick={()=>setConfirmRevoke(false)} data-testid="button-cancel-revoke">{tx('cancel')}</button><button className="ew-button danger" disabled={!!busy} onClick={async()=>{const ok=await action('revoke',`/edge-console/nodes/${encodeURIComponent(selected)}/credentials/revoke`,'POST');if(ok!==undefined){setConfirmRevoke(false);await load()}}} data-testid="button-confirm-revoke">{tx('confirm')}</button></div>
    </section></div>}
  </div>;
}
