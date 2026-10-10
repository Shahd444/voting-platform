import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AdminUser } from '../lib/types';
import { useLang } from './i18n';

// ------------------------------------------------------------------ Modal
export function Modal({ title, wide, busy = false, onClose, children }: { title: string; wide?: boolean; busy?: boolean; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLang();
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, busy]);
  useEffect(() => { cardRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus(); }, []);
  return (
    <div className="modal">
      <div className="modal-bg" onClick={() => { if (!busy) onClose(); }} />
      <div className={`modal-card${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" ref={cardRef}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" aria-label={t.common.close} disabled={busy} onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Admin context: session, toasts, confirm dialogs
type ToastKind = 'ok' | 'err' | 'warn';
interface ConfirmOpts { danger?: boolean; confirmText?: string; typeToConfirm?: string }
interface AdminCtx {
  me: AdminUser;
  isAdmin: boolean;
  setMe: (m: AdminUser | null) => void;
  toast: (msg: string, kind?: ToastKind) => void;
  confirm: (message: string, opts?: ConfirmOpts) => Promise<boolean>;
}
const Ctx = createContext<AdminCtx | null>(null);
export const useAdmin = () => useContext(Ctx)!;

export function AdminProvider({ me, setMe, children }: { me: AdminUser; setMe: (m: AdminUser | null) => void; children: React.ReactNode }) {
  const [toastState, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [dialog, setDialog] = useState<{ message: string; opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);
  const [typed, setTyped] = useState('');
  const { t } = useLang();

  useEffect(() => {
    if (!toastState) return;
    const id = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(id);
  }, [toastState]);

  const toast = useCallback((msg: string, kind: ToastKind = 'ok') => setToast({ msg, kind }), []);
  const confirm = useCallback((message: string, opts: ConfirmOpts = {}) =>
    new Promise<boolean>((resolve) => { setTyped(''); setDialog({ message, opts, resolve }); }), []);
  const close = (v: boolean) => { dialog?.resolve(v); setDialog(null); };

  return (
    <Ctx.Provider value={{ me, isAdmin: me.role === 'admin', setMe, toast, confirm }}>
      {children}
      {dialog && (
        <Modal title={t.common.areYouSure} onClose={() => close(false)}>
          <div className="stack">
            <p>{dialog.message}</p>
            {dialog.opts.typeToConfirm && <input className="input" placeholder={t.common.typeToConfirm(dialog.opts.typeToConfirm)} value={typed} onChange={(e) => setTyped(e.target.value)} />}
            <div className="actions">
              <button className="btn" onClick={() => close(false)}>{t.common.cancel}</button>
              <button className={`btn ${dialog.opts.danger ? 'btn-danger' : 'btn-primary'}`}
                disabled={!!dialog.opts.typeToConfirm && typed !== dialog.opts.typeToConfirm} onClick={() => close(true)}>
                {dialog.opts.confirmText || t.common.confirm}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {toastState && <div className={`toast ${toastState.kind}`} role="status">{toastState.msg}</div>}
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------ small pieces
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Tile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return <div className={`tile ${tone || ''}`}><b>{typeof value === 'number' ? value.toLocaleString('en') : value}</b><span>{label}</span></div>;
}

export function Spinner() { return <div className="boot"><span className="spinner" /></div>; }

/** Load data for a view; exposes reload + error. */
export function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList = []) {
  const ctx = useContext(Ctx);
  const { err } = useLang();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e) {
      if ((e as { code?: string }).code === 'unauthorized' && ctx) { ctx.setMe(null); return; }
      setError(err(e));
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

export function LoadError({ error }: { error: string }) {
  return <div className="card"><p className="alert">{error}</p></div>;
}
