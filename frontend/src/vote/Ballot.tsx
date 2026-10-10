import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Category, Exhibitor, VisitorSession } from '../lib/types';
import { accent, getLocation, initials } from '../lib/util';
import { errorText } from './i18n';
import { useVote } from './VoteContext';

function Photo({ e, className }: { e: Exhibitor; className: string }) {
  return e.image
    ? <img className={className} src={e.image} alt="" loading="lazy" decoding="async" width={800} height={600} />
    : <div className={`${className} ph`} aria-hidden="true">{initials(e.project || e.name)}</div>;
}

/** Step 3 — one vote per category (F1–F3). */
export function Ballot() {
  const { t, data, session, setSession, reload } = useVote();
  const cats = data.categories;
  const votes = session!.votes;
  const firstOpen = () => (cats.find((c) => !votes[c.id]) || cats[0])?.id;
  const [activeId, setActiveId] = useState<number | undefined>(firstOpen);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<{ e: Exhibitor; cat: Category } | null>(null);

  const idx = Math.max(0, cats.findIndex((c) => c.id === activeId));
  const cat = cats[idx];
  const done = cats.filter((c) => votes[c.id]).length;
  if (!cat) {
    return (
      <section className="panel center">
        <div className="glyph glyph-warn" aria-hidden="true" />
        <h1 className="title-sm">{t('noCategoriesTitle')}</h1>
        <p className="muted">{t('noCategoriesBody')}</p>
        <button className="btn btn-primary" onClick={() => reload()}>{t('retry')}</button>
      </section>
    );
  }
  const myVote = votes[cat.id];
  const exhibitors = data.exhibitors.filter((e) => e.category_ids.includes(cat.id));
  const picked = myVote && exhibitors.find((e) => e.id === myVote.exhibitor_id);
  const q = query.trim().toLowerCase();
  const list = exhibitors.filter((e) => !q || `${e.name} ${e.project} ${e.booth}`.toLowerCase().includes(q));
  const next = cats.find((c) => !votes[c.id]);

  const go = (id: number) => { setActiveId(id); setQuery(''); };
  const signOut = async () => {
    try { await api('/api/public/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    setSession(null);
  };

  return (
    <div className="ballot">
      <div className="ballot-head">
        <div className="row-between">
          <div>
            <p className="kicker">{t('hi', session!.name)}</p>
            <p className="progress-text">{t('progress', done, cats.length)}</p>
          </div>
          <button className="btn btn-link small" onClick={signOut}>{t('signOut')}</button>
        </div>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={cats.length} aria-valuenow={done}>
          {cats.map((c, i) => <span key={c.id} className={votes[c.id] ? 'on' : ''} style={accent(i)} />)}
        </div>
      </div>

      <nav className="tabs" role="tablist">
        {cats.map((c, i) => (
          <button key={c.id} role="tab" aria-selected={c.id === cat.id} style={accent(i)} onClick={() => go(c.id)}
            className={`tab${c.id === cat.id ? ' active' : ''}${votes[c.id] ? ' voted' : ''}`}>
            <span className="tab-dot" aria-hidden="true" /><span className="tab-label">{c.name}</span>
          </button>
        ))}
      </nav>

      <section className="cat" style={accent(idx)}>
        <header className="cat-head">
          <h1 className="cat-title">{cat.name}</h1>
          {cat.description && <p className="muted">{cat.description}</p>}
        </header>

        {picked && (
          <div className="voted-banner">
            <span className="tick" aria-hidden="true" />
            <div><b>{t('votedBanner', picked.project || picked.name)}</b><small>{t('votedNote')}</small></div>
            {next && <button className="btn btn-small" onClick={() => { go(next.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t('next')} →</button>}
          </div>
        )}

        {exhibitors.length > 6 && (
          <input className="search" type="search" placeholder={t('search')} aria-label={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        )}

        <ul className="cards">
          {list.length === 0 && <li className="muted empty">{t('noMatch')}</li>}
          {list.map((e) => {
            const mine = myVote?.exhibitor_id === e.id;
            return (
              <li key={e.id} className={`card${mine ? ' mine' : ''}${myVote && !mine ? ' dim' : ''}`}>
                <Photo e={e} className="card-img" />
                <div className="card-body">
                  <div className="card-top">
                    <h3 className="card-title">{e.project || e.name}</h3>
                    {e.booth && <span className="booth">{t('booth')} {e.booth}</span>}
                  </div>
                  {e.project && <p className="maker">{e.name}</p>}
                  {e.description && <p className="desc">{e.description}</p>}
                  {mine ? (
                    <span className="badge-mine"><span className="tick sm" aria-hidden="true" />{t('yourPick')}</span>
                  ) : !myVote && (
                    <button className="btn btn-vote" onClick={() => setConfirming({ e, cat })} aria-label={`${t('vote')}: ${e.project || e.name}`}>{t('vote')}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {confirming && <ConfirmSheet {...confirming} index={cats.findIndex((c) => c.id === confirming.cat.id)} onClose={() => setConfirming(null)} />}
    </div>
  );
}

/** Bottom sheet confirming a (final) vote. Safe to retry: the server treats a repeated identical vote as success. */
function ConfirmSheet({ e, cat, index, onClose }: { e: Exhibitor; cat: Category; index: number; onClose: () => void }) {
  const { t, location, setLocation, setSession, reload, setToast } = useVote();
  const [busy, setBusy] = useState<'casting' | 'locating' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const close = () => { if (!submitting.current) onClose(); };

  useEffect(() => {
    goRef.current?.focus();
    document.body.classList.add('noscroll');
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !submitting.current) onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.body.classList.remove('noscroll'); document.removeEventListener('keydown', esc); };
  }, [onClose]);

  const cast = async (loc = location, retryLocation = false) => {
    if (submitting.current && !retryLocation) return;
    submitting.current = true;
    setBusy('casting'); setErr(null);
    try {
      try {
        const r = await api<{ session: VisitorSession }>('/api/public/votes', {
          method: 'POST', body: { categoryId: cat.id, exhibitorId: e.id, location: loc ?? undefined }, retries: 3,
        });
        setSession(r.session);
        onClose();
        setToast(t('recorded'));
        navigator.vibrate?.(30);
      } catch (ex) {
        const e2 = ex as ApiError;
        if (e2.code === 'already_voted' && e2.body.session) { setSession(e2.body.session); onClose(); return; }
        if (e2.code === 'not_verified') { setSession(null); onClose(); await reload(); return; }
        if (e2.code === 'voting_closed') { onClose(); await reload(); return; }
        if (e2.code === 'not_on_site' && e2.body.access?.needsLocation && !loc) {
          try {
            setBusy('locating');
            const l = await getLocation();
            setLocation(l);
            return await cast(l, true);
          } catch { setErr(t('locDenied')); setBusy(null); return; }
        }
        setErr(errorText(t, e2));
      }
      setBusy(null);
    } finally { submitting.current = false; setBusy(null); }
  };

  return (
    <div className="sheet">
      <div className="sheet-backdrop" onClick={close} />
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title" style={accent(index)}>
        <div className="grab" aria-hidden="true" />
        <p className="kicker" id="sheet-title">{t('confirmTitle')}</p>
        <div className="sheet-ex">
          <Photo e={e} className="sheet-img" />
          <div><h2 className="title-sm">{e.project || e.name}</h2>{e.project && <p className="maker">{e.name}</p>}</div>
        </div>
        <p className="sheet-cat"><i aria-hidden="true" />{t('confirmBody', cat.name)}</p>
        <p className="fine">{t('confirmNote')}</p>
        {err && <p className="alert">{err}</p>}
        <button ref={goRef} className="btn btn-primary btn-block" disabled={!!busy} onClick={() => cast()}>
          {busy === 'casting' ? t('casting') : busy === 'locating' ? t('locating') : t('confirm')}
        </button>
        <button className="btn btn-ghost btn-block" disabled={!!busy} onClick={close}>{t('cancel')}</button>
      </div>
    </div>
  );
}
