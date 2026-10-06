import { chromium, CHROMIUM_PATH } from '../harness/pw.mjs';
import { markSvg } from './mark.mjs';
// Uso: SIDONIA_THEME=../sidonia-shopify node tools/app-icon/build.mjs  (escribe los PNG en assets/ del tema)
const OUT = (process.env.SIDONIA_THEME || '../sidonia-shopify') + '/assets/';
const b = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
const p = await b.newPage({ deviceScaleFactor: 1 });
async function shot(svg, w, h, file, transparent = false) {
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#000'}">${svg}</body></html>`);
  await p.screenshot({ path: OUT + file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
// iPhone (iOS redondea las esquinas: cuadrado lleno)
await shot(markSvg({ size: 180, scale: 0.56 }), 180, 180, 'sidonia-app-icon-180.png');
// Android y ordenador «any»: esquinas redondeadas transparentes
await shot(markSvg({ size: 192, scale: 0.56, rounded: 0.225 }), 192, 192, 'sidonia-app-icon-192.png', true);
await shot(markSvg({ size: 512, scale: 0.56, rounded: 0.225 }), 512, 512, 'sidonia-app-icon-512.png', true);
// Android adaptable (maskable): lleno y la marca dentro de la zona segura
await shot(markSvg({ size: 192, scale: 0.44 }), 192, 192, 'sidonia-app-icon-maskable-192.png');
await shot(markSvg({ size: 512, scale: 0.44 }), 512, 512, 'sidonia-app-icon-maskable-512.png');
// Accesos directos (mantener pulsado el icono en Android)
const glyph = {
  descubre: '<rect x="30" y="24" width="36" height="48" rx="11" fill="none" stroke="#fff" stroke-width="5"/><path d="M42 38v20l15-10z" fill="#fff"/><circle cx="66" cy="25" r="7" fill="#ff4d5e"/>',
  recientes: '<path d="M48 20v12M48 64v12M20 48h12M64 48h12M28 28l8 8M60 60l8 8M28 68l8-8M60 36l8-8" stroke="#fff" stroke-width="5" stroke-linecap="round"/>',
  vender: '<circle cx="48" cy="48" r="24" fill="none" stroke="#fff" stroke-width="5"/><path d="M48 37v22M37 48h22" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'
};
for (const [k, g] of Object.entries(glyph)) {
  await shot(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#000"/>${g}</svg>`, 96, 96, `sidonia-app-shortcut-${k}.png`, true);
}
// Pantallas de carga del iPhone (vertical): negro y la marca en el centro
const SPLASH = [[1320, 2868], [1290, 2796], [1206, 2622], [1179, 2556], [1284, 2778], [1170, 2532], [1125, 2436], [1242, 2688], [828, 1792], [750, 1334]];
for (const [w, h] of SPLASH) {
  const box = Math.round(w * 0.36);
  const svg = `<div style="width:${w}px;height:${h}px;background:#000;display:grid;place-items:center"><div style="transform:translateY(-${Math.round(h * 0.02)}px)">${markSvg({ size: box, scale: 0.6, bg: 'none' })}</div></div>`;
  await shot(svg, w, h, `sidonia-app-splash-${w}x${h}.png`);
}
await b.close();
console.log('ok');
