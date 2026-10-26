import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ApiClientError } from '../client';
import type { Language } from '../i18n';
import { tr } from './config';

export type Row = Record<string, any>;

export const locale = (l: Language) => (l === 'hy' ? 'hy-AM' : l === 'ru' ? 'ru-RU' : 'en-GB');
export const fmt = (v: unknown, l: Language) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(locale(l), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
};
export const rel = (v: unknown, l: Language) => {
  if (!v) return '—';
  const t = new Date(String(v)).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return tr(l, 'now');
  const unit = (n: number, u: Intl.RelativeTimeFormatUnit) => new Intl.RelativeTimeFormat(locale(l), { numeric: 'always' }).format(-n, u);
  if (s < 60) return unit(s, 'second');
  if (s < 3600) return unit(Math.round(s / 60), 'minute');
  if (s < 86400) return unit(Math.round(s / 3600), 'hour');
  return unit(Math.round(s / 86400), 'day');
};

export function errorKind(e: unknown): 'forbidden' | 'unavailable' | 'other' {
  if (e instanceof ApiClientError) {
    if (e.status === 403 || e.status === 401) return 'forbidden';
    if (e.status === 0 || e.status >= 500 || e.code === 'service_unavailable' || e.code === 'connection') return 'unavailable';
  }
  return 'other';
}
export function errorText(e: unknown, l: Language) {
  if (e instanceof ApiClientError) {
    if (e.code === 'recent_authentication_required') return tr(l, 'reauth');
    if (e.code === 'edge_already_registered') return tr(l, 'edgeExists');
    if (e.code === 'active_bootstrap_token_exists') return tr(l, 'tokenExists');
    return `${tr(l, 'failed')} (${e.code || e.status})`;
  }
  return tr(l, 'failed');
}

const tone = (s: string) => {
  const v = s.toUpperCase();
  if (['ONLINE', 'REGISTERED', 'CONNECTED', 'OK', 'ACTIVE', 'SUCCESS', 'CLEARED', 'ACKNOWLEDGED', 'AUTHORIZED', 'USED'].includes(v)) return 'ok';
  if (['OFFLINE', 'FAILED', 'DISCONNECTED', 'REVOKED', 'ERROR', 'CRITICAL', 'DENIED', 'TIMEOUT', 'EXPIRED', 'EMERGENCY'].includes(v)) return 'bad';
  if (['DEGRADED', 'STALE', 'WARNING', 'MAJOR', 'RECONNECTING', 'WAITING_BOOTSTRAP_TOKEN', 'PENDING', 'PENDING_REGISTRATION', 'QUEUED'].includes(v)) return 'warn';
  return 'idle';
};
export const Badge = ({ value, dot = true, label }: { value: unknown; dot?: boolean; label?: string }) => {
  const s = String(value ?? 'UNKNOWN');
  return <span className={'em-badge ' + tone(s)}>{dot && <i />}{label ?? s.replace(/_/g, ' ')}</span>;
};

