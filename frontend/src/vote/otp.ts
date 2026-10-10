import { api, ApiError } from '../lib/api';
import type { VisitorSession } from '../lib/types';

export type OtpOutcome = { status: 'verified'; session: VisitorSession } | { status: 'new_code' | 'unconfirmed' };

export async function recoverOtpSession(): Promise<OtpOutcome> {
  try {
    const result = await api<{ session: VisitorSession }>('/api/public/me', { retries: 1 });
    return result.session ? { status: 'verified', session: result.session } : { status: 'new_code' };
  } catch (error) {
    return (error as ApiError).status === 401 ? { status: 'new_code' } : { status: 'unconfirmed' };
  }
}

export async function verifyOtp(challengeId: string, code: string): Promise<OtpOutcome> {
  try {
    const result = await api<{ session: VisitorSession }>('/api/public/otp/verify', {
      method: 'POST', body: { challengeId, code }, retries: 0,
    });
    return { status: 'verified', session: result.session };
  } catch (error) {
    const e = error as ApiError;
    if (e.status === 0 || e.status >= 500 || e.code === 'otp_invalid') return recoverOtpSession();
    throw error;
  }
}
