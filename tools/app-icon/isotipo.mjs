// Recorta la «O» (con su punto) del logo: busca las letras por columnas vacías y se queda con la cuarta (S I D O N I A)
import { chromium, CHROMIUM_PATH } from '../harness/pw.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
// Uso: SIDONIA_THEME=../sidonia-shopify node tools/app-icon/isotipo.mjs  (crea assets/sidonia-app-isotipo.png)
const THEME = process.env.SIDONIA_THEME || '../sidonia-shopify';
const SRC = THEME + '/assets/sidonia-app-logo.png';
const b = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
const p = await b.newPage();
const res = await p.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  const ink = (i, y) => d[(y * W + i) * 4 + 3] > 40;
  const cols = []; for (let i = 0; i < W; i++) { let any = false; for (let y = 0; y < H; y++) if (ink(i, y)) { any = true; break; } cols.push(any); }
  const runs = []; let s = -1; cols.forEach((v, i) => { if (v && s < 0) s = i; if (!v && s >= 0) { runs.push([s, i - 1]); s = -1; } }); if (s >= 0) runs.push([s, W - 1]);
  const [x0, x1] = runs[3];
  let y0 = H, y1 = 0; for (let i = x0; i <= x1; i++) for (let y = 0; y < H; y++) if (ink(i, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const o = document.createElement('canvas'); o.width = w; o.height = h;
  o.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return { runs, box: [x0, y0, w, h], png: o.toDataURL('image/png') };
}, 'data:image/png;base64,' + readFileSync(SRC).toString('base64'));
console.log('letras:', res.runs.length, JSON.stringify(res.runs), 'O:', res.box);
writeFileSync(THEME + '/assets/sidonia-app-isotipo.png', Buffer.from(res.png.split(',')[1], 'base64'));
await b.close();
