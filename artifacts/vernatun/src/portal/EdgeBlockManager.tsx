import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, Check, Copy, Layers3, Pencil, Plus, RefreshCw, RotateCcw, Save, X } from 'lucide-react';
import { request, ApiClientError } from './client';
import type { Language } from './i18n';
import type { RoleContext } from './types';

type Building = { id: string; name: string; organization_id: string; organization_name?: string | null; address?: string | null };
type Block = {
  id: string; organization_id: string; code: string; name: string; organization_name?: string | null;
  archived_at?: string | null; building_count: number; edge_node_count: number;
  buildings: { id: string; name: string }[];
};
type Bootstrap = {
  id: string; edge_id: string; organization_id: string; block_id: string;
  edge_name: string; site_code: string; expires_at: string; bootstrapToken: string; oneTime: true;
};
type TokenMeta = {
  id: string; edge_id: string; organization_id: string; building_id: string | null; block_id: string | null;
  protocol_version: number; edge_name: string; site_code: string; expires_at: string;
  used_at: string | null; revoked_at: string | null; created_at: string;
  organization_name: string; building_name: string | null; block_name: string | null; status: string;
};

const labels: Record<string, [string, string, string]> = {
  title: ['Edge v2 · բլոկների կառավարում', 'Edge · управление блоками и узлами', 'Edge · block and node management'],
  help: ['Կառավարեք բլոկները, դրանց շենքերը և Edge Agent v2 գրանցումը։', 'Управляйте блоками, входящими в них зданиями и регистрацией Edge Agent v2.', 'Manage blocks, assigned buildings, and Edge Agent v2 registration.'],
  code: ['Բլոկի կոդ', 'Код блока', 'Block code'], name: ['Բլոկի անվանում', 'Название блока', 'Block name'],
  buildings: ['Շենքեր այս բլոկում', 'Здания в блоке', 'Buildings in this block'],
  createBlock: ['Ստեղծել բլոկ', 'Создать блок', 'Create block'], choose: ['Ընտրեք բլոկ', 'Выберите блок', 'Choose a block'],
  edgeId: ['Edge ID', 'Edge ID', 'Edge ID'], edgeName: ['Edge հանգույցի անվանում', 'Название Edge-узла', 'Edge node name'],
  siteCode: ['Տեղանքի կոդ', 'Код объекта', 'Site code'], expires: ['Ժամկետը՝ րոպե', 'Срок действия, мин', 'Expires in minutes'],
  createToken: ['Ստեղծել v2 գրանցման բանալի', 'Создать ключ регистрации v2', 'Create v2 bootstrap token'],
  noBlocks: ['Բլոկներ դեռ չկան։', 'Блоков пока нет.', 'No blocks yet.'],
  tokenOnce: ['Բանալին ցուցադրվում է միայն մեկ անգամ։ Պահեք այն անվտանգ տեղում։', 'Ключ показывается только один раз. Сохраните его в безопасном месте.', 'This token is shown once. Store it securely.'],
  copy: ['Պատճենել կազմաձևը', 'Скопировать конфигурацию', 'Copy configuration'], copied: ['Պատճենված է', 'Скопировано', 'Copied'],
  error: ['Չհաջողվեց կատարել գործողությունը։', 'Не удалось выполнить действие.', 'Could not complete the action.'],
  loading: ['Բեռնում…', 'Загрузка…', 'Loading…'], refresh: ['Թարմացնել', 'Обновить', 'Refresh'],
  block: ['Բլոկ', 'Блок', 'Block'], nodes: ['Edge հանգույցներ', 'Edge-узлы', 'Edge nodes'],
  protocolNote: ['V2-ը սահմանափակում է մեկ Edge նոդը բլոկի շենքերով։ Շենքերի ID-ները ստացվում են համակարգից։', 'V2 ограничивает Edge-ноду зданиями выбранного блока. ID зданий берутся из системы.', 'V2 limits a node to the selected block’s buildings. Building IDs come from the system.'],
  tenantId: ['Tenant ID / կազմակերպության ID', 'Tenant ID / ID организации', 'Tenant / organization ID'],
  buildingId: ['Building ID', 'Building ID', 'Building ID'], blockId: ['Block ID', 'Block ID', 'Block ID'],
  edit: ['Խմբագրել', 'Изменить', 'Edit'], save: ['Պահպանել', 'Сохранить', 'Save'],
  archive: ['Արխիվացնել', 'В архив', 'Archive'], restore: ['Վերականգնել', 'Восстановить', 'Restore'],
  revoked: ['Չեղարկված է', 'Отозван', 'Revoked'],
  archiveNote: ['Արխիվը պահպանում է պատմությունն ու թույլ չի տալիս նոր գրանցում։', 'Архив сохраняет историю и скрывает запись из активного списка.', 'Archive preserves history and removes the record from active lists.'],
  archived: ['Արխիվացված', 'В архиве', 'Archived'], showArchived: ['Ցույց տալ արխիվը', 'Показать архив', 'Show archived'],
  tokenHistory: ['Գրանցման բանալիների պատմություն', 'История ключей регистрации', 'Bootstrap token history'],
  revokeToken: ['Չեղարկել', 'Отозвать', 'Revoke'], pending: ['Սպասում է', 'Ожидает', 'Pending'],
  locked: ['Շենքերի կազմը հնարավոր չէ փոխել, երբ Edge հանգույցն արդեն գրանցվել է։', 'Состав зданий нельзя менять после регистрации Edge-узла.', 'Building membership is locked after an Edge node has registered.'],
  testCreated: ['Թեստային շենքը գտնվեց։ ID-ները լրացվել են համակարգից։', 'Тестовое здание найдено. Идентификаторы загружены из системы.', 'Test building found. IDs were loaded from the system.'],
  reauth: ['Для этой операции войдите заново и повторите её в течение 5 минут.', 'Для этой операции войдите заново и повторите её в течение 5 минут.', 'Sign in again, then retry within five minutes.'],
  scopeLocked: ['После регистрации Edge-узла состав блока менять нельзя. Сначала архивируйте узел.', 'Состав блока заблокирован зарегистрированным узлом. Сначала архивируйте узел.', 'A registered Edge node locks block membership. Archive the node first.'],
  activeNode: ['Սկզբում արխիվացրեք բլոկի ակտիվ Edge հանգույցները։', 'Сначала архивируйте активные Edge-узлы блока.', 'Archive active Edge nodes in this block first.'],
  success: ['Կատարված է։', 'Готово.', 'Done.'],
  empty: ['Տվյալներ չկան։', 'Нет данных.', 'No data.'],
  status: ['Կարգավիճակ', 'Статус', 'Status'],
};
const langIndex = (language: Language) => language === 'hy' ? 0 : language === 'ru' ? 1 : 2;
const testBuildingId = 'a6e398fc-2f1d-4724-9db4-11e7874683c7';
const testBuildingName = 'TEST Building 01';

