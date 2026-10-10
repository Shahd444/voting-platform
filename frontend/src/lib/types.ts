export interface Category { id: number; slug: string; name: string; description: string }
export interface Exhibitor {
  id: number; name: string; project: string; description: string; booth: string;
  image: string | null; category_ids: number[];
}
export interface VotingState { open: boolean; reason?: 'closed' | 'not_started' | 'ended'; opens_at?: string | null; closes_at?: string | null }
export interface VisitorSession { name: string; phone: string; votes: Record<number, { exhibitor_id: number; at: string }> }
export interface PublicState {
  event: { name: string; tagline: string; venue: string };
  voting: VotingState;
  access: { allowed: boolean; needsLocation: boolean; mode: string };
  qrEntryRequired?: boolean;
  qrEntryAllowed?: boolean;
  categories: Category[];
  exhibitors: Exhibitor[];
  session: VisitorSession | null;
}
export interface GeoPoint { lat: number; lng: number; accuracy: number }

export interface Standing { id: number; name: string; project: string; booth: string; image: string | null; votes: number; rank: number }
export interface CategoryResult extends Category { total: number; standings: Standing[] }
export interface ResultsSnapshot {
  event: { name: string; tagline: string; venue: string };
  voting: VotingState;
  show_counts: boolean;
  show_winners: boolean;
  generated_at: string;
  totals: { votes: number; voters: number };
  categories: CategoryResult[];
}

export type AdminRole = 'admin' | 'viewer';
export interface AdminUser { id: number; username: string; role: AdminRole; totp_enabled: boolean }
export interface AdminCategory extends Category { is_active: boolean; exhibitor_count: number }
export interface AdminExhibitor extends Exhibitor { is_active: boolean; votes: number; image_id: string | null }
export interface Settings {
  event: { name: string; tagline: string; venue: string; public_url?: string };
  voting: { open: boolean; opens_at: string | null; closes_at: string | null; ended_at?: string | null };
  access: { mode: string; allowed_cidrs: string[]; geofence: { lat: number | null; lng: number | null; radius_m: number | null; max_accuracy_m: number | null } };
  display: { key: string | null; show_counts: boolean; show_winners?: boolean };
}
