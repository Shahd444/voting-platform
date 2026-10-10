import { api } from '../../lib/api';
import { useLang } from '../i18n';
import { Spinner, useLoad } from '../ui';

interface Entry { id: string; actor: string; action: string; ip: string | null; created_at: string }

export default function Audit() {
  const { t } = useLang();
  const a = t.audit;
  const { data, error, loading, reload } = useLoad(() => api<{ entries: Entry[] }>('/api/admin/audit'));
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted">{a.intro}</p>
        <button type="button" className="btn btn-sm" disabled={loading} aria-busy={loading} onClick={() => { void reload(); }}>{loading ? t.common.refreshing : error ? t.common.retry : t.common.refresh}</button>
      </div>
      {error && <p className="alert" role="alert">{a.loadError(error)}{data ? a.showingOld : ''}</p>}
      {!data && loading && <Spinner />}
      {data && <section className="card flush" aria-busy={loading}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{a.cols.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.entries.length === 0 && <tr><td colSpan={4} className="empty">{a.empty}</td></tr>}
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{t.when(e.created_at)}</td>
                  <td><bdi>{e.actor}</bdi></td>
                  <td><span className={`pill ${/failed|reset|deleted|purged|disabled/.test(e.action) ? 'warn' : ''}`}>{a.actions[e.action] ?? e.action.replace(/_/g, ' ')}</span></td>
                  <td className="mono small"><span dir="ltr">{e.ip || ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}
