#!/usr/bin/env node
// Comprobación completa del kit Sidonia, sin red. La usan los desarrolladores antes de cada cambio y
// integration/build-zip.mjs antes de empaquetar (si hay errores, no se crea el ZIP).
//
//   node tools/check-kit.mjs                    compone anfitrión de pruebas + kit y lo revisa todo
//   node tools/check-kit.mjs --theme impact/sidonia
//                                               revisa un tema YA integrado (Impact + kit); solo informa
//                                               de errores en archivos del kit (Impact no es nuestro)
//   --quiet                                     solo imprime errores
//
// Qué revisa:
//   1. Liquid (tools/lint/liquid.mjs): etiquetas y filtros reales de Shopify, sin filtros en parámetros de
//      render/for/if, snippets y claves de traducción existentes, ámbito de render.
//   2. Esquemas (tools/lint/schema.mjs): tipos de ajuste, rangos, nombres ≤ 25, plantillas JSON y grupos.
//   3. Coherencia del kit: ajustes settings.sidonia_* declarados, metacampos sidonia.* definidos en
//      data/metafields.json, textos de JavaScript presentes en sidonia-head, sintaxis de JavaScript.
//   4. Aislamiento: todo selector CSS lleva «sidonia»; :root solo define variables --sidonia-*.
//   5. Reglas del encargo: nombres públicos Coches/Barcos/Casas y comunidades GARAGE/HARBOR/ESTATE,
//      sin subida de archivos, sin secretos, sin datos de formulario en almacenamiento local,
//      sin promesas prohibidas en los textos, límites de Search & Discovery, solo reglas EQUALS,
//      contraste de la paleta.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE, PAIRS } from './palette.mjs';
import { ratio } from './contrast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kit');
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const themeArg = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : null;
const errors = [];
const notes = [];
const err = (where, msg) => errors.push(`${where}  ${msg}`);
const say = (m) => {
  if (!quiet) console.log(m);
};
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])) : []);
const read = (p) => readFileSync(p, 'utf8');
const loose = (p) => JSON.parse(read(p).replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/, ''));

/* ---------------------------------------------------------------- 0. tema a revisar */
let theme = themeArg;
let only = null;
if (!theme) {
  theme = join(ROOT, 'build', 'check-theme');
  try {
    execFileSync('node', [join(ROOT, 'integration', 'apply-kit.mjs'), '--base', join(ROOT, 'harness', 'host'), '--out', theme, '--replace', 'index.json,search.json,404.json', '--quiet'], { stdio: 'pipe' });
  } catch (e) {
    console.error('apply-kit falló al componer el tema de comprobación:\n' + String(e.stderr || e.stdout || e.message));
    process.exit(1);
  }
  say(`Tema compuesto: anfitrión de pruebas + kit → ${relative(ROOT, theme)}`);
} else {
  only = '(^|/)sidonia-|^templates/(index|search|404)\\.json|^templates/(collection|product|page)\\.(sidonia|garage|harbor|estate|sold|sell|how-it-works|about|favorites|sidonia-contact|wanted|sidonia-card)\\.';
  say(`Tema revisado: ${theme} (solo se informa de archivos del kit)`);
}

/* ---------------------------------------------------------------- 1-2. linters */
for (const [name, file] of [
  ['Liquid', 'liquid.mjs'],
  ['Esquemas', 'schema.mjs']
]) {
  let out = '';
  let failed = false;
  try {
    out = execFileSync('node', [join(ROOT, 'tools', 'lint', file)], { encoding: 'utf8', env: { ...process.env, SIDONIA_LINT_ROOT: theme, ...(only ? { SIDONIA_LINT_ONLY: only } : {}) } });
  } catch (e) {
    out = String(e.stdout || '');
    failed = true;
  }
  const lines = out.split('\n');
  const errStart = lines.findIndex((l) => /^Errores \(/.test(l));
  const found = errStart >= 0 ? lines.slice(errStart + 1).filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim()) : [];
  found.forEach((l) => err(`[${name}]`, l));
  if (failed && !found.length) err(`[${name}]`, 'el linter terminó con error:\n' + out.slice(-1500));
  say(`${name}: ${found.length ? found.length + ' errores' : 'sin errores'}`);
}

