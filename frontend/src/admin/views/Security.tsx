import { useState } from 'react';
import { api } from '../../lib/api';
import { useLang } from '../i18n';
import { useAdmin } from '../ui';
import { PasswordInput } from '../PasswordInput';
import { useAction } from '../useAction';

/** Password change. */
export default function Security() {
  return (
    <div className="stack">
      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const { toast } = useAdmin();
  const { t } = useLang();
  const s = t.security;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { busy, run } = useAction();
  return (
    <section className="card">
      <div className="card-head"><h2>{s.password}</h2></div>
      <p className="muted">{s.passwordIntro}</p>
      <form className="grid3" onSubmit={async (e) => {
        e.preventDefault();
        await run('password', async () => {
          await api('/api/admin/password', { method: 'POST', body: { current, next } });
          setCurrent(''); setNext(''); toast(s.changed);
        });
      }}>
        <label className="field"><span>{s.currentPassword}</span><PasswordInput autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label className="field"><span>{s.newPassword}</span><PasswordInput autoComplete="new-password" required minLength={10} maxLength={200} value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <div className="field"><span>&nbsp;</span><button className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? s.updating : s.update}</button></div>
      </form>
    </section>
  );
}
