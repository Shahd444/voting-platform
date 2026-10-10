import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import './styles/brand.css';
import NotFound from './NotFound';
import { ADMIN_ROUTES } from './lib/routes';

// Route-level code splitting: a visitor's phone only downloads the voting page.
const VotePage = lazy(() => import('./vote/VotePage'));
const DisplayPage = lazy(() => import('./display/DisplayPage'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

const Loading = () => <div className="boot-spinner"><span className="spinner" /></div>;

function AdminRoute() {
  const { pathname } = useLocation();
  return ADMIN_ROUTES.includes(pathname.replace(/\/+$/, '')) ? <AdminApp /> : <NotFound />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/display" element={<DisplayPage />} />
          <Route path="/admin/*" element={<AdminRoute />} />
          <Route path="/" element={<VotePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
