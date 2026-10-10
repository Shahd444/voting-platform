import 'dotenv/config';
import * as crypto from 'crypto';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name: string, devFallback?: string): string {
  const v = env[name];
  if (v) return v;
  if (!isProd && devFallback !== undefined) return devFallback;
  throw new Error(`Missing required environment variable ${name}`);
}

/**
 * One master secret; purpose-specific keys are derived with HKDF so that a
 * leaked JWT key cannot decrypt phone numbers and vice versa.
 */
const APP_SECRET = required('APP_SECRET', 'dev-only-insecure-secret-change-me-dev-only-insecure');
if (isProd && APP_SECRET.length < 32) throw new Error('APP_SECRET must be at least 32 characters');

const derive = (info: string) => Buffer.from(crypto.hkdfSync('sha256', APP_SECRET, 'mc2026-voting', info, 32));

export const config = {
  isProd,
  port: Number(env.PORT || 3000),
  publicUrl: env.PUBLIC_URL || '',
  databaseUrl: required('DATABASE_URL', 'postgres://mc:mc@localhost:5432/mc2026'),
  dbPoolSize: Number(env.DB_POOL_SIZE || 20),
  redisUrl: env.REDIS_URL || '', // optional — app degrades gracefully without it
  trustProxy: env.TRUST_PROXY || 'loopback',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  frontendDist: env.FRONTEND_DIST || '',

  keys: {
    jwt: derive('jwt'),
    data: derive('data-encryption'),
    phoneHmac: derive('phone-hmac'),
    otpHmac: derive('otp-hmac'),
    voteQr: derive('vote-qr'),
  },

  voteQr: {
    rotateSeconds: 20,
    grantSeconds: 600,
    entryRequired: env.REQUIRE_DYNAMIC_VOTE_QR !== 'false' && env.NODE_ENV !== 'test',
  },

  otp: {
    length: 6,
    ttlSeconds: Number(env.OTP_TTL_SECONDS || 300),
    maxAttempts: 5,
    resendCooldownSeconds: Number(env.OTP_RESEND_COOLDOWN || 30),
    maxPerPhonePerHour: Number(env.OTP_MAX_PER_HOUR || 5),
    /** DEMO ONLY: return the code in the API response. Never active in production. */
    devEcho: env.OTP_DEV_ECHO === 'true' && !isProd,
  },

  sms: {
    provider: env.SMS_PROVIDER || 'console', // console | twilio | http
    twilio: { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM },
    http: { url: env.SMS_HTTP_URL, token: env.SMS_HTTP_TOKEN },
    senderName: env.SMS_SENDER_NAME || 'MC2026',
  },

  phone: {
    defaultCountryCode: env.DEFAULT_COUNTRY_CODE || '962',
    allowPattern: env.PHONE_ALLOW_PATTERN || '^9627[789]\\d{7}$|^\\d{8,15}$',
  },

  sessions: { visitorTtl: '12h', adminTtl: '8h' },

  bootstrapAdmin: {
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD || (isProd ? '' : 'admin12345'),
  },
};