export function Modal({ title, onClose, children, wide, labelId }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; labelId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? []).filter(x => !x.hasAttribute('disabled'));
    (focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return <div className="em-modal" role="presentation"><div ref={ref} className={'em-dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={labelId}>
    <header><h2 id={labelId}>{title}</h2><button type="button" className="em-icon" onClick={onClose} aria-label="close"><X size={18} /></button></header>
    {children}
  </div></div>;
}

export const styles = `
.p-main:has(.em) > .p-page-heading{display:none}
.em{--o:#e8742a;--o2:#fbe9dc;--ink:#1d2a33;--mut:#6b7882;--ln:#e3e7ea;--bg:#fff;--g:#1f9d55;--gbg:#e3f5ea;--r:#d33d3d;--rbg:#fde8e8;--y:#b9770e;--ybg:#fdf0d5;color:var(--ink);display:grid;gap:1rem;min-width:0}
.em *{box-sizing:border-box}.em h1{margin:0;font-size:1.9rem;letter-spacing:-.03em}.em h2,.em h3{margin:0}
.em-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap}.em-sub{color:var(--mut);font-size:.85rem;margin-top:.2rem}
.em-actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.em-btn{border:1px solid var(--ln);background:var(--bg);color:var(--ink);border-radius:8px;padding:.55rem .9rem;font:600 .82rem inherit;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;min-height:38px}
.em-btn:hover{background:#f6f7f8}.em-btn.pri{background:var(--o);border-color:var(--o);color:#fff}.em-btn.pri:hover{background:#d4651d}.em-btn.out{border-color:var(--o);color:#b8541a;background:#fff}.em-btn.out:hover{background:var(--o2)}.em-btn.bad{color:var(--r);border-color:#efc0c0}.em-btn:disabled{opacity:.5;cursor:not-allowed}
.em-btn:focus-visible,.em input:focus-visible,.em select:focus-visible,.em-tab:focus-visible,.em textarea:focus-visible{outline:3px solid #f5c29c;outline-offset:1px}
.em-icon{border:0;background:none;cursor:pointer;color:var(--mut);padding:.35rem;border-radius:6px}.em-icon:hover{background:#f0f2f3}
.em-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr));gap:.7rem}
.em-card{background:var(--bg);border:1px solid var(--ln);border-radius:12px;padding:.85rem 1rem;display:grid;gap:.15rem}.em-card span{color:var(--mut);font-size:.78rem;display:flex;align-items:center;gap:.4rem}.em-card strong{font-size:1.6rem;letter-spacing:-.03em}.em-card small{color:var(--mut);font-size:.72rem}
.em-dot{width:9px;height:9px;border-radius:50%;background:#9aa5ad;display:inline-block}.em-dot.ok{background:var(--g)}.em-dot.bad{background:var(--r)}.em-dot.warn{background:#e8a317}
.em-filters{display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-end}.em-filters label{display:grid;gap:.2rem;font-size:.72rem;color:var(--mut)}
.em select,.em input[type=text],.em input[type=number],.em input:not([type]),.em textarea{border:1px solid var(--ln);border-radius:8px;background:#fff;padding:.5rem .6rem;font:inherit;font-size:.82rem;color:var(--ink);min-height:38px;max-width:100%}
.em-search{flex:1;min-width:14rem}.em-search input{width:100%}
.em-panel{background:var(--bg);border:1px solid var(--ln);border-radius:12px;min-width:0}
.em-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.em-table{width:100%;border-collapse:collapse;font-size:.8rem;min-width:max-content}.em-table th{background:#f8f9fa;text-align:left;font-weight:600;color:#44525c;padding:.6rem .7rem;border-bottom:1px solid var(--ln);white-space:nowrap}.em-table td{padding:.6rem .7rem;border-bottom:1px solid #eef0f2;vertical-align:middle}
.em-table tr.sel td{background:#fdf3ea}.em-table tr.row{cursor:pointer}.em-table tr.row:hover td{background:#fafbfb}.em-mono{font:.75rem ui-monospace,monospace;overflow-wrap:anywhere}
.em-badge{display:inline-flex;align-items:center;gap:.35rem;border-radius:6px;padding:.18rem .5rem;font-size:.72rem;font-weight:600;white-space:nowrap;background:#eef0f2;color:#4b5963}.em-badge i{width:7px;height:7px;border-radius:50%;background:currentColor}
.em-badge.ok{background:var(--gbg);color:#17703d}.em-badge.bad{background:var(--rbg);color:#a82a2a}.em-badge.warn{background:var(--ybg);color:var(--y)}
.em-status-reasons{display:block;color:#7b5a16;font-size:.7rem;line-height:1.35;margin-top:.25rem;max-width:28rem;white-space:normal}
.em-pager{display:flex;justify-content:space-between;gap:.7rem;align-items:center;padding:.6rem .8rem;font-size:.78rem;color:var(--mut);flex-wrap:wrap}
.em-alert{padding:.7rem .9rem;border-radius:10px;font-size:.84rem;display:flex;gap:.7rem;align-items:center;justify-content:space-between;flex-wrap:wrap}.em-alert.warn{background:var(--ybg);color:#6e4806}.em-alert.bad{background:var(--rbg);color:#8a2222}.em-alert.ok{background:var(--gbg);color:#17703d}.em-alert.info{background:#eef3f7;color:#34505f}
.em-state{padding:2.5rem 1rem;text-align:center;color:var(--mut);display:grid;gap:.8rem;justify-items:center}
.em-skel{height:2.2rem;border-radius:6px;background:linear-gradient(90deg,#eef0f2,#f7f8f9,#eef0f2);background-size:200% 100%;animation:ems 1.3s linear infinite;margin:.5rem .8rem}@keyframes ems{to{background-position:-200% 0}}
.em-detail{padding:1rem;display:grid;gap:1rem}.em-dhead{display:flex;gap:1rem;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}.em-dhead h2{font-size:1.2rem;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
.em-tabs{display:flex;gap:.2rem;border-bottom:1px solid var(--ln);overflow-x:auto}.em-tab{border:0;background:none;padding:.65rem .8rem;font:600 .8rem inherit;color:var(--mut);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}.em-tab[aria-selected=true]{color:#b8541a;border-bottom-color:var(--o)}
.em-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.6rem}.em-fact{background:#f7f8f9;border-radius:8px;padding:.6rem .7rem;min-width:0}.em-fact small{display:block;color:var(--mut);font-size:.7rem;margin-bottom:.15rem}.em-fact strong{font-size:.82rem;overflow-wrap:anywhere;font-weight:600}
.em-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem}
.em-checks{display:grid;gap:.3rem}.em-check{display:flex;justify-content:space-between;gap:.7rem;align-items:center;padding:.5rem .7rem;border-radius:8px;background:#f7f8f9;font-size:.8rem}.em-check small{color:var(--mut);display:block}
.em-feed{display:grid;gap:.5rem;max-height:22rem;overflow:auto}.em-feed article{border:1px solid var(--ln);border-radius:8px;padding:.55rem .7rem;font-size:.78rem;display:grid;gap:.2rem}.em-feed pre{margin:0;background:#f4f6f7;padding:.4rem;border-radius:6px;font:.72rem ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.em-seg{display:inline-flex;border:1px solid var(--ln);border-radius:8px;overflow:hidden}.em-seg button{border:0;background:#fff;padding:.35rem .7rem;font:600 .75rem inherit;cursor:pointer}.em-seg button[aria-pressed=true]{background:var(--o2);color:#b8541a}
.em-form{display:grid;gap:.7rem}.em-form label{display:grid;gap:.25rem;font-size:.78rem;color:var(--mut)}.em-form input,.em-form select,.em-form textarea{width:100%}.em-grid2{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.em-opt{display:flex!important;grid-template-columns:none!important;align-items:center;gap:.5rem!important;color:var(--ink)!important;font-size:.82rem!important}.em-opt input{width:auto!important;min-height:0!important}
.em-modal{position:fixed;inset:0;background:#142027aa;z-index:1000;display:grid;place-items:center;padding:1rem}.em-dialog{background:#fff;border-radius:14px;padding:1.1rem;width:min(100%,32rem);max-height:92dvh;overflow:auto;display:grid;gap:.8rem;box-shadow:0 20px 60px #0004}.em-dialog.wide{width:min(100%,44rem)}.em-dialog header{display:flex;justify-content:space-between;align-items:center}.em-dialog h2{font-size:1.1rem}
.em-steps{display:flex;gap:.4rem;flex-wrap:wrap}.em-steps span{font-size:.72rem;padding:.25rem .6rem;border-radius:99px;background:#eef0f2;color:var(--mut)}.em-steps span.on{background:var(--o);color:#fff}
.em-token{font:.8rem ui-monospace,monospace;background:#f4f6f7;padding:.7rem;border-radius:8px;overflow-wrap:anywhere;white-space:pre-wrap;margin:0}
.em-cardlist{display:none}
@media(max-width:1100px){.em-two{grid-template-columns:1fr}}
@media(max-width:820px){.em-grid2{grid-template-columns:1fr}.em-table.fleet{display:none}.em-cardlist{display:grid;gap:.6rem;padding:.7rem}.em-cardlist button{text-align:left;border:1px solid var(--ln);background:#fff;border-radius:10px;padding:.7rem;display:grid;gap:.35rem;cursor:pointer;font:inherit}.em-cardlist button.sel{border-color:var(--o);background:#fdf3ea}}
`;
