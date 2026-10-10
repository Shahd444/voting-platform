import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Settings } from '../../lib/types';
import { getLocation } from '../../lib/util';
import { ACCESS_MODES, usesGeo, usesIp } from '../accessModes';
import { useLang } from '../i18n';
import { LoadError, Spinner, useAdmin, useLoad } from '../ui';
import { useAction } from '../useAction';


/** On-site access control (F11): venue network + venue location, set up at each venue. */
export default function Access() {
  const { isAdmin, toast } = useAdmin();
  const { t } = useLang();
  const a = t.access;
  const { data, error, reload } = useLoad(() => api<{ settings: Settings; clientIp: string; clientNetworks?: string[] }>('/api/admin/settings'));
  const [mode, setMode] = useState('ip_or_geo');
  const [cidrs, setCidrs] = useState('');
  const [geo, setGeo] = useState({ lat: '', lng: '', radius_m: '', max_accuracy_m: '' });
  const { busy, pending, run } = useAction();

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    // Retired single-check rules are offered as the combined rule; saving applies it.
    setMode(ACCESS_MODES.includes(s.access.mode) ? s.access.mode : 'ip_or_geo');
    setCidrs(s.access.allowed_cidrs.join('\n'));
    const g = s.access.geofence;
    setGeo({ lat: String(g.lat ?? ''), lng: String(g.lng ?? ''), radius_m: String(g.radius_m ?? 150), max_accuracy_m: String(g.max_accuracy_m ?? 500) });
  }, [data]);

  if (error) return <LoadError error={error} />;
  if (!data) return <Spinner />;
  const dis = !isAdmin;
  const ip = data.clientIp;
  const ipRange = `${ip}${ip.includes(':') ? '/128' : '/32'}`;
  const ipList = cidrs.split(/[\s,]+/).filter(Boolean);
  const detectedNetworks = data.clientNetworks || [];
  const networkRanges = detectedNetworks.length ? detectedNetworks : [ipRange];
  const hasThisNetwork = detectedNetworks.length
    ? detectedNetworks.every((network) => ipList.includes(network))
    : ipList.includes(ipRange) || ipList.includes(ip);
  const geoOn = usesGeo(mode), ipOn = usesIp(mode);
  const geoSet = geo.lat !== '' && geo.lng !== '';
  const saved = data.settings.access;
  const dirty = mode !== saved.mode || cidrs.trim() !== saved.allowed_cidrs.join('\n')
    || geo.lat !== String(saved.geofence.lat ?? '') || geo.lng !== String(saved.geofence.lng ?? '')
    || geo.radius_m !== String(saved.geofence.radius_m ?? 150) || geo.max_accuracy_m !== String(saved.geofence.max_accuracy_m ?? 500);

  const save = () => run('save', async () => {
    await api('/api/admin/settings/access', { method: 'PUT', body: {
      mode, allowed_cidrs: ipList,
      ...(geoOn ? { geofence: { lat: Number(geo.lat), lng: Number(geo.lng), radius_m: Number(geo.radius_m), max_accuracy_m: Number(geo.max_accuracy_m) } } : {}),
    } });
    toast(a.saved);
    reload();
  });

  const useMyLocation = () => run('location', async () => {
    try {
      const l = await getLocation();
      setGeo({ ...geo, lat: l.lat.toFixed(6), lng: l.lng.toFixed(6) });
      toast(a.locationSet(Math.round(l.accuracy)));
    } catch { toast(a.locationFailed, 'err'); }
  });

  return (
    <div className="stack">
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (e.currentTarget.reportValidity()) void save(); }}>
        <div className="card-head"><h2>{a.who}</h2></div>
        <p className="muted lead">{a.intro}</p>

        <fieldset className="section" disabled={dis}>
          <legend>{a.rule}</legend>
          <div className="modes">
            {ACCESS_MODES.map((id) => (
              <label key={id} className={`mode${id === 'off' ? ' warn' : ''}`}>
                <input type="radio" name="mode" value={id} checked={mode === id} onChange={() => setMode(id)} />
                <div><b>{t.modes[id][0]}</b><span>{t.modes[id][1]}</span></div>
              </label>
            ))}
          </div>
          {mode === 'off' && <p className="alert">{a.offWarning}</p>}
        </fieldset>

        <div className="grid2 top">
          <fieldset className={`section${ipOn ? '' : ' is-unused'}`} disabled={dis}>
            <legend>{a.network}</legend>
            <div className="network-now">
              <span>{a.thisNetwork}</span>
              <code dir="ltr">{ip}</code>
              {hasThisNetwork
                ? <span className="pill ok">{a.allowed}</span>
                : !dis && <button type="button" className="btn btn-sm btn-primary" onClick={() => setCidrs([...new Set([...ipList, ...networkRanges])].join('\n'))}>{a.useNetwork}</button>}
            </div>
            <label className="field"><span>{a.networks}</span>
              <textarea className="input mono" dir="ltr" rows={4} placeholder={a.networksPh} value={cidrs} onChange={(e) => setCidrs(e.target.value)} /></label>
            <p className="muted small">{a.networkHint}</p>
            {!ipOn && <p className="muted small">{a.unused}</p>}
          </fieldset>

          <fieldset className={`section${geoOn ? '' : ' is-unused'}`} disabled={dis}>
            <legend>{a.location}</legend>
            <div className="actions">
              {!dis && <button type="button" className="btn btn-sm btn-primary" disabled={busy} aria-busy={pending === 'location'} onClick={useMyLocation}>{pending === 'location' ? a.locating : a.useLocation}</button>}
              {geoSet && <a className="btn btn-sm" target="_blank" rel="noopener" href={`https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lng}#map=17/${geo.lat}/${geo.lng}`}>{a.viewMap}</a>}
            </div>
            <div className="grid2">
              <label className="field"><span>{a.lat}</span><input className="input" dir="ltr" type="number" min={-90} max={90} step="any" required={geoOn} value={geo.lat} onChange={(e) => setGeo({ ...geo, lat: e.target.value })} /></label>
              <label className="field"><span>{a.lng}</span><input className="input" dir="ltr" type="number" min={-180} max={180} step="any" required={geoOn} value={geo.lng} onChange={(e) => setGeo({ ...geo, lng: e.target.value })} /></label>
              <label className="field"><span>{a.radius}</span><input className="input" dir="ltr" type="number" min={10} max={50000} step={1} required={geoOn} value={geo.radius_m} onChange={(e) => setGeo({ ...geo, radius_m: e.target.value })} /></label>
              <label className="field"><span>{a.accuracy}</span><input className="input" dir="ltr" type="number" min={0} step="any" required={geoOn} value={geo.max_accuracy_m} onChange={(e) => setGeo({ ...geo, max_accuracy_m: e.target.value })} /></label>
            </div>
            <p className="muted small">{a.radiusHint}</p>
            {!geoOn && <p className="muted small">{a.unused}</p>}
          </fieldset>
        </div>

        {!dis && <div className="form-foot">
          <span className="muted small">{dirty ? a.unsaved : a.allSaved}</span>
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty} aria-busy={pending === 'save'}>{pending === 'save' ? t.common.saving : a.saveRules}</button>
        </div>}
      </form>
    </div>
  );
}
