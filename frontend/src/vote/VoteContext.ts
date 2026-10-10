import { createContext, useContext } from 'react';
import type { GeoPoint, PublicState, VisitorSession } from '../lib/types';
import type { Key, Lang } from './i18n';

export interface VoteCtx {
  t: (k: Key, ...args: any[]) => string;
  lang: Lang;
  data: PublicState | null;
  session: VisitorSession | null;
  setSession: (s: VisitorSession | null) => void;
  location: GeoPoint | null;
  setLocation: (l: GeoPoint | null) => void;
  setOnSite: (v: boolean) => void;
  checkLocation: (location: GeoPoint) => Promise<boolean>;
  requireQr: () => void;
  reload: () => Promise<void>;
  setToast: (msg: string | null) => void;
}

export const VoteContext = createContext<VoteCtx | null>(null);

export function useVote(): VoteCtx & { data: PublicState } {
  const ctx = useContext(VoteContext);
  if (!ctx || !ctx.data) throw new Error('VoteContext missing');
  return ctx as VoteCtx & { data: PublicState };
}
