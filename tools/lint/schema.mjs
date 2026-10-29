#!/usr/bin/env node
// Validador ESTRICTO de esquemas de Shopify (propio, sin red): schemas de secciones, config/settings_schema.json,
// plantillas JSON y grupos de secciones. Aplica las reglas documentadas de Shopify para que la subida y el editor no fallen.
// Origen: validador del prototipo anterior (legacy/), adaptado para revisar el tema compuesto (anfitrión o Impact + kit).
// Uso: node tools/check-kit.mjs (lo invoca) o SIDONIA_LINT_ROOT=<tema> node tools/lint/schema.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raíz del tema a revisar (por defecto, el tema de pruebas compuesto) y filtro de archivos a informar.
const root = process.env.SIDONIA_LINT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'build', 'harness-theme');
const ONLY = process.env.SIDONIA_LINT_ONLY ? new RegExp(process.env.SIDONIA_LINT_ONLY) : null;
const errors = [];
const err = (where, msg) => (!ONLY || ONLY.test(where)) && errors.push(`${where}  ${msg}`);
const loose = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/, ''));

const INPUT_TYPES = new Set('article blog checkbox collection collection_list color color_background color_scheme color_scheme_group font_picker html image_picker inline_richtext link_list liquid metaobject metaobject_list number page product product_list radio range richtext select text text_alignment textarea url video video_url'.split(' '));
const SIDEBAR = new Set(['header', 'paragraph']);
const TAGS = new Set(['article', 'aside', 'div', 'footer', 'header', 'section']);
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FONTS_OK = /^[a-z0-9_]+_[ni][1-9]$/;

function validateSetting(where, st, ids) {
  if (typeof st !== 'object' || !st) return err(where, 'setting no es un objeto');
  const t = st.type;
  if (!INPUT_TYPES.has(t) && !SIDEBAR.has(t)) return err(where, `tipo de ajuste desconocido: ${t}`);
  if (SIDEBAR.has(t)) {
    if (t === 'header' && !st.content) err(where, 'header sin content');
    if (t === 'paragraph' && !st.content) err(where, 'paragraph sin content');
    return;
  }
  if (!st.id || typeof st.id !== 'string') return err(where, `ajuste ${t} sin id`);
  if (!/^[a-zA-Z0-9_]+$/.test(st.id)) err(where, `id inválido «${st.id}» (solo letras, números y _)`);
  if (ids.has(st.id)) err(where, `id duplicado: ${st.id}`);
  ids.add(st.id);
  const w = `${where} › ${st.id}`;
  if (!st.label && t !== 'liquid') err(w, 'falta label');
  switch (t) {
    case 'select':
    case 'radio': {
      if (!Array.isArray(st.options) || st.options.length < 2) err(w, 'select/radio necesita al menos 2 opciones');
      else {
        const vals = st.options.map((o) => o.value);
        st.options.forEach((o) => {
          if (typeof o.value !== 'string' || o.value === '') err(w, `opción con value vacío o no texto: ${JSON.stringify(o)}`);
          if (!o.label) err(w, `opción sin label: ${o.value}`);
        });
        if (new Set(vals).size !== vals.length) err(w, 'opciones con value repetido');
        if ('default' in st && !vals.includes(st.default)) err(w, `default «${st.default}» no está entre las opciones`);
      }
      break;
    }
    case 'range': {
      if (!('step' in st)) st = { ...st, step: 1 }; // step es opcional en Shopify (por defecto 1)
      for (const k of ['min', 'max', 'step', 'default']) if (typeof st[k] !== 'number') err(w, `range necesita ${k} numérico`);
      if (typeof st.min === 'number' && typeof st.max === 'number' && typeof st.step === 'number') {
        const steps = (st.max - st.min) / st.step;
        if (steps > 101) err(w, `range con ${steps} pasos (máximo 101)`);
        if (!Number.isInteger(+steps.toFixed(6))) err(w, 'max-min no es múltiplo del paso');
        if (typeof st.default === 'number') {
          if (st.default < st.min || st.default > st.max) err(w, `default ${st.default} fuera de rango`);
          if (!Number.isInteger(+((st.default - st.min) / st.step).toFixed(6))) err(w, `default ${st.default} no coincide con el paso ${st.step} desde ${st.min}`);
        }
      }
      break;
    }
    case 'checkbox':
      if ('default' in st && typeof st.default !== 'boolean') err(w, 'default de checkbox debe ser true/false');
      break;
    case 'number':
      if ('default' in st && typeof st.default !== 'number') err(w, 'default de number debe ser numérico');
      break;
    case 'color':
    case 'color_background':
      if ('default' in st && st.type === 'color' && !HEX.test(st.default)) err(w, `color por defecto no válido: ${st.default}`);
      break;
    case 'font_picker':
      if (!st.default) err(w, 'font_picker necesita default');
      else if (!FONTS_OK.test(st.default)) err(w, `handle de fuente sospechoso: ${st.default}`);
      break;
    case 'image_picker':
    case 'video':
    case 'collection':
    case 'product':
    case 'blog':
    case 'article':
    case 'page':
      if ('default' in st && t !== 'collection' && t !== 'product' && t !== 'blog' && t !== 'page') err(w, `${t} no admite default`);
      break;
    case 'video_url':
      if (!Array.isArray(st.accept) || !st.accept.length) err(w, 'video_url necesita accept');
      break;
    case 'product_list':
    case 'collection_list':
      if ('limit' in st && !(st.limit >= 1 && st.limit <= 50)) err(w, 'limit entre 1 y 50');
      break;
    case 'url':
      // Shopify rechaza el archivo entero si el valor por defecto de un url no es /collections o /collections/all
      if ('default' in st && !['/collections', '/collections/all'].includes(st.default)) err(w, `url por defecto solo puede ser /collections o /collections/all (hay ${JSON.stringify(st.default)})`);
      break;
    case 'richtext':
      if ('default' in st && !/^\s*<(p|ul|ol)\b/.test(st.default)) err(w, 'richtext por defecto debe empezar por <p>, <ul> u <ol>');
      break;
    case 'text':
    case 'textarea':
    case 'url':
      if ('default' in st && typeof st.default !== 'string') err(w, 'default debe ser texto');
      if (t === 'text' && typeof st.default === 'string' && st.default.length > 255) err(w, 'default de text > 255 caracteres');
      break;
    case 'link_list':
      if ('default' in st && !['main-menu', 'footer'].includes(st.default)) err(w, 'default de link_list: main-menu o footer');
      break;
  }
}

