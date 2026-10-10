import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLang } from '../i18n';
import { LoadError, PageHead, Spinner, useLoad } from '../ui';

interface Row { id: string; name: string; phone: string; verified_at: string; votes: number; consent_outreach: boolean }
const LIMIT = 50;

/** Verified visitors (F14). Phones are masked here; full numbers only in the audited export. */
export default function Visitors() {
  const { t } = useLang();
  const v = t.visitors;
  const [offset, setOffset] = useState(0);
  const { data, error } = useLoad(async () => ({
    ...await api<{ total: number; visitors: Row[] }>(`/api/admin/visitors?limit=${LIMIT}&offset=${offset}`), offset,
  }), [offset]);
  useEffect(() => {
    if (!data || data.offset !== offset || offset === 0 || offset < data.total) return;
    setOffset(Math.max(0, Math.floor((data.total - 1) / LIMIT) * LIMIT));
  }, [data, offset]);
  if (error) return <LoadError error={error} />;
  if (!data || data.offset !== offset) return <Spinner />;
  return (
    <div>
      <PageHead title={v.title} sub={v.sub}>
        <a className="btn" href="/api/admin/export/visitors.csv?consented=true">{v.exportOptIn}</a>
        <a className="btn" href="/api/admin/export/visitors.csv">{v.exportAll}</a>
      </PageHead>
      <section className="card flush">
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{v.cols.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.visitors.length === 0 && <tr><td colSpan={5} className="empty">{v.empty}</td></tr>}
              {data.visitors.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td><td className="mono"><span dir="ltr">{r.phone}</span></td><td>{t.when(r.verified_at)}</td><td className="num">{r.votes}</td>
                  <td>{r.consent_outreach ? <span className="pill ok">{t.common.yes}</span> : <span className="pill">{t.common.no}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">{data.total ? t.common.of(offset + 1, Math.min(offset + LIMIT, data.total), data.total) : ''}</span>
          <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(offset - LIMIT)}>{t.common.prev}</button>
          <button className="btn btn-sm" disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>{t.common.next}</button>
        </div>
      </section>
    </div>
  );
}
