import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApiError } from '../lib/api';
import type { GeoPoint, PublicState, VisitorSession } from '../lib/types';
import { getLocation, safeStore, useBodyClass } from '../lib/util';
import '../styles/vote.css';
import { Ballot } from './Ballot';
import { errorText, makeT } from './i18n';
import { PublicLanguageButton, usePublicLanguage } from '../lib/public-language';
import { ClosedScreen, DoneScreen, ErrorScreen, OffsiteScreen } from './Screens';
import { checkLocation as requestLocationCheck, registrationGate } from './access';
import { OtpScreen, RegisterScreen, type Challenge, type FormState } from './Signup';
import { VoteContext } from './VoteContext';

/**
 * Visitor voting page — mobile-first, bilingual (EN/AR), resilient to flaky
 * venue Wi-Fi (retries, idempotent votes, offline banner).
 *
 * Flow: on-site check → name + phone → SMS code → one vote per category → done.
 */
export default function VotePage() {
  useBodyClass('vote');
  const { lang, setLang } = usePublicLanguage();
  const t = useMemo(() => makeT(lang), [lang]);

  const [data, setData] = useState<PublicState | null>(null);
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [location, setLocationState] = useState<GeoPoint | null>(null);
  const locationRef = useRef<GeoPoint | null>(null);
  const setLocation = (loc: GeoPoint | null) => { locationRef.current = loc; setLocationState(loc); };
  const [onSite, setOnSite] = useState(false);
  const accessRevision = useRef(0);
  const stateRequest = useRef(0);
  const attemptedLocationMode = useRef<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [challenge, setChallengeState] = useState<Challenge | null>(() => safeStore.get<Challenge>('challenge'));
  const [form, setFormState] = useState<FormState>(() => safeStore.get<FormState>('form') || { name: '', phone: '', consent: false });
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState<string | null>(null);
  const [qrEntry, setQrEntry] = useState<'none' | 'checking' | 'ready'>(() =>
    new URLSearchParams(window.location.search).has('entry') || new URLSearchParams(window.location.hash.slice(1)).has('entry') ? 'checking' : 'none');

  const setChallenge = (c: Challenge | null) => { setChallengeState(c); if (c) safeStore.set('challenge', c); else safeStore.del('challenge'); };
  const setForm = (f: FormState) => { setFormState(f); safeStore.set('form', f); };
  const requireQr = () => setData(previous => previous ? { ...previous, qrEntryRequired: true, qrEntryAllowed: false } : previous);
  const checkLocation = useCallback(async (loc: GeoPoint) => {
    const revision = ++accessRevision.current;
    const result = await requestLocationCheck(loc);
    if (revision !== accessRevision.current) return false;
    locationRef.current = result.allowed ? loc : null;
    setLocationState(locationRef.current);
    setOnSite(result.allowed);
    return result.allowed;
  }, []);

  const load = useCallback(async () => {
    const request = ++stateRequest.current;
    const revision = accessRevision.current;
    try {
      const s = await api<PublicState>('/api/public/state', { retries: 3 });
      if (request !== stateRequest.current || revision !== accessRevision.current) return;
      if (s.access.needsLocation && locationRef.current) {
        s.access = await requestLocationCheck(locationRef.current);
        if (request !== stateRequest.current || revision !== accessRevision.current) return;
      }
      setData(s);
      setSession(s.session);
      setOnSite(s.access.allowed);
      if (s.session) setChallenge(null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e as ApiError);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reset clears saved votes (or registrations); reconcile open screens with server state.
  useEffect(() => {
    let refreshing = false;
    const timer = window.setInterval(async () => {
      if (refreshing || document.visibilityState !== 'visible' || !navigator.onLine) return;
      refreshing = true;
      try { await load(); } finally { refreshing = false; }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load, challenge]);

  // A rotating venue QR is exchanged immediately for a short-lived browser grant. This runs on page
  // load and again when the address changes, so scanning while the page is already open (in-app
  // scanners reuse the open page) works too.
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let active = true;
    const enter = () => {
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(url.hash.slice(1));
      const token = url.searchParams.get('entry') || hashParams.get('entry');
      if (!token) return;
      setQrEntry('checking');
      const cleanEntryFromUrl = () => {
        url.searchParams.delete('entry');
        hashParams.delete('entry');
        url.hash = hashParams.toString();
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      };
      api('/api/public/qr-entry', { method: 'POST', body: { token } })
        .then(async () => {
          if (!active) return;
          cleanEntryFromUrl();
          await load();
          if (active) setQrEntry('ready');
        })
        .catch((error) => {
          if (!active) return;
          setQrEntry('none');
          if (error.code?.startsWith('vote_qr')) cleanEntryFromUrl();
          setToast(errorText(tRef.current, error));
        });
    };
    enter();
    window.addEventListener('hashchange', enter);
    return () => { active = false; window.removeEventListener('hashchange', enter); };
  }, [load]);

  // Automatic and manual GPS both require backend approval before registration.
  const needsAutoLocation = !!data?.access.needsLocation && !location && qrEntry !== 'checking';
  const accessMode = data?.access.mode;
  useEffect(() => {
    if (!needsAutoLocation || !accessMode || attemptedLocationMode.current === accessMode) return;
    attemptedLocationMode.current = accessMode;
    setLocating(true);
    void getLocation().then(checkLocation)
      .catch(() => { /* The off-site screen offers a manual retry. */ })
      .finally(() => setLocating(false));
  }, [needsAutoLocation, accessMode, checkLocation]);

  // Network awareness: banner when offline, refresh when back / when the tab returns
  useEffect(() => {
    const on = () => { setOnline(true); load(); };
    const off = () => setOnline(false);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const ctx = { t, lang, data, session, setSession, location, setLocation, setOnSite, checkLocation, requireQr, reload: load, setToast };
  const gate = data ? registrationGate(onSite, session) : null;

  let screen: React.ReactNode;
  if (qrEntry === 'checking') {
    screen = <div className="loading"><span className="spinner" /></div>;
  } else if (!data) {
    screen = loadError ? <ErrorScreen message={errorText(t, loadError)} /> : <div className="loading"><span className="spinner" /></div>;
  } else if (!data.voting.open) {
    screen = <ClosedScreen />;
  } else if (session) {
    const allDone = data.categories.length > 0 && data.categories.every((c) => session.votes[c.id]);
    screen = allDone ? <DoneScreen /> : <Ballot />;
  } else if (gate === 'offsite' && locating) {
    screen = <div className="loading" role="status">{t('locating')}</div>;
  } else if (gate === 'offsite') {
    screen = <OffsiteScreen />;
  } else if (challenge) {
    screen = <OtpScreen challenge={challenge} setChallenge={setChallenge} form={form} />;
  } else {
    screen = <RegisterScreen form={form} setForm={setForm} setChallenge={setChallenge} />;
  }

  return (
    <VoteContext.Provider value={ctx}>
      <PublicLanguageButton lang={lang} setLang={setLang} />
      {!online && <div className="offline">{t('offline')}</div>}
      <header className="topbar">
        <a className="brand" href="/" aria-label={t('brandHome')}>
          <img className="brand-lockup" src="/mc-logo-lockup.png" alt={t('brandAlt')} />
          <span className="brand-text"><b>MC2026</b> <span>{t('awards')}</span></span>
        </a>
      </header>
      <main id="app" aria-live="polite">{screen}</main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </VoteContext.Provider>
  );
}