function validateSettings(where, arr) {
  const ids = new Set();
  if (!Array.isArray(arr)) return err(where, 'settings no es una lista');
  arr.forEach((s) => validateSetting(where, s, ids));
  return ids;
}

/* ------------------------------------------------------------ secciones */
const sections = {};
for (const f of readdirSync(join(root, 'sections')).filter((n) => n.endsWith('.liquid'))) {
  const name = basename(f, '.liquid');
  const src = readFileSync(join(root, 'sections', f), 'utf8');
  const m = src.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  const where = `sections/${f}`;
  if (!m) {
    sections[name] = { schema: null };
    continue;
  }
  let schema;
  try {
    schema = JSON.parse(m[1]);
  } catch (e) {
    err(where, 'schema no es JSON válido: ' + e.message);
    continue;
  }
  if (schema.name && schema.name.length > 25) err(where, `name de más de 25 caracteres: «${schema.name}» (${schema.name.length})`);
  if (!schema.name) err(where, 'falta name');
  if ('tag' in schema && !TAGS.has(schema.tag)) err(where, `tag no válido: ${schema.tag}`);
  if ('limit' in schema && ![1, 2].includes(schema.limit)) err(where, 'limit solo 1 o 2');
  if ('max_blocks' in schema && !(schema.max_blocks >= 1 && schema.max_blocks <= 50)) err(where, 'max_blocks entre 1 y 50');
  const ids = schema.settings ? validateSettings(where, schema.settings) : new Set();
  const blockTypes = {};
  (schema.blocks || []).forEach((b) => {
    if (b.type === '@app') return (blockTypes['@app'] = {});
    if (!b.type || !b.name) err(where, `bloque sin type o name: ${JSON.stringify(b).slice(0, 60)}`);
    if (blockTypes[b.type]) err(where, `bloque repetido: ${b.type}`);
    if (b.name && b.name.length > 25) err(where, `name de bloque > 25 caracteres: «${b.name}»`);
    blockTypes[b.type] = { ids: validateSettings(`${where} › bloque ${b.type}`, b.settings || []), schema: b };
  });
  (schema.presets || []).forEach((p) => {
    if (!p.name) err(where, 'preset sin name');
    if (p.settings) for (const k of Object.keys(p.settings)) if (!ids.has(k)) err(where, `preset: ajuste inexistente ${k}`);
    (p.blocks || []).forEach((b) => {
      if (!(b.type in blockTypes)) err(where, `preset: tipo de bloque inexistente ${b.type}`);
    });
    if (p.blocks && schema.max_blocks && p.blocks.length > schema.max_blocks) err(where, 'preset con más bloques que max_blocks');
  });
  if (schema.default) {
    (schema.default.blocks || []).forEach((b) => {
      if (!(b.type in blockTypes)) err(where, `default: tipo de bloque inexistente ${b.type}`);
    });
  }
  if (schema.enabled_on && schema.disabled_on) err(where, 'enabled_on y disabled_on a la vez');
  sections[name] = { schema, ids, blockTypes };
}

