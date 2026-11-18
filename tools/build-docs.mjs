#!/usr/bin/env node
// Genera las partes de la documentación que salen de los datos (para que nunca se desincronicen):
//   docs/04-modelo-de-datos.md   ← data/metafields.json
//   docs/03-sistema-de-diseno.md ← bloque <!-- contraste --> con tools/palette.mjs
//   docs/14-registro-de-cambios.md ← archivos del kit (su comentario de cabecera) e integration/patches
// Uso: node tools/build-docs.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE, PAIRS } from './palette.mjs';
import { ratio } from './contrast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = JSON.parse(readFileSync(join(ROOT, 'data', 'metafields.json'), 'utf8'));
const GROUPS = {
  common: 'Comunes a toda pieza',
  location: 'Ubicación pública (dónde está HOY)',
  owner: 'Propietario (solo presentación pública autorizada)',
  price: 'Precio editorial',
  video: 'Vídeo',
  details: 'Detalles, documentos y relaciones',
  garage: 'Coches',
  harbor: 'Barcos',
  estate: 'Casas',
  bands: 'Bandas para filtros (texto)'
};
const TEST = {
  reference: 'PR-G-001', category: 'Coches', status: 'Disponible', hook: 'Texto de prueba: una línea de historia', why_special: '[PRUEBA] Hechos aportados',
  country: 'España', region: 'Región de prueba', city: 'Ciudad de prueba', location_precision: 'Región', owner_name: 'Nombre de prueba', owner_show_name: 'true',
  owner_label: 'Propietario particular', price_mode: 'Publicado', price_amount: '85000', price_currency: 'EUR', video_duration: '83', video_language: 'Español',
  subtitles_lang: 'es', brand: 'Marca A', model: 'Modelo A', year: '1972', mileage_km: '84000', fuel: 'Gasolina', gearbox: 'Manual', power_hp: '130',
  builder: 'Constructor A', boat_type: 'Velero', length_m: '12.5', engine: 'Diésel 40 CV', property_type: 'Masía', area_value: '320', area_unit: 'm²', bedrooms: '5',
  year_band: '1970-1979', km_band: '50.000-99.999 km', loa_band: '12-14,99 m', area_band: '250-499 m²', bedrooms_band: '5 o más', price_band: '50.000-99.999 €', featured: 'true'
};
const esc = (s) => String(s || '').replace(/\|/g, '\\|');

let md = `# 04 · Modelo de datos

> Generado por \`node tools/build-docs.mjs\` a partir de \`data/metafields.json\` (fuente única; la usan también
> \`tools/setup/provision.mjs\` y \`tools/check-kit.mjs\`). No edites este archivo a mano.

## 1. Principios

- **Cada pieza es un producto de Shopify** (URL, colecciones, búsqueda, SEO). Una pieza única no tiene tallas ni cantidades:
  una sola variante, sin inventario comprable (ver [10-precios-y-compra.md](10-precios-y-compra.md)).
- **Namespace \`${M.namespace}\`**, definiciones del comerciante en *Ajustes > Datos personalizados > Productos*.
  **Instalar el tema no crea estas definiciones**: se crean a mano o con \`node tools/setup/provision.mjs --apply\`.
- **Lo que distingue una pieza Sidonia de un producto normal** (libros, láminas…) es el metacampo \`sidonia.category\`.
  Con él, Impact pinta la tarjeta, el precio y la ficha de Sidonia; sin él, todo sigue como siempre.
- **Datos públicos y privados separados.** Nombre del propietario: solo presentación autorizada. Su teléfono, correo o
  documentos **nunca** van en metacampos (son visibles para la tienda online): viajan por el formulario de venta al correo de la tienda.
- **Desconocido no es cero.** Un dato vacío no se muestra; \`0\` sí se publica (por ejemplo, 0 km).
- Los valores de prueba son **[PRUEBA]**: sirven para el arnés y para comprobar una ficha en un duplicado, no son datos reales.

## 2. Metacampos de producto
`;
for (const [g, title] of Object.entries(GROUPS)) {
  const rows = M.product_metafields.filter((m) => m.group === g);
  if (!rows.length) continue;
  md += `\n### ${title}\n\n| Nombre visible | Clave | Tipo de Shopify | Obligatorio | Filtro | Valores | Uso | Valor de prueba |\n|---|---|---|---|---|---|---|---|\n`;
  for (const m of rows) {
    md += `| ${esc(m.name)} | \`${M.namespace}.${m.key}\` | \`${m.type}\` | ${m.required ? 'sí' : ''} | ${m.filter ? 'sí' : ''}${m.smart ? ' · colección automática' : ''} | ${esc((m.choices || []).join(' / '))} | ${esc(m.use)} | ${esc(TEST[m.key] || '')} |\n`;
  }
}
md += `
## 3. Metaobjetos
`;
for (const o of M.metaobjects) {
  md += `\n### ${o.name} (\`${o.type}\`)\n\nAcceso desde la tienda online: **${o.storefront ? 'activado (necesario)' : 'no'}** · campo que lo identifica: \`${o.display_key}\`\n\n| Campo | Clave | Tipo | Obligatorio | Valores |\n|---|---|---|---|---|\n`;
  for (const f of o.fields) md += `| ${esc(f.name)} | \`${f.key}\` | \`${f.type}\` | ${f.required ? 'sí' : ''} | ${esc((f.choices || []).join(' / '))} |\n`;
}
md += `
**Cuentas sociales:** cada cuenta es una entrada; el total se **calcula** sumando \`followers\` de las entradas con
\`include_in_total\` verdadero, sin repetir una cuenta (misma URL normalizada o misma red + nombre). Una cifra vacía no es 0
y no se suma. Si ninguna cuenta tiene cifra, no se muestra total: solo «Sigue las historias de Sidonia» y los enlaces.
No existe un total manual.

## 4. Filtros (Search & Discovery)

${M.filters._comment}

| Orden | Filtro | Metacampo |
|---|---|---|
${M.filters.order.map((k, i) => `| ${i + 1} | ${M.filters.labels[k]} | \`${M.namespace}.${k}\` |`).join('\n')}