/* ---------------------------------------------------------------- 3. coherencia del kit */
const kitFiles = walk(KIT);
const liquidFiles = kitFiles.filter((f) => f.endsWith('.liquid'));
const jsFiles = kitFiles.filter((f) => f.endsWith('.js'));
const cssFiles = kitFiles.filter((f) => f.endsWith('.css'));
const rel = (f) => relative(ROOT, f);

const schemaGroups = JSON.parse(read(join(KIT, 'config', 'settings_schema.sidonia.json')));
const settingIds = new Set(schemaGroups.flatMap((g) => g.settings.map((s) => s.id).filter(Boolean)));
for (const id of settingIds) if (!id.startsWith('sidonia_')) err('kit/config/settings_schema.sidonia.json', `ajuste sin prefijo sidonia_: ${id}`);
for (const f of [...liquidFiles, ...jsFiles]) {
  const src = read(f);
  for (const m of src.matchAll(/settings\.(sidonia_[a-z0-9_]+)/g)) if (!settingIds.has(m[1])) err(rel(f), `ajuste global inexistente: ${m[1]}`);
}
// Ajustes compuestos por clave de categoría: settings[<'sidonia_' | append: key | append: '_name'>]
const DIV_KEYS = ['garage', 'harbor', 'estate'];
for (const suffix of ['name', 'community', 'color', 'collection', 'tagline', 'image', 'email', 'whatsapp']) {
  for (const k of DIV_KEYS) if (!settingIds.has(`sidonia_${k}_${suffix}`)) err('kit/config/settings_schema.sidonia.json', `falta el ajuste sidonia_${k}_${suffix}`);
}

const model = JSON.parse(read(join(ROOT, 'data', 'metafields.json')));
const mfKeys = new Set(model.product_metafields.map((m) => m.key));
for (const f of liquidFiles) {
  const src = read(f);
  for (const m of src.matchAll(/metafields\.sidonia\.([a-z0-9_]+)/g)) if (!mfKeys.has(m[1])) err(rel(f), `metacampo sidonia.${m[1]} no definido en data/metafields.json`);
  if (/assign\s+mf\s*=\s*product\.metafields\.sidonia\b/.test(src)) {
    for (const m of src.matchAll(/\bmf\.([a-z0-9_]+)/g)) if (!mfKeys.has(m[1])) err(rel(f), `metacampo sidonia.${m[1]} (vía mf) no definido en data/metafields.json`);
  }
}
for (const m of model.product_metafields) {
  if (!/^[a-z0-9_]+$/.test(m.key)) err('data/metafields.json', `clave no válida: ${m.key}`);
  if (m.filter && m.type.startsWith('number_')) err('data/metafields.json', `${m.key}: un numérico como filtro se muestra por valor exacto; usa una banda de texto`);
}
const filterCount = model.filters.order.length;
if (filterCount > 25) err('data/metafields.json', `${filterCount} filtros (Search & Discovery admite 25 por tienda)`);
const mfFilters = model.product_metafields.filter((m) => m.filter).length;
if (mfFilters > 50) err('data/metafields.json', `${mfFilters} metacampos como filtro (máximo 50)`);
for (const k of model.filters.order) if (!['price', 'availability'].includes(k) && !mfKeys.has(k)) err('data/metafields.json', `filtro sin metacampo: ${k}`);
for (const c of model.collections) {
  for (const [k] of c.rules) {
    const def = model.product_metafields.find((m) => m.key === k);
    if (!def) err('data/metafields.json', `colección ${c.handle}: regla sobre metacampo inexistente ${k}`);
    else if (!def.smart) err('data/metafields.json', `colección ${c.handle}: ${k} no está marcado como usable en colecciones automáticas`);
  }
  if (c.relation && c.relation !== 'EQUALS') err('data/metafields.json', `colección ${c.handle}: solo EQUALS es válido para metacampos de texto de una línea`);
}
const cat = model.product_metafields.find((m) => m.key === 'category');
if (!cat || JSON.stringify(cat.choices) !== JSON.stringify(['Coches', 'Barcos', 'Casas'])) err('data/metafields.json', 'la categoría debe tener exactamente las opciones Coches, Barcos, Casas');

