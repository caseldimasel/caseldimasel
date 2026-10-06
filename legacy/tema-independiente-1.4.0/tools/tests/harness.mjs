import { chromium, CHROMIUM_PATH } from '../preview/pw.mjs';
import http from 'node:http';
import { startServer } from '../preview/server.mjs';

export const results = [];
let current = null;

export function assert(cond, msg) {
  if (!cond) throw new Error('Aserción fallida: ' + msg);
}
export function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)}`);
}

export async function test(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, info: info || '' });
    console.log(`  ✔ ${name}${info ? ' · ' + info : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(e.message || e).split('\n')[0] });
    console.log(`  ✘ ${name}\n      ${String(e.message || e).split('\n')[0]}`);
  }
}

export async function setup() {
  const full = await startServer({ port: 4190, profile: 'full' });
  const empty = await startServer({ port: 4191, profile: 'empty' });
  const bare = await startServer({ port: 4192, profile: 'bare' });
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  return { full, empty, bare, browser, URL: (p, profile = 'full') => `http://localhost:${{ full: 4190, empty: 4191, bare: 4192 }[profile]}${p}` };
}

/** Abre una página con colector de errores de consola/página y de peticiones fallidas. */
export async function open(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    reducedMotion: opts.reducedMotion,
    javaScriptEnabled: opts.js !== false,
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
    if (!/youtube|vimeo/.test(r.url())) page.errors.push('requestfailed: ' + r.url());
  });
  page.on('request', (r) => page.requests.push(r.url()));
  // Las peticiones externas reales (YouTube, etc.) se cortan: el entorno no tiene red.
  await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  return { ctx, page };
}

/** GET sencillo con node:http (devuelve un objeto con text() y json(), como fetch). */
export function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, text: async () => body, json: async () => JSON.parse(body) });
      });
    }).on('error', reject);
  });
}
