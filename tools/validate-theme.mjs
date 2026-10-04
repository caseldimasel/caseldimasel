#!/usr/bin/env node
// Validador estático del tema de Sidonia.
// NO sustituye a Shopify Theme Check ni al servidor de Shopify: es una comprobación independiente que cubre
// lo que se puede verificar sin red (JSON, schemas, balance de Liquid, referencias, traducciones, contraste).
// Uso: node tools/validate-theme.mjs [--json] [--quiet]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const THEME = join(ROOT, 'theme');
const args = new Set(process.argv.slice(2));

const errors = [];
const warnings = [];
const info = [];
const err = (file, msg, line) => errors.push({ file: relative(ROOT, file), line, msg });
const warn = (file, msg, line) => warnings.push({ file: relative(ROOT, file), line, msg });

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
}
const read = (f) => readFileSync(f, 'utf8');
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

const all = walk(THEME);
const byDir = (d) => all.filter((f) => relative(THEME, f).startsWith(d + '/'));
const sectionsDir = byDir('sections');
const snippetsDir = byDir('snippets');
const assets = new Set(byDir('assets').map((f) => basename(f)));
const snippetNames = new Set(snippetsDir.map((f) => basename(f, '.liquid')));
const sectionNames = new Set(sectionsDir.filter((f) => f.endsWith('.liquid')).map((f) => basename(f, '.liquid')));
const groupNames = new Set(sectionsDir.filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json')));

// ------------------------------------------------------------------ 1. estructura obligatoria
for (const req of ['layout/theme.liquid', 'config/settings_schema.json', 'config/settings_data.json', 'locales/es.default.json', 'templates/index.json', 'templates/product.json', 'templates/collection.json', 'templates/page.json', 'templates/search.json', 'templates/404.json', 'templates/cart.json', 'templates/blog.json', 'templates/article.json', 'templates/list-collections.json', 'templates/password.json', 'layout/password.liquid']) {
  if (!existsSync(join(THEME, req))) err(join(THEME, req), 'Archivo obligatorio ausente');
}
{
  const t = read(join(THEME, 'layout/theme.liquid'));
  if (!t.includes('{{ content_for_header }}')) err(join(THEME, 'layout/theme.liquid'), 'Falta {{ content_for_header }}');
  if (!t.includes('{{ content_for_layout }}')) err(join(THEME, 'layout/theme.liquid'), 'Falta {{ content_for_layout }}');
}

// ------------------------------------------------------------------ 2. JSON
const jsonCache = new Map();
for (const f of all.filter((f) => f.endsWith('.json'))) {
  try {
    jsonCache.set(f, JSON.parse(read(f)));
  } catch (e) {
    err(f, 'JSON inválido: ' + e.message);
  }
}

// ------------------------------------------------------------------ 3. schemas
const SETTING_TYPES = new Set(['checkbox', 'number', 'radio', 'range', 'select', 'text', 'textarea', 'article', 'blog', 'collection', 'collection_list', 'color', 'color_background', 'color_scheme', 'color_scheme_group', 'font_picker', 'html', 'image_picker', 'inline_richtext', 'link_list', 'liquid', 'page', 'product', 'product_list', 'richtext', 'text_alignment', 'url', 'video', 'video_url', 'metaobject', 'metaobject_list', 'header', 'paragraph']);
const NO_DEFAULT = new Set(['image_picker', 'collection', 'product', 'page', 'blog', 'article', 'product_list', 'collection_list', 'video', 'video_url']);

function validateSettings(file, settings, where, seen = new Set()) {
  if (!Array.isArray(settings)) return err(file, `${where}: settings debe ser una lista`);
  for (const s of settings) {
    if (!s.type || !SETTING_TYPES.has(s.type)) {
      err(file, `${where}: tipo de ajuste desconocido «${s.type}»`);
      continue;
    }
    if (s.type === 'header' || s.type === 'paragraph') {
      if (!s.content) err(file, `${where}: ${s.type} sin content`);
      continue;
    }
    if (!s.id || !/^[a-z0-9_]+$/.test(s.id)) err(file, `${where}: id inválido «${s.id}»`);
    if (seen.has(s.id)) err(file, `${where}: id duplicado «${s.id}»`);
    seen.add(s.id);
    if (!s.label) err(file, `${where}: ajuste «${s.id}» sin label`);
    if (s.type === 'select' || s.type === 'radio') {
      if (!Array.isArray(s.options) || s.options.length < 2) err(file, `${where}: «${s.id}» necesita al menos 2 opciones`);
      else {
        const vals = s.options.map((o) => o.value);
        if (new Set(vals).size !== vals.length) err(file, `${where}: «${s.id}» opciones duplicadas`);
        if (s.default !== undefined && !vals.includes(s.default)) err(file, `${where}: «${s.id}» default «${s.default}» no está en las opciones`);
        s.options.forEach((o) => {
          if (o.value === undefined || !o.label) err(file, `${where}: «${s.id}» opción sin value/label`);
        });
      }
    }
    if (s.type === 'range') {
      const { min, max, step, default: d } = s;
      if ([min, max, step, d].some((v) => typeof v !== 'number')) err(file, `${where}: range «${s.id}» necesita min, max, step y default numéricos`);
      else {
        if (d < min || d > max) err(file, `${where}: range «${s.id}» default fuera de rango`);
        if ((max - min) / step > 101) err(file, `${where}: range «${s.id}» tiene más de 101 pasos`);
        if (((d - min) / step) % 1 !== 0) err(file, `${where}: range «${s.id}» default no coincide con el paso`);
      }
    }
    if (s.type === 'checkbox' && s.default !== undefined && typeof s.default !== 'boolean') err(file, `${where}: checkbox «${s.id}» default debe ser booleano`);
    if (s.type === 'font_picker' && typeof s.default !== 'string') err(file, `${where}: font_picker «${s.id}» necesita default`);
    if (s.type === 'number' && s.default !== undefined && typeof s.default !== 'number') err(file, `${where}: number «${s.id}» default debe ser numérico`);
    if (s.type === 'video_url' && !Array.isArray(s.accept)) err(file, `${where}: video_url «${s.id}» necesita accept`);
    if (s.type === 'richtext' && s.default !== undefined && !/^<(p|ul|ol|h[1-6])/.test(s.default)) err(file, `${where}: richtext «${s.id}» default debe empezar por una etiqueta de bloque (<p>)`);
    if (NO_DEFAULT.has(s.type) && s.default !== undefined) err(file, `${where}: «${s.id}» (${s.type}) no admite default`);
    if (s.type === 'color' && s.default !== undefined && !/^#[0-9a-fA-F]{6}$/.test(s.default)) err(file, `${where}: color «${s.id}» default debe ser #RRGGBB`);
  }
}

const sectionSchemas = new Map(); // nombre -> schema
const NAME_MAX = 25;
const TAGS = new Set(['article', 'aside', 'div', 'footer', 'header', 'section']);

function extractSchema(file, text) {
  const matches = [...text.matchAll(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/g)];
  if (matches.length === 0) return { missing: true };
  if (matches.length > 1) err(file, 'Más de un {% schema %}');
  try {
    return { schema: JSON.parse(matches[0][1]), index: matches[0].index };
  } catch (e) {
    err(file, 'JSON del schema inválido: ' + e.message, lineOf(text, matches[0].index));
    return { invalid: true };
  }
}

for (const f of sectionsDir.filter((f) => f.endsWith('.liquid'))) {
  const name = basename(f, '.liquid');
  const text = read(f);
  const { schema, missing } = extractSchema(f, text);
  if (missing) {
    err(f, 'La sección no tiene {% schema %}');
    continue;
  }
  if (!schema) continue;
  sectionSchemas.set(name, schema);
  if (!schema.name) err(f, 'Schema sin name');
  else if (schema.name.length > NAME_MAX) err(f, `Nombre del schema de ${schema.name.length} caracteres (máx. ${NAME_MAX}): «${schema.name}»`);
  if (schema.tag && !TAGS.has(schema.tag)) err(f, `tag inválido «${schema.tag}»`);
  if (schema.settings) validateSettings(f, schema.settings, `sección ${name}`);
  if (schema.max_blocks > 50) err(f, 'max_blocks > 50');
  if (schema.enabled_on && schema.disabled_on) err(f, 'enabled_on y disabled_on a la vez');
  for (const k of ['enabled_on', 'disabled_on']) {
    if (schema[k]) {
      if (typeof schema[k] !== 'object' || (!schema[k].templates && !schema[k].groups)) err(f, `${k} necesita templates o groups`);
      for (const key of ['templates', 'groups']) if (schema[k][key] && (!Array.isArray(schema[k][key]) || schema[k][key].length === 0)) err(f, `${k}.${key} debe ser una lista no vacía`);
    }
  }
  const btypes = new Set();
  for (const b of schema.blocks || []) {
    if (!b.type) err(f, 'Bloque sin type');
    if (btypes.has(b.type)) err(f, `Tipo de bloque duplicado «${b.type}»`);
    btypes.add(b.type);
    if (b.type === '@app') continue;
    if (!b.name) err(f, `Bloque «${b.type}» sin name`);
    else if (b.name.length > NAME_MAX) err(f, `Nombre de bloque de ${b.name.length} caracteres: «${b.name}»`);
    if (b.settings) validateSettings(f, b.settings, `bloque ${b.type} de ${name}`);
  }
  const settingIds = new Set((schema.settings || []).map((s) => s.id).filter(Boolean));
  for (const p of schema.presets || []) {
    if (!p.name) err(f, 'Preset sin name');
    for (const k of Object.keys(p.settings || {})) if (!settingIds.has(k)) err(f, `Preset: ajuste desconocido «${k}»`);
    for (const b of p.blocks || []) {
      if (!btypes.has(b.type)) err(f, `Preset: tipo de bloque desconocido «${b.type}»`);
    }
    if (schema.max_blocks && (p.blocks || []).length > schema.max_blocks) err(f, 'Preset con más bloques que max_blocks');
  }
}

{
  const f = join(THEME, 'config/settings_schema.json');
  const sc = jsonCache.get(f);
  if (Array.isArray(sc)) {
    if (sc[0]?.name !== 'theme_info') err(f, 'El primer elemento debe ser theme_info');
    const seen = new Set();
    for (const g of sc.slice(1)) {
      if (!g.name) err(f, 'Grupo sin name');
      validateSettings(f, g.settings || [], `grupo «${g.name}»`, seen);
    }
    info.push(`Ajustes globales: ${seen.size}`);
  }
}

// ------------------------------------------------------------------ 4. plantillas JSON y grupos
function checkSectionRefs(f, data, templateBase) {
  const secs = data.sections || {};
  const ids = Object.keys(secs);
  if (!data.order && !f.includes('-group')) err(f, 'Falta order');
  for (const id of data.order || []) if (!secs[id]) err(f, `order referencia una sección inexistente «${id}»`);
  for (const id of ids) if (data.order && !data.order.includes(id)) err(f, `La sección «${id}» no está en order`);
  if (ids.length > 25) err(f, 'Más de 25 secciones');
  for (const [id, sec] of Object.entries(secs)) {
    const sch = sectionSchemas.get(sec.type);
    if (!sectionNames.has(sec.type)) {
      err(f, `Sección «${id}»: tipo inexistente «${sec.type}»`);
      continue;
    }
    if (!sch) continue;
    if (templateBase && sch.enabled_on?.templates && !sch.enabled_on.templates.includes(templateBase)) err(f, `La sección «${sec.type}» no está habilitada para la plantilla ${templateBase}`);
    if (!templateBase && sch.enabled_on?.groups && !sch.enabled_on.groups.includes(basename(f, '.json').replace('-group', ''))) {/* grupos: se acepta */}
    const settings = new Map((sch.settings || []).filter((s) => s.id).map((s) => [s.id, s]));
    for (const [k, v] of Object.entries(sec.settings || {})) {
      const def = settings.get(k);
      if (!def) {
        err(f, `Sección «${id}»: ajuste desconocido «${k}»`);
        continue;
      }
      if (def.type === 'select' && !def.options.some((o) => o.value === v)) err(f, `Sección «${id}»: valor «${v}» inválido para «${k}»`);
      if (def.type === 'checkbox' && typeof v !== 'boolean') err(f, `Sección «${id}»: «${k}» debe ser booleano`);
    }
    const btypes = new Map((sch.blocks || []).map((b) => [b.type, b]));
    const blocks = sec.blocks || {};
    const bids = Object.keys(blocks);
    if (sch.max_blocks && bids.length > sch.max_blocks) err(f, `Sección «${id}»: ${bids.length} bloques (máx. ${sch.max_blocks})`);
    if (bids.length && !sec.block_order) err(f, `Sección «${id}»: falta block_order`);
    for (const bid of sec.block_order || []) if (!blocks[bid]) err(f, `Sección «${id}»: block_order referencia «${bid}» inexistente`);
    for (const [bid, b] of Object.entries(blocks)) {
      const bd = btypes.get(b.type);
      if (!bd) {
        err(f, `Sección «${id}»: tipo de bloque desconocido «${b.type}»`);
        continue;
      }
      const bset = new Set((bd.settings || []).map((s) => s.id));
      for (const k of Object.keys(b.settings || {})) if (!bset.has(k)) err(f, `Bloque «${bid}»: ajuste desconocido «${k}»`);
    }
  }
}
for (const f of all.filter((f) => f.endsWith('.json'))) {
  const rel = relative(THEME, f);
  const data = jsonCache.get(f);
  if (!data) continue;
  if (rel.startsWith('templates/')) checkSectionRefs(f, data, basename(f).split('.')[0]);
  if (rel.startsWith('sections/')) checkSectionRefs(f, data, null);
}

// ------------------------------------------------------------------ 5. Liquid: balance, referencias, filtros
const KNOWN_FILTERS = new Set('abs append at_least at_most base64_decode base64_encode base64_url_safe_decode base64_url_safe_encode capitalize ceil compact concat date default divided_by downcase escape escape_once first floor join json last lstrip map minus modulo newline_to_br plus prepend remove remove_first remove_last replace replace_first replace_last reverse round rstrip size slice sort sort_natural split strip strip_html strip_newlines sum times truncate truncatewords uniq upcase url_decode url_encode where asset_url asset_img_url file_url global_asset_url image_url image_tag stylesheet_tag script_tag preload_tag link_to money money_with_currency money_without_currency money_without_trailing_zeros t time_tag font_face font_url font_modify color_brightness color_contrast color_darken color_lighten color_to_rgb color_extract color_modify color_saturate color_desaturate color_mix color_to_hsl color_to_hex color_difference metafield_tag metafield_text default_errors handleize handle pluralize within video_tag external_video_url external_video_tag structured_data json'.split(' '));
const BLOCK_TAGS = new Set(['if', 'unless', 'case', 'for', 'capture', 'form', 'paginate', 'tablerow', 'style', 'stylesheet', 'javascript', 'schema', 'comment', 'raw']);
const SIMPLE_TAGS = new Set(['assign', 'echo', 'render', 'include', 'section', 'sections', 'layout', 'liquid', 'else', 'elsif', 'when', 'break', 'continue', 'cycle', 'increment', 'decrement']);
const usedTranslationKeys = new Map(); // clave -> [archivos]
const usedAssets = [];
const usedSnippets = [];
const classesUsed = new Map();
const dataAttrsInLiquid = new Set();

function stripQuoted(s) {
  return s.replace(/'[^']*'|"[^"]*"/g, '""');
}

function checkExpression(file, text, idx, tag, expr) {
  const ln = lineOf(text, idx);
  const bare = stripQuoted(expr);
  if (/^(if|elsif|unless)$/.test(tag) && /[()]/.test(bare)) err(file, `Paréntesis en la condición de {% ${tag} %} (Liquid no los admite): ${expr.trim().slice(0, 80)}`, ln);
  if (tag === 'render') {
    if (/^\s*block\s*$/.test(expr)) return; // bloques de app: {% render block %}
    const m = /^\s*(['"])([^'"]+)\1\s*(?:,(.*))?$/s.exec(expr);
    if (!m) {
      err(file, `render con sintaxis inesperada: ${expr.trim().slice(0, 80)}`, ln);
      return;
    }
    usedSnippets.push({ name: m[2], file, ln });
    if (m[3] && /\|/.test(stripQuoted(m[3]))) err(file, `Los argumentos de render no admiten filtros: ${m[3].trim().slice(0, 80)}`, ln);
  }
  if (/default:[^|}%]*\|\s*t\b/.test(expr)) err(file, 'Patrón «default: clave | t»: traduce también el texto del comercio', ln);
  // filtros
  for (const m of bare.matchAll(/\|\s*([a-z_0-9]+)/g)) {
    if (!KNOWN_FILTERS.has(m[1])) warn(file, `Filtro no reconocido «${m[1]}»`, ln);
  }
}

function lintLiquid(file) {
  const text = read(file);
  const tokenRe = /\{%-?([\s\S]*?)-?%\}|\{\{-?([\s\S]*?)-?\}\}/g;
  const stack = [];
  let m;
  let skipUntil = null;
  while ((m = tokenRe.exec(text))) {
    const ln = lineOf(text, m.index);
    if (m[2] !== undefined && skipUntil === null) {
      // {{ ... }}
      const expr = m[2];
      for (const t of expr.matchAll(/'([a-z_0-9]+(?:\.[a-z_0-9]+)+)'\s*\|\s*t\b/g)) {
        if (!usedTranslationKeys.has(t[1])) usedTranslationKeys.set(t[1], []);
        usedTranslationKeys.get(t[1]).push(relative(ROOT, file) + ':' + ln);
      }
      for (const a of expr.matchAll(/'([^']+\.(?:css|js|svg|png|jpg|webp|woff2?))'\s*\|\s*(?:asset_url|asset_img_url)/g)) usedAssets.push({ name: a[1], file, ln });
      if (/default:[^|}]*\|\s*t\b/.test(expr)) err(file, 'Patrón «default: clave | t»', ln);
      for (const f of stripQuoted(expr).matchAll(/\|\s*([a-z_0-9]+)/g)) if (!KNOWN_FILTERS.has(f[1])) warn(file, `Filtro no reconocido «${f[1]}»`, ln);
      continue;
    }
    if (m[1] === undefined) continue;
    const inner = m[1].trim();
    if (skipUntil === null) {
      for (const t of inner.matchAll(/'([a-z_0-9]+(?:\.[a-z_0-9]+)+)'\s*\|\s*t\b/g)) {
        if (!usedTranslationKeys.has(t[1])) usedTranslationKeys.set(t[1], []);
        usedTranslationKeys.get(t[1]).push(relative(ROOT, file) + ':' + ln);
      }
    }
    const nameM = /^([a-z_]+)/.exec(inner);
    if (!nameM) {
      if (!inner.startsWith('#')) err(file, `Etiqueta vacía o ilegible {% ${inner.slice(0, 30)} %}`, ln);
      continue;
    }
    const tag = nameM[1];
    const rest = inner.slice(tag.length);
    if (skipUntil !== null) {
      if (tag === skipUntil) {
        skipUntil = null;
        if (stack.length && stack[stack.length - 1].tag === tag.replace(/^end/, '')) stack.pop();
      }
      continue;
    }
    if (tag === 'liquid') {
      lintLiquidBlock(file, text, m.index, rest, stack);
      continue;
    }
    if (tag === 'comment' || tag === 'raw' || tag === 'schema' || tag === 'stylesheet' || tag === 'javascript') {
      stack.push({ tag, ln });
      skipUntil = 'end' + tag;
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      stack.push({ tag, ln });
      checkExpression(file, text, m.index, tag, rest);
      continue;
    }
    if (tag.startsWith('end')) {
      const want = tag.slice(3);
      const top = stack.pop();
      if (!top) err(file, `{% ${tag} %} sin apertura`, ln);
      else if (top.tag !== want) err(file, `{% ${tag} %} cierra «${top.tag}» abierto en la línea ${top.ln}`, ln);
      continue;
    }
    if (tag === 'elsif' || tag === 'else' || tag === 'when') {
      const top = stack[stack.length - 1];
      if (!top) err(file, `{% ${tag} %} fuera de un bloque`, ln);
      else if (tag === 'elsif' && top.tag !== 'if') err(file, `{% elsif %} dentro de ${top.tag}`, ln);
      else if (tag === 'when' && top.tag !== 'case') err(file, `{% when %} dentro de ${top.tag}`, ln);
      checkExpression(file, text, m.index, tag, rest);
      continue;
    }
    if (SIMPLE_TAGS.has(tag)) {
      checkExpression(file, text, m.index, tag, rest);
      if (tag === 'sections') {
        const g = /['"]([^'"]+)['"]/.exec(rest);
        if (g && !groupNames.has(g[1])) err(file, `Grupo de secciones inexistente «${g[1]}»`, ln);
      }
      continue;
    }
    if (tag === 'form') continue;
    err(file, `Etiqueta desconocida {% ${tag} %}`, ln);
  }
  for (const open of stack) err(file, `Etiqueta {% ${open.tag} %} sin cerrar`, open.ln);
  // clases y atributos usados
  if (!file.includes('/sections/') || true) {
    for (const attr of text.matchAll(/\bclass="([^"]*)"/g)) {
      const cleaned = attr[1].replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, ' ');
      for (const c of cleaned.split(/\s+/)) {
        if (/^sd-[a-z0-9_-]+$/.test(c) && !classesUsed.has(c)) classesUsed.set(c, relative(ROOT, file));
      }
    }
    for (const a of text.matchAll(/\bdata-sd-[a-z0-9-]+/g)) dataAttrsInLiquid.add(a[0]);
  }
}

