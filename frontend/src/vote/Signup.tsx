import { useEffect, useRef, useState } from 'react';
import { recoverOtpSession, verifyOtp, type OtpOutcome } from './otp';

import { api, ApiError } from '../lib/api';
import { errorText } from './i18n';
import { useVote } from './VoteContext';

export interface FormState {
  name: string;
  phone: string;
  consent: boolean;
}

export interface Challenge {
  id: string;
  phone: string;
  resendAt: number;
  devCode?: string;
}

interface OtpResponse {
  challengeId: string;
  phone: string;
  expiresIn: number;
  resendIn: number;
  devCode?: string;
}

const toChallenge = (r: OtpResponse): Challenge => ({
  id: r.challengeId,
  phone: r.phone,
  resendAt: Date.now() + r.resendIn * 1000,
  devCode: r.devCode,
});

function UserIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="14" r="8" />
      <path d="M9 43v-5c0-9 6.7-15 15-15s15 6 15 15v5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 46 32" aria-hidden="true">
      <path d="M2 16h39M29 3l13 13-13 13" />
    </svg>
  );
}

function CableLines() {
  return (
    <svg className="cable-lines" viewBox="0 0 1024 1536" preserveAspectRatio="none" aria-hidden="true">
      <path d="M631 283v26c0 109 39 142 142 211" />
      <path d="M666 196v101c0 124 40 153 154 229" />
      <path d="M702 143v157c0 133 54 174 177 253" />
      <path className="aqua" d="M824 285v15c0 143 66 166 187 263" />
      <circle className="cyan-dot" cx="631" cy="284" r="13" />
      <circle className="yellow-dot" cx="666" cy="196" r="13" />
      <circle className="blue-dot" cx="702" cy="143" r="13" />
      <circle className="purple-dot" cx="824" cy="285" r="13" />
    </svg>
  );
}

function Gear() {
  return (
    <div className="login-gear" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} style={{ transform: `translate(-50%, -50%) rotate(${index * 45}deg)` }} />
      ))}
      <div className="gear-ring" />
    </div>
  );
}

/** Step 1 — name + mobile number (F5). */
export function RegisterScreen({
  form,
  setForm,
  setChallenge,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  setChallenge: (c: Challenge) => void;
}) {
  const { t, data, location, setOnSite, setLocation, reload } = useVote();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.classList.add('vote-login');
    return () => document.body.classList.remove('vote-login');
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const f = { ...form, name: form.name.trim(), phone: form.phone.trim() };
    if (f.name.split(/\s+/).filter(Boolean).length < 2) { nameRef.current?.focus(); setErr(t('fullNameError')); return; }
    if (!f.phone) { phoneRef.current?.focus(); setErr(`${t('phone')} ✱`); return; }

    setBusy(true);
    setErr(null);

    try {
      const r = await api<OtpResponse>('/api/public/otp/request', {
        method: 'POST',
        body: {
          ...f,
          location: location ?? undefined,
        },
      });

      setChallenge(toChallenge(r));
    } catch (ex) {
      const e2 = ex as ApiError;

      if (e2.code === 'not_on_site') {
        setOnSite(false);
        setLocation(null);
        return;
      }
      if (e2.code === 'voting_closed') {
        await reload();
        return;
      }

      if (e2.code === 'bad_name') { setErr(t('fullNameError')); return; }
      if (e2.code === 'duplicate_name') { setErr(t('duplicateNameError')); return; }
      if (e2.code === 'phone_attached') { setErr(t('phoneAttachedError')); return; }
      if (e2.code === 'bad_phone') { setErr(t('phoneInvalidError')); return; }

      setErr(errorText(t, e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="voter-login"
      aria-labelledby="voter-login-title"
    >
      <div className="paper-noise" aria-hidden="true" />

      {/* Decorative elements */}
      <div className="purple-slab" aria-hidden="true" />
      <div className="cyan-pill" aria-hidden="true" />
      <div className="blue-orb" aria-hidden="true" />
      <div className="magenta-angle" aria-hidden="true" />
      <div className="yellow-ribbon" aria-hidden="true" />
      <div className="yellow-arc" aria-hidden="true" />
      <div className="line-rings" aria-hidden="true" />
      <Gear />
      <CableLines />

      {/* Branding */}
      <header
        className="maker-brand"
        aria-label={t('brandAlt')}
      >
        <img
          src="/assets/maker-logo.png"
          alt={t('brandAltFull')}
        />
      </header>

      {/* Workshop image */}
      <figure className="workshop-photo">
        <img src="/assets/maker-workshop.jpg" alt="" />
        <div className="photo-tint" aria-hidden="true" />
      </figure>

      {/* Login card */}
      <form className="login-card" noValidate onSubmit={submit}>
        <p className="eyebrow">{t('heroKicker')}</p>

        <h1 id="voter-login-title">
          {t('loginTitle')}
          <br />
          {t('loginTitleAccent')}
        </h1>
        {data.event.tagline && <p className="login-tagline">{data.event.tagline}</p>}
        {data.event.venue && <p className="login-venue">📍 {data.event.venue}</p>}

        <label className="login-design-field" htmlFor="f-name">
          <span className="sr-only">{t('name')}</span>

          <span className="field-icon user-icon">
            <UserIcon />
          </span>

          <input
            id="f-name"
            ref={nameRef}
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={80}
            placeholder={t('namePh')}
            value={form.name}
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
              })
            }
          />
        </label>

        <label className="login-design-field" htmlFor="f-phone">
          <span className="sr-only">{t('phone')}</span>

          <span className="field-icon number-icon" aria-hidden="true">
            #
          </span>

          <input
            id="f-phone"
            ref={phoneRef}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            maxLength={40}
            pattern="[+0-9٠-٩۰-۹\s().-]+"
            dir="ltr"
            placeholder={t('number')}
            value={form.phone}
            onChange={(e) =>
              setForm({
                ...form,
                phone: e.target.value,
              })
            }
          />
        </label>

        <label className="check login-consent">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(e) => setForm({ ...form, consent: e.currentTarget.checked })}
          />
          <span>{t('consent')}</span>
        </label>

        {err && <p className="alert">{err}</p>}

        <button
          className="login-design-submit"
          type="submit"
          disabled={busy}
        >
          <span>{busy ? t('sending') : t('sendCode')}</span>
          <ArrowIcon />
        </button>
      </form>
    </section>
  );
}