/* ------------------------------------------------------------ settings_schema.json */
const ssPath = join(root, 'config', 'settings_schema.json');
const ss = loose(ssPath);
const allIds = new Set();
if (!Array.isArray(ss)) err('config/settings_schema.json', 'debe ser una lista de grupos');
else {
  const info = ss.find((g) => g.name === 'theme_info');
  if (!info) err('config/settings_schema.json', 'falta el grupo theme_info');
  else for (const k of ['theme_name', 'theme_version', 'theme_author']) if (!info[k]) err('config/settings_schema.json', `theme_info sin ${k}`);
  ss.filter((g) => g.name !== 'theme_info').forEach((g) => {
    if (!g.name) err('config/settings_schema.json', 'grupo sin name');
    const ids = validateSettings(`settings_schema › ${g.name}`, g.settings || []) || new Set();
    ids.forEach((id) => {
      if (allIds.has(id)) err('config/settings_schema.json', `id repetido entre grupos: ${id}`);
      allIds.add(id);
    });
  });
}
try {
  const sd = loose(join(root, 'config', 'settings_data.json'));
  if (!sd.current && !sd.presets) err('config/settings_data.json', 'sin «current»');
} catch (e) {
  err('config/settings_data.json', 'JSON no válido: ' + e.message);
}

