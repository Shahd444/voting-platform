import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, ApiError, onAdminSessionExpired } from '../lib/api';
import type { AdminUser } from '../lib/types';
import { initials, useBodyClass } from '../lib/util';
import '../styles/admin.css';
import { LangProvider, LangToggle, useLang } from './i18n';
import { Login } from './Login';
import { AdminProvider, Spinner, useAdmin } from './ui';
import Dashboard from './views/Dashboard';
import { useAction } from './useAction';
import NotFound from '../NotFound';

const Exhibitors = lazy(() => import('./views/Exhibitors'));
const Categories = lazy(() => import('./views/Categories'));
const Results = lazy(() => import('./views/Results'));
const Visitors = lazy(() => import('./views/Visitors'));
const Settings = lazy(() => import('./views/Settings'));

/** [route, admin-only]; labels come from the language file. */
const NAV: [string, boolean?][] = [
  ['dashboard'], ['exhibitors'], ['categories'], ['results'], ['visitors', true], ['settings'],
];

/** Earlier admin URLs, kept working for bookmarks. */
const MOVED: [string, string][] = [
  ['overview', 'dashboard'], ['access', 'settings/access'], ['security', 'settings/account'], ['audit', 'settings/activity'],
];

/** Admin console — exhibitors, categories, voting window, access rules, exports, MFA, audit. */
export default function AdminApp() {
  useBodyClass('admin');
  return <LangProvider><AdminRoot /></LangProvider>;
}

function AdminRoot() {
  const { t, err } = useLang();
  const [me, setMe] = useState<AdminUser | null | undefined>(undefined);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    if (!me) return;
    return onAdminSessionExpired(() => {
      setSessionExpired(true);
      setMe(null);
    });
  }, [me]);

  const loadMe = useCallback(async () => {
    setLoadError(null);
    try { setMe((await api<{ admin: AdminUser }>('/api/admin/me')).admin); }
    catch (error) {
      if ((error as ApiError).status === 401) setMe(null);
      else setLoadError(error);
    }
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);

  if (loadError) return <div className="card"><p className="alert" role="alert">{err(loadError)}</p><button className="btn" onClick={loadMe}>{t.common.retry}</button></div>;
  if (me === undefined) return <Spinner />;
  if (me === null) return <Login initialMessage={sessionExpired ? t.shell.sessionExpired : null} onDone={() => { setSessionExpired(false); loadMe(); }} />;

  return (
    <AdminProvider me={me} setMe={setMe}>
      <Shell />
    </AdminProvider>
  );
}

function Shell() {
  const { t, err } = useLang();
  const { me, isAdmin, setMe, toast } = useAdmin();
  const { busy, run } = useAction();

  return (
    <div className="layout">
      <aside className="side">
        <div className="logo"><img src="/mc-logo-lockup.png" alt={t.shell.logoAlt} /><div><b>{t.shell.brand}</b><span>{t.shell.console}</span></div></div>
        <nav className="nav">
          {NAV.filter(([, adminOnly]) => !adminOnly || isAdmin).map(([id]) => (
            <NavLink key={id} to={`/admin/${id}`} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>{t.shell.nav[id]}</NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="avatar">{initials(me.username)}</span>
            <div><b>{me.username}</b><span>{me.role === 'admin' ? t.shell.administrator : t.shell.viewer}</span></div>
          </div>
          <button className="btn btn-ghost-dark btn-block" disabled={busy} aria-busy={busy} onClick={() => run('logout', async () => {
            try { await api('/api/admin/logout', { method: 'POST', body: {} }); setMe(null); }
            catch (ex) { toast(err(ex), 'err'); }
          })}>{busy ? t.shell.signingOut : t.shell.signOut}</button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><LangToggle /></div>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="exhibitors" element={<Exhibitors />} />
            <Route path="categories" element={<Categories />} />
            <Route path="results" element={<Results />} />
            {isAdmin && <Route path="visitors" element={<Visitors />} />}
            <Route path="settings/*" element={<Settings />} />
            {MOVED.map(([from, to]) => <Route key={from} path={from} element={<Navigate to={`/admin/${to}`} replace />} />)}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