export default function EdgeBlockManager({ c, language, onRefresh }: { c: RoleContext; language: Language; onRefresh?: () => void }) {
  const tx = (key: keyof typeof labels) => labels[key][langIndex(language)];
  const canManage = c.permissions.includes('edge.manage');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState<Bootstrap>();
  const [copied, setCopied] = useState(false);
  const [blockForm, setBlockForm] = useState({ code: '', name: '', buildingIds: [] as string[] });
  const [nodeForm, setNodeForm] = useState({ blockId: '', edgeId: '', name: '', siteCode: '', expiresInMinutes: '60' });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', buildingIds: [] as string[] });
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const defaultsApplied = useRef(false);

  const friendlyError = (cause: unknown) => {
    if (!(cause instanceof ApiClientError)) return tx('error');
    if (cause.code === 'recent_authentication_required') return tx('reauth');
    if (cause.code === 'edge_block_scope_locked') return tx('scopeLocked');
    if (cause.code === 'edge_block_has_active_nodes') return tx('activeNode');
    return `${tx('error')} (${cause.code || cause.status})`;
  };
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [buildingRows, blockResult, tokenResult] = await Promise.all([
        request<Building[]>('/edge-console/buildings'),
        request<{ blocks: Block[] }>('/edge-console/blocks?includeArchived=true'),
        request<{ tokens: TokenMeta[] }>('/edge-console/bootstrap-tokens'),
      ]);
      setBuildings(buildingRows);
      setBlocks(blockResult.blocks);
      setTokens(tokenResult.tokens);
      const testBuilding = buildingRows.find(b => b.id === testBuildingId || b.name === testBuildingName);
      const testBlock = blockResult.blocks.find(b => !b.archived_at && b.buildings?.some(building => building.id === testBuilding?.id));
      const assignedIds = new Set(blockResult.blocks.flatMap(block => block.buildings.map(building => building.id)));
      if (!defaultsApplied.current) {
        defaultsApplied.current = true;
        if (testBuilding && !testBlock && !assignedIds.has(testBuilding.id)) {
          setBlockForm({ code: 'building01', name: 'TEST Block 01', buildingIds: [testBuilding.id] });
          setNotice(tx('testCreated'));
        }
      }
      if (testBlock) {
        setNodeForm(current => current.edgeId ? current : {
          ...current, blockId: testBlock.id, edgeId: 'edge-building01',
          name: 'Vernatun Edge - TEST Building 01', siteCode: 'building01',
        });
      } else if (blockResult.blocks[0]) {
        setNodeForm(current => current.blockId ? current : { ...current, blockId: blockResult.blocks[0].id });
      }
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }, [c.id, language, showArchived]);
  useEffect(() => { void load(); }, [load]);

  const createBlock = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const first = buildings.find(building => blockForm.buildingIds.includes(building.id));
      await request('/edge-console/blocks', 'POST', {
        ...(c.organization_id ? { organizationId: c.organization_id } : first ? { organizationId: first.organization_id } : {}),
        code: blockForm.code.trim(), name: blockForm.name.trim(), buildingIds: blockForm.buildingIds,
      });
      setBlockForm({ code: '', name: '', buildingIds: [] });
      setNotice(tx('success'));
      await load(); onRefresh?.();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const createToken = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setToken(undefined); setNotice('');
    try {
      const created = await request<Bootstrap>(`/edge-console/blocks/${encodeURIComponent(nodeForm.blockId)}/bootstrap-tokens`, 'POST', {
        edgeId: nodeForm.edgeId.trim(), name: nodeForm.name.trim(), siteCode: nodeForm.siteCode.trim(),
        expiresInMinutes: Number(nodeForm.expiresInMinutes),
      });
      setToken(created);
      await load();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const beginEdit = (block: Block) => {
    setEditing(block.id);
    setEditForm({ code: block.code, name: block.name, buildingIds: block.buildings.map(item => item.id) });
  };
  const saveBlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/edge-console/blocks/${encodeURIComponent(editing)}`, 'PATCH', editForm);
      setEditing(null); setNotice(tx('success')); await load(); onRefresh?.();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const archiveBlock = async (id: string) => {
    setBusy(true); setError('');
    try {
      await request(`/edge-console/blocks/${encodeURIComponent(id)}`, 'DELETE');
      setConfirmArchive(null); setNotice(tx('archived')); await load(); onRefresh?.();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const restoreBlock = async (id: string) => {
    setBusy(true); setError('');
    try {
      await request(`/edge-console/blocks/${encodeURIComponent(id)}/restore`, 'POST');
      setNotice(tx('success')); await load(); onRefresh?.();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const revokeToken = async (id: string) => {
    setBusy(true); setError('');
    try {
      await request(`/edge-console/bootstrap-tokens/${encodeURIComponent(id)}/revoke`, 'POST');
      setNotice(tx('revoked')); await load();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const configText = token ? [
    `-EdgeId "${token.edge_id}"`,
    `-EdgeName "${token.edge_name}"`,
    `-TenantId "${token.organization_id}"`,
    `-BlockId "${token.block_id}"`,
    `-BuildingIds "${blocks.find(b => b.id === token.block_id)?.buildings.map(item => item.id).join(',') ?? ''}"`,
    `-SiteCode "${token.site_code}"`,
    `-BootstrapToken "${token.bootstrapToken}"`,
  ].join('\n') : '';
  const copyConfig = async () => {
    if (!configText) return;
    try { await navigator.clipboard.writeText(configText); setCopied(true); }
    catch { setError(tx('error')); }
  };
  const assignedBuildingIds = new Set(blocks.flatMap(block => block.buildings.map(building => building.id)));
  const activeBlocks = blocks.filter(block => !block.archived_at);
  const visibleBlocks = showArchived ? blocks : activeBlocks;
  const selectedBlock = activeBlocks.find(block => block.id === nodeForm.blockId);
  const selectedOrganizationId = buildings.find(building => blockForm.buildingIds.includes(building.id))?.organization_id;

  return <section className="ew-panel ebm" data-testid="edge-v2-block-manager">
    <style>{`.ebm{display:grid;gap:1rem}.ebm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem}.ebm-block{border:1px solid var(--ew-line);border-radius:11px;padding:.8rem;background:#fff;min-width:0}.ebm-block h3{margin:0 0 .35rem;font-size:.96rem}.ebm-block p,.ebm-block small{color:var(--ew-muted);margin:.2rem 0;overflow-wrap:anywhere}.ebm select[multiple]{min-height:8rem}.ebm-token{font:.78rem ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5ef;padding:.75rem;border-radius:8px}.ebm-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.ebm-id{font: .75rem ui-monospace,monospace;overflow-wrap:anywhere}.ebm-archived{opacity:.72}.ebm-table{width:100%;border-collapse:collapse;font-size:.8rem}.ebm-table td,.ebm-table th{text-align:left;padding:.55rem;border-bottom:1px solid var(--ew-line);vertical-align:top}.ebm-inline{display:grid;gap:.6rem;margin-top:.7rem}.ebm-inline input,.ebm-inline select{max-width:100%;min-height:40px}.ebm-block-actions{margin-top:.6rem}`}</style>
    <header><h2><Layers3 size={18}/> {tx('title')}</h2><div className="ebm-actions">
      <label><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/> {tx('showArchived')}</label>
      <button className="ew-button" onClick={() => void load()} disabled={busy} data-testid="button-refresh-edge-blocks"><RefreshCw size={15}/>{tx('refresh')}</button>
    </div></header>
    <p className="ew-note">{tx('help')} {tx('protocolNote')}</p>
    {!!error && <p className="ew-error" role="alert" data-testid="edge-v2-error">{error}</p>}
    {!!notice && <p className="ew-note" role="status">{notice}</p>}
    <div className="ebm-grid">
      {canManage && <form className="ew-form" onSubmit={createBlock} data-testid="form-edge-block">
        <h3>{tx('createBlock')}</h3>
        <label>{tx('code')}<input required maxLength={80} value={blockForm.code} onChange={e => setBlockForm({ ...blockForm, code: e.target.value })} data-testid="input-edge-block-code"/></label>
        <label>{tx('name')}<input required maxLength={120} value={blockForm.name} onChange={e => setBlockForm({ ...blockForm, name: e.target.value })} data-testid="input-edge-block-name"/></label>
         <label>{tx('buildings')}<select required multiple value={blockForm.buildingIds} onChange={e => setBlockForm({ ...blockForm, buildingIds: Array.from(e.currentTarget.selectedOptions, option => option.value) })} data-testid="select-edge-block-buildings">{buildings.filter(building => (!selectedOrganizationId || building.organization_id === selectedOrganizationId) && (!assignedBuildingIds.has(building.id) || blockForm.buildingIds.includes(building.id))).map(building => <option key={building.id} value={building.id}>{building.name}{building.organization_name ? ` · ${building.organization_name}` : ''}</option>)}</select></label>
        {!!blockForm.buildingIds.length && <p className="ew-note">{tx('tenantId')}: <span className="ebm-id">{buildings.find(building => blockForm.buildingIds.includes(building.id))?.organization_id}</span><br/>{tx('buildingId')}: <span className="ebm-id">{blockForm.buildingIds.join(', ')}</span></p>}
        <button className="ew-button primary" disabled={busy || !blockForm.buildingIds.length} data-testid="button-create-edge-block"><Plus size={15}/>{busy ? tx('loading') : tx('createBlock')}</button>
      </form>}
      <form className="ew-form" onSubmit={createToken} data-testid="form-edge-v2-bootstrap">
        <h3>{tx('createToken')}</h3>
        <label>{tx('block')}<select required value={nodeForm.blockId} onChange={e => setNodeForm({ ...nodeForm, blockId: e.target.value })} data-testid="select-edge-v2-block"><option value="">{tx('choose')}</option>{activeBlocks.map(block => <option key={block.id} value={block.id}>{block.name} · {block.building_count}</option>)}</select></label>
        <label>{tx('edgeId')}<input required maxLength={80} value={nodeForm.edgeId} onChange={e => setNodeForm({ ...nodeForm, edgeId: e.target.value })} data-testid="input-edge-v2-id"/></label>
        <label>{tx('edgeName')}<input required maxLength={120} value={nodeForm.name} onChange={e => setNodeForm({ ...nodeForm, name: e.target.value })} data-testid="input-edge-v2-name"/></label>
        <label>{tx('siteCode')}<input required maxLength={100} value={nodeForm.siteCode} onChange={e => setNodeForm({ ...nodeForm, siteCode: e.target.value })} data-testid="input-edge-v2-site"/></label>
        <label>{tx('expires')}<input type="number" min="5" max="120" required value={nodeForm.expiresInMinutes} onChange={e => setNodeForm({ ...nodeForm, expiresInMinutes: e.target.value })} data-testid="input-edge-v2-expiry"/></label>
        {selectedBlock && <div className="ew-note"><strong>{tx('tenantId')}:</strong> <span className="ebm-id">{selectedBlock.organization_id}</span><br/><strong>{tx('blockId')}:</strong> <span className="ebm-id">{selectedBlock.id}</span><br/><strong>{tx('buildingId')}:</strong> <span className="ebm-id">{selectedBlock.buildings.map(item => item.id).join(', ') || '—'}</span></div>}
        <button className="ew-button primary" disabled={busy || !activeBlocks.length} data-testid="button-create-edge-v2-token"><Plus size={15}/>{busy ? tx('loading') : tx('createToken')}</button>
      </form>
    </div>
    {!!token && <div className="ew-note" role="status" data-testid="edge-v2-one-time-token">
      <strong>{tx('tokenOnce')}</strong><p className="ebm-token">{configText}</p>
      <div className="ebm-actions"><button className="ew-button primary" onClick={() => void copyConfig()} data-testid="button-copy-edge-v2-token">{copied ? <Check size={15}/> : <Copy size={15}/>}{copied ? tx('copied') : tx('copy')}</button>
        <span>{tx('expires')}: {new Date(token.expires_at).toLocaleString(language === 'hy' ? 'hy-AM' : language === 'ru' ? 'ru-RU' : 'en-GB')}</span>
      </div>
      <p>{tx('blockId')}: <span className="ebm-id">{token.block_id}</span> · {tx('tenantId')}: <span className="ebm-id">{token.organization_id}</span></p>
    </div>}
    <section aria-label={tx('title')}>
      <h3>{tx('buildings')}</h3>
      <div className="ew-scroll"><table className="ebm-table"><thead><tr><th>{tx('buildings')}</th><th>{tx('tenantId')}</th><th>{tx('block')}</th><th>{tx('buildingId')}</th></tr></thead>
        <tbody>{buildings.map(building => {
          const assigned = blocks.find(block => block.buildings.some(item => item.id === building.id));
          return <tr key={building.id}><td>{building.name}<br/><small>{building.organization_name ?? ''}</small></td><td className="ebm-id">{building.organization_id}</td><td>{assigned?.name ?? '—'}{assigned?.archived_at ? ` · ${tx('archived')}` : ''}</td><td className="ebm-id">{building.id}</td></tr>;
        })}</tbody></table></div>
    </section>
    <div className="ebm-grid" aria-label={tx('title')}>
      {visibleBlocks.length ? visibleBlocks.map(block => <article className={`ebm-block ${block.archived_at ? 'ebm-archived' : ''}`} key={block.id} data-testid={`edge-block-${block.id}`}>
        <h3>{block.name}{block.archived_at ? ` · ${tx('archived')}` : ''}</h3><p>{block.code} · {block.organization_name ?? ''}</p>
        <small>{block.building_count} · {tx('buildings')} · {block.edge_node_count} · {tx('nodes')}</small>
        <p>{block.buildings?.map(item => item.name).join(', ') || '—'}</p>
        <p>{tx('tenantId')}: <span className="ebm-id">{block.organization_id}</span><br/>{tx('blockId')}: <span className="ebm-id">{block.id}</span></p>
        {canManage && <div className="ebm-actions ebm-block-actions">
          {!block.archived_at && <button className="ew-button" disabled={busy} onClick={() => beginEdit(block)}><Pencil size={14}/>{tx('edit')}</button>}
          {block.archived_at
            ? <button className="ew-button" disabled={busy} onClick={() => void restoreBlock(block.id)}><RotateCcw size={14}/>{tx('restore')}</button>
            : confirmArchive === block.id
              ? <><span>{tx('archiveNote')}</span><button className="ew-button danger" disabled={busy} onClick={() => void archiveBlock(block.id)}><Archive size={14}/>{tx('archive')}</button><button className="ew-button" onClick={() => setConfirmArchive(null)}><X size={14}/></button></>
              : <button className="ew-button danger" disabled={busy} onClick={() => setConfirmArchive(block.id)}><Archive size={14}/>{tx('archive')}</button>}
        </div>}
        {editing === block.id && <form className="ew-form ebm-inline" onSubmit={saveBlock}>
          <label>{tx('code')}<input required maxLength={80} value={editForm.code} onChange={e => setEditForm({ ...editForm, code: e.target.value })}/></label>
          <label>{tx('name')}<input required maxLength={120} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}/></label>
          <label>{tx('buildings')}<select multiple disabled={block.edge_node_count>0} value={editForm.buildingIds} onChange={e => setEditForm({ ...editForm, buildingIds: Array.from(e.currentTarget.selectedOptions, option => option.value) })}>
             {buildings.filter(building => building.organization_id === block.organization_id && (!assignedBuildingIds.has(building.id)||editForm.buildingIds.includes(building.id))).map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
          </select></label>
          {block.edge_node_count>0&&<p className="ew-note">{tx('locked')}</p>}
          <div className="ebm-actions"><button className="ew-button primary" disabled={busy||!editForm.buildingIds.length}><Save size={14}/>{tx('save')}</button><button type="button" className="ew-button" onClick={() => setEditing(null)}><X size={14}/></button></div>
        </form>}
      </article>) : <p className="ew-empty" data-testid="edge-blocks-empty">{tx('noBlocks')}</p>}
    </div>
    <section>
      <h3>{tx('tokenHistory')}</h3>
      {tokens.length ? <div className="ew-scroll"><table className="ebm-table"><thead><tr><th>Edge ID</th><th>{tx('name')}</th><th>{tx('block')} / {tx('buildings')}</th><th>{tx('status')}</th><th>{tx('expires')}</th><th></th></tr></thead><tbody>
        {tokens.map(item => <tr key={item.id}><td className="ebm-id">{item.edge_id}<br/>v{item.protocol_version}</td><td>{item.edge_name}<br/><small>{item.organization_name}</small></td><td>{item.block_name ?? item.building_name ?? '—'}<br/><small className="ebm-id">{item.block_id ?? item.building_id ?? ''}</small></td><td>{item.status}</td><td>{new Date(item.expires_at).toLocaleString(language === 'hy' ? 'hy-AM' : language === 'ru' ? 'ru-RU' : 'en-GB')}</td><td>{item.status==='PENDING'&&c.permissions.includes('edge.bootstrap.create')&&<button className="ew-button danger" disabled={busy} onClick={() => void revokeToken(item.id)}>{tx('revokeToken')}</button>}</td></tr>)}
      </tbody></table></div> : <p className="ew-empty">{tx('empty' as keyof typeof labels)}</p>}
    </section>
  </section>;
}
