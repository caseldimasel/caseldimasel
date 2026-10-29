#!/usr/bin/env node
// Capturas REALES del código funcionando (Chromium), no imágenes generadas: Impact integrado (o el anfitrión si no hay
// copia de Impact) con datos [PRUEBA]. Cada captura lleva una etiqueta visible en la esquina para que nunca se confunda
// con la tienda publicada. Salida: docs/capturas/*.png y docs/capturas/README.md.
// Uso: node tools/harness/screenshots.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium, CHROMIUM_PATH } from './pw.mjs';
import { startServer } from './server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'capturas');
const impact = existsSync(join(ROOT, 'impact', 'original', 'layout', 'theme.liquid'));
if (impact) execFileSync('node', [join(ROOT, 'integration', 'apply-kit.mjs'), '--base', join(ROOT, 'impact', 'original'), '--out', join(ROOT, 'impact', 'sidonia'), '--replace', 'index.json,search.json,404.json', '--quiet']);
const PORT = 4390;
const { server } = await startServer({ port: PORT, profile: 'full', theme: impact ? join(ROOT, 'impact', 'sidonia') : null });
const EMPTY = 4391;
const empty = await startServer({ port: EMPTY, profile: 'empty', compose: false, theme: impact ? join(ROOT, 'impact', 'sidonia') : null });
mkdirSync(OUT, { recursive: true });
const base = impact ? 'Impact 7.2.0 + kit Sidonia' : 'anfitrión de pruebas + kit Sidonia (no es Impact)';
const LABEL = `Arnés de pruebas · ${base} · datos [PRUEBA] · no es la tienda publicada`;

const SHOTS = [
  ['01-inicio', '/', 'Inicio: hero con cabecera transparente de Impact, categorías con punto y buscador'],
  ['02-inicio-completo', '/', 'Inicio completo: tres mundos, selección, cómo vendemos, historia, comunidad (total de seguidores calculado), criterio, testimonios autorizados, propietarios, FAQ y pie', { full: true }],
  ['03-cabecera-solida-al-bajar', '/', 'Cabecera de Impact en piedra sólida tras superar el hero (misma altura)', { scroll: 1400 }],
  ['04-coches', '/collections/coches', 'Colección Coches: filtros reales (Search & Discovery simulado), orden y tarjetas'],
  ['05-filtro-aplicado', '/collections/coches?filter.p.m.sidonia.gearbox=Manual', 'Filtro activo en la URL (compartible), con chip para quitarlo'],
  ['06-ficha-coche', '/products/prueba-coche-a', 'Ficha de coche: vídeo vertical 9:16, precio, datos, propietario autorizado, ubicación y contacto'],
  ['07-ficha-coche-completa', '/products/prueba-coche-a', 'Ficha completa: historia, ficha técnica, estado, cronología, consulta vinculada y relacionadas', { full: true }],
  ['08-ficha-barco', '/products/prueba-barco-a', 'Ficha de barco: vídeo horizontal; propietario sin nombre autorizado → descripción'],
  ['09-ficha-casa', '/products/prueba-casa-a', 'Ficha de casa: ubicación con precisión «Ciudad»'],
  ['10-a-consultar', '/products/prueba-coche-b-a-consultar', 'Pieza «Precio a consultar» (nunca 0)'],
  ['11-vendida', '/products/prueba-casa-b-vendida', 'Pieza vendida: estado inequívoco y «Busco algo parecido»'],
  ['12-vender', '/pages/vender-con-sidonia', 'Vender con Sidonia: formulario único en 3 pasos'],
  ['13-vender-barcos', '/pages/vender-con-sidonia?categoria=barcos', 'Preselección validada con ?categoria=barcos (cambiable)', { step2: true }],
  ['14-favoritos', '/pages/favoritos', 'Favoritos en este navegador (estado vacío)'],
  ['15-busqueda', '/search?q=prueba', 'Resultados de búsqueda con piezas y un producto normal de la tienda'],
  ['16-vendidas', '/collections/vendidas', 'Archivo de piezas vendidas'],
  ['17-404', '/no-existe', 'Página 404 útil'],
  ['18-producto-normal', '/products/prueba-libro', 'Producto normal de la tienda (Impact sin cambios: precio y «Añadir a la cesta»)'],
  ['19-instalacion-vacia', '/', 'Instalación vacía: sin piezas, sin redes, sin imágenes (estado cuidado, sin datos inventados)', { empty: true }]
];
const VIEWPORTS = [
  ['escritorio', { width: 1440, height: 900 }],
  ['movil', { width: 390, height: 844 }]
];

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
const index = [];
for (const [vpName, vp] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  for (const [id, path, caption, o = {}] of SHOTS) {
    if (o.full && vpName === 'movil' && id === '02-inicio-completo') continue;
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${o.empty ? EMPTY : PORT}${path}`, { waitUntil: 'networkidle' });
    if (o.step2) await page.locator('[data-sidonia-next]').click();
    if (o.scroll) {
      await page.mouse.wheel(0, o.scroll);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(500);
    await page.evaluate((label) => {
      const b = document.createElement('div');
      b.textContent = label;
      b.setAttribute('style', 'position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:calc(100vw - 16px);padding:4px 8px;border-radius:4px;background:rgba(182,63,56,.92);color:#fff;font:600 11px/1.3 system-ui,sans-serif;pointer-events:none');
      document.body.appendChild(b);
    }, LABEL);
    const file = `${id}-${vpName}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: !!o.full });
    index.push([file, caption, vpName === 'escritorio' ? '1440 × 900' : '390 × 844', path + (o.empty ? ' (perfil vacío)' : '')]);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
server.close();
empty.server.close();

writeFileSync(
  join(OUT, 'README.md'),
  `# Capturas

Capturas **reales** del código funcionando en Chromium, tomadas con \`node tools/harness/screenshots.mjs\` el ${new Date().toISOString().slice(0, 10)}.

- **Qué se ve:** ${base}, renderizado por el intérprete de Liquid del arnés con datos **[PRUEBA]** (piezas, cuentas y testimonios
  ficticios y rotulados). No son la tienda publicada ni capturas de Shopify: el render real de Shopify puede diferir en detalles.
- **Logos:** el arnés no tiene los PNG reales; usa la palabra SIDONIA en SVG. Las fotos de coches son las que aportó Sidonia;
  barcos y casas usan degradados de prueba.
- Cada imagen lleva la etiqueta roja «Arnés de pruebas» en la esquina inferior izquierda.

| Archivo | Qué muestra | Tamaño | Ruta |
|---|---|---|---|
${index.map(([f, c, s, p]) => `| [${f}](${f}) | ${c} | ${s} | \`${p}\` |`).join('\n')}
`
);
console.log(`${index.length} capturas en docs/capturas/`);