/** Step 2 — one-time SMS code (F6). */
export function OtpScreen({
  challenge,
  setChallenge,
  form,
}: {
  challenge: Challenge;
  setChallenge: (c: Challenge | null) => void;
  form: FormState;
}) {
  const { t, location, setSession } = useVote();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [recovery, setRecovery] = useState<'code' | 'new_code' | 'unconfirmed'>('code');

  const receive = (result: OtpOutcome) => {
    if (result.status === 'verified') {
      setChallenge(null);
      setSession(result.session);
      window.scrollTo({ top: 0 });
      return;
    }
    setRecovery(result.status);
    setCode('');
    setErr(t(result.status === 'new_code' ? 'otpNeedNewCode' : 'otpRecoveryUnavailable'));
  };

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { inputRef.current?.focus(); }, [challenge.id]);
  const resendIn = Math.max(0, Math.ceil((challenge.resendAt - now) / 1000));

  const verify = async (value: string) => {
    if (submitting.current || recovery === 'new_code' || (recovery === 'code' && value.length !== 6)) return;
    submitting.current = true;
    setBusy(true); setErr(null);
    try {
      receive(recovery === 'unconfirmed' ? await recoverOtpSession() : await verifyOtp(challenge.id, value));
    } catch (ex) {
      const e2 = ex as ApiError;
      setErr(errorText(t, e2));
      if (['otp_expired', 'otp_locked', 'otp_invalid'].includes(e2.code || '')) setCode('');
      if (['otp_expired', 'otp_locked'].includes(e2.code || '')) setRecovery('new_code');
      inputRef.current?.select();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const onChange = (raw: string) => {
    const v = raw
      .replace(/[٠-٩]/g, (d) =>
        String(d.charCodeAt(0) - 0x0660),
      )
      .replace(/\D/g, '')
      .slice(0, 6);

    setCode(v);

    if (v.length === 6) verify(v);
  };

  const resend = async () => {
    if (submitting.current || resendIn > 0) return;
    submitting.current = true;
    setBusy(true); setErr(null);
    try {
      const r = await api<OtpResponse>('/api/public/otp/request', { method: 'POST', body: { ...form, location: location ?? undefined } });
      setChallenge(toChallenge(r));
      setCode('');
      setRecovery('code');
    } catch (ex) {
      setErr(errorText(t, ex as ApiError));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="panel form">
      <div className="glyph glyph-sms" aria-hidden="true" />

      <h1 className="title-sm">{t('otpTitle')}</h1>

      <p className="muted">{t('otpBody', challenge.phone)}</p>

      {challenge.devCode && (
        <p className="demo">
          {t('demoCode', challenge.devCode)}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify(code);
        }}
      >
        <input
          id="f-code"
          ref={inputRef}
          className="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required={recovery === 'code'}
          disabled={busy || recovery !== 'code'}
          aria-label={t('otpTitle')}
          dir="ltr"
          value={code}
          onChange={(e) => onChange(e.currentTarget.value)}
        />

        {err && <p className="alert">{err}</p>}

        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={busy || recovery === 'new_code'}
        >
          {busy ? t('verifying') : recovery === 'unconfirmed' ? t('checkSession') : t('verify')}
        </button>
      </form>

      <div className="row-between">
        <button
          className="btn btn-link"
          type="button"
          disabled={busy}
          onClick={() => setChallenge(null)}
        >
          {t('changeNumber')}
        </button>

        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy || resendIn > 0 || recovery === 'unconfirmed'}
          onClick={resend}
        >
          {resendIn > 0
            ? t('resendIn', resendIn)
            : t(recovery === 'new_code' ? 'requestNewCode' : 'resend')}
        </button>
      </div>
    </section>
  );
}
