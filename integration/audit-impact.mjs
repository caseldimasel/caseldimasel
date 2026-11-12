#!/usr/bin/env node
// Auditoría automática de la copia de Impact ANTES de integrar el kit Sidonia.
//
// No inventa nada: lee los archivos reales y lista lo que encuentra para cada punto de integración
// (versión, cabecera transparente, tarjeta de producto, filtros, JSON-LD, og:price, búsqueda
// predictiva, carrito, colores, tipografías, eventos y custom elements, bloques de app,
// personalizaciones y conflictos con el kit). El resultado guía los parches de integration/patches/.
//
// Uso:
//   node integration/audit-impact.mjs impact/original            (carpeta descomprimida)
//   node integration/audit-impact.mjs impact/impact-copia.zip    (ZIP descargado de Shopify)
// Salida: impact/AUDITORIA.md e impact/auditoria.json (carpeta ignorada por git: el código de Impact
// es licenciado y este repositorio es público).
import { walk, readJsonLoose, resolveTheme, extractSchema, grepFiles, readFileSync, writeFileSync, existsSync, mkdirSync, join } from './lib.mjs';

const input = process.argv[2];
if (!input) {
  console.error('Uso: node integration/audit-impact.mjs <carpeta-o-zip-de-impact> [--out impact]');
  process.exit(1);
}
const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'impact';
const root = resolveTheme(input);
const files = walk(root);
const by = (dir) => files.filter((f) => f.startsWith(dir + '/'));
const A = { input, root, generated: new Date().toISOString() };

/* ---------- 1. identidad y versión ---------- */
const schema = readJsonLoose(join(root, 'config/settings_schema.json'));
const info = (Array.isArray(schema) ? schema : []).find((g) => g.name === 'theme_info') || {};
A.theme = { name: info.theme_name || '(sin theme_info)', version: info.theme_version || '(sin versión)', author: info.theme_author || '', docs: info.theme_documentation_url || '' };
A.isImpact = /^impact(\s|$)/i.test(String(A.theme.name).trim());

/* ---------- 2. estructura ---------- */
A.structure = {};
for (const d of ['layout', 'templates', 'sections', 'snippets', 'assets', 'locales', 'config', 'blocks']) A.structure[d] = by(d).length;
A.templates = by('templates');
A.locales = by('locales');
A.defaultLocale = A.locales.find((f) => /\.default\.json$/.test(f) && !/schema/.test(f)) || null;
A.groups = by('sections').filter((f) => f.endsWith('.json')).map((f) => {
  try {
    const j = readJsonLoose(join(root, f));
    return { file: f, type: j.type, name: j.name, sections: Object.values(j.sections || {}).map((s) => s.type) };
  } catch (e) {
    return { file: f, error: e.message };
  }
});

/* ---------- 3. cabecera y cabecera transparente ---------- */
const headerGroup = A.groups.find((g) => g.type === 'header') || null;
A.header = { group: headerGroup ? headerGroup.file : null, sections: headerGroup ? headerGroup.sections : [] };
A.header.sectionFiles = A.header.sections.map((t) => `sections/${t}.liquid`).filter((f) => files.includes(f));
A.header.settings = [];
for (const f of A.header.sectionFiles) {
  const s = extractSchema(readFileSync(join(root, f), 'utf8'));
  if (s && Array.isArray(s.settings)) A.header.settings.push(...s.settings.filter((x) => x.id).map((x) => ({ file: f, id: x.id, type: x.type, label: x.label })));
}
A.transparent = {
  schemaSettings: [],
  liquid: grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /transparent/i, 8),
  css: grepFiles(root, files.filter((f) => /\.css(\.liquid)?$/.test(f)), /transparent/i, 6),
  js: grepFiles(root, files.filter((f) => /\.js$/.test(f)), /transparent/i, 6)
};
for (const f of by('sections').filter((x) => x.endsWith('.liquid'))) {
  const s = extractSchema(readFileSync(join(root, f), 'utf8'));
  if (!s || !Array.isArray(s.settings)) continue;
  for (const st of s.settings) if (st.id && /transparent/i.test(st.id)) A.transparent.schemaSettings.push({ file: f, id: st.id, type: st.type, label: st.label });
}
A.logoSettings = (Array.isArray(schema) ? schema : []).flatMap((g) => (g.settings || []).filter((s) => s.id && /logo|favicon/i.test(s.id)).map((s) => ({ group: g.name, id: s.id, type: s.type })));
A.logoSettings.push(...A.header.settings.filter((s) => /logo/i.test(s.id)));
A.menus = A.header.settings.filter((s) => s.type === 'link_list');
A.menuLinkRendering = grepFiles(root, A.header.sectionFiles.concat(by('snippets').filter((f) => /menu|nav/i.test(f))), /link\.title|link\.url|for\s+link\s+in/i, 6);

