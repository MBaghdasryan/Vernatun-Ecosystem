import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { request } from '../client';
import type { Language } from '../i18n';
import type { RoleContext } from '../types';
import { ENVIRONMENTS, EDGE_CONFIG, LOCKED_CAPS, MODULES, UNPROVEN_CAPS, tr, type EdgeMode } from './config';
import { Badge, Modal, errorText, fmt, rel, type Row } from './ui';
import DeviceActions, { DeviceCapabilityPolicy } from './DeviceActions';

type Props = {
  c: RoleContext; language: Language; mode: EdgeMode; detail: Row; buildings: Row[]; blocks: Row[];
  onReload: () => void; onToken: (id: string) => void; onSecret: (token: string, node: Row) => void;
};
const CHECK_KEYS = ['cloud', 'registration', 'credential', 'websocket', 'heartbeat', 'inventory', 'telemetry', 'events', 'alarms', 'queue', 'localAuthorization'];

export default function Detail({ c, language, mode, detail, buildings, blocks, onReload, onToken, onSecret }: Props) {
  const L = (k: string) => tr(language, k);
  const cfg = EDGE_CONFIG[mode];
  const node: Row = detail.node;
  const has = (p: string) => c.permissions.includes(p);
  const canManage = has('edge.manage');
  const canConfig = has('edge.config.manage') || canManage;
  const canBootstrap = has('edge.bootstrap.create');
  const canRotate = cfg.canRotate && has('edge.credentials.rotate');
  const canRevoke = cfg.canRotate && has('edge.credentials.revoke');
  const tabs = cfg.tabs.filter(t => t !== 'config' || canConfig || mode === 'platform');
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>();
  const [ok, setOk] = useState('');
  const [check, setCheck] = useState<Row>();
  const [view, setView] = useState<'human' | 'raw'>('human');
  const [confirm, setConfirm] = useState<{ kind: 'archive' | 'revoke' | 'rotate' | 'removeBuilding' | 'revokeToken' | 'access' | 'removeAccess'; id?: string; extra?: string } | null>(null);
  const [access, setAccess] = useState<Record<string, string>>({});
  const [addB, setAddB] = useState('');
  const base = `/edge-console/nodes/${encodeURIComponent(node.id)}`;
  const buildingsList: Row[] = detail.buildings ?? [];
  const configuration: Row = detail.configuration ?? {};
  const initial = {
    name: node.name ?? '', siteCode: node.site_code ?? '',
    description: configuration.description == null ? '' : String(configuration.description),
    hb: configuration.heartbeatSeconds == null ? '' : String(configuration.heartbeatSeconds),
    inv: configuration.inventorySeconds == null ? '' : String(configuration.inventorySeconds),
    tel: configuration.telemetrySeconds == null ? '' : String(configuration.telemetrySeconds),
    projectName: node.project_name == null ? '' : String(node.project_name),
    environment: node.environment == null ? '' : String(node.environment),
    modules: Array.isArray(configuration.enabledModules) ? (configuration.enabledModules as string[]) : [],
  };
  const modulesKnown = Array.isArray(configuration.enabledModules);
  const [cfgForm, setCfgForm] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  useEffect(() => {
    if (JSON.stringify(cfgForm) === JSON.stringify(baseline)) {
      setCfgForm(initial); setBaseline(initial);
    }
    // Do not overwrite an operator's unsaved edits on polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.config_version]);

  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key); setErr(undefined); setOk('');
    try { const r = await fn(); setOk(L('done')); after?.(); onReload(); return r; } catch (e) { setErr(e); return undefined; } finally { setBusy(''); }
  };
  const runCheck = async () => {
    setBusy('check'); setErr(undefined);
    try { setCheck(await request<Row>(`${base}/connection-check`)); } catch (e) { setErr(e); } finally { setBusy(''); }
  };
  const saveCfg = (e: FormEvent) => {
    e.preventDefault();
    const body: Row = {};
    if (cfgForm.name.trim() !== baseline.name) body.name = cfgForm.name.trim();
    if (cfgForm.siteCode.trim() !== baseline.siteCode) body.siteCode = cfgForm.siteCode.trim();
    if (cfgForm.projectName.trim() !== baseline.projectName) body.projectName = cfgForm.projectName.trim();
    if (cfgForm.environment !== baseline.environment && cfgForm.environment) body.environment = cfgForm.environment;
    if (cfgForm.description !== baseline.description) body.description = cfgForm.description;
    if (cfgForm.hb !== baseline.hb && cfgForm.hb.trim()) body.heartbeatSeconds = Number(cfgForm.hb);
    if (cfgForm.inv !== baseline.inv && cfgForm.inv.trim()) body.inventorySeconds = Number(cfgForm.inv);
    if (cfgForm.tel !== baseline.tel && cfgForm.tel.trim()) body.telemetrySeconds = Number(cfgForm.tel);
    if (JSON.stringify([...cfgForm.modules].sort()) !== JSON.stringify([...baseline.modules].sort())) body.enabledModules = cfgForm.modules;
    if (!Object.keys(body).length) return;
    void run('cfg', () => request(base, 'PATCH', body), () => setBaseline(cfgForm));
  };
  const patchBuildings = (ids: string[]) => run('bld', () => request(`${base}/buildings`, 'PATCH', { buildingIds: ids }), () => setAddB(''));

  const archived = !!node.archived_at;
  const isV2 = Number(node.protocol_version) === 2 || !!node.block_id;
  const currentBlock = blocks.find(b => b.id === node.block_id);
  const addable = isV2 ? (currentBlock?.buildings ?? []).filter((b: Row) => !buildingsList.some(x => x.id === b.id)) : [];
  const buildingName = (id: string) => buildings.find(b => b.id === id);

  const Fact = (k: string, v: ReactNode) => <div className="em-fact" key={k}><small>{k}</small><strong>{v ?? '—'}</strong></div>;
  const Table = (head: string[], rows: ReactNode[][], empty = L('noData')) => rows.length
    ? <div className="em-scroll"><table className="em-table"><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j}>{x ?? '—'}</td>)}</tr>)}</tbody></table></div>
    : <div className="em-state" data-testid="text-tab-empty">{empty}</div>;
  const t = (v: unknown) => fmt(v, language);

  const feed: Row[] = [
    ...(detail.telemetry ?? []).map((x: Row) => ({ ...x, _k: 'telemetry' })),
    ...(detail.events ?? []).map((x: Row) => ({ ...x, _k: 'event' })),
    ...(detail.alarms ?? []).map((x: Row) => ({ ...x, _k: 'alarm' })),
  ].map(x => ({ ...x, _t: x.received_at ?? x.created_at ?? x.ts ?? x.reported_at ?? x.started_at })).sort((a, b) => new Date(b._t ?? 0).getTime() - new Date(a._t ?? 0).getTime()).slice(0, 20);
  const payloadOf = (x: Row) => x.payload ?? x.data ?? x.values ?? x.value ?? null;
  const human = (x: Row) => { const p = payloadOf(x); if (p && typeof p === 'object') return Object.entries(p).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n'); return p != null ? String(p) : String(x.alarm_type ?? x.event_type ?? x.status ?? ''); };

  const renderCheck = (k: string) => {
    const v = check?.checks?.[k];
    if (v === undefined) return null;
    const o: Row = typeof v === 'object' && v ? v : { status: v };
    const extra = Object.entries(o).filter(([key, val]) => key !== 'status' && val != null && typeof val !== 'object').map(([key, val]) => `${key}: ${/_at$|At$|^last/.test(key) ? t(val) : String(val)}`).join(' · ');
    return <div className="em-check" key={k}><span><strong>{L('c_' + k)}</strong>{extra && <small>{extra}</small>}</span><Badge value={o.status ?? 'UNKNOWN'} /></div>;
  };

  return <section className="em-panel em-detail" data-testid={'panel-edge-detail-' + node.id}>
    <div className="em-dhead">
      <div><h2>{node.name} <Badge value={archived ? L('archived') : node.status} /></h2><span className="em-mono">{node.edge_id}</span>{Array.isArray(node.status_reasons) && node.status_reasons.length > 0 && <small className="em-status-reasons">{(node.status_reasons as string[]).map(r => L('reason_' + r)).join(' · ')}</small>}</div>
      <div className="em-actions">
        <button className="em-btn" onClick={() => { setTab('connection'); void runCheck(); }} data-testid="button-detail-check">{L('checkConn')}</button>
        {canManage && !archived && <button className="em-btn bad" onClick={() => setConfirm({ kind: 'archive' })} data-testid="button-archive-edge">{L('archive')}</button>}
        {canManage && archived && <button className="em-btn" disabled={!!busy} onClick={() => void run('restore', () => request(`${base}/restore`, 'POST'))}>{L('restore')}</button>}
      </div>
    </div>
    {!!err && <div className="em-alert bad" role="alert">{errorText(err, language)}</div>}
    {!!ok && <div className="em-alert ok" role="status">{ok}</div>}
    <div className="em-tabs" role="tablist">{tabs.map((k, i) => <button key={k} id={'em-tab-' + k} role="tab" aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} className="em-tab" onClick={() => setTab(k)} onKeyDown={e => {
      const n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
      if (n < 0) return; e.preventDefault(); setTab(tabs[n]); document.getElementById('em-tab-' + tabs[n])?.focus();
    }} data-testid={'tab-' + k}>{L('tab_' + k)}</button>)}</div>

    {tab === 'overview' && <div className="em-facts">
      {Fact(L('org'), node.organization_name)}{Fact(L('block'), node.block_name)}{Fact(L('buildings'), buildingsList.map(b => b.name).join(', ') || node.building_name)}{Fact(L('project'), node.project_name)}{Fact(L('environment'), node.environment ? L('env_' + node.environment) : '—')}{Fact(L('site'), node.site_code)}
      {Fact(L('agentVersion'), node.agent_version)}{Fact(L('os'), node.os ?? node.os_name)}{Fact(L('arch'), node.architecture ?? node.arch)}{Fact(L('protocol'), 'v' + (node.protocol_version ?? 1))}
      {Fact(L('registration'), <Badge value={node.registration_state} />)}{Fact(L('ws'), <Badge value={node.web_socket_open ? 'CONNECTED' : 'DISCONNECTED'} />)}
      {Fact(L('heartbeat'), node.last_heartbeat_at ? `${rel(node.last_heartbeat_at, language)} (${t(node.last_heartbeat_at)})` : '—')}
      {Fact(L('lastInventory'), t(node.last_inventory_at))}{Fact(L('lastTelemetry'), t(node.last_telemetry_at))}{Fact(L('lastEvent'), t(node.last_event_at))}{Fact(L('lastAlarm'), t(node.last_alarm_at))}
      {Fact(L('queue'), node.queue_depth)}{Fact(L('localAuth'), <Badge value={node.local_authorization_status} />)}
      {Fact(L('createdAt'), t(node.created_at))}{Fact(L('registeredAt'), t(node.registered_at))}{Fact(L('lastSeen'), t(node.last_seen_at))}
      {mode === 'platform' && <>{Fact(L('tenant'), <span className="em-mono">{node.organization_id}</span>)}{Fact(L('blockId'), <span className="em-mono">{node.block_id ?? '—'}</span>)}</>}
      {Fact(L('description'), String(configuration.description ?? node.description ?? '—'))}
    </div>}

    {tab === 'connection' && <div className="em-two">
      <div className="em-form">
        <div className="em-actions" style={{ justifyContent: 'space-between' }}><h3>{L('checkResults')}</h3><button className="em-btn pri" disabled={busy === 'check'} onClick={() => void runCheck()} data-testid="button-run-check">{L('runCheck')}</button></div>
        {check ? <><div className="em-checks" data-testid="list-connection-checks">{check.overallStatus && <div className="em-check"><strong>{L('overall')}</strong><Badge value={check.overallStatus} /></div>}{CHECK_KEYS.map(renderCheck)}</div>
          <small>{L('checkedAt')}: {t(check.checkedAt)}</small></> : <div className="em-alert info">{L('noCheckYet')}</div>}
      </div>
      <div className="em-form">
        <div className="em-actions" style={{ justifyContent: 'space-between' }}><h3>{L('lastData')}</h3>
          <div className="em-seg"><button aria-pressed={view === 'human'} onClick={() => setView('human')}>{L('human')}</button><button aria-pressed={view === 'raw'} onClick={() => setView('raw')}>{L('raw')}</button></div></div>
        {feed.length ? <div className="em-feed">{feed.map((x, i) => <article key={x.id ?? i}>
          <span><strong>{t(x._t)}</strong> · {x.device_name ?? x.edge_device_id ?? '—'} · <Badge value={x.alarm_type ?? x.event_type ?? x._k} dot={false} /></span>
          <pre>{view === 'raw' ? JSON.stringify(x, (k, v) => k.startsWith('_') ? undefined : v, 2) : human(x)}</pre></article>)}</div> : <div className="em-state">{L('noData')}</div>}
      </div>
    </div>}

    {tab === 'buildings' && <div className="em-form">
      {!isV2 ? <div className="em-alert info">{L('v1Locked')}</div> : <div className="em-alert info">{L('v2Note')}</div>}
      {Table([L('building'), L('address'), L('devices'), L('alarms'), L('lastTelemetry'), ...(canManage && isV2 ? [L('actions')] : [])],
        buildingsList.map(b => { const info = buildingName(b.id); return [b.name, b.address ?? info?.address ?? '—', b.device_count ?? '—', b.active_alarms ?? '—', t(b.last_telemetry_at),
          ...(canManage && isV2 && !archived ? [<button className="em-btn bad" disabled={!!busy || buildingsList.length < 2} onClick={() => setConfirm({ kind: 'removeBuilding', id: b.id, extra: b.name })}>{L('remove')}</button>] : [])]; }))}
      {canManage && isV2 && !archived && addable.length > 0 && <div className="em-actions"><select value={addB} onChange={e => setAddB(e.target.value)} aria-label={L('addBuilding')}><option value="">{L('chooseBuilding')}</option>{addable.map((b: Row) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <button className="em-btn pri" disabled={!addB || !!busy} onClick={() => void patchBuildings([...buildingsList.map(x => x.id), addB])}>{L('addBuilding')}</button></div>}
    </div>}

    {tab === 'devices' && Table([L('device'), L('deviceId'), L('profile'), L('building'), L('zone'), L('status'), L('actions'), L('lastTelemetry'), L('lastEvt'), L('tbId'), L('access')],
      (detail.devices ?? []).map((d: Row) => [d.label || d.name, <span className="em-mono">{d.edge_device_id}</span>, d.profile ?? d.device_type, d.building_name, d.zone ?? d.unit_id, <Badge value={d.reported_online == null ? 'UNKNOWN' : d.reported_online ? 'ONLINE' : 'OFFLINE'} />, <DeviceActions key={`${c.id}:${d.id}`} context={c} language={language} node={node} device={d} />, t(d.last_telemetry_at), t(d.last_event_at), <span className="em-mono">{d.thingsboard_id ?? '—'}</span>,
        <div className="em-form">{canConfig && !archived && <DeviceCapabilityPolicy key={`${d.id}:${(d.enabled_capabilities ?? []).join(',')}`} device={d} language={language} onSaved={onReload} />}
          {Array.isArray(d.capabilities) && d.capabilities.includes('BARRIER.OPEN') && <>{(d.access_units ?? []).map((a: Row) => <span className="em-actions" key={a.unitId}><span className="em-mono">{a.unitId} · {(a.allowedCapabilities ?? []).join(', ')}</span>{canManage && !archived && <button className="em-btn bad" disabled={!!busy} onClick={() => setConfirm({ kind: 'removeAccess', id: d.id, extra: a.unitId })}>{L('removeAccess')}</button>}</span>)}
          {canManage && !archived && <span className="em-actions"><input aria-label={L('unitId')} placeholder={L('unitId')} value={access[d.id] ?? ''} onChange={e => setAccess({ ...access, [d.id]: e.target.value })} /><button className="em-btn" disabled={!!busy || !access[d.id]?.trim()} onClick={() => setConfirm({ kind: 'access', id: d.id, extra: access[d.id].trim() })}>{L('allowOpen')}</button></span>}</>}</div>]))}

    {tab === 'commands' && <div className="em-form"><div className="em-alert info">{L('cmdReadOnly')}</div>
      {Table([L('time'), 'ID', L('actor'), L('role'), L('device'), L('capability'), L('decision'), L('status'), L('source'), L('error')],
        (detail.commands ?? []).map((m: Row) => [t(m.requested_at), <span className="em-mono">{m.command_id}</span>, m.actor_name ?? m.requested_by_user_id ?? '—', m.requested_role, m.edge_device_id, m.capability, <Badge value={m.authorization_decision ?? 'UNKNOWN'} />, <Badge value={String(m.status ?? '').toUpperCase()} />, m.source_product, m.error_code]))}</div>}

    {tab === 'alarms' && Table([L('severity'), L('type'), L('device'), L('building'), L('started'), L('status'), L('ackBy'), L('cleared')],
      (detail.alarms ?? []).map((a: Row) => [<Badge value={String(a.severity ?? '').toUpperCase()} />, a.alarm_type, a.device_name ?? a.edge_device_id, a.building_name, t(a.received_at), <Badge value={String(a.status ?? '').toUpperCase()} />, a.acknowledged_by_name ?? a.acknowledged_by ?? '—', t(a.resolved_at)]))}

    {tab === 'audit' && Table([L('time'), L('actor'), L('action'), L('ip'), L('result')],
      [...(detail.audit ?? [])].map((a: Row) => [t(a.created_at), a.actor_name ?? a.actor_user_id ?? '—', a.action, a.ip ?? a.ip_address ?? '—', a.result ?? a.outcome ?? '—']))}

    {tab === 'config' && <form className="em-form" onSubmit={saveCfg}>
      <div className="em-grid2">
        <label>{L('name')}<input value={cfgForm.name} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, name: e.target.value })} /></label>
        <label>{L('project')}<input value={cfgForm.projectName} maxLength={120} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, projectName: e.target.value })} /></label>
        <label>{L('environment')}<select value={cfgForm.environment} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, environment: e.target.value })}>{!cfgForm.environment && <option value="">—</option>}{ENVIRONMENTS.map(v => <option key={v} value={v}>{L('env_' + v)}</option>)}</select><small>{L('envNote')}</small></label>
        <label>{L('site')}<input value={cfgForm.siteCode} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, siteCode: e.target.value })} /></label>
        <label>{L('interval_hb')}<input type="number" min={5} value={cfgForm.hb} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, hb: e.target.value })} /></label>
        <label>{L('interval_inv')}<input type="number" min={30} value={cfgForm.inv} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, inv: e.target.value })} /></label>
        <label>{L('interval_tel')}<input type="number" min={1} value={cfgForm.tel} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, tel: e.target.value })} /></label>
      </div>
      <label>{L('description')}<textarea rows={2} value={cfgForm.description} disabled={!canConfig || archived} onChange={e => setCfgForm({ ...cfgForm, description: e.target.value })} /></label>
      <fieldset style={{ border: '1px solid var(--ln)', borderRadius: 8 }}><legend>{L('modules')}</legend>{!modulesKnown && <small>{L('modulesUnknown')}</small>}{MODULES.map(m => <label className="em-opt" key={m}><input type="checkbox" disabled={!canConfig || archived || !modulesKnown} checked={cfgForm.modules.includes(m)} onChange={() => setCfgForm({ ...cfgForm, modules: cfgForm.modules.includes(m) ? cfgForm.modules.filter(x => x !== m) : [...cfgForm.modules, m] })} />{L('m_' + m)}</label>)}</fieldset>
      <fieldset style={{ border: '1px solid var(--ln)', borderRadius: 8 }}><legend>{L('capsTitle')}</legend>
        {LOCKED_CAPS.map(k => <label className="em-opt" key={k}><input type="checkbox" disabled checked={false} /><Lock size={14} /> <span className="em-mono">{k}</span> <Badge value={L('safetyLocked')} dot={false} /></label>)}
        {UNPROVEN_CAPS.map(k => <label className="em-opt" key={k}><input type="checkbox" disabled checked={false} /><span className="em-mono">{k}</span> <small>{L('unproven')}</small></label>)}
      </fieldset>
      {canConfig && !archived && <div><button className="em-btn pri" disabled={!!busy} data-testid="button-save-config">{L('save')}</button></div>}
    </form>}

    {tab === 'security' && <div className="em-form">
      <div className="em-facts">{Fact(L('registration'), <Badge value={node.registration_state} />)}{Fact(L('credStatus'), <Badge value={node.credential_active ? 'ACTIVE' : node.credential_state ?? (node.credential_issued_at === null ? L('notIssued') : 'UNKNOWN')} />)}{Fact(L('credVersion'), node.credential_issued_at ? node.credential_version : '—')}</div>
      <div className="em-actions">
        {canBootstrap && !archived && <button className="em-btn pri" onClick={() => onToken(node.id)}><KeyRound size={15} />{L('genToken')}</button>}
        {canRotate && !archived && <button className="em-btn" disabled={!!busy} onClick={() => setConfirm({ kind: 'rotate' })}>{L('rotate')}</button>}
        {canRevoke && !archived && <button className="em-btn bad" onClick={() => setConfirm({ kind: 'revoke' })}><ShieldAlert size={15} />{L('revokeCred')}</button>}
      </div>
      {canRotate && <small>{L('rotateNote')}</small>}
      <h3>{L('tokens')}</h3>
      {Table([L('createdAt'), L('status'), L('expires'), L('usedAt'), ...(canBootstrap ? [L('actions')] : [])],
        (detail.tokens ?? []).map((k: Row) => { const st = k.status ?? (k.used_at ? 'USED' : k.revoked_at ? 'REVOKED' : new Date(k.expires_at) <= new Date() ? 'EXPIRED' : 'PENDING'); return [t(k.created_at), <Badge value={st} />, t(k.expires_at), t(k.used_at), ...(canBootstrap ? [st === 'PENDING' ? <button className="em-btn bad" disabled={!!busy} onClick={() => setConfirm({ kind: 'revokeToken', id: k.id })}>{L('revokeToken')}</button> : '—'] : [])]; }))}
    </div>}

    {confirm && (() => {
      const k = confirm.kind;
      const msg: Record<string, string> = { archive: L('archiveAsk'), revoke: L('revokeAsk'), rotate: L('rotateAsk'), removeBuilding: `${L('removeBuildingAsk')} ${confirm.extra ?? ''}`, revokeToken: L('revokeTokenAsk'), access: `${L('accessAsk')} ${confirm.extra ?? ''}`, removeAccess: `${L('removeAccessAsk')} ${confirm.extra ?? ''}` };
      const go = () => {
        const done = () => setConfirm(null);
        if (k === 'archive') return run(k, () => request(base, 'DELETE'), done);
        if (k === 'revoke') return run(k, () => request(`${base}/credentials/revoke`, 'POST'), done);
        if (k === 'rotate') return run(k, async () => { const r = await request<Row>(`${base}/credentials/rotate`, 'POST'); if (typeof r?.accessToken === 'string') onSecret(r.accessToken, node); }, done);
        if (k === 'removeBuilding') return patchBuildings(buildingsList.filter(x => x.id !== confirm.id).map(x => x.id)).then(done);
        if (k === 'revokeToken') return run(k, () => request(`/edge-console/bootstrap-tokens/${encodeURIComponent(confirm.id!)}/revoke`, 'POST'), done);
        if (k === 'access') return run(k, () => request(`/edge-console/devices/${encodeURIComponent(confirm.id!)}/access`, 'PUT', { unitId: confirm.extra, allowedCapabilities: ['BARRIER.OPEN'] }), () => { setAccess(x => ({ ...x, [confirm.id!]: '' })); done(); });
        return run(k, () => request(`/edge-console/devices/${encodeURIComponent(confirm.id!)}/access/${encodeURIComponent(confirm.extra!)}`, 'DELETE'), done);
      };
      return <Modal title={L('confirmTitle')} onClose={() => setConfirm(null)} labelId="em-confirm-title">
        <p>{msg[k]}</p>
        {!!err && <div className="em-alert bad" role="alert">{errorText(err, language)}</div>}
        <div className="em-actions"><button className="em-btn" onClick={() => setConfirm(null)}>{L('cancel')}</button>
          <button className="em-btn bad" disabled={!!busy} data-testid="button-confirm-action" onClick={() => void go()}>{L('confirm')}</button></div>
      </Modal>;
    })()}
  </section>;
}
