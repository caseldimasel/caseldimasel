// Utilidades de las pruebas end-to-end (Chromium contra el arnés: Impact integrado si está la copia local, o el anfitrión genérico).
import http from 'node:http';
import { chromium, CHROMIUM_PATH } from '../pw.mjs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, composeTheme } from '../server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Objetivo de las pruebas: «impact» (copia licenciada local en impact/original, integrada en impact/sidonia)
 *  o «host» (anfitrión de pruebas genérico; es lo único disponible sin la copia de Impact). */
export const TARGET = process.env.SIDONIA_TARGET || (existsSync(join(ROOT, 'impact', 'original', 'layout', 'theme.liquid')) ? 'impact' : 'host');

export const results = [];

export function assert(cond, msg) {
  if (!cond) throw new Error('Aserción fallida: ' + msg);
}
export function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`);
}

export async function test(group, name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    results.push({ group, name, ok: true, ms: Date.now() - t0, info: info || '' });
    console.log(`  ✔ ${name}${info ? ' · ' + info : ''}`);
  } catch (e) {
    results.push({ group, name, ok: false, ms: Date.now() - t0, error: String(e.message || e).split('\n')[0] });
    console.log(`  ✘ ${name}\n      ${String(e.message || e).split('\n')[0]}`);
  }
}

const PORTS = { full: 4290, empty: 4291 };
export async function setup() {
  let theme = null;
  if (TARGET === 'impact') {
    execFileSync('node', [join(ROOT, 'integration', 'apply-kit.mjs'), '--base', join(ROOT, 'impact', 'original'), '--out', join(ROOT, 'impact', 'sidonia'), '--replace', 'index.json,search.json,404.json', '--quiet']);
    theme = join(ROOT, 'impact', 'sidonia');
  } else composeTheme();
  const servers = {};
  for (const [profile, port] of Object.entries(PORTS)) servers[profile] = await startServer({ port, profile, compose: false, theme });
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const url = (p, profile = 'full') => `http://localhost:${PORTS[profile]}${p}`;
  return { servers, browser, url };
}

export async function open(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    reducedMotion: opts.reducedMotion,
    javaScriptEnabled: opts.js !== false,
    hasTouch: opts.hasTouch,
    isMobile: opts.isMobile,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.requests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    const u = r.url();
    // Cortes esperados: red externa (no hay Internet en el entorno), fuentes .m3u8 que Chromium no reproduce
    // y descargas de vídeo canceladas al cerrar el reproductor.
    if (/^https?:\/\/(?!localhost)/.test(u) || /\.m3u8|\.webm/.test(u)) return;
    page.errors.push('requestfailed: ' + u);
  });
  page.on('request', (r) => page.requests.push(r.url()));
  await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  return { ctx, page };
}

export function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
