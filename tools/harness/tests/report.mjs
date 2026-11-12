#!/usr/bin/env node
// Genera docs/12-informe-de-pruebas.md a partir de las últimas ejecuciones (last-run-impact.json y last-run-host.json)
// y de tools/check-kit.mjs. Uso: node tools/harness/tests/e2e.mjs && node tools/harness/tests/report.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const load = (t) => (existsSync(join(here, `last-run-${t}.json`)) ? JSON.parse(readFileSync(join(here, `last-run-${t}.json`), 'utf8')) : null);
const runs = { impact: load('impact'), host: load('host') };
const check = (args) => {
  try {
    return { ok: true, out: execFileSync('node', [join(ROOT, 'tools', 'check-kit.mjs'), ...args], { encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') };
  }
};
const ck = check([]);
const ckImpact = existsSync(join(ROOT, 'impact', 'sidonia')) ? check(['--theme', join(ROOT, 'impact', 'sidonia')]) : null;
const kb = (n) => (n / 1024).toFixed(1).replace('.', ',') + ' KB';
const assets = readdirSync(join(ROOT, 'kit', 'assets')).map((f) => [f, statSync(join(ROOT, 'kit', 'assets', f)).size]);

const table = (run) => {
  if (!run) return '_No ejecutado._\n';
  let out = '';
  let group = '';
  for (const r of run.results) {
    if (r.group !== group) {
      group = r.group;
      out += `\n**${group}**\n\n| Resultado | Prueba | Detalle |\n|---|---|---|\n`;
    }
    out += `| ${r.ok ? '✔' : '✘ **FALLA**'} | ${r.name} | ${(r.ok ? r.info : r.error || '').replace(/\|/g, '\\|')} |\n`;
  }
  return out;
};
const sum = (r) => (r ? `**${r.total - r.failed} de ${r.total}** correctas (${r.at.slice(0, 16).replace('T', ' ')} UTC)` : 'no ejecutado');

const md = `# 12 · Informe de pruebas

> Generado con \`node tools/harness/tests/e2e.mjs && SIDONIA_TARGET=host node tools/harness/tests/e2e.mjs && node tools/harness/tests/report.mjs\`.
> Léelo entero: explica con qué se ha probado y **qué no se ha podido probar**.

## 1. Resumen

| Comprobación | Resultado |
|---|---|
| Pruebas en navegador sobre **Impact 7.2.0 integrado** (copia de la tienda + kit + parches) | ${sum(runs.impact)} |
| Las mismas pruebas sobre el **anfitrión genérico** (sin Impact) | ${sum(runs.host)} |
| \`tools/check-kit.mjs\` (anfitrión + kit) | ${ck.ok ? 'sin errores' : '**con errores**'} |
| \`tools/check-kit.mjs --theme impact/sidonia\` (archivos del kit dentro de Impact) | ${ckImpact ? (ckImpact.ok ? 'sin errores' : '**con errores**') : 'no ejecutado'} |
| Contraste de la paleta (19 pares) | todos cumplen ([03](03-sistema-de-diseno.md)) |

## 2. Cómo se ha probado

| Capa | Herramienta | Qué demuestra | Límite |
|---|---|---|---|
| Liquid y esquemas | \`tools/lint/liquid.mjs\`, \`tools/lint/schema.mjs\` (propios) | Etiquetas y filtros de Shopify, sin filtros en parámetros de \`render\`/\`if\`/\`for\`, claves de traducción, ámbito de \`render\`, tipos y rangos de ajustes, nombres ≤ 25, plantillas JSON | No es Theme Check |
| Reglas del encargo | \`tools/check-kit.mjs\` | Nombres públicos, comunidades, sin subida de archivos, sin secretos, sin datos de formulario en el navegador, analítica sin datos personales, sin promesas prohibidas, límites de Search & Discovery, solo «es igual a», aislamiento CSS | — |
| Render | \`tools/harness/liquid.mjs\` (**intérprete propio**, no el de Shopify) con datos **[PRUEBA]** y los ajustes reales de \`settings_data.json\` de la tienda | Que Impact + kit producen el HTML esperado en 25 rutas | Puede diferir del motor de Shopify en detalles |
| Navegador | Chromium (Playwright) a 360, 390, 768, 1024 y 1440 px | Diseño, JavaScript de Impact y del kit, vídeo, filtros, favoritos, formularios, accesibilidad básica | Sin red externa; sin dispositivos reales |

## 3. Lo que NO se ha podido probar (pendiente en la tienda)

1. **Shopify Theme Check / Shopify CLI**: no se pudieron instalar (sin acceso a npm). Ejecuta \`shopify theme check --path impact/sidonia\`.
2. **Subida real del ZIP y editor de Shopify**: no hay acceso a la tienda. Se ha simulado la carga/descarga de secciones del editor.
3. **Recepción de formularios** en el correo de la tienda y la pantalla anti-spam real (el arnés simula éxito, errores, red y verificación).
4. **Bloqueo real de compra** de piezas (inventario y canales): ver la prueba manual de [10](10-precios-y-compra.md).
5. **Search & Discovery** real: el arnés reproduce su contrato de filtros (\`collection.filters\`, URLs \`filter.p.m.sidonia.*\`).
6. **Vídeos reales** (MP4/HLS de Shopify), **YouTube/Vimeo** (sin red) y **Core Web Vitals** en red móvil real.
7. **jamesedition.com** no se pudo abrir (red bloqueada): ver [01](01-patrones-jamesedition.md).
8. **Lectores de pantalla reales** (VoiceOver, NVDA): se han comprobado roles, nombres accesibles, foco y anuncios, no una sesión con lector.
9. \`tools/setup/provision.mjs\` (Admin API) no se ha ejecutado contra una tienda.

## 4. Linter sobre los archivos propios de Impact (informativo)

El linter de esquemas, aplicado a **todo** Impact, señala 5 casos en archivos de Impact que no son errores reales
(un bloque \`@theme\`, colores por defecto \`rgba(0,0,0,0)\`, un menú por defecto distinto de main-menu/footer) y el de Liquid
2 avisos de ámbito en \`product-quick-buy.liquid\` de Impact. No se han tocado: son código de Maestrooo y Shopify los acepta.

## 5. Resultados sobre Impact 7.2.0 integrado
${table(runs.impact)}
## 6. Resultados sobre el anfitrión genérico
${table(runs.host)}
## 7. Errores reales encontrados y corregidos durante las pruebas

| Error | Causa | Corrección |
|---|---|---|
| La ficha no mostraba el reproductor | \`<sidonia-player>\` sin \`display: block\` (elemento personalizado = en línea) | Regla de bloque para los elementos del kit, respetando \`hidden\` |
| El héroe desbordaba en móvil | Un \`fieldset\` usa \`min-inline-size: min-content\` | \`min-inline-size: 0\` y columnas \`minmax(0, 1fr)\` |
| Los filtros y «Cargar más» no funcionaban | La sección de catálogo no cargaba \`sidonia-catalog.js\` | Script diferido en la sección |
| La barra de contacto móvil no aparecía tras un salto | \`IntersectionObserver\` no avisa si se salta por encima del resumen | Medición por fotograma al desplazarse |
| Un envío colgado dejaba «Enviando…» para siempre | \`fetch\` sin límite de tiempo | Corte a los 25 s con aviso de conexión |
| La tarjeta desbordaba 5 px en la cuadrícula de 2 columnas de Impact | Precio y estado sin poder partir línea | Columna \`minmax(0,1fr)\` y \`flex-wrap\` |
| Iconos sobre el logo a 360 px y menú en dos líneas | Logo centrado de Impact + 6 enlaces + «Vender» | Diseño «logo a la izquierda»; corazón al panel móvil; espaciado en < 400 px |
| «Propietario» con dos puntos sueltos | Etiqueta solo para lectores de pantalla | La regla de «:» ignora etiquetas ocultas |
| Nombres de sección de más de 25 caracteres | Límite de Shopify | Nombres acortados |
| Al pasar de paso en el formulario, el paso quedaba bajo la cabecera fija | El cálculo no contaba la cabecera | \`scroll-margin-top\` con la altura real de la cabecera de Impact |
| \`apply-kit --update\` sobrescribía plantillas editadas y duplicaba las secciones conservadas | Las plantillas se trataban como archivos del kit | En \`--update\` se conservan; reaplicar sobre un tema integrado no cambia nada |
| Un producto normal no mostraba su información en el arnés | El intérprete de pruebas no exponía \`section\` a los snippets (Shopify sí) | Corregido el intérprete (no el tema) |

## 8. Peso de los recursos del kit (sin comprimir)

| Archivo | Tamaño |
|---|---|
${assets.map(([f, n]) => `| \`${f}\` | ${kb(n)} |`).join('\n')}

Ningún framework ni biblioteca externa. Se cargan diferidos; \`sidonia-catalog.js\`, \`sidonia-forms.js\` y \`sidonia-product.js\` solo en las páginas que los usan.
`;
writeFileSync(join(ROOT, 'docs', '12-informe-de-pruebas.md'), md);
console.log('docs/12-informe-de-pruebas.md generado');
