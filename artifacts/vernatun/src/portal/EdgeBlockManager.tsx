import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Layers3, Plus, RefreshCw } from 'lucide-react';
import { request, ApiClientError } from './client';
import type { Language } from './i18n';
import type { RoleContext } from './types';

type Building = { id: string; name: string; organization_id: string; organization_name?: string | null };
type Block = {
  id: string; code: string; name: string; organization_name?: string;
  building_count: number; edge_node_count: number;
  buildings: { id: string; name: string }[];
};
type Bootstrap = { id: string; edge_id: string; expires_at: string; bootstrapToken: string; oneTime: true };

const labels: Record<string, [string, string, string]> = {
  title: ['Edge v2 · բլոկների կառավարում', 'Edge v2 · управление блоками', 'Edge v2 · Block management'],
  help: ['Ստեղծեք բլոկներ և յուրաքանչյուր բլոկի համար մեկ կամ մի քանի Edge հանգույց։', 'Создайте блоки и один или несколько Edge-узлов на каждый блок.', 'Create blocks and one or more Edge nodes per block.'],
  code: ['Բլոկի կոդ', 'Код блока', 'Block code'], name: ['Բլոկի անվանում', 'Название блока', 'Block name'],
  buildings: ['Շենքեր այս բլոկում', 'Здания в блоке', 'Buildings in this block'],
  createBlock: ['Ստեղծել բլոկ', 'Создать блок', 'Create block'], choose: ['Ընտրեք բլոկ', 'Выберите блок', 'Choose a block'],
  edgeId: ['Edge ID', 'Edge ID', 'Edge ID'], edgeName: ['Edge հանգույցի անվանում', 'Название Edge-узла', 'Edge node name'],
  siteCode: ['Տեղանքի կոդ', 'Код объекта', 'Site code'], expires: ['Ժամկետը՝ րոպե', 'Срок действия, мин', 'Expires in minutes'],
  createToken: ['Ստեղծել v2 գրանցման բանալի', 'Создать ключ регистрации v2', 'Create v2 bootstrap token'],
  noBlocks: ['Բլոկներ դեռ չկան։', 'Блоков пока нет.', 'No blocks yet.'],
  tokenOnce: ['Բանալին ցուցադրվում է միայն մեկ անգամ։ Տեղադրեք այն Edge Agent v2-ում։', 'Ключ показывается один раз. Введите его в Edge Agent v2.', 'This token is shown once. Add it to Edge Agent v2.'],
  copy: ['Պատճենել', 'Копировать', 'Copy'], copied: ['Պատճենված է', 'Скопировано', 'Copied'],
  error: ['Չհաջողվեց կատարել գործողությունը։', 'Не удалось выполнить действие.', 'Could not complete the action.'],
  loading: ['Բեռնում…', 'Загрузка…', 'Loading…'], refresh: ['Թարմացնել', 'Обновить', 'Refresh'],
  block: ['Բլոկ', 'Блок', 'Block'], nodes: ['Edge հանգույցներ', 'Edge-узлы', 'Edge nodes'],
  protocolNote: ['V2 Agent-ը ստանում է բլոկին թույլատրված շենքերի ցանկը։ Սարքի շենքը պետք է նշված լինի ThingsBoard-ի UUID-ի քարտեզում։', 'Agent v2 получает список разрешённых зданий блока. Здание каждого устройства задаётся в карте по UUID ThingsBoard.', 'The v2 Agent receives the block’s allowed buildings. Each device must have an explicit ThingsBoard UUID-to-building mapping.'],
};
const langIndex = (language: Language) => language === 'hy' ? 0 : language === 'ru' ? 1 : 2;

