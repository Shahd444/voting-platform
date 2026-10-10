import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { AdminCategory, AdminExhibitor } from '../../lib/types';
import { accent } from '../../lib/util';
import { useLang } from '../i18n';
import { LoadError, Modal, PageHead, Spinner, useAdmin, useLoad } from '../ui';
import { useAction } from '../useAction';

export default function Categories() {
  const { isAdmin, toast, confirm } = useAdmin();
  const { t } = useLang();
  const c_ = t.cat;
  const [managing, setManaging] = useState<AdminCategory | null>(null);
  const { data, error, reload } = useLoad(() => api<{ categories: AdminCategory[] }>('/api/admin/categories'));
  const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null);
  const { busy, pending, run } = useAction();
  if (error) return <LoadError error={error} />;
  if (!data) return <Spinner />;
  const cats = data.categories;

  const remove = (c: AdminCategory) => run(`delete-${c.id}`, async () => {
    if (!(await confirm(c_.confirmDelete(c.name), { danger: true, confirmText: t.common.delete }))) return;
    try {
      await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
    } catch (ex) {
      if ((ex as ApiError).code !== 'has_votes') throw ex;
      if (!(await confirm(c_.confirmForce(c.name), { danger: true, confirmText: c_.forceBtn, typeToConfirm: 'DELETE' }))) return;
      await api(`/api/admin/categories/${c.id}?force=true`, { method: 'DELETE' });
    }
    toast(c_.deleted); reload();
  });

  return (
    <div>
      <PageHead title={c_.title}>
        {isAdmin && <button className="btn btn-primary" disabled={busy} onClick={() => setEditing('new')}>{c_.add}</button>}
      </PageHead>
      <div className="cat-grid">
        {cats.map((c, i) => (
          <section key={c.id} className={`card cat-card${c.is_active ? '' : ' inactive'}`} style={accent(i)}>
            <div className="cat-bar" />
            <h2>{c.name}</h2>
            <p className="muted">{c.description || c_.noDescription}</p>
            <div className="cat-meta"><span>{c_.exhibitors(c.exhibitor_count)}</span>{!c.is_active && <span className="pill">{c_.hidden}</span>}</div>
            {isAdmin && <div className="actions">
              <button className="btn btn-sm" disabled={busy} onClick={() => setManaging(c)}>{c_.manage}</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(c)}>{t.common.edit}</button>
              <button className="btn btn-sm btn-ghost danger" disabled={busy} aria-busy={pending === `delete-${c.id}`} onClick={() => remove(c)}>{pending === `delete-${c.id}` ? t.common.deleting : t.common.delete}</button>
            </div>}
          </section>
        ))}
      </div>
      {managing && <CategoryMembers category={managing} onClose={() => { setManaging(null); reload(); }} />}
      {editing && <CategoryForm category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast(c_.saved); reload(); }} />}
    </div>
  );
}

function CategoryForm({ category, onClose, onSaved }: { category: AdminCategory | null; onClose: () => void; onSaved: () => void }) {
  const { t, err: errText } = useLang();
  const c_ = t.cat;
  const isNew = !category;
  const [name, setName] = useState(category?.name || '');
  const [slug, setSlug] = useState(category?.slug || '');
  const [description, setDescription] = useState(category?.description || '');
  const [active, setActive] = useState(category ? category.is_active : true);
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useAction();
  return (
    <Modal title={isNew ? c_.addTitle : c_.editTitle} busy={busy} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (!e.currentTarget.reportValidity()) return;
        await run('save', async () => {
          setErr(null);
          try {
            await api(isNew ? '/api/admin/categories' : `/api/admin/categories/${category!.id}`, {
              method: isNew ? 'POST' : 'PUT',
              body: { name, slug: slug.trim() || undefined, description, is_active: active },
            });
            onSaved();
          } catch (ex) { setErr(errText(ex)); }
        });
      }}>
        <label className="field"><span>{c_.name}</span><input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>{c_.slug}</span><input className="input mono" dir="ltr" maxLength={40} autoCapitalize="none" spellCheck={false} disabled={busy} placeholder={c_.slugPh} value={slug} onChange={(e) => setSlug(e.target.value)} />
          <small className="muted">{c_.slugHint}</small>
        </label>
        <label className="field"><span>{c_.description}</span><textarea className="input" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>{c_.active}</span></label>
        {err && <p className="alert">{err}</p>}
        <div className="actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>{t.common.cancel}</button><button className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? t.common.saving : t.common.save}</button></div>
      </form>
    </Modal>
  );
}

