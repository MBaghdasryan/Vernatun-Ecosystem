import { useState, type FormEvent } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { request } from '../client';
import { ReauthPrompt, needsReauth, reauthDone } from '../Reauth';
import type { Language } from '../i18n';
import { ENVIRONMENTS, MODULES, tr, type EdgeMode } from './config';
import { Modal, errorText, fmt, type Row } from './ui';

type Props = { language: Language; mode: EdgeMode; buildings: Row[]; blocks: Row[] };

/* ---------------- Token modal (plaintext lives only in component state) ---------------- */
export function TokenModal({ language, nodes, presetId, onClose, onDone }: { language: Language; nodes: Row[]; presetId?: string; onClose: () => void; onDone: () => void }) {
  const L = (k: string) => tr(language, k);
  const [nodeId, setNodeId] = useState(presetId ?? '');
  const [minutes, setMinutes] = useState('60');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const [res, setRes] = useState<Row>();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState('');
  const node = nodes.find(n => n.id === nodeId);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(undefined); setConfirmed(false);
    try { setRes(await request<Row>(`/edge-console/nodes/${encodeURIComponent(nodeId)}/bootstrap-token`, 'POST', { expiresInMinutes: Number(minutes) })); onDone(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const isV2 = res ? Number(res.protocol_version) === 2 || !!res.block_id : false;
  const bl: Row[] = res?.buildings ?? [];
  const ps = (value: unknown) => "'" + String(value ?? '').replaceAll("'", "''") + "'";
  const text = res ? (isV2
    ? [`# Edge Agent version 2 configuration export`, `EdgeId: ${res.edge_id}`, `EdgeName: ${res.edge_name}`, `TenantId: ${res.organization_id}`, `BlockId: ${res.block_id}`, `BuildingIds: ${bl.map(b => b.id).join(',')}`, `SiteCode: ${res.site_code}`, `BootstrapToken: ${res.bootstrapToken}`].join('\n')
    : ['powershell -ExecutionPolicy Bypass -File .\\scripts\\install.ps1 `', `  -EdgeId ${ps(res.edge_id)} \``, `  -EdgeName ${ps(res.edge_name)} \``, `  -TenantId ${ps(res.organization_id)} \``, `  -BuildingId ${ps(res.building_id)} \``, `  -SiteCode ${ps(res.site_code)} \``, `  -BootstrapToken ${ps(res.bootstrapToken)}`].join('\n')) : '';
  const copy = async (what: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopied(what); } catch { setErr(new Error('clipboard')); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `edge-${res?.edge_id}-${isV2 ? 'v2-config.txt' : 'v1-setup.ps1.txt'}`; a.click(); URL.revokeObjectURL(url);
  };
  const fact = (k: string, v: unknown) => <div className="em-fact" key={k}><small>{k}</small><strong>{String(v ?? '—')}</strong></div>;

  return <Modal title={res ? L('tokenOk') : L('genToken')} onClose={onClose} wide labelId="em-token-title">
    {needsReauth(err) ? <ReauthPrompt language={language} onDone={() => { setErr(undefined); setConfirmed(true); }} onCancel={() => setErr(undefined)} /> : !res ? <form className="em-form" onSubmit={submit}>
      {confirmed && <div className="em-alert info" role="status">{reauthDone(language)}</div>}
      <label>{L('chooseEdge')}<select required value={nodeId} onChange={e => setNodeId(e.target.value)} data-testid="select-token-edge"><option value="">—</option>{nodes.filter(n => !n.archived_at).map(n => <option key={n.id} value={n.id}>{n.name} · {n.edge_id}</option>)}</select></label>
      {node && <div className="em-facts">{fact(L('org'), node.organization_name)}{fact(L('block'), node.block_name)}{fact(L('building'), node.building_name)}{fact(L('edgeId'), node.edge_id)}{fact(L('site'), node.site_code)}</div>}
      <label>{L('expiry')}<input type="number" min={5} max={1440} required value={minutes} onChange={e => setMinutes(e.target.value)} data-testid="input-token-minutes" /></label>
      {!!err && <div className="em-alert bad" role="alert">{errorText(err, language)}</div>}
      <div className="em-actions"><button type="submit" className="em-btn pri" disabled={busy || !nodeId} data-testid="button-generate-token">{L('generate')}</button><button type="button" className="em-btn" onClick={onClose}>{L('cancel')}</button></div>
    </form> : <div className="em-form">
      <div className="em-alert warn" role="alert">{L('tokenOnce')}</div>
      <div className="em-facts">{fact(L('tenant'), res.organization_id)}{fact(L('building'), res.building_id ?? bl.map(b => b.name).join(', '))}{fact(L('blockId'), res.block_id)}{fact(L('edgeId'), res.edge_id)}{fact(L('edgeNameMeta'), res.edge_name)}{fact(L('site'), res.site_code)}{fact(L('expires'), fmt(res.expires_at, language))}</div>
      <div><small>Bootstrap token</small><pre className="em-token" data-testid="text-bootstrap-token">{res.bootstrapToken}</pre></div>
      <div><small>{isV2 ? L('v2cfg') : L('v1cmd')}</small><pre className="em-token">{text}</pre></div>
      <div className="em-actions">
        <button className="em-btn pri" onClick={() => void copy('t', res.bootstrapToken)} data-testid="button-copy-token">{copied === 't' ? <Check size={15} /> : <Copy size={15} />}{copied === 't' ? L('copied') : L('copy')}</button>
        <button className="em-btn" onClick={() => void copy('c', text)}>{copied === 'c' ? <Check size={15} /> : <Copy size={15} />}{L('copy')} {isV2 ? 'config' : 'command'}</button>
        <button className="em-btn" onClick={download} data-testid="button-download-setup"><Download size={15} />{L('download')}</button>
        <button className="em-btn" onClick={onClose}>{L('close')}</button>
      </div>
    </div>}
  </Modal>;
}

/* ---------------- Add Edge wizard ---------------- */
export function AddEdgeWizard({ language, mode, buildings, blocks, onClose, onCreated }: Props & { onClose: () => void; onCreated: (nodeId: string) => void }) {
  const L = (k: string) => tr(language, k);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const [f, setF] = useState({ orgId: '', edgeId: '', name: '', siteCode: '', description: '', scope: 'newBlock', blockId: '', buildingId: '', blockName: '', blockCode: '', buildingIds: [] as string[], modules: [] as string[], projectName: '', environment: '' });
  const [madeBlock, setMadeBlock] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const set = (p: Partial<typeof f>) => setF(c => ({ ...c, ...p }));
  const orgs = Array.from(new Map(buildings.map(b => [b.organization_id, b.organization_name ?? b.organization_id])).entries());
  const orgId = mode === 'platform' ? f.orgId : '';
  const orgBuildings = buildings.filter(b => mode === 'organization' || b.organization_id === f.orgId);
  const freeBuildings = orgBuildings.filter(b => !blocks.some(bl => !bl.archived_at && bl.buildings?.some((x: Row) => x.id === b.id)));
  const orgBlocks = blocks.filter(b => !b.archived_at && (mode === 'organization' || b.organization_id === f.orgId));
  const sel = (k: 'scope') => f[k];
  void sel;
  const valid = [
    !!f.edgeId.trim() && !!f.name.trim() && !!f.siteCode.trim() && (mode === 'organization' || !!f.orgId),
    f.scope === 'newBlock' ? !!f.blockName.trim() && !!f.blockCode.trim() && f.buildingIds.length > 0 : f.scope === 'existingBlock' ? !!f.blockId : !!f.buildingId,
    true, true,
  ];
  const toggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const submit = async () => {
    setBusy(true); setErr(undefined); setConfirmed(false);
    try {
      let blockId = madeBlock || f.blockId;
      if (f.scope === 'newBlock' && !madeBlock) {
        const b = await request<Row>('/edge-console/blocks', 'POST', { ...(orgId ? { organizationId: orgId } : {}), code: f.blockCode.trim(), name: f.blockName.trim(), buildingIds: f.buildingIds });
        blockId = b.id; setMadeBlock(b.id);
      }
      const created = await request<Row>('/edge-console/nodes', 'POST', {
        edgeId: f.edgeId.trim(), name: f.name.trim(), siteCode: f.siteCode.trim(),
        ...(f.description.trim() ? { description: f.description.trim() } : {}),
        ...(orgId ? { organizationId: orgId } : {}),
        ...(f.projectName.trim() ? { projectName: f.projectName.trim() } : {}),
        ...(f.environment ? { environment: f.environment } : {}),
        ...(f.scope === 'singleBuilding' ? { buildingId: f.buildingId } : { blockId }),
        enabledModules: f.modules,
      });
      onCreated(String(created.id ?? created.node?.id ?? ''));
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const names = [L('wiz1'), L('wiz2'), L('wiz3'), L('wiz4')];
  const buildingName = (id: string) => buildings.find(b => b.id === id)?.name ?? id;

  if (needsReauth(err)) return <Modal title={L('add')} onClose={onClose} wide labelId="em-wiz-title">
    <ReauthPrompt language={language} onDone={() => { setErr(undefined); setConfirmed(true); }} onCancel={() => setErr(undefined)} />
  </Modal>;

  return <Modal title={L('add')} onClose={onClose} wide labelId="em-wiz-title">
    <div className="em-steps" aria-label="steps">{names.map((n, i) => <span key={n} className={i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined}>{i + 1}. {n}</span>)}</div>
    <div className="em-form">
      {step === 0 && <>
        {mode === 'platform' && <label>{L('org')}<select value={f.orgId} onChange={e => set({ orgId: e.target.value, buildingIds: [], blockId: '', buildingId: '' })} data-testid="select-wizard-org"><option value="">{L('chooseOrg')}</option>{orgs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        <div className="em-grid2">
          <label>{L('name')}<input maxLength={120} value={f.name} onChange={e => set({ name: e.target.value })} data-testid="input-wizard-name" /></label>
          <label>{L('edgeId')}<input maxLength={80} value={f.edgeId} onChange={e => set({ edgeId: e.target.value })} data-testid="input-wizard-edge-id" /></label>
          <label>{L('project')}<input maxLength={120} value={f.projectName} onChange={e => set({ projectName: e.target.value })} /></label>
          <label>{L('environment')}<select value={f.environment} onChange={e => set({ environment: e.target.value })}><option value="">{L('env_unknown')}</option>{ENVIRONMENTS.filter(v => v !== 'unknown').map(v => <option key={v} value={v}>{L('env_' + v)}</option>)}</select></label>
          <label>{L('site')}<input maxLength={100} value={f.siteCode} onChange={e => set({ siteCode: e.target.value })} data-testid="input-wizard-site" /></label>
        </div>
        <label>{L('description')}<textarea rows={2} maxLength={500} value={f.description} onChange={e => set({ description: e.target.value })} /></label>
      </>}
      {step === 1 && <>
        <label>{L('scope')}<select value={f.scope} onChange={e => set({ scope: e.target.value })} data-testid="select-wizard-scope"><option value="newBlock">{L('newBlock')}</option><option value="existingBlock">{L('existingBlock')}</option><option value="singleBuilding">{L('singleBuilding')}</option></select></label>
        {f.scope === 'newBlock' && <>
          <div className="em-grid2"><label>{L('blockName')}<input value={f.blockName} onChange={e => set({ blockName: e.target.value })} /></label><label>{L('blockCode')}<input value={f.blockCode} onChange={e => set({ blockCode: e.target.value })} /></label></div>
          {orgBuildings.length ? <>
            <fieldset style={{ border: '1px solid var(--ln)', borderRadius: 8, maxHeight: 220, overflow: 'auto' }}><legend>{L('buildings')} ({f.buildingIds.length})</legend>
              {orgBuildings.map(b => {
                const assigned = orgBlocks.find(bl => bl.buildings?.some((x: Row) => x.id === b.id));
                return <label className="em-opt" key={b.id}><input type="checkbox" disabled={!!assigned} checked={f.buildingIds.includes(b.id)} onChange={() => set({ buildingIds: toggle(f.buildingIds, b.id) })} />{b.name}{assigned ? ` · ${L('blockAssigned')}: ${assigned.name}` : ''}</label>;
              })}
            </fieldset>
            {!freeBuildings.length && <div className="em-alert info">{L('noFreeBuildings')}</div>}
            {!!orgBlocks.length && <button type="button" className="em-btn" onClick={() => set({ scope: 'existingBlock', blockId: orgBlocks[0].id })}>{L('existingBlock')}</button>}
          </> : <div className="em-alert info">{L('noBuildings')}</div>}
        </>}
        {f.scope === 'existingBlock' && <label>{L('block')}<select value={f.blockId} onChange={e => set({ blockId: e.target.value })}><option value="">{L('chooseBlock')}</option>{orgBlocks.map(b => <option key={b.id} value={b.id}>{b.name} · {b.building_count}</option>)}</select></label>}
        {f.scope === 'singleBuilding' && <label>{L('building')}<select value={f.buildingId} onChange={e => set({ buildingId: e.target.value })}><option value="">{L('chooseBuilding')}</option>{orgBuildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      </>}
      {step === 2 && <fieldset style={{ border: '1px solid var(--ln)', borderRadius: 8 }}><legend>{L('modules')}</legend>{MODULES.map(m => <label className="em-opt" key={m}><input type="checkbox" checked={f.modules.includes(m)} onChange={() => set({ modules: toggle(f.modules, m) })} />{L('m_' + m)}</label>)}</fieldset>}
      {step === 3 && <>
        {confirmed && <div className="em-alert info" role="status">{reauthDone(language)}</div>}
        <div className="em-facts">
          {[[L('name'), f.name], [L('edgeId'), f.edgeId], [L('site'), f.siteCode], [L('protocol'), f.scope === 'singleBuilding' ? 'v1' : 'v2'],
          [L('block'), f.scope === 'newBlock' ? f.blockName : f.scope === 'existingBlock' ? blocks.find(b => b.id === f.blockId)?.name : '—'],
          [L('buildings'), f.scope === 'newBlock' ? f.buildingIds.map(buildingName).join(', ') : f.scope === 'singleBuilding' ? buildingName(f.buildingId) : (blocks.find(b => b.id === f.blockId)?.buildings ?? []).map((x: Row) => x.name).join(', ')],
          [L('modules'), f.modules.map(m => L('m_' + m)).join(', ') || '—']].map(([k, v]) => <div className="em-fact" key={String(k)}><small>{k}</small><strong>{v || '—'}</strong></div>)}
        </div>
        <div className="em-alert info">{L('afterCreate')}</div>
        {!!madeBlock && <div className="em-alert info">{L('stepRetry')}</div>}
        {!!err && <div className="em-alert bad" role="alert">{errorText(err, language)}</div>}
      </>}
      <div className="em-actions" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="em-btn" onClick={() => step ? setStep(step - 1) : onClose()}>{step ? L('back') : L('cancel')}</button>
        {step < 3 ? <button type="button" className="em-btn pri" disabled={!valid[step]} onClick={() => setStep(step + 1)} data-testid="button-wizard-next">{L('next')}</button>
          : <button type="button" className="em-btn pri" disabled={busy} onClick={() => void submit()} data-testid="button-wizard-create">{L('create')}</button>}
      </div>
    </div>
  </Modal>;
}
