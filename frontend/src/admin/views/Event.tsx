import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Settings } from '../../lib/types';
import { isLocalAddress } from '../address';
import { useLang } from '../i18n';
import { LoadError, Spinner, useAdmin, useLoad } from '../ui';
import { useAction } from '../useAction';

/** Event details shown to visitors and on the results screen. */
export default function Event() {
  const { isAdmin, toast } = useAdmin();
  const { t } = useLang();
  const e = t.event;
  const { data, error, reload } = useLoad(() => api<{ settings: Settings }>('/api/admin/settings'));
  const [ev, setEv] = useState({ name: '', tagline: '', venue: '', public_url: '' });
  const [showCounts, setShowCounts] = useState(true);
  const { busy, pending, run } = useAction();

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    setEv({ name: s.event.name, tagline: s.event.tagline, venue: s.event.venue, public_url: s.event.public_url || '' });
    setShowCounts(s.display.show_counts !== false);
  }, [data]);

  if (error) return <LoadError error={error} />;
  if (!data) return <Spinner />;
  const dis = !isAdmin;

  const saveEvent = () => run('event', async () => {
    await api('/api/admin/settings/event', { method: 'PUT', body: ev });
    toast(e.saved); reload();
  });
  const saveCounts = (value: boolean) => run('display', async () => {
    setShowCounts(value);
    try {
      await api('/api/admin/settings/display', { method: 'PUT', body: { show_counts: value } });
      toast(value ? e.countsOn : e.countsOff);
    } catch (ex) { setShowCounts(!value); throw ex; }
  });

  return (
    <div className="stack">
      <form className="card" onSubmit={(ev_) => { ev_.preventDefault(); if (ev_.currentTarget.reportValidity()) void saveEvent(); }}>
        <div className="card-head"><h2>{e.details}</h2></div>
        <p className="muted lead">{e.detailsIntro}</p>
        <div className="grid3">
          <label className="field"><span>{e.name}</span><input className="input" required maxLength={80} pattern=".*\S.*" disabled={dis} value={ev.name} onChange={(x) => setEv({ ...ev, name: x.target.value })} /></label>
          <label className="field"><span>{e.tagline}</span><input className="input" maxLength={120} disabled={dis} value={ev.tagline} onChange={(x) => setEv({ ...ev, tagline: x.target.value })} /></label>
          <label className="field"><span>{e.venue}</span><input className="input" maxLength={120} disabled={dis} value={ev.venue} onChange={(x) => setEv({ ...ev, venue: x.target.value })} /></label>
        </div>
        <label className="field address-field"><span>{e.address}</span>
          <input className="input mono" dir="ltr" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={200} disabled={dis} placeholder="http://192.168.1.20:3000"
            value={ev.public_url} onChange={(x) => setEv({ ...ev, public_url: x.target.value })} />
          <small className="muted">{e.addressHint}</small>
          {isLocalAddress(ev.public_url) && <small className="address-warn" role="note">{e.addressLocal}</small>}
        </label>
        {!dis && <div className="form-foot"><span /><button type="submit" className="btn btn-primary" disabled={busy} aria-busy={pending === 'event'}>{pending === 'event' ? t.common.saving : e.save}</button></div>}
      </form>

      <section className="card">
        <div className="card-head"><h2>{e.screen}</h2></div>
        <p className="muted lead">{e.screenIntro}</p>
        <div className="segmented" role="radiogroup" aria-label={e.showsLabel}>
          <label className={showCounts ? 'is-on' : ''}><input type="radio" name="counts" disabled={dis || busy} checked={showCounts} onChange={() => saveCounts(true)} />{e.withCounts}</label>
          <label className={showCounts ? '' : 'is-on'}><input type="radio" name="counts" disabled={dis || busy} checked={!showCounts} onChange={() => saveCounts(false)} />{e.rankingsOnly}</label>
        </div>
        <p className="muted small">{e.countsHint}</p>
      </section>
    </div>
  );
}
