export type AccessMode = 'off' | 'ip' | 'geo' | 'ip_or_geo' | 'ip_and_geo';
export const ACCESS_MODES: AccessMode[] = ['off', 'ip', 'geo', 'ip_or_geo', 'ip_and_geo'];

/** public_url: optional fixed QR address; empty uses PUBLIC_URL or the current request origin. */
export interface EventSettings { name: string; tagline: string; venue: string; public_url: string }
export interface VotingSettings { open: boolean; opens_at: string | null; closes_at: string | null; ended_at?: string | null }
export interface AccessSettings {
  mode: AccessMode;
  allowed_cidrs: string[];
  geofence: { lat: number | null; lng: number | null; radius_m: number | null; max_accuracy_m: number | null };
}
export interface DisplaySettings { key: string | null; show_counts: boolean; show_winners: boolean }

export interface AllSettings {
  event: EventSettings;
  voting: VotingSettings;
  access: AccessSettings;
  display: DisplaySettings;
}
export type SettingsKey = keyof AllSettings;

export interface VotingState { open: boolean; reason?: 'closed' | 'not_started' | 'ended'; opens_at?: string | null; closes_at?: string | null }