// Textos de JavaScript: toda clave S.t('x') debe existir en el bloque «strings» de sidonia-head
const head = read(join(KIT, 'snippets', 'sidonia-head.liquid'));
const stringsBlock = (head.match(/"strings":\s*\{([\s\S]*?)\n\s{2}\}/) || [])[1] || '';
const jsKeys = new Set([...stringsBlock.matchAll(/"([a-zA-Z0-9_]+)":/g)].map((m) => m[1]));
for (const f of jsFiles) {
  for (const m of read(f).matchAll(/S\.t\('([a-zA-Z0-9_]+)'/g)) if (!jsKeys.has(m[1])) err(rel(f), `texto de JavaScript sin definir en sidonia-head: ${m[1]}`);
  try {
    execFileSync('node', ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    err(rel(f), 'error de sintaxis JavaScript: ' + String(e.stderr).split('\n').slice(0, 5).join(' '));
  }
}

/* ---------------------------------------------------------------- 4. aislamiento CSS */
// Divide una lista de selectores por las comas de primer nivel (no las de :is(), :not(), :has()…)
function splitTop(sel) {
  const parts = [];
  let cur = '';
  let d = 0;
  for (const ch of sel) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
}
for (const f of cssFiles) {
  const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let buf = '';
  const stack = [];
  for (const ch of src) {
    if (ch === '{') {
      const sel = buf.trim();
      buf = '';
      const inKeyframes = stack.some((s) => s.startsWith('@keyframes'));
      if (!sel.startsWith('@') && !inKeyframes) {
        for (const part of splitTop(sel)) {
          if (part === ':root') continue;
          if (!/sidonia/.test(part)) err(rel(f), `selector sin prefijo sidonia (podría afectar a Impact): «${part}»`);
        }
      }
      stack.push(sel);
      depth++;
    } else if (ch === '}') {
      const sel = stack.pop() || '';
      if (sel === ':root') {
        /* comprobado abajo */
      }
      depth--;
      buf = '';
      if (depth < 0) err(rel(f), 'llaves desequilibradas');
    } else if (ch === ';' && depth > 0) {
      const decl = buf.trim();
      if (stack[stack.length - 1] === ':root' && decl && !decl.startsWith('--sidonia-')) err(rel(f), `:root define algo que no es una variable --sidonia-*: «${decl}»`);
      buf = '';
    } else buf += ch;
  }
  if (depth !== 0) err(rel(f), 'llaves desequilibradas al final del archivo');
}

/* ---------------------------------------------------------------- 5. reglas del encargo */
const locale = JSON.parse(read(join(KIT, 'locales', 'es.json')));
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, String(v)]]));
const localeEntries = flat(locale);
const defaults = new Map(schemaGroups.flatMap((g) => g.settings.filter((s) => s.id).map((s) => [s.id, s.default])));
const expect = {
  sidonia_garage_name: 'Coches',
  sidonia_harbor_name: 'Barcos',
  sidonia_estate_name: 'Casas',
  sidonia_garage_community: 'SIDONIA GARAGE',
  sidonia_harbor_community: 'SIDONIA HARBOR',
  sidonia_estate_community: 'SIDONIA ESTATE'
};
for (const [id, v] of Object.entries(expect)) if (defaults.get(id) !== v) err('kit/config/settings_schema.sidonia.json', `${id} debe valer «${v}» por defecto (hay «${defaults.get(id)}»)`);
const colorExpect = { sidonia_garage_color: PALETTE.coches, sidonia_harbor_color: PALETTE.barcos, sidonia_estate_color: PALETTE.casas };
for (const [id, v] of Object.entries(colorExpect)) if (String(defaults.get(id) || '').toLowerCase() !== v.toLowerCase()) err('kit/config/settings_schema.sidonia.json', `${id} por defecto debe ser ${v}`);

