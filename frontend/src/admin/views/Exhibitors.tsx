import { useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { AdminCategory, AdminExhibitor } from '../../lib/types';
import { accent, initials } from '../../lib/util';
import { useLang } from '../i18n';
import { LoadError, Modal, PageHead, Spinner, useAdmin, useLoad } from '../ui';
import { useAction } from '../useAction';

export default function Exhibitors() {
  const { isAdmin, toast, confirm } = useAdmin();
  const { t, err } = useLang();
  const x = t.ex;
  const { data, error, reload } = useLoad(() => Promise.all([
    api<{ exhibitors: AdminExhibitor[] }>('/api/admin/exhibitors'),
    api<{ categories: AdminCategory[] }>('/api/admin/categories'),
  ]));
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AdminExhibitor | 'new' | null>(null);
  const { busy, pending, run } = useAction();

  const rows = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data[0].exhibitors.filter((e) => !term || `${e.name} ${e.project} ${e.booth}`.toLowerCase().includes(term));
  }, [data, q]);

  if (error) return <LoadError error={error} />;
  if (!data) return <Spinner />;
  const [{ exhibitors }, { categories }] = data;
  const catIndex = (id: number) => Math.max(0, categories.findIndex((c) => c.id === id));

  const remove = (e: AdminExhibitor) => run(`delete-${e.id}`, async () => {
    if (!(await confirm(x.confirmDelete(e.project || e.name), { danger: true, confirmText: t.common.delete }))) return;
    try {
      await api(`/api/admin/exhibitors/${e.id}`, { method: 'DELETE' });
    } catch (ex) {
      if ((ex as ApiError).code !== 'has_votes') return toast(err(ex), 'err');
      if (!(await confirm(x.confirmForce, { danger: true, confirmText: x.forceBtn, typeToConfirm: 'DELETE' }))) return;
      try { await api(`/api/admin/exhibitors/${e.id}?force=true`, { method: 'DELETE' }); }
      catch (forceError) { toast(err(forceError), 'err'); return; }
    }
    toast(x.deleted); reload();
  });

  return (
    <div>
      <PageHead title={x.title} sub={x.sub(exhibitors.length)}>
        {isAdmin && <button className="btn btn-primary" disabled={busy} onClick={() => setEditing('new')}>{x.add}</button>}
      </PageHead>
      <section className="card flush">
        <div className="card-tools"><input className="input search" type="search" placeholder={x.search} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{x.cols.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="empty">{exhibitors.length ? x.noMatch : x.empty}</td></tr>}
              {rows.map((e) => (
                <tr key={e.id} className={e.is_active ? '' : 'inactive'}>
                  <td>{e.image ? <img className="thumb" src={e.image} alt="" /> : <div className="thumb ph">{initials(e.project || e.name)}</div>}</td>
                  <td><b>{e.project || '—'}</b><div className="muted small">{e.name}</div></td>
                  <td>{e.booth || '—'}</td>
                  <td><div className="chips">{e.category_ids.map((id) => {
                    const c = categories.find((cat) => cat.id === id);
                    return c ? <span key={id} className="chip" style={accent(catIndex(id))}>{c.name}</span> : null;
                  })}</div></td>
                  <td className="num">{e.votes}</td>
                  <td>{e.is_active ? <span className="pill ok">{x.visible}</span> : <span className="pill">{x.hidden}</span>}</td>
                  <td className="row-actions">{isAdmin && (<>
                    <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(e)}>{t.common.edit}</button>
                    <button className="btn btn-sm btn-ghost danger" disabled={busy} aria-busy={pending === `delete-${e.id}`} onClick={() => remove(e)}>{pending === `delete-${e.id}` ? t.common.deleting : t.common.delete}</button>
                  </>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && <ExhibitorForm exhibitor={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function ExhibitorForm({ exhibitor, categories, onClose, onSaved }: {
  exhibitor: AdminExhibitor | null; categories: AdminCategory[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast, confirm } = useAdmin();
  const { t, err: errText } = useLang();
  const x = t.ex;
  const isNew = !exhibitor;
  const [f, setF] = useState({
    project: exhibitor?.project || '', name: exhibitor?.name || '', booth: exhibitor?.booth || '',
    description: exhibitor?.description || '', is_active: exhibitor ? exhibitor.is_active : true,
    category_ids: exhibitor?.category_ids || ([] as number[]),
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(exhibitor?.image || null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const hasSavedPhoto = !!exhibitor?.image && !removePhoto;
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const toggleCat = (id: number) => set('category_ids', f.category_ids.includes(id) ? f.category_ids.filter((c) => c !== id) : [...f.category_ids, id]);

  const save = async (force = false): Promise<void> => {
    if (saving.current && !force) return;
    const missing: string[] = [];
    if (!f.name.trim()) missing.push(x.missName);
    if (f.is_active) {
      if (!file && !hasSavedPhoto) missing.push(x.missPhoto);
      if (!f.description.trim()) missing.push(x.missDescription);
      if (!f.category_ids.length) missing.push(x.missCategory);
    }
    if (missing.length) { setErr(x.missing(missing)); return; }
    saving.current = true;
    const fd = new FormData();
    fd.append('name', f.name); fd.append('project', f.project); fd.append('booth', f.booth);
    fd.append('description', f.description); fd.append('is_active', String(f.is_active));
    fd.append('category_ids', JSON.stringify(f.category_ids));
    if (file) fd.append('photo', file);
    if (removePhoto) fd.append('remove_photo', 'true');
    setBusy(true); setErr(null);
    try {
      await api(isNew ? '/api/admin/exhibitors' : `/api/admin/exhibitors/${exhibitor!.id}${force ? '?force=true' : ''}`, { method: isNew ? 'POST' : 'PUT', form: fd });
      toast(isNew ? x.addedToast : x.savedToast);
      onSaved();
    } catch (ex) {
      if ((ex as ApiError).code === 'has_votes' && !force) {
        if (await confirm(x.confirmSaveForce, { danger: true, confirmText: x.saveForceBtn })) return await save(true);
      } else setErr(errText(ex));
    } finally { saving.current = false; setBusy(false); }
  };

  return (
    <Modal title={isNew ? x.addTitle : x.editTitle} wide busy={busy} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (e.currentTarget.reportValidity()) void save(); }}>
        {f.is_active && <p className="muted small">{x.required}</p>}
        <div className="photo-row">
          <div className="photo-preview">{preview ? <img src={preview} alt="" /> : <div className="ph">{x.noPhoto}</div>}</div>
          <div className="stack tight">
            <label className="field"><span>{x.photo}{f.is_active ? ' *' : ''}</span>
              <input ref={photoInput} type="file" required={f.is_active && !hasSavedPhoto} disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                const fl = e.target.files?.[0];
                if (!fl) { setFile(null); setPreview(hasSavedPhoto ? exhibitor!.image : null); return; }
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(fl.type) || fl.size > 3 * 1024 * 1024) {
                  toast(x.photoBad, 'err');
                  e.target.value = ''; setFile(null); setPreview(hasSavedPhoto ? exhibitor!.image : null); return;
                }
                setFile(fl); setRemovePhoto(false);
                // data: URL, not blob: — the page CSP only allows self and data: images.
                const reader = new FileReader();
                reader.onload = () => setPreview(String(reader.result));
                reader.readAsDataURL(fl);
              }} /></label>
            <p className="muted small">{x.photoHint}</p>
            {exhibitor?.image && !removePhoto && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} style={{ alignSelf: 'flex-start' }} onClick={() => {
              setRemovePhoto(true); setFile(null); setPreview(null);
              if (photoInput.current) photoInput.current.value = '';
            }}>{x.removePhoto}</button>}
            {f.is_active && removePhoto && !file && <p className="alert" role="status">{x.replacePhoto}</p>}
          </div>
        </div>
        <div className="grid2">
          <label className="field"><span>{x.project}</span><input className="input" maxLength={120} placeholder={x.projectPh} value={f.project} onChange={(e) => set('project', e.target.value)} /></label>
          <label className="field"><span>{x.maker} *</span><input className="input" maxLength={100} required placeholder={x.makerPh} value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>{x.booth}</span><input className="input" maxLength={20} placeholder={x.boothPh} value={f.booth} onChange={(e) => set('booth', e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /><span>{x.visibleCheck}</span></label>
        </div>
        <label className="field"><span>{x.description}{f.is_active ? ' *' : ''}</span><textarea className="input" rows={3} required={f.is_active} maxLength={400} placeholder={x.descriptionPh} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
        <div className="field"><span>{x.competes}{f.is_active ? ` *${x.competesReq}` : ''}</span>
          <div className="chips">{categories.map((c, i) => (
            <label key={c.id} className="check-chip" style={accent(i)}>
              <input type="checkbox" checked={f.category_ids.includes(c.id)} onChange={() => toggleCat(c.id)} /><span>{c.name}</span>
            </label>
          ))}</div>
          {f.is_active && categories.length === 0 && <p className="alert">{x.noCategories}</p>}
        </div>
        {err && <p className="alert" role="alert">{err}</p>}
        <div className="actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>{t.common.cancel}</button><button className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? t.common.saving : isNew ? x.saveNew : x.saveEdit}</button></div>
      </form>
    </Modal>
  );
}
