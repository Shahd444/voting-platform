// Runs before any test module is imported, so config.ts sees these values.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://mc:mc@localhost:5432/mc2026nest_test';
process.env.REDIS_URL = ''; // prove the in-memory fallbacks
process.env.APP_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.OTP_DEV_ECHO = 'true';
process.env.OTP_RESEND_COOLDOWN = '1';
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = '';