/** Tick/untick exhibitors to add them to or remove them from one category. Each change saves immediately. */
function CategoryMembers({ category, onClose }: { category: AdminCategory; onClose: () => void }) {
  const { toast, confirm } = useAdmin();
  const { t, err } = useLang();
  const c_ = t.cat;
  const { data, error, reload } = useLoad(() => api<{ exhibitors: AdminExhibitor[] }>('/api/admin/exhibitors'));
  const [pendingId, setPendingId] = useState<number | null>(null);

  const send = (e: AdminExhibitor, member: boolean, force: boolean) => {
    const category_ids = member ? [...e.category_ids, category.id] : e.category_ids.filter((id) => id !== category.id);
    const fd = new FormData();
    fd.append('name', e.name); fd.append('project', e.project || ''); fd.append('booth', e.booth || '');
    fd.append('description', e.description || ''); fd.append('is_active', String(e.is_active));
    fd.append('category_ids', JSON.stringify(category_ids));
    return api(`/api/admin/exhibitors/${e.id}${force ? '?force=true' : ''}`, { method: 'PUT', form: fd });
  };

  const toggle = async (e: AdminExhibitor, member: boolean, force = false): Promise<void> => {
    setPendingId(e.id);
    try {
      await send(e, member, force);
      toast(c_.membersSaved);
      await reload();
    } catch (ex) {
      if ((ex as ApiError).code === 'has_votes' && !force) {
        if (await confirm(t.ex.confirmSaveForce, { danger: true, confirmText: t.ex.saveForceBtn })) return await toggle(e, member, true);
      } else toast(err(ex), 'err');
    } finally { setPendingId(null); }
  };

  /** Check or clear every exhibitor. Failures are skipped and counted; vote-discarding changes need one confirmation. */
  const setAll = async (member: boolean) => {
    const targets = (data?.exhibitors || []).filter((e) => e.category_ids.includes(category.id) !== member);
    if (!targets.length) return;
    setPendingId(-1);
    let skipped = 0;
    try {
      const needForce: AdminExhibitor[] = [];
      for (const e of targets) {
        try { await send(e, member, false); }
        catch (ex) { if ((ex as ApiError).code === 'has_votes') needForce.push(e); else skipped++; }
      }
      if (needForce.length && await confirm(t.ex.confirmSaveForce, { danger: true, confirmText: t.ex.saveForceBtn })) {
        for (const e of needForce) { try { await send(e, member, true); } catch { skipped++; } }
      } else skipped += needForce.length;
      if (skipped) toast(c_.bulkSkipped(skipped), 'warn'); else toast(c_.membersSaved);
    } finally { setPendingId(null); await reload(); }
  };

  return (
    <Modal title={c_.membersTitle(category.name)} busy={pendingId !== null} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{c_.membersHint}</p>
        {error && <p className="alert" role="alert">{err(error)}</p>}
        {!data && !error && <Spinner />}
        {data && data.exhibitors.length > 0 && <div className="actions">
          <button type="button" className="btn btn-sm" disabled={pendingId !== null} onClick={() => { void setAll(true); }}>{c_.checkAll}</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={pendingId !== null} onClick={() => { void setAll(false); }}>{c_.clearAll}</button>
        </div>}
        {data && data.exhibitors.length === 0 && <p className="empty">{c_.noExhibitors}</p>}
        {data && data.exhibitors.map((e) => (
          <label key={e.id} className="check">
            <input type="checkbox" checked={e.category_ids.includes(category.id)} disabled={pendingId !== null}
              onChange={(ev) => { void toggle(e, ev.target.checked); }} />
            <span>{e.project || e.name}{e.project ? <small className="muted"> · {e.name}</small> : null}{e.is_active ? '' : ` (${t.ex.hidden})`}</span>
          </label>
        ))}
        <div className="actions"><button type="button" className="btn btn-primary" disabled={pendingId !== null} onClick={onClose}>{t.common.close}</button></div>
      </div>
    </Modal>
  );
}