/* ------------------------------------------------------------ plantillas JSON y grupos */
function checkValue(where, st, v) {
  if (!st) return;
  switch (st.type) {
    case 'checkbox':
      if (typeof v !== 'boolean') err(where, `esperaba booleano, hay ${JSON.stringify(v)}`);
      break;
    case 'select':
    case 'radio':
      if (!st.options.map((o) => o.value).includes(v)) err(where, `valor «${v}» no está entre las opciones (${st.options.map((o) => o.value).join(', ')})`);
      break;
    case 'range':
      if (typeof v !== 'number' || v < st.min || v > st.max) err(where, `valor ${v} fuera de rango`);
      break;
    case 'number':
      if (typeof v !== 'number') err(where, 'esperaba número');
      break;
    case 'color':
      // Shopify exporta "" (sin color) y rgba(...) (transparente) además de hexadecimales
      if (v !== '' && !HEX.test(v) && !/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(v)) err(where, `color no válido ${v}`);
      break;
    case 'richtext':
      if (v !== '' && !/^\s*<(p|ul|ol|h[1-6])\b/.test(v)) err(where, 'richtext debe empezar por <p>');
      break;
    case 'text':
    case 'textarea':
      if (typeof v !== 'string') err(where, 'esperaba texto');
      break;
    case 'url':
      if (typeof v !== 'string') err(where, 'esperaba texto (url)');
      else if (v && !/^(\/|#|https?:|mailto:|tel:|shopify:)/.test(v)) err(where, `url no válida: ${v}`);
      break;
  }
}

function checkSectionInstance(where, id, inst, allowGroup) {
  const def = sections[inst.type];
  if (!def) return err(where, `la sección ${id} usa un tipo inexistente: ${inst.type}`);
  if (!def.schema) return;
  const byId = Object.fromEntries((def.schema.settings || []).map((s) => [s.id, s]));
  for (const [k, v] of Object.entries(inst.settings || {})) {
    if (!byId[k]) err(where, `${id}: ajuste inexistente «${k}» en ${inst.type}`);
    else checkValue(`${where} › ${id}.${k}`, byId[k], v);
  }
  const bt = def.blockTypes || {};
  const bids = Object.keys(inst.blocks || {});
  (inst.block_order || bids).forEach((b) => {
    if (!(b in (inst.blocks || {}))) err(where, `${id}: block_order referencia ${b} inexistente`);
  });
  bids.forEach((b) => {
    const blk = inst.blocks[b];
    if (String(blk.type).startsWith('shopify://apps/') && (bt['@app'] || inst.type === 'apps')) return; // bloque de app
    if (!bt[blk.type]) return err(where, `${id}: el bloque ${b} usa un tipo que ${inst.type} no define: ${blk.type}`);
    const bs = Object.fromEntries(((bt[blk.type].schema && bt[blk.type].schema.settings) || []).map((s) => [s.id, s]));
    for (const [k, v] of Object.entries(blk.settings || {})) {
      if (!bs[k]) err(where, `${id}.${b}: ajuste inexistente «${k}»`);
      else checkValue(`${where} › ${id}.${b}.${k}`, bs[k], v);
    }
  });
  if (def.schema.max_blocks && bids.length > def.schema.max_blocks) err(where, `${id}: ${bids.length} bloques (máximo ${def.schema.max_blocks})`);
  if (def.schema.limit) {
    /* límite por plantilla: se cuenta fuera */
  }
}

const tplDir = join(root, 'templates');
for (const f of readdirSync(tplDir).filter((n) => n.endsWith('.json'))) {
  const where = `templates/${f}`;
  let t;
  try {
    t = loose(join(tplDir, f));
  } catch (e) {
    err(where, 'JSON no válido: ' + e.message);
    continue;
  }
  if (!t.sections || typeof t.sections !== 'object') err(where, 'falta «sections»');
  if (!Array.isArray(t.order)) err(where, 'falta «order»');
  else {
    t.order.forEach((id) => {
      if (!(id in (t.sections || {}))) err(where, `order referencia ${id} inexistente`);
    });
    Object.keys(t.sections || {}).forEach((id) => {
      if (!t.order.includes(id)) err(where, `la sección ${id} no está en order`);
    });
  }
  if (Object.keys(t.sections || {}).length > 25) err(where, 'más de 25 secciones');
  const counts = {};
  for (const [id, inst] of Object.entries(t.sections || {})) {
    checkSectionInstance(where, id, inst);
    counts[inst.type] = (counts[inst.type] || 0) + 1;
    const tplName = f.replace(/\.json$/, '').split('.')[0];
    const def = sections[inst.type];
    const eo = def && def.schema && def.schema.enabled_on;
    if (eo && eo.templates && !eo.templates.includes('*') && !eo.templates.includes(tplName)) err(where, `${inst.type} solo está habilitada en: ${eo.templates.join(', ')}`);
    const dis = def && def.schema && def.schema.disabled_on;
    if (dis && dis.templates && dis.templates.includes(tplName)) err(where, `${inst.type} está deshabilitada en ${tplName}`);
  }
  for (const [type, n] of Object.entries(counts)) {
    const lim = sections[type] && sections[type].schema && sections[type].schema.limit;
    if (lim && n > lim) err(where, `${type} admite como máximo ${lim} por plantilla (hay ${n})`);
  }
}
for (const f of readdirSync(join(root, 'sections')).filter((n) => n.endsWith('.json') && !n.includes('.context.'))) {
  const where = `sections/${f}`;
  const g = loose(join(root, 'sections', f));
  for (const k of ['type', 'name', 'sections', 'order']) if (!(k in g)) err(where, `grupo sin «${k}»`);
  Object.entries(g.sections || {}).forEach(([id, inst]) => checkSectionInstance(where, id, inst, true));
}

// Locales
for (const f of readdirSync(join(root, 'locales')).filter((n) => n.endsWith('.json'))) {
  try {
    loose(join(root, 'locales', f));
  } catch (e) {
    err('locales/' + f, 'JSON no válido: ' + e.message);
  }
}
if (!existsSync(join(root, 'layout', 'theme.liquid'))) err('layout', 'falta layout/theme.liquid');
const layout = readFileSync(join(root, 'layout', 'theme.liquid'), 'utf8');
if (!/content_for_header/.test(layout)) err('layout/theme.liquid', 'falta {{ content_for_header }}');
if (!/content_for_layout/.test(layout)) err('layout/theme.liquid', 'falta {{ content_for_layout }}');

console.log(`Secciones con schema: ${Object.values(sections).filter((s) => s.schema).length} · ajustes globales: ${allIds.size}`);
console.log(`Errores (${errors.length})`);
errors.forEach((e) => console.log('  ' + e));
console.log(errors.length ? '\nRESULTADO: CON ERRORES' : '\nRESULTADO: SIN ERRORES');
process.exit(errors.length ? 1 : 0);
