import { chromium, CHROMIUM_PATH } from './pw.mjs';
import { startServer } from './server.mjs';
const profile = process.argv[2] || 'full';
const port = 4180 + (profile === 'full' ? 0 : 1);
const { server } = await startServer({ port, profile });
const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
const pages = (process.argv[3] || '/,/collections/coches,/products/prueba-coche-a,/pages/vender').split(',');
const widths = (process.argv[4] || '390,1440').split(',').map(Number);
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 800 : 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  for (const p of pages) {
    await page.goto(`http://localhost:${port}${p}`, { waitUntil: 'networkidle' });
    const name = p.replace(/[^a-z0-9]+/gi, '_') || 'home';
    await page.screenshot({ path: `/tmp/shots/${profile}-${name}-${w}.png`, fullPage: true });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(profile, w, p, 'overflow', ov, 'errors', JSON.stringify(errors.splice(0)));
  }
  await ctx.close();
}
await browser.close();
server.close();
