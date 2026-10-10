import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { connectResults, type LiveStatus } from '../lib/live-results';
import type { CategoryResult, ResultsSnapshot } from '../lib/types';
import { useBodyClass } from '../lib/util';
import '../styles/display.css';
import { PublicLanguageButton, usePublicLanguage, type PublicLang } from '../lib/public-language';
import { displayText, type DisplayText } from './i18n';

const TOP_N = 3;
const DISPLAY_ACCENTS = ['#7f32d9', '#4a68d8', '#f8d749', '#74dccf', '#a52a3a'];

const SHAPES = ['gear', 'circle', 'triangle', 'diamond', 'spark'];

function shapeFor(slug: string, name: string, index: number): string {
  const key = `${slug} ${name}`.toLowerCase();
  if (key.includes('innov')) return 'gear';
  if (key.includes('impact') || key.includes('communit')) return 'circle';
  if (key.includes('craft') || key.includes('entrepren')) return 'triangle';
  return SHAPES[index % SHAPES.length];
}

function GearIcon() {
  return (
    <svg className="gear-icon" viewBox="0 0 72 72" aria-hidden="true">
      <g className="circuit">
        <path d="M7 15h12l7 7M4 29h15l7 4M7 54h12l8-8M14 64V53l9-8" />
        <circle cx="5" cy="15" r="3" />
        <circle cx="3" cy="29" r="3" />
        <circle cx="6" cy="54" r="3" />
        <circle cx="14" cy="66" r="3" />
      </g>
      <path
        className="gear"
        d="m48 10 4 7 8-1 3 8 7 4-3 8 3 8-7 4-3 8-8-1-4 7-8-3-8 3-4-7-8 1-3-8-7-4 3-8-3-8 7-4 3-8 8 1 4-7 8 3 8-3Z"
      />
      <circle className="gear-center" cx="40" cy="36" r="11" />
    </svg>
  );
}

/**
 * Live results dashboard for TV / projector (F7, F8).
 * Primary channel: Server-Sent Events. Fallback: polling every 5 s after
 * repeated SSE errors (some venue proxies buffer streams).
 */
