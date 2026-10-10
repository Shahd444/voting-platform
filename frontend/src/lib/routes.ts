// Explicit entry routes prevent admin typos from opening login or the voter page.
export const ADMIN_ROUTES = [
  '/admin', '/admin/dashboard', '/admin/exhibitors', '/admin/categories', '/admin/results', '/admin/visitors',
  '/admin/settings', '/admin/settings/access', '/admin/settings/event', '/admin/settings/account', '/admin/settings/activity',
  // earlier URLs, redirected inside the admin app
  '/admin/overview', '/admin/access', '/admin/security', '/admin/audit',
];
