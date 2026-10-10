import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ResultsSnapshot } from '../../lib/types';
import { accent } from '../../lib/util';
import { useLang } from '../i18n';
import { LoadError, Modal, PageHead, Spinner, useAdmin, useLoad } from '../ui';
import { useAction } from '../useAction';

export default function Results() {
  const { isAdmin } = useAdmin();
  const { t } = useLang();
  const r = t.results;
  const { data: snap, error, reload } = useLoad(() => api<ResultsSnapshot>('/api/admin/results'));
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 5000);
    return () => window.clearInterval(timer);
  }, [reload]);
  if (error) return <LoadError error={error} />;
  if (!snap) return <Spinner />;

  return (
    <div>
      <PageHead title={r.title} sub={r.sub(snap.totals.votes.toLocaleString('en'), snap.totals.voters.toLocaleString('en'), t.when(snap.generated_at))}>
        <a className="btn" href="/api/admin/export/results.csv">{r.csv}</a>
        <a className="btn" href="/api/admin/export/results.json">{r.json}</a>
        {isAdmin && <button className="btn btn-danger" onClick={() => setResetting(true)}>{r.reset}</button>}
      </PageHead>
      <div className="cat-grid">
        {snap.categories.map((c, i) => {
          const max = Math.max(1, ...c.standings.map((s) => s.votes));
          return (
            <section key={c.id} className="card" style={accent(i)}>
              <div className="cat-bar" />
              <div className="card-head"><h2>{c.name}</h2><span className="muted">{r.votes(c.total.toLocaleString('en'))}</span></div>
              <ol className="result-list">
                {c.standings.map((s) => (
                  <li key={s.id} className={s.rank === 1 && s.votes ? 'lead' : ''}>
                    <span className="rk">{s.votes ? s.rank : '–'}</span>
                    <div>
                      <div className="rl"><b>{s.project || s.name}</b><span className="muted small">{s.name}</span></div>
                      <div className="bar"><i style={{ width: `${(s.votes / max) * 100}%` }} /></div>
                    </div>
                    <b className="num">{s.votes}</b>
                    <span className="muted small pct">{c.total ? `${((100 * s.votes) / c.total).toFixed(1)}%` : '0%'}</span>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      {resetting && <ResetDialog onClose={() => setResetting(false)} onDone={() => { setResetting(false); reload(); }} />}
    </div>
  );
}

function ResetDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useAdmin();
  const { t } = useLang();
  const r = t.results;
  const [password, setPassword] = useState('');
  const [purge, setPurge] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { busy, run } = useAction();
  return (
    <Modal title={r.resetTitle} busy={busy} onClose={onClose}>
      <div className="stack">
        <p>{r.resetBody}</p>
        <label className="check"><input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} /><span>{r.purge}</span></label>
        <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>{r.confirmReset}</span></label>
        <label className="field"><span>{r.adminPassword}</span><input className="input" dir="ltr" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-danger" disabled={busy || !confirmed || !password} aria-busy={busy} onClick={() => run('reset', async () => {
            const res = await api<{ deleted: number }>('/api/admin/results/reset', { method: 'POST', body: { password, purgeVisitors: purge } });
            toast(r.resetDone(res.deleted)); onDone();
          })}>{busy ? t.common.deleting : r.deleteAll}</button>
        </div>
      </div>
    </Modal>
  );
}