export default function DisplayPage() {
  useBodyClass('tv');
  const { lang, setLang } = usePublicLanguage();
  const text = displayText[lang];
  const languageButton = <PublicLanguageButton lang={lang} setLang={setLang} />;
  const [phase, setPhase] = useState<'loading' | 'locked' | 'live' | 'error'>('loading');
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  const [snap, setSnap] = useState<ResultsSnapshot | null>(null);
  const [prev, setPrev] = useState<ResultsSnapshot | null>(null);
  const [qr, setQr] = useState<{ qr: string; refreshIn: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [, tick] = useState(0);
  const [connection, setConnection] = useState<LiveStatus>('connecting');
  const newest = useRef(-Infinity);
  const bootGeneration = useRef(0);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const receive = useCallback((s: ResultsSnapshot) => {
    const timestamp = Date.parse(s.generated_at);
    if (!Number.isFinite(timestamp) || timestamp < newest.current) return;
    newest.current = timestamp;
    setSnap((old) => { setPrev(old); return s; });
    setLastUpdate(Date.now());
  }, []);

  const boot = useCallback(async () => {
    const generation = ++bootGeneration.current;
    const key = new URLSearchParams(window.location.search).get('key');
    if (key) {
      try { await api('/api/display/auth', { method: 'POST', body: { key } }); }
      catch (e) { if (generation === bootGeneration.current) { setLockMsg((e as Error).message); setPhase((e as ApiError).status === 401 ? 'locked' : 'error'); setRetryAttempt(n => n + 1); } return; }
      if (generation !== bootGeneration.current) return;
      window.history.replaceState(null, '', '/display'); // don't leave the key on screen
    }
    try {
      const snapshot = await api<ResultsSnapshot>('/api/display/results');
      if (generation !== bootGeneration.current) return;
      receive(snapshot);
      // Signed-in admin without a key: pin this screen with a display cookie so it survives admin logout.
      if (!key) void api('/api/display/pair', { method: 'POST', body: {} }).catch(() => { /* not an admin; the display cookie is already in use */ });
      setPhase('live');
    } catch (e) {
      if (generation !== bootGeneration.current) return;
      if ((e as ApiError).status === 401) { setPhase('locked'); return; }
      setPhase('error');
      setRetryAttempt(n => n + 1);
    }
  }, [receive]);

  useEffect(() => {
    if (phase !== 'loading' && phase !== 'error') return;
    const timer = setTimeout(() => { void boot(); }, phase === 'error' ? 5000 : 0);
    return () => { clearTimeout(timer); bootGeneration.current++; };
  }, [boot, phase, retryAttempt]);

  // The voting QR carries a signed entry token that rotates; fetch the next one as each expires.
  useEffect(() => {
    if (phase !== 'live') return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await api<{ qr: string; refreshIn: number }>('/api/display/qr');
        if (disposed) return;
        setQr(result);
        timer = setTimeout(load, Math.max(1000, result.refreshIn + 250));
      } catch {
        // Keep the current code (still valid for one more period) and retry shortly.
        if (!disposed) timer = setTimeout(load, 3000);
      }
    };
    void load();
    return () => { disposed = true; clearTimeout(timer); };
  }, [phase]);

  // Live channel
  useEffect(() => {
    if (phase !== 'live') return;
    const disconnect = connectResults<ResultsSnapshot>({
      url: '/api/display/stream', load: () => api<ResultsSnapshot>('/api/display/results'),
      onSnapshot: receive, onStatus: setConnection,
      onUnauthorized: () => { setLockMsg('access_expired'); setPhase('locked'); },
    });
    const staleTimer = setInterval(() => tick((n) => n + 1), 5000);
    return () => { disconnect(); clearInterval(staleTimer); };
  }, [phase, receive]);

  if (phase === 'locked') return <>{languageButton}<KeyForm text={text} message={lockMsg === 'access_expired' ? text.expired : lockMsg} onUnlock={() => { newest.current = -Infinity; setLockMsg(null); setPhase('loading'); }} onError={setLockMsg} /></>;
  if (phase === 'error') return <>{languageButton}<div className="center"><div><p role="alert">{lockMsg || text.connectError}</p><button onClick={() => setPhase('loading')}>{text.retry}</button></div></div></>;
  if (!snap) return <>{languageButton}<div className="center"><span className="spinner" /></div></>;

  // Winners are announced only when the admin says so; a closed or paused vote is not final.
  const finalMode = !snap.voting.open && snap.show_winners && snap.totals.votes > 0;
  const stale = Date.now() - lastUpdate > 30000;

  return (
    <>
      <div className="display-stage" aria-hidden="true">
        <span className="shape shape-gear" />
        <span className="shape shape-yellow" />
        <span className="shape shape-navy" />
        <span className="shape shape-aqua" />
        <span className="shape shape-violet" />
      </div>

      <header className="hdr">
        <div className="hdr-brand">
          <img className="brand-lockup" src="/mc-logo-lockup.png" alt="The Maker Collective 2026" />
        </div>
        <div className="hdr-title">
          <p className="kicker">{[snap.event.name || 'The Maker Collective 2026', snap.event.venue].filter(Boolean).join(' · ')}</p>
          <h1><span>{text.titleLead}</span> {text.titleRest}</h1>
          <p className="dek">{snap.event.tagline || text.subtitle}</p>
        </div>
        <div className="hdr-status">
          {languageButton}
          {snap.show_counts && <Stat lang={lang} label={text.votes} value={snap.totals.votes} prev={prev?.totals.votes} />}
          {finalMode ? <span className="pill final">{text.final}</span>
            : snap.voting.open ? <span className={`pill live${stale || connection !== 'live' ? ' stale' : ''}`}><i />{connection === 'live' && !stale ? text.live : connection === 'polling' && !stale ? text.updating : text.disconnected}</span>
            : <span className="pill closed">{text.closed}</span>}
        </div>
      </header>

      <main className="cols" style={{ '--n': snap.categories.length } as React.CSSProperties}>
        {snap.categories.map((c, i) => (
          <Column key={c.id} text={text} lang={lang} c={c} index={i} finalMode={finalMode} showCounts={snap.show_counts} prev={prev?.categories.find((x) => x.id === c.id)} />
        ))}
      </main>

      <footer className="ftr">
        {(stale || connection !== 'live') && <p className="note" role="status">{stale || connection === 'offline' ? text.lost : text.polling}</p>}
        <div className="cta">
          <div className="cta-copy">
            <span>{text.join}</span>
            <b>{text.scanLead} <em>{text.scanAccent}</em></b>
            <i />
          </div>
          {qr && snap.voting.open ? (
            <div className="qr">
              <img src={qr.qr} alt={text.qrAlt} />
            </div>
          ) : (
            <p className="note">{snap.voting.open ? text.qrUnavailable : finalMode ? text.ended : text.votingClosed}</p>
          )}
        </div>
      </footer>
    </>
  );
}