## 5. Colecciones automáticas

Solo condiciones **«es igual a»** sobre metacampos de texto de una línea (lo que admite Shopify para colecciones automáticas).

| Colección | Handle | Plantilla | Condición |
|---|---|---|---|
${M.collections.map((c) => `| ${c.title} | \`${c.handle}\` | ${c.template ? '`collection.' + c.template + '`' : '(por defecto)'} | ${c.rules.map(([k, v]) => `\`${M.namespace}.${k}\` = «${v}»`).join(c.any ? ' **o** ' : ' **y** ')} |`).join('\n')}

## 6. Páginas

| Página | Handle | Plantilla |
|---|---|---|
${M.pages.map((p) => `| ${p.title} | \`/pages/${p.handle}\` | \`page.${p.template}\` |`).join('\n')}

Menú propuesto \`${M.menu.handle}\`: ${M.menu.items.map(([t, u]) => `${t} (\`${u}\`)`).join(' · ')}.

## 7. Cómo los lee el tema (Liquid)

\`\`\`liquid
{%- comment -%} Precio editorial: nunca el precio de la variante {%- endcomment -%}
{%- render 'sidonia-price', product: product -%}            → «85.000 €», «Precio a consultar», «Precio no publicado»
{%- render 'sidonia-location', product: product -%}         → «Región de prueba, España» (según la precisión)
{%- render 'sidonia-owner', product: product -%}            → nombre autorizado o descripción; si no, nada
{%- render 'sidonia-category', product: product -%}         → garage | harbor | estate (clave interna)
{{ product.metafields.sidonia.year.value }}                 → lectura directa de un dato
\`\`\`

Los snippets \`sidonia-spec\` y \`sidonia-specs\` dan formato español a los números (4 cifras sin separador, 5 o más con
punto, decimales con coma) y ocultan lo desconocido.
`;
writeFileSync(join(ROOT, 'docs', '04-modelo-de-datos.md'), md);

