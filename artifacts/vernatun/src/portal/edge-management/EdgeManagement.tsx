import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, KeyRound, Activity, RefreshCw, ShieldOff } from 'lucide-react';
import { request, ApiClientError } from '../client';
import type { Language } from '../i18n';
import type { RoleContext } from '../types';
import { EDGE_CONFIG, ENVIRONMENTS, REFRESH, modeFor, tr } from './config';
import BlockManagement from './BlockManagement';
import Detail from './Detail';
import { AddEdgeWizard, TokenModal } from './Wizard';
import { Badge, Modal, errorKind, fmt, rel, styles, type Row } from './ui';

type Filters = { project: string; environment: string; registration: string; search: string; org: string; block: string; building: string; status: string; ws: string; version: string };
const EMPTY: Filters = { project: '', environment: '', registration: '', search: '', org: '', block: '', building: '', status: '', ws: '', version: '' };

export default function EdgeManagement({ c, language }: { c: RoleContext; language: Language }) {
  const L = (k: string) => tr(language, k);
  const mode = modeFor(c);
  const cfg = EDGE_CONFIG[mode];
  const has = (p: string) => c.permissions.includes(p);
  const canCreate = has('edge.manage') && has('edge.bootstrap.create');
  const canBootstrap = has('edge.bootstrap.create');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(REFRESH.pageSize);
  const [archived, setArchived] = useState(false);
  const [fleet, setFleet] = useState<Row>();
  const [fleetErr, setFleetErr] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Row>();
  const [detailErr, setDetailErr] = useState<unknown>();
  const [buildings, setBuildings] = useState<Row[]>([]);
  const [blocks, setBlocks] = useState<Row[]>([]);
  const [wizard, setWizard] = useState(false);
  const [tokenFor, setTokenFor] = useState<{ id?: string } | null>(null);
  const [secret, setSecret] = useState<{ token: string; name: string }>();
  const [apiNote, setApiNote] = useState('');
  const [topoErr, setTopoErr] = useState(false);
  const [topoTick, setTopoTick] = useState(0);
  const [blockMgr, setBlockMgr] = useState(false);
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h1.current?.focus(); }, []);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  const fleetSeq = useRef(0);
  const detailSeq = useRef(0);
  const selectedRef = useRef('');
  selectedRef.current = selected;

  useEffect(() => { const t = setTimeout(() => { setDebounced(filters.search); setPage(1); }, 350); return () => clearTimeout(t); }, [filters.search]);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const query = (() => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debounced.trim()) q.set('search', debounced.trim());
    if (filters.org && mode === 'platform') q.set('organizationId', filters.org);
    if (filters.block) q.set('blockId', filters.block);
    if (filters.building) q.set('buildingId', filters.building);
    if (filters.status) q.set('status', filters.status);
    if (filters.ws) q.set('websocket', filters.ws);
    if (filters.version) q.set('version', filters.version);
    if (filters.project) q.set('project', filters.project);
    if (filters.environment) q.set('environment', filters.environment);
    if (filters.registration) q.set('registration', filters.registration);
    if (archived) q.set('includeArchived', 'true');
    return q.toString();
  })();

  const loadFleet = useCallback(async (silent = false) => {
    const seq = ++fleetSeq.current;
    if (!silent) setLoading(true);
    try {
      const f = await request<Row>(`/edge-console/fleet?${query}`);
      if (seq !== fleetSeq.current) return;
      setFleet(f); setFleetErr(undefined);
    } catch (e) { if (seq === fleetSeq.current) setFleetErr(e); }
    finally { if (seq === fleetSeq.current) setLoading(false); }
  }, [query, c.id]);
  useEffect(() => { void loadFleet(); const t = setInterval(() => void loadFleet(true), REFRESH.fleetMs); return () => clearInterval(t); }, [loadFleet]);

  const loadDetail = useCallback(async (id: string) => {
    const seq = ++detailSeq.current;
    try {
      const d = await request<Row>(`/edge-console/nodes/${encodeURIComponent(id)}`);
      if (seq !== detailSeq.current || selectedRef.current !== id) return;
      setDetail(d); setDetailErr(undefined);
    } catch (e) { if (seq === detailSeq.current) setDetailErr(e); }
  }, []);
  useEffect(() => {
    detailSeq.current++;
    if (!selected) { setDetail(undefined); return; }
    setDetail(d => (d?.node?.id === selected ? d : undefined));
    void loadDetail(selected);
    const t = setInterval(() => void loadDetail(selected), REFRESH.detailMs);
    return () => clearInterval(t);
  }, [selected, loadDetail, c.id]);

  useEffect(() => {
    if (!canBootstrap) return;
    let live = true;
    setTopoErr(false);
    Promise.all([request<Row[]>('/edge-console/buildings'), request<Row>('/edge-console/blocks').then(r => r.blocks as Row[])])
      .then(([b, bl]) => { if (live) { setBuildings(b); setBlocks(bl); } })
      .catch(() => { if (live) setTopoErr(true); });
    return () => { live = false; };
  }, [canBootstrap, c.id, topoTick]);

  useEffect(() => { // context switch: drop selection, one-time secrets and open dialogs
    setSelected(''); setDetail(undefined); setFleet(undefined); setTokenFor(null); setSecret(undefined); setWizard(false); setBuildings([]); setBlocks([]);
  }, [c.id]);
  const refreshAll = () => { void loadFleet(true); if (selected) void loadDetail(selected); };
  const nodes: Row[] = fleet?.nodes ?? [];
  const summary: Row = fleet?.summary ?? {};
  const facets: Row = fleet?.facets ?? {};
  const pg: Row = fleet?.pagination ?? { page, pageSize, total: nodes.length, pages: 1 };
  const kind = fleetErr ? errorKind(fleetErr) : undefined;
  const filtered = Object.entries(filters).some(([k, v]) => v && !(k === 'org' && mode === 'organization'));
  const setF = (p: Partial<Filters>) => { setFilters(f => ({ ...f, ...p })); setPage(1); };
  const pct = (n: number) => summary.total ? `${Math.round((n / summary.total) * 100)}%` : '';

  const checkApi = async () => {
    try { await request('/auth/session'); setApiNote(L('apiOk')); } catch { setApiNote(L('apiDown')); }
  };

  if (kind === 'forbidden' && !fleet) {
    return <div className="em"><style>{styles}</style><div className="em-panel em-state" role="alert" data-testid="state-edge-forbidden"><ShieldOff size={32} /><p>{L(fleetErr instanceof ApiClientError && fleetErr.code === 'module_disabled' ? 'moduleDisabled' : 'forbidden')}</p><button className="em-btn" onClick={() => void loadFleet()}>{L('retry')}</button></div></div>;
  }

  const cardDefs: Record<string, { label: string; value: unknown; tone?: string; sub?: string }> = {
    total: { label: mode === 'organization' ? L('myTotal') : L('total'), value: summary.total },
    online: { label: L('online'), value: summary.online, tone: 'ok', sub: pct(summary.online) },
    offline: { label: L('offline'), value: summary.offline, tone: '', sub: pct(summary.offline) },
    degraded: { label: L('degraded'), value: summary.degraded, tone: 'warn', sub: pct(summary.degraded) },
    waiting: { label: L('waiting'), value: summary.waiting, tone: 'warn' },
    syncErrors: { label: L('syncErrors'), value: summary.syncErrors, tone: 'bad' },
    alarms: { label: L('alarms'), value: summary.activeAlarms, tone: 'bad' },
    devices: { label: L('devices'), value: summary.devices },
    lastSync: { label: L('lastSync'), value: rel(summary.lastSync, language) },
  };

  const cell = (col: string, n: Row): React.ReactNode => {
    switch (col) {
      case 'name': return <strong>{n.name}</strong>;
      case 'edgeId': return <span className="em-mono">{n.edge_id}</span>;
      case 'org': return n.organization_name ?? '—';
      case 'project': return n.project_name ?? '—';
      case 'block': return n.block_name ?? n.building_name ?? '—';
      case 'buildings': return n.building_count ?? '—';
      case 'site': return n.site_code;
      case 'status': return <Badge value={n.archived_at ? L('archived') : n.status} />;
      case 'registration': return <Badge value={n.registration_state} />;
      case 'ws': return <Badge value={n.web_socket_open ? 'CONNECTED' : 'DISCONNECTED'} />;
      case 'heartbeat': return rel(n.last_heartbeat_at, language);
      case 'queue': return n.queue_depth ?? '—';
      case 'devices': return n.device_count ?? 0;
      case 'version': return n.agent_version ?? '—';
      case 'alarms': return Number(n.active_alarms) > 0 ? <Badge value="CRITICAL" dot={false} /> : <span>{n.active_alarms ?? 0}</span>;
      case 'sync': return rel(n.last_inventory_at ?? n.last_telemetry_at ?? n.last_seen_at, language);
      default: return '—';
    }
  };
  const alarmCell = (col: string, n: Row) => col === 'alarms' ? <span>{n.active_alarms ?? 0}</span> : cell(col, n);

  return <div className="em" data-testid="edge-workspace">
    <style>{styles}</style>
    <div className="em-head">
      <div><h1 ref={h1} tabIndex={-1}>{L('title')}</h1><div className="em-sub">{L(cfg.subtitle)}</div></div>
      <div className="em-actions">
        {canCreate && <button className="em-btn pri" onClick={() => setWizard(true)} data-testid="button-add-edge"><Plus size={16} />{L('add')}</button>}
        {canCreate && <button className="em-btn" onClick={() => setBlockMgr(true)} data-testid="button-block-settings">{L('blockSettings')}</button>}
        {canBootstrap && <button className="em-btn out" onClick={() => setTokenFor({ id: selected || undefined })} data-testid="button-generate-token"><KeyRound size={16} />{L('genToken')}</button>}
        {mode === 'organization' && <button className="em-btn out" disabled={!selected} onClick={() => { document.getElementById('em-detail')?.scrollIntoView({ behavior: 'smooth' }); document.querySelector<HTMLElement>('[data-testid="button-detail-check"]')?.click(); }} data-testid="button-check-connection"><Activity size={16} />{L('checkConn')}</button>}
        <button className="em-btn" onClick={refreshAll} aria-label={L('refresh')}><RefreshCw size={15} /></button>
      </div>
    </div>

    {offline && <div className="em-alert info" role="status">{L('offlineNote')}</div>}
    {kind === 'unavailable' && <div className="em-alert warn" role="alert" data-testid="state-edge-unavailable"><span>{fleet ? L('unavailable') : L('unavailableEmpty')}{apiNote && ` — ${apiNote}`}</span>
      <span className="em-actions"><button className="em-btn" onClick={() => void loadFleet()}>{L('retry')}</button><button className="em-btn" onClick={() => void checkApi()}>{L('checkApi')}</button></span></div>}
    {topoErr && <div className="em-alert warn" role="alert"><span>{L('topologyErr')}</span><button className="em-btn" onClick={() => setTopoTick(x => x + 1)}>{L('retry')}</button></div>}
    {kind === 'other' && <div className="em-alert bad" role="alert"><span>{L('partial')}</span><button className="em-btn" onClick={() => void loadFleet()}>{L('retry')}</button></div>}

    <div className="em-cards" data-testid="edge-fleet-summary">
      {cfg.cards.map(k => { const d = cardDefs[k]; return <div className="em-card" key={k} data-testid={'metric-edge-' + k}><span>{d.tone !== undefined && <i className={'em-dot ' + d.tone} />}{d.label}</span><strong>{loading && !fleet ? '…' : fleet ? String(d.value ?? 0) : '—'}</strong>{d.sub && <small>{d.sub}</small>}</div>; })}
    </div>

    <div className="em-filters">
      {cfg.filters.includes('org') && <label>{L('org')}<select value={filters.org} onChange={e => setF({ org: e.target.value })}><option value="">{L('allOrgs')}</option>{(facets.organizations ?? []).map((o: Row) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
      {cfg.filters.includes('project') && <label>{L('project')}<select value={filters.project} onChange={e => setF({ project: e.target.value })}><option value="">{L('allProjects')}</option>{(facets.projects ?? []).map((v: string) => <option key={v} value={v}>{v}</option>)}</select></label>}
      <label>{L('block')}<select value={filters.block} onChange={e => setF({ block: e.target.value })}><option value="">{L('allBlocks')}</option>{(facets.blocks ?? []).map((o: Row) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>{L('building')}<select value={filters.building} onChange={e => setF({ building: e.target.value })}><option value="">{L('allBuildings')}</option>{(facets.buildings ?? []).map((o: Row) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>{L('status')}<select value={filters.status} onChange={e => setF({ status: e.target.value })}><option value="">{L('allStatuses')}</option>{['ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN'].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      {cfg.filters.includes('registration') && <label>{L('registration')}<select value={filters.registration} onChange={e => setF({ registration: e.target.value })}><option value="">{L('allRegs')}</option>{['PENDING_REGISTRATION', 'REGISTERED', 'REVOKED'].map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}</select></label>}
      <label>{L('ws')}<select value={filters.ws} onChange={e => setF({ ws: e.target.value })}><option value="">{L('all')}</option><option value="CONNECTED">{L('connected')}</option><option value="DISCONNECTED">{L('disconnected')}</option></select></label>
      {cfg.filters.includes('environment') && <label>{L('environment')}<select value={filters.environment} onChange={e => setF({ environment: e.target.value })}><option value="">{L('allEnvs')}</option>{(facets.environments ?? ENVIRONMENTS).map((v: string) => <option key={v} value={v}>{L('env_' + v)}</option>)}</select></label>}
      {cfg.filters.includes('version') && <label>{L('version')}<select value={filters.version} onChange={e => setF({ version: e.target.value })}><option value="">{L('allVersions')}</option>{(facets.versions ?? []).map((v: string) => <option key={v} value={v}>{v}</option>)}</select></label>}
      <label className="em-search">&nbsp;<input type="text" placeholder={L('search')} aria-label={L('search')} value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} data-testid="input-edge-search" /></label>
      {has('edge.manage') && <label className="em-opt" style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPage(1); }} />{L('showArchived')}</label>}
    </div>

    <section className="em-panel" aria-busy={loading}>
      {loading && !fleet ? <div>{[0, 1, 2, 3, 4].map(i => <div className="em-skel" key={i} />)}</div>
        : !nodes.length ? <div className="em-state" data-testid="text-edge-empty"><p>{filtered ? L('emptyFiltered') : mode === 'platform' ? L('emptyPlatform') : L('emptyOrg')}</p>{filtered && <button className="em-btn" onClick={() => { setFilters(EMPTY); setArchived(false); }}>{L('all')}</button>}{!filtered && canCreate && <button className="em-btn pri" onClick={() => setWizard(true)}><Plus size={15} />{L('add')}</button>}</div>
          : <>
            <div className="em-scroll"><table className="em-table fleet"><thead><tr>{cfg.columns.map(k => <th key={k}>{L(k)}</th>)}<th>{L('actions')}</th></tr></thead>
              <tbody>{nodes.map(n => <tr key={n.id} className={'row' + (selected === n.id ? ' sel' : '')} onClick={() => setSelected(n.id)} data-testid={'row-edge-node-' + n.id}>
                {cfg.columns.map(k => <td key={k}>{alarmCell(k, n)}</td>)}
                <td><button className="em-btn" aria-pressed={selected === n.id} onClick={e => { e.stopPropagation(); setSelected(n.id); }} data-testid={'button-open-node-' + n.id}>{L('open')}</button></td></tr>)}</tbody></table></div>
            <div className="em-cardlist">{nodes.map(n => <button key={n.id} className={selected === n.id ? 'sel' : ''} onClick={() => setSelected(n.id)}><strong>{n.name}</strong><span className="em-mono">{n.edge_id}</span><span><Badge value={n.status} /> <Badge value={n.web_socket_open ? 'CONNECTED' : 'DISCONNECTED'} /></span><small>{n.block_name ?? n.building_name} · {n.device_count ?? 0} {L('devices')} · {rel(n.last_heartbeat_at, language)}</small></button>)}</div>
            <div className="em-pager"><span>{L('rows')}: <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[10, 25, 50, 100].map(n => <option key={n}>{n}</option>)}</select> · {pg.total}</span>
              <span className="em-actions"><button className="em-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="prev">‹</button><span>{L('page')} {pg.page} / {pg.pages || 1}</span><button className="em-btn" disabled={page >= (pg.pages || 1)} onClick={() => setPage(page + 1)} aria-label="next">›</button></span></div>
          </>}
    </section>
    {fleet && <small style={{ color: 'var(--mut)' }}>{L('updated')}: {fmt(new Date().toISOString(), language)}</small>}

    <div id="em-detail">
      {selected && !detail && (detailErr ? <div className="em-alert warn" role="alert"><span>{errorKind(detailErr) === 'forbidden' ? L('forbidden') : L('unavailable')}</span><button className="em-btn" onClick={() => void loadDetail(selected)}>{L('retry')}</button></div> : <div className="em-panel">{[0, 1, 2].map(i => <div className="em-skel" key={i} />)}</div>)}
      {selected && detail && <>
        {!!detailErr && <div className="em-alert warn" role="alert"><span>{L('unavailable')}</span><button className="em-btn" onClick={() => void loadDetail(selected)}>{L('retry')}</button></div>}
        <Detail key={c.id + detail.node.id} c={c} language={language} mode={mode} detail={detail} buildings={buildings} blocks={blocks}
          onReload={refreshAll} onToken={id => setTokenFor({ id })} onSecret={(token, n) => setSecret({ token, name: n.name })} />
      </>}
    </div>

    {wizard && <AddEdgeWizard language={language} mode={mode} buildings={buildings} blocks={blocks} onClose={() => setWizard(false)}
      onCreated={id => { setWizard(false); void loadFleet(true); if (id) { setSelected(id); setTokenFor({ id }); } }} />}
    {blockMgr && <BlockManagement language={language} buildings={buildings} onClose={() => setBlockMgr(false)} onChanged={() => { setTopoTick(x => x + 1); void loadFleet(true); }} />}
    {tokenFor && <TokenModal language={language} nodes={nodes.some(n => n.id === tokenFor.id) || !detail ? nodes : [...nodes, detail.node]} presetId={tokenFor.id} onClose={() => setTokenFor(null)} onDone={refreshAll} />}
    {secret && <Modal title={L('rotate')} onClose={() => setSecret(undefined)} labelId="em-secret-title">
      <div className="em-alert warn" role="alert">{L('tokenOnce')}</div><pre className="em-token">{secret.token}</pre>
      <div className="em-actions"><button className="em-btn pri" onClick={() => void navigator.clipboard.writeText(secret.token).catch(() => undefined)}>{L('copy')}</button><button className="em-btn" onClick={() => setSecret(undefined)}>{L('close')}</button></div>
    </Modal>}
  </div>;
}