function Stat({ label, value, prev, lang }: { label: string; value: number; prev?: number; lang: PublicLang }) {
  const changed = prev != null && prev !== value;
  return (
    <div className={`stat${changed ? ' bump' : ''}`} key={changed ? value : undefined}>
      <b>{value.toLocaleString(lang)}</b><span>{label}</span>
    </div>
  );
}

function Column({ c, index, finalMode, showCounts, prev, text, lang }: { c: CategoryResult; index: number; finalMode: boolean; showCounts: boolean; prev?: CategoryResult; text: DisplayText; lang: PublicLang }) {
  const prevVotes = new Map(prev ? prev.standings.map((s) => [s.id, s.votes]) : []);
  const max = Math.max(1, ...c.standings.map((s) => s.votes));
  const leaders = c.standings.filter((s) => s.rank === 1 && s.votes > 0);
  const lead = leaders[0];
  const nonLeaders = c.standings.filter((s) => !leaders.some((l) => l.id === s.id));
  const rows = leaders.length > 1 && lead ? [lead, ...nonLeaders.slice(0, TOP_N - 1)] : c.standings.slice(0, TOP_N);
  const displayedCount = leaders.length > 1 ? leaders.length + rows.length - 1 : rows.length;
  const categoryStyle = { '--accent': DISPLAY_ACCENTS[index % DISPLAY_ACCENTS.length] } as React.CSSProperties;
  const shape = shapeFor(c.slug, c.name, index);

  return (
    <section className={`col col-${index % 5}${finalMode ? ' is-final' : ''}`} style={categoryStyle}>
      <div className="col-head">
        <span className={`cat-mark ${shape}`} aria-hidden="true">{shape === 'gear' ? <GearIcon /> : <i />}</span>
        <div>
          <h2>{c.name}</h2>
          {c.description && <p>{c.description}</p>}
        </div>
      </div>
      {lead ? null : <div className="leader empty"><p>{text.waiting}</p></div>}
      <ol className="rows" aria-label={`${c.name} ${text.standings}`}>
        {rows.map((s, rowIndex) => {
          const up = prevVotes.has(s.id) && prevVotes.get(s.id)! < s.votes;
          const pct = (s.votes / max) * 100;
          const isLeader = s.rank === 1 && s.votes > 0;
          return (
            <li key={`${c.id}:${s.id}`} data-key={`${c.id}:${s.id}`} className={`row${up ? ' up' : ''}${isLeader ? ' leader-row' : ''}`}>
              <span className="rank">{s.votes ? s.rank : '-'}</span>
              {isLeader && <span className="crown" aria-hidden="true" />}
              <div className="row-main">
                <div className="row-label"><b>{leaders.length > 1 && rowIndex === 0 ? leaders.map((l) => l.project || l.name).join(' & ') : s.project || s.name}</b></div>
                <div className="bar"><i style={{ width: `${Math.max(pct, s.votes ? 10 : 0)}%` }} /></div>
              </div>
              {showCounts && <span className="n">{s.votes.toLocaleString(lang)}<small>{text.votes}</small></span>}
            </li>
          );
        })}
      </ol>
      {c.standings.length > displayedCount && <p className="more">+{(c.standings.length - displayedCount).toLocaleString(lang)} {text.more}</p>}
    </section>
  );
}

function KeyForm({ message, onUnlock, onError, text }: { message: string | null; onUnlock: () => void; onError: (m: string) => void; text: DisplayText }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  return (
    <div className="center">
      <form className="keyform" onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current || !key.trim()) return;
        submitting.current = true; setBusy(true);
        try { await api('/api/display/auth', { method: 'POST', body: { key: key.trim() } }); onUnlock(); }
        catch (err) { onError((err as Error).message); }
        finally { submitting.current = false; setBusy(false); }
      }}>
        <img className="brand-lockup" src="/mc-logo-lockup.png" alt="The Maker Collective 2026" />
        <h1>{text.title}</h1>
        <p>{text.protected}</p>
        {message && <p className="err">{message}</p>}
        <input type="password" dir="ltr" aria-label={text.key} placeholder={text.key} autoComplete="off" autoFocus required disabled={busy} value={key} onChange={(e) => setKey(e.target.value)} />
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? text.unlocking : text.unlock}</button>
      </form>
    </div>
  );
}