function lintLiquidBlock(file, text, baseIdx, body, stack) {
  const ln0 = lineOf(text, baseIdx);
  const lines = body.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const nm = /^([a-z_]+)/.exec(line);
    if (!nm) return;
    const tag = nm[1];
    const rest = line.slice(tag.length);
    const ln = ln0 + i;
    if (BLOCK_TAGS.has(tag)) {
      if (['comment', 'raw'].includes(tag)) return;
      stack.push({ tag, ln });
      checkExpression(file, text, baseIdx, tag, rest);
    } else if (tag.startsWith('end') && BLOCK_TAGS.has(tag.slice(3))) {
      const top = stack.pop();
      if (!top) err(file, `${tag} sin apertura (bloque liquid)`, ln);
      else if (top.tag !== tag.slice(3)) err(file, `${tag} cierra «${top.tag}» de la línea ${top.ln} (bloque liquid)`, ln);
    } else if (['elsif', 'else', 'when'].includes(tag)) {
      const top = stack[stack.length - 1];
      if (!top) err(file, `${tag} fuera de un bloque (bloque liquid)`, ln);
      checkExpression(file, text, baseIdx, tag, rest);
    } else if (SIMPLE_TAGS.has(tag)) {
      checkExpression(file, text, baseIdx, tag, rest);
      for (const t of rest.matchAll(/'([a-z_0-9]+(?:\.[a-z_0-9]+)+)'\s*\|\s*t\b/g)) {
        if (!usedTranslationKeys.has(t[1])) usedTranslationKeys.set(t[1], []);
        usedTranslationKeys.get(t[1]).push(relative(ROOT, file) + ':' + ln);
      }
    } else {
      err(file, `Etiqueta desconocida «${tag}» en bloque liquid`, ln);
    }
  });
}

