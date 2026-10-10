import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { useLang } from './i18n';

export function PasswordInput({ id, className = 'input', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const { t } = useLang();
  const action = visible ? t.login.hidePassword : t.login.showPassword;

  return (
    <div className="password-field">
      <input {...props} id={inputId} className={className} type={visible ? 'text' : 'password'} />
      <button className="password-toggle" type="button" aria-label={action} title={action}
        aria-controls={inputId} aria-pressed={visible} disabled={props.disabled}
        onClick={() => setVisible((current) => !current)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {!visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  );
}