const PROMISES = [
  [/\b24\s?h(oras)?\b/i, 'promesa de plazo de respuesta'],
  [/en menos de \d/i, 'promesa de plazo'],
  [/garantiz/i, 'garantía'],
  [/te avisaremos|te avisamos|recibir[aá]s (una )?alerta|activa(r)? (una )?alerta/i, 'alertas o avisos no implementados'],
  [/tasaci[oó]n gratuita|valoraci[oó]n gratuita|te tasamos/i, 'tasación o valoración prometida'],
  [/inspecci[oó]n (incluida|gratuita)|inspeccionamos/i, 'inspección prometida'],
  [/vendemos en \d|venta asegurada|vendido en \d/i, 'resultado de venta prometido'],
  [/harbour/i, 'HARBOR se escribe sin U']
];
for (const [k, v] of localeEntries) for (const [re, why] of PROMISES) if (re.test(v)) err(`kit/locales/es.json › ${k}`, `${why}: «${v.slice(0, 90)}»`);
for (const f of liquidFiles) {
  const src = read(f);
  const schema = (src.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema/) || [])[1] || '';
  for (const [re, why] of PROMISES) if (re.test(schema)) err(rel(f), `${why} en los textos por defecto del esquema`);
}
const EN_NAMES = /"(Cars|Boats|Homes|Houses|Real estate|Yachts)"/;
for (const [k, v] of localeEntries) if (EN_NAMES.test(`"${v}"`)) err(`kit/locales/es.json › ${k}`, `nombre de categoría en inglés: ${v}`);

for (const f of kitFiles.filter((x) => /\.(liquid|js)$/.test(x))) {
  const src = read(f);
  if (/type=["']?file\b/i.test(src) || /type:\s*['"]file['"]/.test(src)) err(rel(f), 'subida de archivos (input type=file) no permitida');
  if (/shpat_|shpss_|shpca_|X-Shopify-Access-Token|admin\/api\//i.test(src)) err(rel(f), 'posible secreto o llamada a la Admin API en código público');
}
const formsJs = read(join(KIT, 'assets', 'sidonia-forms.js'));
if (/localStorage|sessionStorage|indexedDB/.test(formsJs)) err('kit/assets/sidonia-forms.js', 'los datos de formularios no se guardan en el navegador');
const core = read(join(KIT, 'assets', 'sidonia-core.js'));
const allowed = (core.match(/ALLOWED\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
for (const bad of ['email', 'phone', 'name', 'message', 'body', 'telefono', 'nombre']) if (new RegExp(`'${bad}'`).test(allowed)) err('kit/assets/sidonia-core.js', `la analítica no puede admitir el parámetro «${bad}»`);

/* contraste */
for (const [fg, bg, need, use] of PAIRS) {
  const r = ratio(PALETTE[fg], PALETTE[bg]);
  if (r < need) err('tools/palette.mjs', `contraste ${fg}/${bg} ${r.toFixed(2)}:1 < ${need}:1 (${use})`);
}

/* plantillas generadas al día */
try {
  execFileSync('node', [join(ROOT, 'tools', 'build-templates.mjs'), '--check'], { stdio: 'pipe' });
} catch (e) {
  err('kit/templates', 'plantillas distintas de tools/build-templates.mjs (si el cambio es intencionado, llévalo al generador y regenera):\n    ' + String(e.stdout || e.message).trim().replace(/\n/g, '\n    '));
}

/* ---------------------------------------------------------------- resultado */
say(`Kit: ${liquidFiles.length} Liquid · ${jsFiles.length} JS · ${cssFiles.length} CSS · ${settingIds.size} ajustes · ${mfKeys.size} metacampos · ${filterCount} filtros`);
notes.forEach((n) => say('Nota: ' + n));
if (errors.length) {
  console.log(`\nErrores (${errors.length})`);
  errors.forEach((e) => console.log('  ' + e));
  console.log('\nRESULTADO: CON ERRORES');
  process.exit(1);
}
say('\nRESULTADO: SIN ERRORES');
