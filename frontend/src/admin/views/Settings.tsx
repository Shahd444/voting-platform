import { lazy, Suspense } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import NotFound from '../../NotFound';
import { useLang } from '../i18n';
import { PageHead, Spinner, useAdmin } from '../ui';
import Access from './Access';

const Event = lazy(() => import('./Event'));
const Security = lazy(() => import('./Security'));
const Audit = lazy(() => import('./Audit'));

/** Set-up pages that change rarely: on-site rules, event details, accounts, activity log. */
export default function Settings() {
  const { isAdmin } = useAdmin();
  const { t } = useLang();
  const tabs = ['access', 'event', 'account', ...(isAdmin ? ['activity'] : [])];
  return (
    <div>
      <PageHead title={t.settings.title} />
      <nav className="tabs" aria-label={t.settings.title}>
        {tabs.map((id) => <NavLink key={id} to={`/admin/settings/${id}`} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>{t.settings.tabs[id]}</NavLink>)}
      </nav>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route index element={<Navigate to="access" replace />} />
          <Route path="access" element={<Access />} />
          <Route path="event" element={<Event />} />
          <Route path="account" element={<Security />} />
          {isAdmin && <Route path="activity" element={<Audit />} />}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
}