/* ---------- 4. catálogo, tarjeta y filtros ---------- */
const mainOf = (t) => {
  const f = `templates/${t}.json`;
  if (!files.includes(f)) return null;
  try {
    const j = readJsonLoose(join(root, f));
    return j.order.map((id) => j.sections[id].type);
  } catch (e) {
    return null;
  }
};
A.catalog = { collection: mainOf('collection'), search: mainOf('search'), product: mainOf('product'), page: mainOf('page'), index: mainOf('index'), notfound: mainOf('404') };
A.cardSnippets = by('snippets').filter((f) => /card/i.test(f));
A.cardUsage = grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /render\s+'[^']*card[^']*'/i, 4);
A.facets = grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /\.filters\b|filter\.param_name|url_to_remove/, 3);
A.sortOptions = grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /sort_options/, 3);

/* ---------- 5. SEO: JSON-LD y Open Graph ---------- */
A.jsonld = grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /application\/ld\+json/, 3);
A.jsonldProductPrice = grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /"price"|priceCurrency|offers/i, 4);
A.ogPrice = grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /og:price|product:price/i, 4);

/* ---------- 6. compra: carrito, formularios de producto, búsqueda predictiva ---------- */
A.cart = {
  productForms: grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /form\s+'product'/, 3),
  cartAddJs: grepFiles(root, files.filter((f) => /\.js$/.test(f)), /cart\/add|cart_add_url|routes\.cart_add/i, 3),
  quickBuy: grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /quick[-_ ]?(buy|add|view)/i, 3),
  dynamicCheckout: grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /payment_button|shopify_payment_button/, 3),
  sections: by('sections').filter((f) => /cart|drawer/i.test(f))
};
A.predictive = grepFiles(root, files, /predictive_search|predictive-search/i, 3);
A.priceRendering = grepFiles(root, files.filter((f) => /\.liquid$/.test(f)), /\|\s*money/i, 2).slice(0, 25);

/* ---------- 7. colores, tipografías, variables CSS ---------- */
const allSettings = (Array.isArray(schema) ? schema : []).flatMap((g) => (g.settings || []).map((s) => ({ ...s, group: g.name })));
A.colorSettings = allSettings.filter((s) => /^color/.test(s.type || '')).map((s) => ({ id: s.id, type: s.type, group: s.group, default: s.default }));
A.fontSettings = allSettings.filter((s) => s.type === 'font_picker').map((s) => ({ id: s.id, default: s.default, group: s.group }));
const varSources = files.filter((f) => /^(layout\/theme\.liquid|snippets\/.*(css|variable|style).*\.liquid)$/i.test(f));
A.cssVariables = [];
for (const f of varSources) {
  const t = readFileSync(join(root, f), 'utf8');
  for (const m of t.matchAll(/(--[a-z0-9-]+)\s*:/gi)) if (!A.cssVariables.includes(m[1])) A.cssVariables.push(m[1]);
}
A.cssVariables = A.cssVariables.slice(0, 120);
A.cssVariableSources = varSources;

