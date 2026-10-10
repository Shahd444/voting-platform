import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config/config';
import { maskPhone } from '../common/phone.util';

interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

class ConsoleSmsProvider implements SmsProvider {
  constructor(private readonly log: Logger) {}

  async send(to: string, message: string): Promise<void> {
    this.log.log(`(console provider) to ${maskPhone(to)}: ${message}`);
  }
}

class TwilioSmsProvider implements SmsProvider {
  async send(to: string, message: string): Promise<void> {
    const { accountSid, authToken, from } = config.sms.twilio;
    if (!accountSid || !authToken || !from) throw new Error('Twilio not configured');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: `+${to}`, From: from, Body: message }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Twilio error ${res.status}`);
  }
}

class HttpSmsProvider implements SmsProvider {
  async send(to: string, message: string): Promise<void> {
    const { url, token } = config.sms.http;
    if (!url) throw new Error('SMS_HTTP_URL not configured');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ to: `+${to}`, message, sender: config.sms.senderName }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`SMS gateway error ${res.status}`);
  }
}

/**
 * SMS gateway abstraction. CPF picks the real provider before the pilot, so
 * the provider is a small adapter selected by environment:
 *   console — logs the code (development / demo)
 *   twilio  — Twilio Programmable Messaging REST API
 *   http    — generic JSON webhook {to, message, sender} for any local gateway
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('SMS');
  private readonly providers: Record<string, SmsProvider> = {
    console: new ConsoleSmsProvider(this.log),
    twilio: new TwilioSmsProvider(),
    http: new HttpSmsProvider(),
  };

  async sendOtp(phone: string, code: string): Promise<void> {
    const minutes = Math.round(config.otp.ttlSeconds / 60);
    await this.send(phone, `${code} is your MC2026 voting code. It expires in ${minutes} minutes.`);
  }

  async send(to: string, message: string): Promise<void> {
    const provider = this.providers[config.sms.provider];
    if (!provider) throw new Error(`Unknown SMS provider ${config.sms.provider}`);
    await provider.send(to, message);
  }
}