const ds = join(ROOT, 'docs', '03-sistema-de-diseno.md');
if (existsSync(ds)) {
  const rows = PAIRS.map(([fg, bg, need, use]) => {
    const r = ratio(PALETTE[fg], PALETTE[bg]);
    return `| ${fg} \`${PALETTE[fg]}\` | ${bg} \`${PALETTE[bg]}\` | ${r.toFixed(2)}:1 | ${need}:1 | ${r >= need ? 'sí' : '**NO**'} | ${use} |`;
  });
  const table = `<!-- contraste -->\n| Primer plano | Fondo | Ratio | Mínimo | Cumple | Uso |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n<!-- /contraste -->`;
  const src = readFileSync(ds, 'utf8');
  writeFileSync(ds, src.replace(/<!-- contraste -->[\s\S]*?<!-- \/contraste -->/, table));
}
/* ---------------------------------------------------------------- registro de archivos */
function purpose(file) {
  const src = readFileSync(file, 'utf8');
  const isCode = /\.(js|mjs|css)$/.test(file);
  let m = isCode ? null : /\{%-?\s*comment\s*-?%\}\s*([\s\S]*?)\{%-?\s*endcomment/.exec(src);
  let txt = m ? m[1] : '';
  if (!txt && isCode) {
    m = /^\s*(?:\/\*\*?([\s\S]*?)\*\/|((?:\/\/[^\n]*\n)+))/.exec(src);
    txt = m ? (m[1] || m[2]) : '';
  }
  if (!txt && file.endsWith('.json')) txt = 'Plantilla generada por tools/build-templates.mjs';
  return txt.replace(/^\s*(\*|\/\/)\s?/gm, '').replace(/\s+/g, ' ').trim().split(/(?<=[.:])\s/)[0].slice(0, 180).replace(/\|/g, '\\|');
}
const list = (dir) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((f) => !f.startsWith('.')).sort().map((f) => `${dir}/${f}`) : []);
const kitRows = ['kit/assets', 'kit/sections', 'kit/snippets', 'kit/templates', 'kit/locales', 'kit/config'].flatMap(list);
const patchRows = list('integration/patches').filter((f) => f.endsWith('.mjs'));
let reg = `# 14 · Registro de cambios y archivos

> Generado por \`node tools/build-docs.mjs\`. El detalle exacto de cada integración (archivos creados, reemplazados y
> modificados, con notas) lo escribe \`apply-kit\` en \`impact/sidonia.CAMBIOS.md\`, y las diferencias línea a línea en
> \`impact/sidonia.diff\` (locales: contienen fragmentos de Impact y no se suben al repositorio público).

## Resumen de la integración en Impact 7.2.0

| Tipo | Cantidad | Detalle |
|---|---|---|
| Archivos nuevos del kit (\`sidonia-*\`) | ${kitRows.filter((f) => /\/sidonia-/.test(f)).length + 1} | assets, secciones, snippets y \`snippets/sidonia-impact-bridge.liquid\` |
| Plantillas nuevas | ${list('kit/templates').filter((f) => !/\/(index|search|404)\.json$/.test(f)).length} | colecciones, fichas, páginas y la vista \`product.sidonia-card\` |
| Plantillas reemplazadas (con las originales dentro, desactivadas) | 3 | \`index.json\`, \`search.json\`, \`404.json\` |
| Archivos de Impact modificados | 13 | ver [15](15-restaurar-y-actualizar-impact.md) |
| \`config/settings_data.json\` | 0 | **sin cambios** |
| Resto de archivos de Impact | sin cambios | — |

## Decisiones registradas

| Decisión | Motivo |
|---|---|
| Kit con prefijo \`sidonia-\` + parches con anclas exactas | Trazable, reversible y sin inventar APIs de Impact |
| Cabecera transparente nativa de Impact | Evitar un segundo sistema; Impact ya la resuelve con \`allow-transparent-header\` |
| Cabecera fija y logo a la izquierda en el duplicado | Estado piedra al superar el hero; disposición de JamesEdition; menú en una línea |
| Paleta piedra por puente de variables con casilla | No tocar \`settings_data.json\` y poder volver atrás |
| \`page.sidonia-about\` en lugar de \`page.about\` | La tienda ya usa \`page.about\` |
| Portada, búsqueda y 404 del kit con las secciones originales desactivadas | No perder contenido de la tienda |
| Búsqueda con \`sidonia-catalog\` (piezas y productos normales) | Precio editorial de las piezas y filtros de Sidonia; los productos normales con su precio |
| Tarjeta y precio Sidonia dentro de componentes de Impact solo si \`sidonia.category\` | Comercio normal intacto |
| Ofertas en JSON-LD solo con precio publicado y disponible | Nunca una oferta comprable con precio 0 |
| Formulario de contacto nativo | Sin servidor ni credenciales en la primera versión |

## Parches de Impact

| Parche | Qué hace |
|---|---|
${patchRows.map((f) => `| \`${f}\` | ${purpose(join(ROOT, f))} |`).join('\n')}

## Archivos del kit

| Archivo | Para qué sirve |
|---|---|
${kitRows.map((f) => `| \`${f}\` | ${purpose(join(ROOT, f))} |`).join('\n')}

## Herramientas

| Archivo | Para qué sirve |
|---|---|
${['integration/audit-impact.mjs', 'integration/apply-kit.mjs', 'integration/build-zip.mjs', 'integration/lib.mjs', 'integration/impact/snippets/sidonia-impact-bridge.liquid', 'tools/check-kit.mjs', 'tools/lint/liquid.mjs', 'tools/lint/schema.mjs', 'tools/contrast.mjs', 'tools/palette.mjs', 'tools/build-templates.mjs', 'tools/build-docs.mjs', 'tools/setup/provision.mjs', 'tools/harness/server.mjs', 'tools/harness/liquid.mjs', 'tools/harness/store.mjs', 'tools/harness/tests/e2e.mjs', 'tools/harness/tests/report.mjs', 'tools/harness/screenshots.mjs'].filter((f) => existsSync(join(ROOT, f))).map((f) => `| \`${f}\` | ${purpose(join(ROOT, f))} |`).join('\n')}
`;
writeFileSync(join(ROOT, 'docs', '14-registro-de-cambios.md'), reg);

console.log('Documentación generada: docs/04-modelo-de-datos.md' + (existsSync(ds) ? ' y tabla de contraste de docs/03' : ''));