/* ---------- 8. JavaScript: custom elements y eventos ---------- */
const js = files.filter((f) => /\.js$/.test(f));
const els = new Set();
const evs = new Set();
for (const f of js) {
  const t = readFileSync(join(root, f), 'utf8');
  for (const m of t.matchAll(/customElements\.define\(\s*['"`]([a-z0-9-]+)['"`]/g)) els.add(m[1]);
  for (const m of t.matchAll(/new CustomEvent\(\s*['"`]([a-z0-9:_.-]+)['"`]/gi)) evs.add(m[1]);
  for (const m of t.matchAll(/dispatchEvent\(\s*new\s+(?:Custom)?Event\(\s*['"`]([a-z0-9:_.-]+)['"`]/gi)) evs.add(m[1]);
}
A.customElements = [...els].sort();
A.customEvents = [...evs].sort();
A.sidoniaElementClash = A.customElements.filter((n) => n.startsWith('sidonia-'));

/* ---------- 9. layout ---------- */
const layout = readFileSync(join(root, 'layout/theme.liquid'), 'utf8');
A.layout = {
  hasHeadClose: /<\/head>/i.test(layout),
  hasBodyClose: /<\/body>/i.test(layout),
  sectionsTags: [...layout.matchAll(/\{%-?\s*sections\s+'([^']+)'/g)].map((m) => m[1]),
  mainTag: (layout.match(/<main[^>]*>/i) || [''])[0].slice(0, 160),
  bodyTag: (layout.match(/<body[^>]*>/i) || [''])[0].slice(0, 200),
  licenseHeader: (layout.match(/\/\*[\s\S]{0,600}?\*\//) || [''])[0].split('\n').slice(0, 8).join('\n'),
  alreadyIntegrated: /render\s+'sidonia-head'/.test(layout)
};

/* ---------- 10. bloques de app, personalizaciones, conflictos ---------- */
A.appBlocks = [];
for (const f of by('sections').filter((x) => x.endsWith('.liquid'))) {
  const s = extractSchema(readFileSync(join(root, f), 'utf8'));
  if (s && Array.isArray(s.blocks) && s.blocks.some((b) => b.type === '@app')) A.appBlocks.push(f);
}
A.customLooking = files.filter((f) => /custom|sidonia|^snippets\/.*-app\.liquid$/i.test(f));
try {
  const data = readJsonLoose(join(root, 'config/settings_data.json'));
  A.settingsData = { current: typeof data.current === 'string' ? data.current : '(objeto)', presets: Object.keys(data.presets || {}), hasCurrentObject: typeof data.current === 'object' };
} catch (e) {
  A.settingsData = { error: e.message };
}
const kitRoot = new URL('../kit/', import.meta.url).pathname;
const kitFiles = walk(kitRoot).filter((f) => !f.startsWith('config/') && !f.startsWith('locales/'));
A.conflicts = kitFiles.filter((f) => files.includes(f));
A.licenseFiles = files.filter((f) => /licen|notice|copyright/i.test(f));

/* ---------- informe ---------- */
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'auditoria.json'), JSON.stringify(A, null, 2));
const hits = (list) => (list && list.length ? list.map((h) => `- \`${h.file}:${h.line}\` — ${h.text.replace(/`/g, "'")}`).join('\n') : '- (sin coincidencias)');
const md = `# Auditoría de la copia de Impact

> Generada el ${A.generated} por \`integration/audit-impact.mjs\` sobre \`${input}\`.
> Documento LOCAL (carpeta \`impact/\`, ignorada por git): puede contener fragmentos del código licenciado de Impact.

## 1. Identidad

| Dato | Valor |
|---|---|
| Tema | ${A.theme.name} |
| Versión | ${A.theme.version} |
| Autor | ${A.theme.author} |
| ¿Es Impact? | ${A.isImpact ? 'sí' : '**NO — revisa el archivo antes de seguir**'} |
| Ya integrado | ${A.layout.alreadyIntegrated ? 'sí (hay sidonia-head en el layout)' : 'no'} |

Cabecera de licencia del layout (resumen):
\`\`\`
${A.layout.licenseHeader || '(no encontrada)'}
\`\`\`
Archivos de licencia/aviso: ${A.licenseFiles.join(', ') || '(ninguno)'}

## 2. Estructura

${Object.entries(A.structure).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
- Idioma por defecto: \`${A.defaultLocale}\` · locales: ${A.locales.map((l) => '`' + l + '`').join(', ')}
- Grupos de secciones: ${A.groups.map((g) => `\`${g.file}\` (${g.type || '?'}: ${(g.sections || []).join(', ')})`).join(' · ')}
- \`<main>\`: \`${A.layout.mainTag}\`
- \`<body>\`: \`${A.layout.bodyTag}\`

## 3. Cabecera y cabecera transparente

- Secciones de cabecera: ${A.header.sectionFiles.map((f) => '`' + f + '`').join(', ') || '(no encontradas)'}
- Ajustes de menú: ${A.menus.map((m) => '`' + m.id + '`').join(', ') || '(ninguno)'}
- Ajustes de logo/favicon: ${A.logoSettings.map((s) => '`' + s.id + '`').join(', ') || '(ninguno)'}

Ajustes de schema con «transparent»:
${A.transparent.schemaSettings.map((s) => `- \`${s.file}\` → \`${s.id}\` (${s.type}) «${s.label}»`).join('\n') || '- (ninguno)'}

Liquid:
${hits(A.transparent.liquid)}

CSS:
${hits(A.transparent.css)}

JS:
${hits(A.transparent.js)}

Pintado de enlaces del menú (para insertar sidonia-menu-dot):
${hits(A.menuLinkRendering)}

## 4. Catálogo, tarjeta y filtros

- index: ${JSON.stringify(A.catalog.index)} · collection: ${JSON.stringify(A.catalog.collection)} · search: ${JSON.stringify(A.catalog.search)} · product: ${JSON.stringify(A.catalog.product)} · 404: ${JSON.stringify(A.catalog.notfound)}
- Snippets de tarjeta: ${A.cardSnippets.map((f) => '`' + f + '`').join(', ') || '(ninguno)'}

Uso de tarjetas:
${hits(A.cardUsage)}

Filtros (results.filters):
${hits(A.facets)}

## 5. SEO (riesgo de precio 0 u oferta comprable)

JSON-LD:
${hits(A.jsonld)}

Precio/ofertas en datos estructurados:
${hits(A.jsonldProductPrice)}

Open Graph de precio:
${hits(A.ogPrice)}

## 6. Compra (debe quedar oculta en las fichas Sidonia)

Formularios de producto:
${hits(A.cart.productForms)}

JS de carrito:
${hits(A.cart.cartAddJs)}

Compra rápida:
${hits(A.cart.quickBuy)}

Botones de pago dinámicos:
${hits(A.cart.dynamicCheckout)}

Secciones de carrito/cajón: ${A.cart.sections.map((f) => '`' + f + '`').join(', ') || '(ninguna)'}

Búsqueda predictiva:
${hits(A.predictive)}

## 7. Colores, tipografías y variables

- Ajustes de color (${A.colorSettings.length}): ${A.colorSettings.map((c) => `\`${c.id}\` (${c.type})`).join(', ')}
- Tipografías: ${A.fontSettings.map((f) => `\`${f.id}\` = ${f.default}`).join(', ') || '(ninguna)'}
- Fuentes de variables CSS: ${A.cssVariableSources.map((f) => '`' + f + '`').join(', ')}
- Variables (primeras ${A.cssVariables.length}): ${A.cssVariables.map((v) => '`' + v + '`').join(' ')}

## 8. JavaScript de Impact

- Custom elements (${A.customElements.length}): ${A.customElements.map((e) => '`' + e + '`').join(' ')}
- Eventos propios (${A.customEvents.length}): ${A.customEvents.map((e) => '`' + e + '`').join(' ')}
- Choques con sidonia-*: ${A.sidoniaElementClash.join(', ') || 'ninguno'}

## 9. Bloques de app, personalizaciones y conflictos

- Secciones con bloques de app: ${A.appBlocks.map((f) => '`' + f + '`').join(', ') || '(ninguna)'}
- Archivos que parecen personalizaciones: ${A.customLooking.map((f) => '`' + f + '`').join(', ') || '(ninguno)'}
- settings_data.json: ${JSON.stringify(A.settingsData)}
- Archivos del kit que YA existen en Impact (conflicto): ${A.conflicts.map((f) => '`' + f + '`').join(', ') || 'ninguno'}

## 10. Decisiones que esta auditoría permite tomar (ver docs/02-instalacion.md §4)

1. **Cabecera transparente**: reutilizar el mecanismo nativo listado en §3 para \`sidonia-hero\` y \`sidonia-page-header\` (ruta A) o el contrato \`data-sidonia-header\` del kit (ruta B).
2. **Acciones de cabecera**: dónde insertar \`sidonia-header-actions\` y \`sidonia-menu-dot\` (líneas de §3).
3. **Catálogo**: comparar los filtros de Impact (§4) con los requisitos del briefing §10; si no los cumplen, usar \`sidonia-catalog\` en collection.*.json y search.json.
4. **SEO**: condicionar el JSON-LD y og:price de §5 para que no se emitan en plantillas product.garage/harbor/estate.
5. **Búsqueda predictiva**: sustituir el precio de variante por \`sidonia-price\` para piezas Sidonia (§6).
6. **Colores**: fijar el fondo piedra en los ajustes de color de §7 y enlazar los tokens \`--sidonia-*\` con las variables reales.
`;
writeFileSync(join(outDir, 'AUDITORIA.md'), md);
console.log(`Auditoría: ${A.theme.name} ${A.theme.version} → ${join(outDir, 'AUDITORIA.md')} y auditoria.json`);
if (!A.isImpact) console.log('AVISO: el tema no se identifica como Impact.');
if (A.conflicts.length) console.log(`Conflictos con el kit: ${A.conflicts.length} (ver §9)`);
