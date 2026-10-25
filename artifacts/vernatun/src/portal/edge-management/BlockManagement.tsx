import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError, request } from '../client';
import type { Language } from '../i18n';
import { tr } from './config';
import { Modal, errorText, type Row } from './ui';

export default function BlockManagement({ language, buildings, onClose, onChanged }: { language: Language; buildings: Row[]; onClose: () => void; onChanged: () => void }) {
  const L = (k: string) => tr(language, k);
  const [blocks, setBlocks] = useState<Row[]>();
  const [loadErr, setLoadErr] = useState<unknown>();
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState('');
  const [form, setForm] = useState({ name: '', code: '', ids: [] as string[] });
  const [confirm, setConfirm] = useState('');

  const load = useCallback(async () => {
    try { setBlocks((await request<Row>('/edge-console/blocks?includeArchived=true')).blocks); setLoadErr(undefined); } catch (e) { setLoadErr(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const msg = (e: unknown) => e instanceof ApiClientError && e.code === 'edge_block_scope_locked' ? L('blockLocked')
    : e instanceof ApiClientError && e.code === 'edge_block_has_active_nodes' ? L('blockActive')
    : e instanceof ApiClientError && e.code === 'building_already_assigned_to_block' ? L('blockAssigned') : errorText(e, language);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setErr(undefined);
    try { await fn(); after?.(); await load(); onChanged(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const begin = (b: Row) => { setEditing(b.id); setErr(undefined); setForm({ name: b.name, code: b.code, ids: (b.buildings ?? []).map((x: Row) => x.id) }); };
  const save = (e: FormEvent, b: Row) => {
    e.preventDefault();
    const before = (b.buildings ?? []).map((x: Row) => x.id).sort().join(',');
    const body: Row = { name: form.name.trim(), code: form.code.trim() };
    if ([...form.ids].sort().join(',') !== before) body.buildingIds = form.ids;
    void run(() => request(`/edge-console/blocks/${encodeURIComponent(b.id)}`, 'PATCH', body), () => setEditing(''));
  };
  const visible = (blocks ?? []).filter(b => archived || !b.archived_at);

  return <Modal title={L('blockSettings')} onClose={onClose} wide labelId="em-blocks-title">
    <label className="em-opt"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />{L('showArchived')}</label>
    {!!loadErr && <div className="em-alert bad" role="alert"><span>{msg(loadErr)}</span><button className="em-btn" onClick={() => void load()}>{L('retry')}</button></div>}
    {!!err && <div className="em-alert bad" role="alert">{msg(err)}</div>}
    {!blocks && !loadErr && <div className="em-skel" />}
    {blocks && !visible.length && <div className="em-state">{L('noBlocks')}</div>}
    <div className="em-form" style={{ maxHeight: '60dvh', overflow: 'auto' }}>
      {visible.map(b => <article key={b.id} className="em-panel" style={{ padding: '.8rem', opacity: b.archived_at ? .7 : 1 }} data-testid={'block-' + b.id}>
        <div className="em-actions" style={{ justifyContent: 'space-between' }}>
          <div><strong>{b.name}</strong> <span className="em-mono">{b.code}</span>{b.archived_at && <> · {L('archived')}</>}<br /><small>{b.organization_name} · {b.building_count} {L('buildings')} · {b.edge_node_count} Edge</small></div>
          <span className="em-actions">
            {!b.archived_at && <button className="em-btn" disabled={busy} onClick={() => begin(b)}>{L('edit')}</button>}
            {b.archived_at ? <button className="em-btn" disabled={busy} onClick={() => void run(() => request(`/edge-console/blocks/${encodeURIComponent(b.id)}/restore`, 'POST'))}>{L('restore')}</button>
              : confirm === b.id ? <><small>{L('archiveBlockAsk')}</small><button className="em-btn bad" disabled={busy} onClick={() => void run(() => request(`/edge-console/blocks/${encodeURIComponent(b.id)}`, 'DELETE'), () => setConfirm(''))}>{L('confirm')}</button><button className="em-btn" onClick={() => setConfirm('')}>{L('cancel')}</button></>
                : <button className="em-btn bad" disabled={busy} onClick={() => setConfirm(b.id)}>{L('archive')}</button>}
          </span>
        </div>
        <p style={{ margin: '.4rem 0', fontSize: '.8rem' }}>{(b.buildings ?? []).map((x: Row) => x.name).join(', ') || '—'}</p>
        {editing === b.id && <form className="em-form" onSubmit={e => save(e, b)}>
          <div className="em-grid2"><label>{L('blockName')}<input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>{L('blockCode')}<input required maxLength={80} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></label></div>
          <fieldset style={{ border: '1px solid var(--ln)', borderRadius: 8, maxHeight: 180, overflow: 'auto' }}><legend>{L('buildings')}</legend>
            {buildings.filter(x => x.organization_id === b.organization_id).map(x => {
              const other = blocks?.some(o => o.id !== b.id && !o.archived_at && o.buildings?.some((y: Row) => y.id === x.id));
              return <label className="em-opt" key={x.id}><input type="checkbox" disabled={other || b.edge_node_count > 0} checked={form.ids.includes(x.id)} onChange={() => setForm({ ...form, ids: form.ids.includes(x.id) ? form.ids.filter(i => i !== x.id) : [...form.ids, x.id] })} />{x.name}{other ? ` · ${L('blockAssigned')}` : ''}</label>;
            })}</fieldset>
          {b.edge_node_count > 0 && <small>{L('blockLocked')}</small>}
          <div className="em-actions"><button className="em-btn pri" disabled={busy || !form.ids.length}>{L('save')}</button><button type="button" className="em-btn" onClick={() => setEditing('')}>{L('cancel')}</button></div>
        </form>}
      </article>)}
    </div>
    <div className="em-actions"><button className="em-btn" onClick={onClose}>{L('close')}</button></div>
  </Modal>;
}
