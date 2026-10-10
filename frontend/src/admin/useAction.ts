import { useRef, useState } from 'react';
import { useAdmin } from './ui';
import { useLang } from './i18n';

/** Lock synchronously, before React renders, so rapid clicks cannot start duplicate writes. */
export function useAction() {
  const locked = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const { toast } = useAdmin();
  const { err } = useLang();
  const run = async (name: string, action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setPending(name);
    try { await action(); }
    catch (error) { toast(err(error), 'err'); }
    finally { locked.current = false; setPending(null); }
  };
  return { pending, busy: pending !== null, run };
}