for (const f of all.filter((f) => f.endsWith('.liquid'))) lintLiquid(f);

// claves dinámicas conocidas
for (const g of ['identity', 'mechanics', 'look', 'dimensions', 'engine', 'admin', 'property', 'layout', 'energy']) usedTranslationKeys.set('specs.group_' + g, ['dinámica']);
// claves *_key de form-field
for (const f of all.filter((f) => f.endsWith('.liquid'))) {
  const text = read(f);
  for (const m of text.matchAll(/(?:label_key|help_key|placeholder_key|options_key):\s*'([^']+)'/g)) {
    if (!usedTranslationKeys.has(m[1])) usedTranslationKeys.set(m[1], []);
    usedTranslationKeys.get(m[1]).push(relative(ROOT, f) + ':' + lineOf(text, m.index));
  }
}

for (const r of usedSnippets) if (!snippetNames.has(r.name)) err(r.file, `render de un snippet inexistente «${r.name}»`, r.ln);
for (const a of usedAssets) if (!assets.has(a.name)) err(a.file, `Asset inexistente «${a.name}»`, a.ln);
// scripts referenciados en layout con asset_url sin literal exacto
// snippet sin uso
{
  const used = new Set(usedSnippets.map((r) => r.name));
  for (const s of snippetNames) if (!used.has(s)) warn(join(THEME, 'snippets', s + '.liquid'), 'Snippet sin ningún render');
}

