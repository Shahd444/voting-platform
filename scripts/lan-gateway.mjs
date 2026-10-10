#!/usr/bin/env node
/**
 * LAN gateway — run the event on a local server, with phones on the same Wi-Fi.
 *
 *   phone ──HTTPS──▶ this gateway (port 8443) ──HTTP──▶ Docker nginx (127.0.0.1:3000) ──▶ app
 *
 * Why it exists:
 *  - Phones only share GPS with HTTPS pages, so the gateway serves HTTPS with a local certificate.
 *  - Docker Desktop (Windows/macOS) replaces every visitor's address with its own gateway address,
 *    so the app could not tell phones apart. The gateway sees the real phone address and passes it
 *    on in X-Forwarded-For, which nginx trusts only in LAN mode (deploy/real-ip.lan.conf).
 *
 * Usage:  node scripts/lan-gateway.mjs
 * Env:    LAN_PORT (8443), LAN_HTTP_PORT (8080, redirects to HTTPS), LAN_TARGET (http://127.0.0.1:3000)
 * No dependencies. Needs `openssl` once, to create the certificate in deploy/certs/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.LAN_PORT || 8443);
const HTTP_PORT = Number(process.env.LAN_HTTP_PORT || 8080);
const TARGET = new URL(process.env.LAN_TARGET || 'http://127.0.0.1:3000');
const CERT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../deploy/certs');
const KEY = path.join(CERT_DIR, 'lan-key.pem');
const CERT = path.join(CERT_DIR, 'lan-cert.pem');
const CERT_IPS = path.join(CERT_DIR, 'lan-cert-ips.txt');

function ipv4Number(value) {
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets.reduce((n, part) => ((n << 8) | part) >>> 0, 0);
}

/** Calculate a network CIDR from the adapter's own address and netmask. */
function networkCidr(address, netmask) {
  const addr = ipv4Number(address), mask = ipv4Number(netmask);
  if (addr === null || mask === null) return null;
  const bits = mask.toString(2).padStart(32, '0');
  const prefix = bits.indexOf('0') < 0 ? 32 : bits.indexOf('0');
  if (bits.slice(prefix).includes('1')) return null;
  const network = (addr & mask) >>> 0;
  const octets = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255);
  return `${octets.join('.')}/${prefix}`;
}

/** IPv4 addresses and subnets of real adapters (skips loopback, WSL, Docker and VM adapters). */
function lanInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|WSL|docker|VirtualBox|VMware|Loopback|br-|veth/i.test(name)) continue;
    for (const a of addrs || []) {
      // Node reports family as either "IPv4" or 4, depending on its version.
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) {
        out.push({ address: a.address, network: networkCidr(a.address, a.netmask) });
      }
    }
  }
  return out.filter((item) => item.network);
}

function findOpenssl() {
  const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
  for (const c of candidates) {
    try { execFileSync(c, ['version'], { stdio: 'ignore' }); return c; } catch { /* try next */ }
  }
  return null;
}

/** Self-signed certificate for this computer's LAN addresses; recreated when the addresses change. */
function ensureCertificate(ips) {
  const wanted = [...ips].sort().join(',');
  if (existsSync(KEY) && existsSync(CERT) && existsSync(CERT_IPS) && readFileSync(CERT_IPS, 'utf8').trim() === wanted) return;
  const openssl = findOpenssl();
  if (!openssl) {
    console.error('openssl was not found. Install Git for Windows (it includes openssl) or put openssl on PATH, then run again.');
    process.exit(1);
  }
  mkdirSync(CERT_DIR, { recursive: true });
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
    '-subj', '/CN=MC2026 Voting (local)', '-addext', `subjectAltName=${san}`,
    '-keyout', KEY, '-out', CERT], { stdio: 'ignore' });
  writeFileSync(CERT_IPS, wanted);
  console.log(`Created a local HTTPS certificate for ${ips.join(', ') || 'localhost'}.`);
}

const clientAddress = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');

/** Forward one request; the phone's address replaces any X-Forwarded-For it sent. */
function forward(req, res) {
  const clientIp = clientAddress(req);
  const clientAddressNumber = ipv4Number(clientIp);
  const networksForClient = adapters.filter((item) => {
    const [networkIp, prefixText] = item.network.split('/');
    const networkNumber = ipv4Number(networkIp), prefix = Number(prefixText);
    if (clientAddressNumber === null || networkNumber === null || !Number.isInteger(prefix)) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((clientAddressNumber & mask) >>> 0) === networkNumber;
  }).map((item) => item.network);
  const headers = {
    ...req.headers,
    'x-forwarded-for': clientIp,
    'x-forwarded-proto': 'https',
    'x-event-lan-networks': (networksForClient.length ? networksForClient : networks).join(','),
  };
  const upstream = http.request({
    protocol: TARGET.protocol, hostname: TARGET.hostname, port: TARGET.port, path: req.url, method: req.method, headers,
  }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The voting server is not running. Start it with: docker compose up -d');
  });
  // Live-results streams stay open; drop the upstream request as soon as the phone leaves.
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

const adapters = lanInterfaces();
const ips = [...new Set(adapters.map((item) => item.address))];
const networks = [...new Set(adapters.map((item) => item.network))];
// Repeated `make` calls can reuse a gateway left running in another terminal.
const existingGateway = await new Promise(resolve => {
  const probe = https.get({ hostname: '127.0.0.1', port: PORT, path: '/healthz', rejectUnauthorized: false, timeout: 1500 }, response => {
    response.resume();
    resolve(response.headers['x-mc2026-gateway'] === '1');
  });
  probe.on('timeout', () => probe.destroy());
  probe.on('error', () => resolve(false));
});
if (existingGateway) {
  console.log(`MC2026 HTTPS gateway is already running on port ${PORT}; reusing it.`);
  for (const ip of ips) console.log(`  https://${ip}${PORT === 443 ? '' : `:${PORT}`}/admin`);
  process.exit(0);
}
ensureCertificate(ips);

https.createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, (req, res) => {
  res.setHeader('X-MC2026-Gateway', '1');
  forward(req, res);
})
  .on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' || e.code === 'EACCES'
      ? `Port ${PORT} is occupied by another process or access is denied. Stop the conflicting process, or run: make lan LAN_PORT=${PORT === 9443 ? 10443 : 9443}`
      : e.message);
    process.exit(1);
  })
  .listen(PORT, '0.0.0.0', () => {
    const port = PORT === 443 ? '' : `:${PORT}`;
    console.log('\nMC2026 LAN gateway is running. Phones on the same Wi-Fi can open:');
    for (const ip of ips) console.log(`  https://${ip}${port}/        admin: https://${ip}${port}/admin`);
    console.log('\nOpen the admin page using one of these addresses; voting links use the address you opened.');
    console.log('Phones will show a certificate warning the first time: choose "Advanced" › "Proceed".\n');
  });

// Plain-HTTP port only redirects, so typing the address without https:// still works.
http.createServer((req, res) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  res.writeHead(301, { location: `https://${host}${PORT === 443 ? '' : `:${PORT}`}${req.url}` });
  res.end();
}).on('error', () => { /* optional: port in use, HTTPS still works */ }).listen(HTTP_PORT, '0.0.0.0');
