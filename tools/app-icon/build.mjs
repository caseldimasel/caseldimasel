// Iconos y pantallas de carga de la app de Sidonia, sobre blanco:
// - iconos y accesos directos: el isotipo (la «O» con el punto, assets/sidonia-app-isotipo.png, recortada del logo);
// - pantallas de carga del iPhone: el logo completo (assets/sidonia-app-logo.png).
// Uso: SIDONIA_THEME=../sidonia-shopify node tools/app-icon/build.mjs
import { chromium, CHROMIUM_PATH } from '../harness/pw.mjs';
import { readFileSync } from 'node:fs';
const THEME = process.env.SIDONIA_THEME || '../sidonia-shopify';
const OUT = THEME + '/assets/';
const LOGO = 'data:image/png;base64,' + readFileSync(OUT + 'sidonia-app-logo.png').toString('base64');
const ISO = 'data:image/png;base64,' + readFileSync(OUT + 'sidonia-app-isotipo.png').toString('base64');
const b = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
const p = await b.newPage({ deviceScaleFactor: 1 });
async function shot(html, w, h, file, transparent = false) {
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#fff'}">${html}</body></html>`);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: OUT + file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
// Cuadrado blanco (esquinas redondeadas opcionales) con el isotipo centrado, de `alto` del lado
const icon = (size, alto, radius = 0) => `<div style="width:${size}px;height:${size}px;border-radius:${radius * size}px;background:#fff;display:grid;place-items:center"><img src="${ISO}" style="height:${Math.round(size * alto)}px;width:auto;display:block"></div>`;
await shot(icon(180, 0.6), 180, 180, 'sidonia-app-icon-180.png');
await shot(icon(192, 0.6, 0.225), 192, 192, 'sidonia-app-icon-192.png', true);
await shot(icon(512, 0.6, 0.225), 512, 512, 'sidonia-app-icon-512.png', true);
// Android adaptable: el isotipo dentro de la zona segura (círculo del 80 %)
await shot(icon(192, 0.5), 192, 192, 'sidonia-app-icon-maskable-192.png');
await shot(icon(512, 0.5), 512, 512, 'sidonia-app-icon-maskable-512.png');
// Accesos directos: iconos negros de línea sobre blanco
const glyph = {
  descubre: '<rect x="30" y="24" width="36" height="48" rx="11" fill="none" stroke="#111" stroke-width="5"/><path d="M42 38v20l15-10z" fill="#111"/><circle cx="66" cy="25" r="7" fill="#ff4d5e"/>',
  recientes: '<path d="M48 20v12M48 64v12M20 48h12M64 48h12M28 28l8 8M60 60l8 8M28 68l8-8M60 36l8-8" stroke="#111" stroke-width="5" stroke-linecap="round"/>',
  vender: '<circle cx="48" cy="48" r="24" fill="none" stroke="#111" stroke-width="5"/><path d="M48 37v22M37 48h22" stroke="#111" stroke-width="5" stroke-linecap="round"/>'
};
for (const [k, g] of Object.entries(glyph)) {
  await shot(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#fff"/>${g}</svg>`, 96, 96, `sidonia-app-shortcut-${k}.png`, true);
}
// Pantallas de carga del iPhone: blanco y el logo en el centro
const SPLASH = [[1320, 2868], [1290, 2796], [1206, 2622], [1179, 2556], [1284, 2778], [1170, 2532], [1125, 2436], [1242, 2688], [828, 1792], [750, 1334]];
for (const [w, h] of SPLASH) {
  await shot(`<div style="width:${w}px;height:${h}px;background:#fff;display:grid;place-items:center"><img src="${LOGO}" style="width:${Math.round(w * 0.56)}px;height:auto;display:block;transform:translateY(-${Math.round(h * 0.02)}px)"></div>`, w, h, `sidonia-app-splash-${w}x${h}.png`);
}
await b.close();
console.log('ok');