// ------------------------------------------------------------------ 6. traducciones
{
  const lf = join(THEME, 'locales/es.default.json');
  const loc = jsonCache.get(lf) || {};
  const get = (key) => key.split('.').reduce((n, p) => (n && typeof n === 'object' ? n[p] : undefined), loc);
  const flat = [];
  (function walkL(o, p) {
    for (const [k, v] of Object.entries(o)) (typeof v === 'object' ? walkL(v, p ? p + '.' + k : k) : flat.push(p ? p + '.' + k : k));
  })(loc, '');
  const usedLeaf = new Set();
  for (const [key, where] of usedTranslationKeys) {
    const v = get(key);
    if (v === undefined) err(lf, `Falta la traducción «${key}» (usada en ${where[0]})`);
    else if (typeof v === 'object') {
      if (!('other' in v)) err(lf, `«${key}» es un grupo sin forma «other» (usada en ${where[0]})`);
      Object.keys(v).forEach((k) => usedLeaf.add(key + '.' + k));
    } else usedLeaf.add(key);
  }
  // claves usadas desde JS (S.t('...'))
  for (const f of all.filter((f) => f.endsWith('.js'))) {
    const t = read(f);
    for (const m of t.matchAll(/S\.t\(\s*(?:[^'"()]*\?\s*)?'([a-z_0-9.]+)'(?:\s*:\s*'([a-z_0-9.]+)')?/g)) {
      for (const key of [m[1], m[2]].filter(Boolean)) {
        const v = get(key);
        if (v === undefined) err(f, `JS usa una traducción inexistente «${key}»`);
        const cfg = read(join(THEME, 'snippets/js-config.liquid'));
        if (!cfg.includes(`"${key}"`)) err(f, `La cadena «${key}» no se exporta en snippets/js-config.liquid`);
        usedLeaf.add(key);
      }
    }
  }
  const unused = flat.filter((k) => !usedLeaf.has(k));
  if (unused.length) info.push(`Traducciones sin uso detectado (${unused.length}): ${unused.slice(0, 8).join(', ')}${unused.length > 8 ? '…' : ''}`);
  info.push(`Cadenas de interfaz: ${flat.length}`);
}

// ------------------------------------------------------------------ 7. CSS: clases usadas y definidas
{
  const css = all.filter((f) => f.endsWith('.css')).map(read).join('\n');
  const defined = new Set([...css.matchAll(/\.(sd-[a-z0-9_-]+)/g)].map((m) => m[1]));
  const jsClasses = new Set();
  for (const f of all.filter((f) => f.endsWith('.js'))) for (const m of read(f).matchAll(/\b(sd-[a-z0-9_-]+)\b/g)) jsClasses.add(m[1]);
  const undef = [];
  for (const [c, where] of classesUsed) {
    if (!defined.has(c) && !/^sd-(live|toast)$/.test(c)) undef.push(`${c} (${where})`);
  }
  // elementos personalizados y atributos no son clases
  const custom = new Set(['sd-header', 'sd-video-modal', 'sd-video-stage', 'sd-save', 'sd-fav-count', 'sd-favorites-page', 'sd-facets', 'sd-form', 'sd-sell-form', 'sd-share', 'sd-stickybar', 'sd-track', 'sd-config', 'sd-newsletter', 'sd-skip', 'sd-search', 'sd-nl']);
  const realUndef = undef.filter((u) => !custom.has(u.split(' ')[0]) && !/^sd-(search|nl|ft|hero-q|tokens|inquiry|inq|want|cont|sell|vmodal-title|suggest-title|pwd|newsletter)/.test(u.split(' ')[0]));
  if (realUndef.length) warn(join(THEME, 'assets'), `Clases usadas en Liquid sin regla en el CSS (${realUndef.length}): ${realUndef.slice(0, 40).join(', ')}`);
  // atributos data-sd-* usados por JS que no existen en Liquid
  const jsAttrs = new Set();
  for (const f of all.filter((f) => f.endsWith('.js'))) for (const m of read(f).matchAll(/data-sd-[a-z0-9-]+/g)) jsAttrs.add(m[0]);
  const dyn = new Set(['data-sd-swap', 'data-sd-base-required', 'data-sd-fav-removed-title']);
  const missingAttrs = [...jsAttrs].filter((a) => !dataAttrsInLiquid.has(a) && !dyn.has(a));
  if (missingAttrs.length) warn(join(THEME, 'assets'), `Atributos data-sd-* que usa el JS y no aparecen en Liquid: ${missingAttrs.join(', ')}`);
}

// ------------------------------------------------------------------ 8. contenido prohibido
for (const f of all.filter((f) => /\.(liquid|json|js|css)$/.test(f))) {
  const t = read(f);
  if (/harbour/i.test(t)) err(f, 'Aparece «HARBOUR»: la marca es HARBOR');
  if (/lorem ipsum/i.test(t)) err(f, 'Texto de relleno «lorem ipsum»');
  if (/example\.(com|org)|\+34\s?6\d\d|\+1\s?555/.test(t)) err(f, 'Dato de ejemplo (email o teléfono) en el tema');
  if (/(<script[^>]+src=["']https?:\/\/(?!cdn\.shopify))/i.test(t)) err(f, 'Script de terceros cargado directamente');
  if (/\b(Admin API|shpat_|shpss_|access_token)\b/.test(t)) err(f, 'Posible credencial');
  if (/\bproduct\.available\b|\bvariant\.available\b/.test(t) && f.endsWith('.liquid')) warn(f, 'Se usa product.available: el estado editorial no debe depender del inventario');
  if (/add_to_cart|product-form|\/cart\/add|type:\s*'add'|name="add"/.test(t) && f.endsWith('.liquid')) err(f, 'Aparece interfaz de compra (añadir al carrito)');
}

// ------------------------------------------------------------------ 9. contraste de la paleta por defecto
function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum([r, g, b]) {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [l1, l2] = [lum(hex2rgb(a)), lum(hex2rgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function mix(a, b, pa) {
  const A = hex2rgb(a), B = hex2rgb(b);
  const m = A.map((v, i) => Math.round(v * pa + B[i] * (1 - pa)));
  return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const contrastRows = [];
{
  const sc = jsonCache.get(join(THEME, 'config/settings_schema.json')) || [];
  const d = {};
  for (const g of sc) for (const s of g.settings || []) if (s.id && s.default !== undefined) d[s.id] = s.default;
  const checks = [
    ['Texto sobre fondo', d.color_text, d.color_bg, 4.5],
    ['Texto sobre superficie', d.color_text, d.color_surface, 4.5],
    ['Texto secundario sobre fondo', d.color_muted, d.color_bg, 4.5],
    ['Texto secundario sobre superficie alternativa', d.color_muted, d.color_surface_alt, 4.5],
    ['Texto del botón sobre botón', d.color_button_text, d.color_button, 4.5],
    ['Texto claro sobre fondo oscuro', '#F5F0E6', d.color_dark, 4.5],
    ['Anillo de foco sobre fondo', d.color_focus, d.color_bg, 3],
    ['Borde de campo sobre superficie', mix(d.color_text, d.color_surface, 0.55), d.color_surface, 3],
    ['Garage como texto sobre superficie alternativa', d.color_garage, d.color_surface_alt, 4.5],
    ['Harbor como texto sobre superficie alternativa', d.color_harbor, d.color_surface_alt, 4.5],
    ['Estate como texto sobre superficie alternativa', d.color_estate, d.color_surface_alt, 4.5],
    ['Garage como texto sobre fondo', d.color_garage, d.color_bg, 4.5],
    ['Harbor como texto sobre fondo', d.color_harbor, d.color_bg, 4.5],
    ['Estate como texto sobre fondo', d.color_estate, d.color_bg, 4.5],
    ['Texto sobre Garage', d.color_surface, d.color_garage, 4.5],
    ['Texto sobre Harbor', d.color_surface, d.color_harbor, 4.5],
    ['Texto sobre Estate', d.color_surface, d.color_estate, 4.5],
    ['Error (#9c2018) sobre superficie', '#9c2018', d.color_surface, 4.5],
    ['Éxito (#2d6a4a) sobre superficie', '#2d6a4a', d.color_surface, 4.5],
    ['Reservado (#8a5a00) sobre superficie', '#8a5a00', d.color_surface, 3]
  ];
  for (const [name, fg, bg, min] of checks) {
    const r = ratio(fg, bg);
    contrastRows.push({ name, fg, bg, ratio: r.toFixed(2), min, ok: r >= min });
    if (r < min) err(join(THEME, 'config/settings_schema.json'), `Contraste insuficiente: ${name} ${r.toFixed(2)}:1 (mín. ${min}:1)`);
  }
}

// ------------------------------------------------------------------ 10. tamaños
const sizes = [];
for (const f of byDir('assets')) sizes.push([basename(f), statSync(f).size]);
const totalCss = sizes.filter(([n]) => n.endsWith('.css')).reduce((a, [, s]) => a + s, 0);
const totalJs = sizes.filter(([n]) => n.endsWith('.js')).reduce((a, [, s]) => a + s, 0);
info.push(`CSS total: ${(totalCss / 1024).toFixed(1)} KB · JS total: ${(totalJs / 1024).toFixed(1)} KB (sin comprimir)`);
info.push(`Archivos del tema: ${all.length} · secciones: ${sectionNames.size} · snippets: ${snippetNames.size}`);

// ------------------------------------------------------------------ informe
if (args.has('--json')) {
  console.log(JSON.stringify({ errors, warnings, info, contrast: contrastRows }, null, 2));
} else {
  const fmt = (x) => `  ${x.file}${x.line ? ':' + x.line : ''}  ${x.msg}`;
  if (!args.has('--quiet')) {
    console.log('\nContraste de la paleta por defecto');
    for (const r of contrastRows) console.log(`  ${r.ok ? 'OK ' : 'FALLA'} ${r.ratio.padStart(5)}:1 (mín. ${r.min})  ${r.name}`);
    console.log('\nInformación');
    info.forEach((i) => console.log('  ' + i));
  }
  if (warnings.length) {
    console.log(`\nAvisos (${warnings.length})`);
    warnings.forEach((w) => console.log(fmt(w)));
  }
  console.log(`\nErrores (${errors.length})`);
  errors.forEach((e) => console.log(fmt(e)));
  console.log(errors.length ? '\nRESULTADO: CON ERRORES' : '\nRESULTADO: SIN ERRORES');
}
process.exit(errors.length ? 1 : 0);