export default function EdgeBlockManager({ c, language, onRefresh }: {
  c: RoleContext; language: Language; onRefresh?: () => void;
}) {
  const tx = (key: keyof typeof labels) => labels[key][langIndex(language)];
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<Bootstrap>();
  const [copied, setCopied] = useState(false);
  const [blockForm, setBlockForm] = useState({ code: '', name: '', buildingIds: [] as string[] });
  const [nodeForm, setNodeForm] = useState({ blockId: '', edgeId: '', name: '', siteCode: '', expiresInMinutes: '60' });

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [buildingRows, blockResult] = await Promise.all([
        request<Building[]>('/edge-console/buildings'),
        request<{ blocks: Block[] }>('/edge-console/blocks'),
      ]);
      setBuildings(buildingRows);
      setBlocks(blockResult.blocks);
      if (blockResult.blocks[0]) setNodeForm(current => current.blockId ? current : ({ ...current, blockId: blockResult.blocks[0].id }));
    } catch (e) {
      setError(e instanceof ApiClientError ? `${tx('error')} (${e.status || e.code})` : tx('error'));
    } finally { setBusy(false); }
  }, [c.id, language]);
  useEffect(() => { void load(); }, [load]);

  const createBlock = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const first = buildings.find(b => blockForm.buildingIds.includes(b.id));
      await request('/edge-console/blocks', 'POST', {
        ...(c.organization_id ? { organizationId: c.organization_id } : first ? { organizationId: first.organization_id } : {}),
        code: blockForm.code.trim(), name: blockForm.name.trim(), buildingIds: blockForm.buildingIds,
      });
      setBlockForm({ code: '', name: '', buildingIds: [] });
      await load(); onRefresh?.();
    } catch (e) {
      setError(e instanceof ApiClientError ? `${tx('error')} (${e.status || e.code})` : tx('error'));
    } finally { setBusy(false); }
  };
  const createToken = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setToken(undefined);
    try {
      const created = await request<Bootstrap>(`/edge-console/blocks/${encodeURIComponent(nodeForm.blockId)}/bootstrap-tokens`, 'POST', {
        edgeId: nodeForm.edgeId.trim(), name: nodeForm.name.trim(), siteCode: nodeForm.siteCode.trim(),
        expiresInMinutes: Number(nodeForm.expiresInMinutes),
      });
      setToken(created);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? `${tx('error')} (${e.status || e.code})` : tx('error'));
    } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!token?.bootstrapToken) return;
    try { await navigator.clipboard.writeText(token.bootstrapToken); setCopied(true); }
    catch { setError(tx('error')); }
  };

  return <section className="ew-panel ebm" data-testid="edge-v2-block-manager">
    <style>{`.ebm{display:grid;gap:1rem}.ebm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem}.ebm-block{border:1px solid var(--ew-line);border-radius:11px;padding:.8rem;background:#fff}.ebm-block h3{margin:0 0 .35rem;font-size:.96rem}.ebm-block p,.ebm-block small{color:var(--ew-muted);margin:.2rem 0}.ebm select[multiple]{min-height:8rem}.ebm-token{font: .8rem ui-monospace,monospace;overflow-wrap:anywhere;background:#f3f5ef;padding:.75rem;border-radius:8px}.ebm-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}`}</style>
    <header><h2><Layers3 size={18}/> {tx('title')}</h2><button className="ew-button" onClick={() => void load()} disabled={busy} data-testid="button-refresh-edge-blocks"><RefreshCw size={15}/>{tx('refresh')}</button></header>
    <p className="ew-note">{tx('help')} {tx('protocolNote')}</p>
    {!!error && <p className="ew-error" role="alert" data-testid="edge-v2-error">{error}</p>}
    <div className="ebm-grid">
      <form className="ew-form" onSubmit={createBlock} data-testid="form-edge-block">
        <h3>{tx('createBlock')}</h3>
        <label>{tx('code')}<input required maxLength={80} value={blockForm.code} onChange={e => setBlockForm({ ...blockForm, code: e.target.value })} data-testid="input-edge-block-code"/></label>
        <label>{tx('name')}<input required maxLength={120} value={blockForm.name} onChange={e => setBlockForm({ ...blockForm, name: e.target.value })} data-testid="input-edge-block-name"/></label>
        <label>{tx('buildings')}<select required multiple value={blockForm.buildingIds} onChange={e => setBlockForm({ ...blockForm, buildingIds: Array.from(e.currentTarget.selectedOptions, option => option.value) })} data-testid="select-edge-block-buildings">{buildings.map(b => <option key={b.id} value={b.id}>{b.name}{b.organization_name ? ` · ${b.organization_name}` : ''}</option>)}</select></label>
        <button className="ew-button primary" disabled={busy || !blockForm.buildingIds.length} data-testid="button-create-edge-block"><Plus size={15}/>{busy ? tx('loading') : tx('createBlock')}</button>
      </form>
      <form className="ew-form" onSubmit={createToken} data-testid="form-edge-v2-bootstrap">
        <h3>{tx('createToken')}</h3>
        <label>{tx('block')}<select required value={nodeForm.blockId} onChange={e => setNodeForm({ ...nodeForm, blockId: e.target.value })} data-testid="select-edge-v2-block"><option value="">{tx('choose')}</option>{blocks.map(b => <option key={b.id} value={b.id}>{b.name} · {b.building_count}</option>)}</select></label>
        <label>{tx('edgeId')}<input required maxLength={80} value={nodeForm.edgeId} onChange={e => setNodeForm({ ...nodeForm, edgeId: e.target.value })} data-testid="input-edge-v2-id"/></label>
        <label>{tx('edgeName')}<input required maxLength={120} value={nodeForm.name} onChange={e => setNodeForm({ ...nodeForm, name: e.target.value })} data-testid="input-edge-v2-name"/></label>
        <label>{tx('siteCode')}<input required maxLength={100} value={nodeForm.siteCode} onChange={e => setNodeForm({ ...nodeForm, siteCode: e.target.value })} data-testid="input-edge-v2-site"/></label>
        <label>{tx('expires')}<input type="number" min="5" max="120" required value={nodeForm.expiresInMinutes} onChange={e => setNodeForm({ ...nodeForm, expiresInMinutes: e.target.value })} data-testid="input-edge-v2-expiry"/></label>
        <button className="ew-button primary" disabled={busy || !blocks.length} data-testid="button-create-edge-v2-token"><KeyRound size={15}/>{busy ? tx('loading') : tx('createToken')}</button>
      </form>
    </div>
    <div className="ebm-grid" aria-label={tx('title')}>
      {blocks.length ? blocks.map(block => <article className="ebm-block" key={block.id} data-testid={`edge-block-${block.id}`}>
        <h3>{block.name}</h3><p>{block.code} · {block.organization_name ?? ''}</p>
        <small>{block.building_count} · {tx('buildings')} · {block.edge_node_count} · {tx('nodes')}</small>
        <p>{block.buildings?.map(item => item.name).join(', ') || '—'}</p>
      </article>) : <p className="ew-empty" data-testid="edge-blocks-empty">{tx('noBlocks')}</p>}
    </div>
    {token && <div className="ew-note" role="status" data-testid="edge-v2-one-time-token">
      <strong>{tx('tokenOnce')}</strong><p className="ebm-token">{token.bootstrapToken}</p>
      <div className="ebm-actions"><button className="ew-button primary" onClick={() => void copy()} data-testid="button-copy-edge-v2-token"><Copy size={15}/>{copied ? tx('copied') : tx('copy')}</button>
        <span>{token.edge_id} · {new Date(token.expires_at).toLocaleString(language === 'hy' ? 'hy-AM' : language === 'ru' ? 'ru-RU' : 'en-GB')}</span>
      </div>
    </div>}
  </section>;
}
